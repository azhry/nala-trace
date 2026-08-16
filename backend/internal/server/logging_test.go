package server

import (
	"bytes"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestRequestLoggerWritesRequestMetadataWithoutSecrets(t *testing.T) {
	var logs bytes.Buffer
	logger := slog.New(slog.NewTextHandler(&logs, &slog.HandlerOptions{ReplaceAttr: func(_ []string, attr slog.Attr) slog.Attr {
		if attr.Key == "time" {
			return slog.Attr{}
		}
		return attr
	}}))

	handler := requestLogger(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/healthz" {
			t.Fatalf("request = %s %s, want POST /healthz", r.Method, r.URL.Path)
		}
		w.WriteHeader(http.StatusServiceUnavailable)
	}), logger)

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/healthz", strings.NewReader(`{"password":"must-not-log"}`))
	request.Header.Set("Authorization", "Bearer must-not-log")
	handler.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusServiceUnavailable)
	}
	output := logs.String()
	for _, expected := range []string{"msg=\"http request\"", "method=POST", "path=/healthz", "status=503", "duration="} {
		if !strings.Contains(output, expected) {
			t.Fatalf("request log = %q, want %q", output, expected)
		}
	}
	for _, secret := range []string{"must-not-log", "Authorization", "password"} {
		if strings.Contains(output, secret) {
			t.Fatalf("request log leaked %q: %q", secret, output)
		}
	}
}
