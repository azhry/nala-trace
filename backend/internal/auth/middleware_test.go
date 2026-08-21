package auth

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/azhry/nala-trace/backend/internal/config"
)

type stubAPIKeyValidator struct {
	wantKey string
	user    User
	calls   int
}

func (stub *stubAPIKeyValidator) Validate(_ context.Context, key string) (User, error) {
	stub.calls++
	if key != stub.wantKey {
		return User{}, ErrUnauthenticated
	}
	return stub.user, nil
}

func testAuthConfig(upstreamURL string) config.Config {
	return config.Config{
		Auth: config.AuthConfig{
			NalaLabsAuthURL: upstreamURL,
			Timeout:         time.Second,
		},
	}
}

func protectedOKHandler() http.Handler {
	return http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		user, ok := UserFromContext(request.Context())
		if !ok {
			http.Error(writer, "missing user", http.StatusInternalServerError)
			return
		}
		writer.Header().Set("Content-Type", "text/plain")
		_, _ = fmt.Fprintf(writer, "%s:%s", user.ID, user.Tier)
	})
}

func TestMiddlewareAcceptsNalaLabsJWT(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if got, want := request.Header.Get("Authorization"), "Bearer jwt-test"; got != want {
			t.Fatalf("Authorization = %q, want %q", got, want)
		}
		_, _ = writer.Write([]byte(`{"authenticated":true,"user":{"id":"jwt-user","tier":"developer"}}`))
	}))
	defer upstream.Close()

	middleware := NewMiddleware(testAuthConfig(upstream.URL), NewIAMClient(testAuthConfig(upstream.URL).Auth), nil)
	request := httptest.NewRequest(http.MethodGet, "/sessions", nil)
	request.Header.Set("Authorization", "Bearer jwt-test")
	response := httptest.NewRecorder()

	middleware.Handler(protectedOKHandler()).ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d: %s", response.Code, http.StatusOK, response.Body.String())
	}
	if got, want := response.Body.String(), "jwt-user:Developer"; got != want {
		t.Fatalf("body = %q, want %q", got, want)
	}
}

func TestMiddlewareAcceptsNalaLabsAPIKey(t *testing.T) {
	apiKeys := &stubAPIKeyValidator{
		wantKey: "api-key-test",
		user:    User{ID: "api-user", Tier: TierAdmin},
	}
	middleware := NewMiddleware(testAuthConfig("http://unused.example"), nil, apiKeys)
	request := httptest.NewRequest(http.MethodGet, "/sessions", nil)
	request.Header.Set("X-Nala-Labs-API-Key", "api-key-test")
	response := httptest.NewRecorder()

	middleware.Handler(protectedOKHandler()).ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d: %s", response.Code, http.StatusOK, response.Body.String())
	}
	if got, want := response.Body.String(), "api-user:Admin"; got != want {
		t.Fatalf("body = %q, want %q", got, want)
	}
	if apiKeys.calls != 1 {
		t.Fatalf("API-key validator calls = %d, want 1", apiKeys.calls)
	}
}

func TestMiddlewareRejectsAmbiguousCredentials(t *testing.T) {
	apiKeys := &stubAPIKeyValidator{wantKey: "api-key-test", user: User{ID: "api-user", Tier: TierAdmin}}
	middleware := NewMiddleware(testAuthConfig("http://unused.example"), nil, apiKeys)
	request := httptest.NewRequest(http.MethodGet, "/sessions", nil)
	request.Header.Set("Authorization", "Bearer jwt-test")
	request.Header.Set("X-API-Key", "api-key-test")
	response := httptest.NewRecorder()

	middleware.Handler(protectedOKHandler()).ServeHTTP(response, request)

	if response.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusUnauthorized)
	}
	if got := response.Body.String(); !strings.Contains(got, "ambiguous_credentials") {
		t.Fatalf("body = %q, want ambiguous_credentials", got)
	}
	if apiKeys.calls != 0 {
		t.Fatalf("API-key validator calls = %d, want 0", apiKeys.calls)
	}
}
