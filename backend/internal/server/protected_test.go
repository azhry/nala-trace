package server

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/azhry/nala-trace/backend/internal/auth"
	"github.com/azhry/nala-trace/backend/internal/config"
)

func TestProtectedRouteUsesMiddlewareWhileHealthCanRemainPublic(t *testing.T) {
	cfg := config.Config{AllowedOrigin: "http://localhost:5005"}
	middleware := auth.NewMiddleware(cfg, nil)
	handler := NewHandler(ProtectedRoute("/protected", http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}), middleware))
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/protected", nil))
	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("protected route status = %d", recorder.Code)
	}

	healthRecorder := httptest.NewRecorder()
	NewHandler(HealthRoute(nil)).ServeHTTP(healthRecorder, httptest.NewRequest(http.MethodGet, "/healthz", nil))
	if healthRecorder.Code != http.StatusServiceUnavailable {
		t.Fatalf("health route was not left public: %d", healthRecorder.Code)
	}
}
