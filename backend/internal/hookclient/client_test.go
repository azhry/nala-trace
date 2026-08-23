package hookclient

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestSendUsesNalaLabsAPIKeyHeader(t *testing.T) {
	var gotAuthorization string
	var gotAPIKey string
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		gotAuthorization = request.Header.Get("Authorization")
		gotAPIKey = request.Header.Get("X-Nala-Labs-API-Key")
		writer.WriteHeader(http.StatusAccepted)
	}))
	defer server.Close()

	err := Send(
		context.Background(),
		strings.NewReader(`{"session_id":"session-1","hook_event_name":"Stop"}`),
		Config{URL: server.URL, Token: "api-key-test", Timeout: time.Second},
	)
	if err != nil {
		t.Fatalf("Send() error = %v", err)
	}
	if gotAPIKey != "api-key-test" {
		t.Fatalf("X-Nala-Labs-API-Key = %q, want %q", gotAPIKey, "api-key-test")
	}
	if gotAuthorization != "" {
		t.Fatalf("Authorization = %q, want empty", gotAuthorization)
	}
}
