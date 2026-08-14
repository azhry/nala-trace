package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestHealthRouteReturnsSiblingDependencyStatuses(t *testing.T) {
	recorder := httptest.NewRecorder()
	NewHandler(HealthRoute()).ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/healthz", nil))

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", recorder.Code)
	}
	if got := recorder.Header().Get("Content-Type"); got != "application/json" {
		t.Fatalf("expected JSON content type, got %q", got)
	}
	var response healthResponse
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
		dependency, ok := response.Dependencies[name]
		if !ok {
			t.Fatalf("dependency %q missing from response", name)
		}
		if dependency.Status != "not_configured" {
			t.Errorf("dependency %q status = %q, want not_configured", name, dependency.Status)
		}
	}
}
