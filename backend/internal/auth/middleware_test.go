package auth

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/azhry/nala-trace/backend/internal/config"
)

func TestMiddlewareAcceptsApplicationSessionAndAddsContext(t *testing.T) {
	sessions := NewSessionManager(config.SessionConfig{CookieName: "session", Secret: "secret", TTL: time.Hour, CookieSameSite: "Lax"})
	loginResponse := httptest.NewRecorder()
	if err := sessions.Create(loginResponse, Session{UserID: "user-1", Tier: TierFree}); err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodGet, "/protected", nil)
	request.AddCookie(loginResponse.Result().Cookies()[0])
	request.Header.Set("Origin", "http://localhost:5005")
	recorder := httptest.NewRecorder()
	base := config.Config{AllowedOrigin: "http://localhost:5005"}
	NewMiddleware(base, sessions, nil).Handler(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		user, ok := UserFromContext(request.Context())
		if !ok || user.ID != "user-1" {
			t.Fatalf("missing user context: %+v %v", user, ok)
		}
		w.WriteHeader(http.StatusNoContent)
	})).ServeHTTP(recorder, request)
	if recorder.Code != http.StatusNoContent || recorder.Header().Get("Access-Control-Allow-Credentials") != "true" {
		t.Fatalf("unexpected middleware response: %d %+v", recorder.Code, recorder.Header())
	}
}

func TestMiddlewareAcceptsAPIKeyAndRejectsBadOrigin(t *testing.T) {
	base := config.Config{AllowedOrigin: "http://localhost:5005", IngestToken: "api-key"}
	request := httptest.NewRequest(http.MethodGet, "/protected", nil)
	request.Header.Set("X-API-Key", "api-key")
	recorder := httptest.NewRecorder()
	called := false
	NewMiddleware(base, nil, nil).Handler(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { called = true; w.WriteHeader(http.StatusNoContent) })).ServeHTTP(recorder, request)
	if recorder.Code != http.StatusNoContent || !called {
		t.Fatalf("API key was not accepted: status=%d called=%v", recorder.Code, called)
	}
	badOrigin := httptest.NewRequest(http.MethodGet, "/protected", nil)
	badOrigin.Header.Set("Origin", "https://evil.example")
	badRecorder := httptest.NewRecorder()
	NewMiddleware(base, nil, nil).Handler(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { t.Fatal("handler should not run") })).ServeHTTP(badRecorder, badOrigin)
	if badRecorder.Code != http.StatusForbidden {
		t.Fatalf("bad origin status = %d", badRecorder.Code)
	}
}

func TestMiddlewareRejectsMissingAndProviderFailureWithoutToken(t *testing.T) {
	base := config.Config{AllowedOrigin: "http://localhost:5005"}
	request := httptest.NewRequest(http.MethodGet, "/protected", nil)
	recorder := httptest.NewRecorder()
	NewMiddleware(base, nil, nil).Handler(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { t.Fatal("handler should not run") })).ServeHTTP(recorder, request)
	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("missing auth status = %d", recorder.Code)
	}
}
