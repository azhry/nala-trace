package hookclient

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestSendPostsOneJSONEventWithRuntimeAuth(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		if request.Method != http.MethodPost || request.Header.Get("Authorization") != "Bearer token" || request.Header.Get("Content-Type") != "application/json" {
			t.Fatalf("unexpected request: %s %+v", request.Method, request.Header)
		}
		w.WriteHeader(http.StatusAccepted)
	}))
	defer server.Close()
	if err := Send(context.Background(), strings.NewReader(`{"session_id":"s","hook_event_name":"Stop"}`), Config{URL: server.URL, Token: "token", Timeout: time.Second}); err != nil {
		t.Fatalf("Send: %v", err)
	}
}

func TestSendRejectsMalformedExtraAndMissingConfiguration(t *testing.T) {
	config := Config{URL: "http://localhost", Token: "token", Timeout: time.Second}
	for name, input := range map[string]string{
		"malformed": `{`,
		"array":     `[]`,
		"extra":     `{"a":1} {"b":2}`,
	} {
		t.Run(name, func(t *testing.T) {
			if err := Send(context.Background(), strings.NewReader(input), config); err == nil {
				t.Fatal("Send accepted invalid input")
			}
		})
	}
	if err := Send(context.Background(), strings.NewReader(`{"a":1}`), Config{}); err == nil {
		t.Fatal("Send accepted missing configuration")
	}
}

func TestConfigFromEnvRequiresRuntimeValues(t *testing.T) {
	values := map[string]string{"CODEX_TRACE_API_URL": "http://api", "CODEX_TRACE_API_TOKEN": "token", "CODEX_TRACE_API_TIMEOUT": "1s"}
	cfg, err := ConfigFromEnv(func(key string) string { return values[key] })
	if err != nil || cfg.Timeout != time.Second {
		t.Fatalf("ConfigFromEnv = %+v, err=%v", cfg, err)
	}
	delete(values, "CODEX_TRACE_API_TOKEN")
	if _, err := ConfigFromEnv(func(key string) string { return values[key] }); err == nil {
		t.Fatal("ConfigFromEnv accepted missing token")
	}
}
