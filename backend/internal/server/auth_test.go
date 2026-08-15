package server

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/azhry/nala-trace/backend/internal/auth"
	"github.com/azhry/nala-trace/backend/internal/config"
)

func TestAuthRoutesLoginSessionAndLogout(t *testing.T) {
	iamServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/api/auth/login" {
			t.Fatalf("unexpected IAM path: %s", request.URL.Path)
		}
		_, _ = w.Write([]byte(`{"authenticated":true,"user":{"id":"user-1","name":"User","roles":["developer"]}}`))
	}))
	defer iamServer.Close()
	cfg := config.Config{
		Auth:    config.AuthConfig{NalaLabsAuthURL: iamServer.URL},
		Session: config.SessionConfig{CookieName: "session", Secret: "test-session-secret", TTL: time.Hour, CookieSameSite: "Lax"},
	}
	authRoutes := NewAuthRoutes(cfg)
	login := httptest.NewRecorder()
	authRoutes.login(login, httptest.NewRequest(http.MethodPost, "/api/auth/login", strings.NewReader(`{"username":"user","password":"password"}`)))
	if login.Code != http.StatusOK || len(login.Result().Cookies()) != 1 {
		t.Fatalf("login response: %d cookies=%v body=%s", login.Code, login.Result().Cookies(), login.Body.String())
	}
	sessionRequest := httptest.NewRequest(http.MethodGet, "/api/auth/session", nil)
	sessionRequest.AddCookie(login.Result().Cookies()[0])
	session := httptest.NewRecorder()
	authRoutes.session(session, sessionRequest)
	if session.Code != http.StatusOK || !strings.Contains(session.Body.String(), "user-1") || !strings.Contains(session.Body.String(), "Developer") {
		t.Fatalf("session response: %d %s", session.Code, session.Body.String())
	}
	logout := httptest.NewRecorder()
	logoutRequest := httptest.NewRequest(http.MethodPost, "/api/auth/logout", nil)
	logoutRequest.AddCookie(login.Result().Cookies()[0])
	authRoutes.logout(logout, logoutRequest)
	if logout.Code != http.StatusNoContent || logout.Result().Cookies()[0].MaxAge != -1 {
		t.Fatalf("logout response: %d cookies=%v", logout.Code, logout.Result().Cookies())
	}
}

func TestAuthSessionWithoutCookieIsJSON401(t *testing.T) {
	routes := NewAuthRoutes(config.Config{Session: config.SessionConfig{CookieName: "session", Secret: "test-session-secret", TTL: time.Hour, CookieSameSite: "Lax"}})
	recorder := httptest.NewRecorder()
	routes.session(recorder, httptest.NewRequest(http.MethodGet, "/api/auth/session", nil))
	if recorder.Code != http.StatusUnauthorized || recorder.Header().Get("Content-Type") != "application/json" {
		t.Fatalf("unexpected session error: %d %s", recorder.Code, recorder.Body.String())
	}
}

func TestProtectedRouteUsesMiddlewareWhileHealthCanRemainPublic(t *testing.T) {
	cfg := config.Config{AllowedOrigin: "http://localhost:5005"}
	middleware := auth.NewMiddleware(cfg, nil, nil)
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
