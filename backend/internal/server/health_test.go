package server

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestHealthRouteReturnsAllHealthyDependencyStatuses(t *testing.T) {
	recorder := httptest.NewRecorder()
	NewHandler(HealthRoute(healthyHealthChecker())).ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/healthz", nil))

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", recorder.Code)
	}
	if got := recorder.Header().Get("Content-Type"); got != "application/json" {
		t.Fatalf("expected JSON content type, got %q", got)
	}
	response := decodeHealthResponse(t, recorder)
	if response.Status != healthStatusOK {
		t.Fatalf("health status = %q, want ok", response.Status)
	}
	assertDependencyStatuses(t, response, healthStatusOK)
}

func TestHealthRouteReturnsDegradedForUnavailableDependency(t *testing.T) {
	checker := healthyHealthChecker()
	checker.probes["redis"] = func(context.Context) error {
		return errors.New("redis password must not be exposed")
	}
	recorder := httptest.NewRecorder()
	NewHandler(HealthRoute(checker)).ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/healthz", nil))

	if recorder.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503, got %d", recorder.Code)
	}
	response := decodeHealthResponse(t, recorder)
	if response.Status != healthStatusDegraded {
		t.Fatalf("health status = %q, want degraded", response.Status)
	}
	if response.Dependencies["redis"].Status != healthStatusUnavailable {
		t.Fatalf("redis status = %q, want unavailable", response.Dependencies["redis"].Status)
	}
	if strings.Contains(recorder.Body.String(), "redis password") {
		t.Fatalf("health response leaked probe error: %s", recorder.Body.String())
	}
}

func TestHealthRouteMarksMissingProbeNotConfigured(t *testing.T) {
	checker := &HealthChecker{probes: map[string]healthProbe{
		"casdoor": func(context.Context) error { return nil },
	}}
	recorder := httptest.NewRecorder()
	NewHandler(HealthRoute(checker)).ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/healthz", nil))

	if recorder.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503, got %d", recorder.Code)
	}
	response := decodeHealthResponse(t, recorder)
	if response.Dependencies["vault"].Status != healthStatusNotConfigured {
		t.Fatalf("vault status = %q, want not_configured", response.Dependencies["vault"].Status)
	}
}

func TestHealthRouteBoundsProbeTimeout(t *testing.T) {
	checker := healthyHealthChecker()
	for _, name := range healthDependencyNames {
		checker.probes[name] = func(ctx context.Context) error {
			<-ctx.Done()
			return ctx.Err()
		}
	}
	checker.timeout = 20 * time.Millisecond

	started := time.Now()
	recorder := httptest.NewRecorder()
	NewHandler(HealthRoute(checker)).ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/healthz", nil))
	if elapsed := time.Since(started); elapsed > 250*time.Millisecond {
		t.Fatalf("health probes exceeded bounded timeout: %s", elapsed)
	}
	if recorder.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503, got %d", recorder.Code)
	}
}

func healthyHealthChecker() *HealthChecker {
	probes := make(map[string]healthProbe, len(healthDependencyNames))
	for _, name := range healthDependencyNames {
		probes[name] = func(context.Context) error { return nil }
	}
	return &HealthChecker{probes: probes, timeout: time.Second}
}

func decodeHealthResponse(t *testing.T, recorder *httptest.ResponseRecorder) healthResponse {
	t.Helper()
	var response healthResponse
	if err := json.NewDecoder(recorder.Body).Decode(&response); err != nil {
		t.Fatalf("decode health response: %v", err)
	}
	return response
}

func assertDependencyStatuses(t *testing.T, response healthResponse, want string) {
	t.Helper()
	if len(response.Dependencies) != len(healthDependencyNames) {
		t.Fatalf("dependency count = %d, want %d", len(response.Dependencies), len(healthDependencyNames))
	}
	for _, name := range healthDependencyNames {
		dependency, ok := response.Dependencies[name]
		if !ok {
			t.Fatalf("dependency %q missing from response", name)
		}
		if dependency.Status != want {
			t.Errorf("dependency %q status = %q, want %q", name, dependency.Status, want)
		}
	}
}
