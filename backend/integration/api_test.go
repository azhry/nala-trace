package integration

import (
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/azhry/nala-trace/backend/internal/config"
	"github.com/azhry/nala-trace/backend/internal/server"
)

func TestHealthEndpointThroughConfiguredServer(t *testing.T) {
	dependencyHTTP := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer dependencyHTTP.Close()

	listeners := make([]net.Listener, 4)
	for index := range listeners {
		listener, err := net.Listen("tcp", "127.0.0.1:0")
		if err != nil {
			t.Fatalf("listen for dependency %d: %v", index, err)
		}
		listeners[index] = listener
		defer listener.Close()
	}

	cfg, err := config.LoadFrom(map[string]string{
		"AUTH_LISTEN_ADDR":    ":0",
		"NALA_LABS_AUTH_URL":  dependencyHTTP.URL,
		"VAULT_ADDR":          dependencyHTTP.URL,
		"VAULT_KV_MOUNT":      "secret",
		"VAULT_KV_PATH":       "nala-trace/test",
		"POSTGRESQL_ADDRESS":  listeners[0].Addr().String(),
		"MONGO_URI":           fmt.Sprintf("mongodb://%s", listeners[1].Addr()),
		"REDIS_ADDRESS":       listeners[2].Addr().String(),
		"KAFKA_ADDRESS":       listeners[3].Addr().String(),
		"HEALTHCHECK_TIMEOUT": "1s",
	})
	if err != nil {
		t.Fatalf("load config: %v", err)
	}
	health := server.NewHealthChecker(cfg, nil)
	handler := server.New(cfg, server.HealthRoute(health)).HTTP.Handler
	request := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK || recorder.Header().Get("Content-Type") != "application/json" {
		t.Fatalf("unexpected health response: status=%d content-type=%q", recorder.Code, recorder.Header().Get("Content-Type"))
	}
	var response struct {
		Status       string                       `json:"status"`
		Dependencies map[string]map[string]string `json:"dependencies"`
	}
	if err := json.NewDecoder(recorder.Body).Decode(&response); err != nil {
		t.Fatalf("decode health response: %v", err)
	}
	if response.Status != "ok" {
		t.Fatalf("health status = %q, want ok", response.Status)
	}
	wantDependencies := []string{"casdoor", "vault", "postgresql", "mongodb", "redis", "kafka"}
	if len(response.Dependencies) != len(wantDependencies) {
		t.Fatalf("dependency count = %d, want %d", len(response.Dependencies), len(wantDependencies))
	}
	for _, name := range wantDependencies {
		if response.Dependencies[name]["status"] != "ok" {
			t.Fatalf("dependency %q = %+v, want ok", name, response.Dependencies[name])
		}
	}
}
