package integration

import (
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
}
