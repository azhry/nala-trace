package auth

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/azhry/nala-trace/backend/internal/config"
)

func TestIAMClientValidateBearerMapsNormalizedUser(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/auth/session" || r.Header.Get("Authorization") != "Bearer token" {
			t.Fatalf("unexpected validation request: %s %s", r.URL.Path, r.Header.Get("Authorization"))
		}
		_, _ = w.Write([]byte(`{"authenticated":true,"user":{"id":"user-1","display_name":"User","roles":["developer"],"token":"must-not-be-used"}}`))
	}))
	defer server.Close()
	client := NewIAMClient(config.AuthConfig{NalaLabsAuthURL: server.URL})
	user, err := client.ValidateBearer(context.Background(), "token")
	if err != nil || user.ID != "user-1" || user.Tier != TierDeveloper || user.Name != "User" {
		t.Fatalf("ValidateBearer = %+v, err=%v", user, err)
	}
}

func TestIAMClientMapsFailuresWithoutProviderBody(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte("password secret must not escape"))
	}))
	defer server.Close()
	client := NewIAMClient(config.AuthConfig{NalaLabsAuthURL: server.URL})
	_, err := client.ValidateBearer(context.Background(), "token")
	if !errors.Is(err, ErrUnauthenticated) || errors.Is(err, ErrProviderUnavailable) {
		t.Fatalf("unexpected auth error: %v", err)
	}
}

func TestDecodeUserRejectsUnauthenticatedOrMissingIdentity(t *testing.T) {
	falseValue := false
	if _, err := decodeUser([]byte(`{"authenticated":false}`), true); !errors.Is(err, ErrUnauthenticated) || falseValue {
		t.Fatalf("unexpected unauthenticated error: %v", err)
	}
	if _, err := decodeUser([]byte(`{"authenticated":true}`), true); !errors.Is(err, ErrMalformedProviderData) {
		t.Fatalf("unexpected malformed identity error: %v", err)
	}
}
