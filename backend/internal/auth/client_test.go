package auth

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/azhry/nala-trace/backend/internal/config"
)

func TestIAMClientRedeemsTraceHandoffWithoutURLToken(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.Method != http.MethodPost || request.URL.Path != "/api/auth/trace-handoff/redeem" || request.URL.RawQuery != "" {
			t.Fatalf("upstream request = %s %s?%s, want POST path without query", request.Method, request.URL.Path, request.URL.RawQuery)
		}
		if got, want := request.Header.Get("Content-Type"), "application/json"; got != want {
			t.Fatalf("Content-Type = %q, want %q", got, want)
		}
		var payload struct {
			Code string `json:"code"`
		}
		if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
			t.Fatalf("decode handoff request: %v", err)
		}
		if payload.Code != "one-time-code" {
			t.Fatalf("code = %q, want one-time-code", payload.Code)
		}
		_, _ = io.WriteString(writer, `{"token":"jwt-from-nala"}`)
	}))
	defer server.Close()

	client := NewIAMClient(config.AuthConfig{NalaLabsAuthURL: server.URL, Timeout: time.Second})
	token, err := client.RedeemTraceHandoff(context.Background(), "  one-time-code  ", "http://localhost:5005/")
	if err != nil {
		t.Fatalf("RedeemTraceHandoff returned error: %v", err)
	}
	if token != "jwt-from-nala" {
		t.Fatalf("token = %q, want jwt-from-nala", token)
	}
}

func TestIAMClientMapsTraceHandoffFailures(t *testing.T) {
	for _, test := range []struct {
		name   string
		status int
		body   string
		want   error
	}{
		{name: "rejected", status: http.StatusUnauthorized, body: `{}`, want: ErrHandoffRejected},
		{name: "provider failure", status: http.StatusBadGateway, body: `{}`, want: ErrProviderUnavailable},
		{name: "malformed response", status: http.StatusOK, body: `{"authenticated":true}`, want: ErrMalformedProviderData},
	} {
		t.Run(test.name, func(t *testing.T) {
			upstream := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
				writer.WriteHeader(test.status)
				_, _ = io.WriteString(writer, test.body)
			}))
			defer upstream.Close()

			client := NewIAMClient(config.AuthConfig{NalaLabsAuthURL: upstream.URL, Timeout: time.Second})
			_, err := client.RedeemTraceHandoff(context.Background(), "one-time-code", "http://localhost:5005")
			if !errors.Is(err, test.want) {
				t.Fatalf("error = %v, want %v", err, test.want)
			}
		})
	}
}

func TestIAMClientRejectsEmptyTraceHandoffCode(t *testing.T) {
	client := NewIAMClient(config.AuthConfig{NalaLabsAuthURL: "http://unused.example", Timeout: time.Second})
	_, err := client.RedeemTraceHandoff(context.Background(), strings.Repeat(" ", 3), "http://localhost:5005")
	if !errors.Is(err, ErrHandoffRejected) {
		t.Fatalf("error = %v, want ErrHandoffRejected", err)
	}
}

func TestIAMClientSendsNormalizedTraceOrigin(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		var payload struct {
			TraceOrigin string `json:"trace_origin"`
		}
		if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
			t.Fatalf("decode handoff request: %v", err)
		}
		if payload.TraceOrigin != "http://localhost:5005" {
			t.Fatalf("trace_origin = %q, want http://localhost:5005", payload.TraceOrigin)
		}
		_, _ = io.WriteString(writer, `{"token":"jwt-from-nala"}`)
	}))
	defer server.Close()

	client := NewIAMClient(config.AuthConfig{NalaLabsAuthURL: server.URL, Timeout: time.Second})
	if _, err := client.RedeemTraceHandoff(context.Background(), "one-time-code", " http://localhost:5005/ "); err != nil {
		t.Fatalf("RedeemTraceHandoff returned error: %v", err)
	}
}

func TestIAMClientRejectsMalformedTraceOriginBeforeUpstreamCall(t *testing.T) {
	called := false
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		called = true
		_, _ = io.WriteString(writer, `{"token":"must-not-be-used"}`)
	}))
	defer server.Close()

	client := NewIAMClient(config.AuthConfig{NalaLabsAuthURL: server.URL, Timeout: time.Second})
	_, err := client.RedeemTraceHandoff(context.Background(), "one-time-code", "https://trace.example.test/sessions?token=bad")
	if !errors.Is(err, ErrHandoffRejected) {
		t.Fatalf("error = %v, want ErrHandoffRejected", err)
	}
	if called {
		t.Fatal("upstream was called with malformed trace origin")
	}
}

func TestNormalizeTraceOriginRejectsMalformedValues(t *testing.T) {
	for _, value := range []string{
		"",
		"not-an-origin",
		"javascript:alert(1)",
		"https://user:password@trace.example.test",
		"https://trace.example.test/path",
		"https://trace.example.test?token=bad",
	} {
		if got := NormalizeTraceOrigin(value); got != "" {
			t.Errorf("NormalizeTraceOrigin(%q) = %q, want empty", value, got)
		}
	}
}

func TestIAMClientValidatesBearerAndPreservesNalaLabsSession(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.Method != http.MethodGet || request.URL.Path != "/api/auth/session" {
			t.Fatalf("request = %s %s, want GET /api/auth/session", request.Method, request.URL.Path)
		}
		if got := request.Header.Get("Authorization"); got != "Bearer session-token" {
			t.Fatalf("Authorization = %q, want bearer token", got)
		}
		_, _ = io.WriteString(writer, `{"authenticated":true,"user":{"id":"admin-123","name":"Admin User","email":"admin@example.test","tier":"admin","entitlements":{"expires":false,"policy":"Full access"}}}`)
	}))
	defer server.Close()

	client := NewIAMClient(config.AuthConfig{NalaLabsAuthURL: server.URL, Timeout: time.Second})
	user, err := client.ValidateBearer(context.Background(), "session-token")
	if err != nil {
		t.Fatalf("ValidateBearer returned error: %v", err)
	}
	if user.ID != "admin-123" || user.Name != "Admin User" || user.Email != "admin@example.test" || user.Tier != TierAdmin {
		t.Fatalf("unexpected user: %#v", user)
	}
	if len(user.Entitlements) != 0 {
		t.Fatalf("object entitlements should not be converted into invented list values: %#v", user.Entitlements)
	}
}

func TestIAMClientPreservesLegacyEntitlementList(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		_, _ = io.WriteString(writer, `{"authenticated":true,"user":{"id":"developer-123","roles":["developer"],"entitlements":["trace:read","trace:write"]}}`)
	}))
	defer server.Close()

	client := NewIAMClient(config.AuthConfig{NalaLabsAuthURL: server.URL, Timeout: time.Second})
	user, err := client.ValidateBearer(context.Background(), "session-token")
	if err != nil {
		t.Fatalf("ValidateBearer returned error: %v", err)
	}
	if user.ID != "developer-123" || user.Tier != TierDeveloper {
		t.Fatalf("unexpected user: %#v", user)
	}
	if got, want := user.Entitlements, []string{"trace:read", "trace:write"}; len(got) != len(want) || got[0] != want[0] || got[1] != want[1] {
		t.Fatalf("entitlements = %#v, want %#v", got, want)
	}
}

func TestIAMClientMapsSharedSessionErrors(t *testing.T) {
	for _, test := range []struct {
		name   string
		status int
		body   string
		want   error
	}{
		{name: "unauthorized", status: http.StatusUnauthorized, body: `{}`, want: ErrUnauthenticated},
		{name: "provider failure", status: http.StatusBadGateway, body: `{}`, want: ErrProviderUnavailable},
		{name: "malformed response", status: http.StatusOK, body: `{"authenticated":true,"user":{"id":"invalid","entitlements":"bad"}}`, want: ErrMalformedProviderData},
	} {
		t.Run(test.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
				writer.WriteHeader(test.status)
				_, _ = io.WriteString(writer, test.body)
			}))
			defer server.Close()

			client := NewIAMClient(config.AuthConfig{NalaLabsAuthURL: server.URL, Timeout: time.Second})
			_, err := client.ValidateBearer(context.Background(), "session-token")
			if !errors.Is(err, test.want) {
				t.Fatalf("error = %v, want %v", err, test.want)
			}
		})
	}
}
