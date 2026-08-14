package integration

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/azhry/nala-trace/backend/internal/config"
	"github.com/azhry/nala-trace/backend/internal/server"
)

func TestHealthEndpointThroughConfiguredServer(t *testing.T) {
	cfg, err := config.LoadFrom(map[string]string{"AUTH_LISTEN_ADDR": ":0"})
	if err != nil {
		t.Fatalf("load config: %v", err)
	}
	handler := server.New(cfg, server.HealthRoute()).HTTP.Handler
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
		if response.Dependencies[name]["status"] != "not_configured" {
			t.Fatalf("dependency %q = %+v, want not_configured", name, response.Dependencies[name])
		}
	}
}
