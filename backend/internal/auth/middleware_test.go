package auth

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/azhry/nala-trace/backend/internal/config"
)

func TestMiddlewareAcceptsNalaLabsBearerTokenAndAddsContext(t *testing.T) {
	iamServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/api/auth/session" || request.Header.Get("Authorization") != "Bearer nala-token" {
			t.Fatalf("unexpected validation request: %s %s", request.URL.Path, request.Header.Get("Authorization"))
		}
		_, _ = w.Write([]byte(`{"authenticated":true,"user":{"id":"user-1","roles":["developer"]}}`))
	}))
	defer iamServer.Close()

	request := httptest.NewRequest(http.MethodGet, "/protected", nil)
	request.Header.Set("Authorization", "Bearer nala-token")
	request.Header.Set("Origin", "http://localhost:5005")
	recorder := httptest.NewRecorder()
	base := config.Config{AllowedOrigin: "http://localhost:5005", Auth: config.AuthConfig{NalaLabsAuthURL: iamServer.URL}}
	NewMiddleware(base, NewIAMClient(base.Auth)).Handler(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		user, ok := UserFromContext(request.Context())
		if !ok || user.ID != "user-1" || user.Tier != TierDeveloper {
			t.Fatalf("missing user context: %+v %v", user, ok)
		}
		w.WriteHeader(http.StatusNoContent)
	})).ServeHTTP(recorder, request)
	if recorder.Code != http.StatusNoContent || recorder.Header().Get("Access-Control-Allow-Credentials") != "true" {
		t.Fatalf("unexpected middleware response: %d %+v", recorder.Code, recorder.Header())
	}
}

func TestMiddlewareAcceptsNalaLabsAPIKeyAndRejectsBadOrigin(t *testing.T) {
	base := config.Config{AllowedOrigin: "http://localhost:5005", Auth: config.AuthConfig{APIKey: "api-key"}}
	request := httptest.NewRequest(http.MethodGet, "/protected", nil)
	request.Header.Set("X-Nala-Labs-API-Key", "api-key")
	recorder := httptest.NewRecorder()
	called := false
	NewMiddleware(base, nil).Handler(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { called = true; w.WriteHeader(http.StatusNoContent) })).ServeHTTP(recorder, request)
	if recorder.Code != http.StatusNoContent || !called {
		t.Fatalf("API key was not accepted: status=%d called=%v", recorder.Code, called)
	}

	badOrigin := httptest.NewRequest(http.MethodGet, "/protected", nil)
	badOrigin.Header.Set("Origin", "https://evil.example")
	badRecorder := httptest.NewRecorder()
	NewMiddleware(base, nil).Handler(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { t.Fatal("handler should not run") })).ServeHTTP(badRecorder, badOrigin)
	if badRecorder.Code != http.StatusForbidden {
		t.Fatalf("bad origin status = %d", badRecorder.Code)
	}
}

func TestMiddlewareRejectsMissingAuthentication(t *testing.T) {
	base := config.Config{AllowedOrigin: "http://localhost:5005"}
	request := httptest.NewRequest(http.MethodGet, "/protected", nil)
	recorder := httptest.NewRecorder()
	NewMiddleware(base, nil).Handler(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { t.Fatal("handler should not run") })).ServeHTTP(recorder, request)
	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("missing auth status = %d", recorder.Code)
	}
}
