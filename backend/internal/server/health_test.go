package server

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestHealthRouteReturnsStableJSONWithoutDependencies(t *testing.T) {
	recorder := httptest.NewRecorder()
	NewHandler(HealthRoute()).ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/healthz", nil))

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", recorder.Code)
	}
	if got := recorder.Header().Get("Content-Type"); got != "application/json" {
		t.Fatalf("expected JSON content type, got %q", got)
	}
	if got := recorder.Body.String(); got != "{\"status\":\"ok\"}\n" {
		t.Fatalf("unexpected health response: %q", got)
	}
}
