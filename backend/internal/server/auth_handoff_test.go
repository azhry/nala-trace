package server

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/azhry/nala-trace/backend/internal/auth"
)

type traceHandoffRedeemerStub struct {
	code        string
	traceOrigin string
	token       string
	err         error
}

func (stub *traceHandoffRedeemerStub) RedeemTraceHandoff(_ context.Context, code, traceOrigin string) (string, error) {
	stub.code = code
	stub.traceOrigin = traceOrigin
	return stub.token, stub.err
}

func TestTraceHandoffRedeemHandlerForwardsBodyCodeAndReturnsToken(t *testing.T) {
	redeemer := &traceHandoffRedeemerStub{token: "jwt-from-nala"}
	request := httptest.NewRequest(http.MethodPost, TraceHandoffRedeemPath, strings.NewReader(`{"code":"  one-time-code  "}`))
	response := httptest.NewRecorder()

	NewTraceHandoffRedeemHandler(redeemer, "http://localhost:5005/").ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d: %s", response.Code, http.StatusOK, response.Body.String())
	}
	if redeemer.code != "one-time-code" {
		t.Fatalf("code = %q, want one-time-code", redeemer.code)
	}
	if redeemer.traceOrigin != "http://localhost:5005" {
		t.Fatalf("trace origin = %q, want http://localhost:5005", redeemer.traceOrigin)
	}
	var payload struct {
		Token string `json:"token"`
	}
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if payload.Token != "jwt-from-nala" {
		t.Fatalf("token = %q, want jwt-from-nala", payload.Token)
	}
}

func TestTraceHandoffRedeemHandlerRejectsInvalidRequests(t *testing.T) {
	for _, test := range []struct {
		name string
		body string
	}{
		{name: "missing code", body: `{}`},
		{name: "unknown field", body: `{"code":"valid","token":"must-not-be-accepted"}`},
		{name: "trailing json", body: `{"code":"valid"}{}`},
	} {
		t.Run(test.name, func(t *testing.T) {
			redeemer := &traceHandoffRedeemerStub{token: "jwt-from-nala"}
			request := httptest.NewRequest(http.MethodPost, TraceHandoffRedeemPath, strings.NewReader(test.body))
			response := httptest.NewRecorder()

			NewTraceHandoffRedeemHandler(redeemer, "http://localhost:5005").ServeHTTP(response, request)

			if response.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want %d: %s", response.Code, http.StatusBadRequest, response.Body.String())
			}
			if redeemer.code != "" {
				t.Fatalf("redeemer code = %q, want empty", redeemer.code)
			}
		})
	}
}

func TestTraceHandoffRedeemHandlerMapsRedeemerErrors(t *testing.T) {
	for _, test := range []struct {
		name       string
		err        error
		wantStatus int
		wantCode   string
	}{
		{name: "invalid code", err: auth.ErrHandoffRejected, wantStatus: http.StatusUnauthorized, wantCode: "invalid_handoff_code"},
		{name: "provider unavailable", err: auth.ErrProviderUnavailable, wantStatus: http.StatusServiceUnavailable, wantCode: "auth_provider_unavailable"},
		{name: "malformed provider", err: auth.ErrMalformedProviderData, wantStatus: http.StatusServiceUnavailable, wantCode: "auth_provider_unavailable"},
	} {
		t.Run(test.name, func(t *testing.T) {
			redeemer := &traceHandoffRedeemerStub{err: test.err}
			request := httptest.NewRequest(http.MethodPost, TraceHandoffRedeemPath, strings.NewReader(`{"code":"valid"}`))
			response := httptest.NewRecorder()

			NewTraceHandoffRedeemHandler(redeemer, "http://localhost:5005").ServeHTTP(response, request)

			if response.Code != test.wantStatus {
				t.Fatalf("status = %d, want %d: %s", response.Code, test.wantStatus, response.Body.String())
			}
			var payload ErrorBody
			if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
				t.Fatalf("decode error response: %v", err)
			}
			if payload.Error.Code != test.wantCode {
				t.Fatalf("error code = %q, want %q", payload.Error.Code, test.wantCode)
			}
		})
	}
}

func TestTraceHandoffRedeemHandlerRejectsUnsupportedMethod(t *testing.T) {
	request := httptest.NewRequest(http.MethodGet, TraceHandoffRedeemPath, nil)
	response := httptest.NewRecorder()

	NewTraceHandoffRedeemHandler(&traceHandoffRedeemerStub{}, "http://localhost:5005").ServeHTTP(response, request)

	if response.Code != http.StatusMethodNotAllowed {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusMethodNotAllowed)
	}
}

func TestTraceHandoffRedeemHandlerDoesNotExposeRedeemerErrors(t *testing.T) {
	secret := errors.New("upstream token must not be exposed")
	redeemer := &traceHandoffRedeemerStub{err: secret}
	request := httptest.NewRequest(http.MethodPost, TraceHandoffRedeemPath, strings.NewReader(`{"code":"valid"}`))
	response := httptest.NewRecorder()

	NewTraceHandoffRedeemHandler(redeemer, "http://localhost:5005").ServeHTTP(response, request)

	if strings.Contains(response.Body.String(), secret.Error()) {
		t.Fatalf("response leaked redeemer error: %s", response.Body.String())
	}
}

func TestTraceHandoffRedeemHandlerRejectsMalformedConfiguredOrigin(t *testing.T) {
	redeemer := &traceHandoffRedeemerStub{token: "must-not-be-used"}
	request := httptest.NewRequest(http.MethodPost, TraceHandoffRedeemPath, strings.NewReader(`{"code":"valid"}`))
	response := httptest.NewRecorder()

	NewTraceHandoffRedeemHandler(redeemer, "https://trace.example.test/path?token=bad").ServeHTTP(response, request)

	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusServiceUnavailable)
	}
	if redeemer.code != "" || redeemer.traceOrigin != "" {
		t.Fatalf("redeemer called with code=%q origin=%q", redeemer.code, redeemer.traceOrigin)
	}
}
