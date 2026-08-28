package hookclient

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
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

func TestSendEnrichesTerminalEventFromCodexTranscript(t *testing.T) {
	transcriptPath := filepath.Join(t.TempDir(), "rollout.jsonl")
	transcript := strings.Join([]string{
		`{"type":"event_msg","payload":{"type":"thread_settings_applied","thread_settings":{"reasoning_effort":"xhigh"}}}`,
		`{"type":"turn_context","payload":{"effort":"xhigh"}}`,
		`{"type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":10,"cached_input_tokens":4,"output_tokens":2,"reasoning_output_tokens":1,"total_tokens":12}}}}`,
		`{"type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":30,"cached_input_tokens":20,"output_tokens":5,"reasoning_output_tokens":2,"total_tokens":35}}}}`,
	}, "\n") + "\n"
	if err := os.WriteFile(transcriptPath, []byte(transcript), 0600); err != nil {
		t.Fatalf("write transcript: %v", err)
	}

	var body []byte
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		body, _ = io.ReadAll(request.Body)
		writer.WriteHeader(http.StatusAccepted)
	}))
	defer server.Close()

	input := `{"session_id":"session-1","hook_event_name":"Stop","transcript_path":` + mustJSONString(t, transcriptPath) + `}`
	if err := Send(context.Background(), strings.NewReader(input), Config{URL: server.URL, Token: "api-key-test", Timeout: time.Second}); err != nil {
		t.Fatalf("Send() error = %v", err)
	}

	var captured map[string]any
	if err := json.Unmarshal(body, &captured); err != nil {
		t.Fatalf("decode captured body: %v", err)
	}
	usage, ok := captured["usage"].(map[string]any)
	if !ok {
		t.Fatalf("usage = %#v, want normalized transcript usage", captured["usage"])
	}
	for key, want := range map[string]float64{
		"input_tokens": 30, "cached_input_tokens": 20, "output_tokens": 5, "reasoning_tokens": 2, "total_tokens": 35,
	} {
		if got := usage[key]; got != want {
			t.Fatalf("usage[%q] = %#v, want %v", key, got, want)
		}
	}
	if got, want := captured["usage_source"], "codex_transcript"; got != want {
		t.Fatalf("usage_source = %#v, want %q", got, want)
	}
	runtimeMetadata, ok := captured["runtime_metadata"].(map[string]any)
	if !ok {
		t.Fatalf("runtime_metadata = %#v, want transcript metadata", captured["runtime_metadata"])
	}
	if got, want := runtimeMetadata["reasoning_effort"], "xhigh"; got != want {
		t.Fatalf("runtime_metadata.reasoning_effort = %#v, want %q", got, want)
	}
}

func TestSendEnrichesReasoningEffortWhenTranscriptHasNoUsage(t *testing.T) {
	transcriptPath := filepath.Join(t.TempDir(), "rollout.jsonl")
	transcript := `{"type":"turn_context","payload":{"effort":"high"}}` + "\n"
	if err := os.WriteFile(transcriptPath, []byte(transcript), 0600); err != nil {
		t.Fatalf("write transcript: %v", err)
	}

	var body []byte
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		body, _ = io.ReadAll(request.Body)
		writer.WriteHeader(http.StatusAccepted)
	}))
	defer server.Close()

	input := `{"session_id":"session-1","hook_event_name":"Stop","transcript_path":` + mustJSONString(t, transcriptPath) + `}`
	if err := Send(context.Background(), strings.NewReader(input), Config{URL: server.URL, Token: "api-key-test", Timeout: time.Second}); err != nil {
		t.Fatalf("Send() error: %v", err)
	}

	var captured map[string]any
	if err := json.Unmarshal(body, &captured); err != nil {
		t.Fatalf("decode captured body: %v", err)
	}
	runtimeMetadata, ok := captured["runtime_metadata"].(map[string]any)
	if !ok {
		t.Fatalf("runtime_metadata = %#v, want transcript metadata", captured["runtime_metadata"])
	}
	if got, want := runtimeMetadata["reasoning_effort"], "high"; got != want {
		t.Fatalf("runtime_metadata.reasoning_effort = %#v, want %q", got, want)
	}
	if _, ok := captured["usage"]; ok {
		t.Fatalf("usage = %#v, want omitted when transcript has no token count", captured["usage"])
	}
}

func TestSendAddsReasoningEffortWithoutOverwritingProviderUsage(t *testing.T) {
	transcriptPath := filepath.Join(t.TempDir(), "rollout.jsonl")
	transcript := `{"type":"turn_context","payload":{"effort":"xhigh"}}` + "\n"
	if err := os.WriteFile(transcriptPath, []byte(transcript), 0600); err != nil {
		t.Fatalf("write transcript: %v", err)
	}

	var body []byte
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		body, _ = io.ReadAll(request.Body)
		writer.WriteHeader(http.StatusAccepted)
	}))
	defer server.Close()

	input := `{"session_id":"session-1","hook_event_name":"Stop","transcript_path":` + mustJSONString(t, transcriptPath) + `,"usage":{"input_tokens":7,"output_tokens":3,"total_tokens":10}}`
	if err := Send(context.Background(), strings.NewReader(input), Config{URL: server.URL, Token: "api-key-test", Timeout: time.Second}); err != nil {
		t.Fatalf("Send() error: %v", err)
	}

	var captured map[string]any
	if err := json.Unmarshal(body, &captured); err != nil {
		t.Fatalf("decode captured body: %v", err)
	}
	usage, ok := captured["usage"].(map[string]any)
	if !ok || usage["total_tokens"] != float64(10) {
		t.Fatalf("usage = %#v, want provider usage preserved", captured["usage"])
	}
	if _, ok := captured["usage_source"]; ok {
		t.Fatalf("usage_source = %#v, want omitted for provider usage", captured["usage_source"])
	}
	runtimeMetadata, ok := captured["runtime_metadata"].(map[string]any)
	if !ok || runtimeMetadata["reasoning_effort"] != "xhigh" {
		t.Fatalf("runtime_metadata = %#v, want transcript reasoning effort", captured["runtime_metadata"])
	}
}

func TestSendDoesNotEnrichNonTerminalOrProviderUsageEvents(t *testing.T) {
	transcriptPath := filepath.Join(t.TempDir(), "rollout.jsonl")
	if err := os.WriteFile(transcriptPath, []byte(`{"type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":30,"output_tokens":5,"total_tokens":35}}}}`+"\n"), 0600); err != nil {
		t.Fatalf("write transcript: %v", err)
	}

	var bodies [][]byte
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		body, _ := io.ReadAll(request.Body)
		bodies = append(bodies, body)
		writer.WriteHeader(http.StatusAccepted)
	}))
	defer server.Close()

	for _, input := range []string{
		`{"session_id":"session-1","hook_event_name":"PostToolUse","transcript_path":` + mustJSONString(t, transcriptPath) + `}`,
		`{"session_id":"session-1","hook_event_name":"Stop","transcript_path":` + mustJSONString(t, transcriptPath) + `,"usage":{"input_tokens":7,"output_tokens":3,"total_tokens":10}}`,
	} {
		if err := Send(context.Background(), strings.NewReader(input), Config{URL: server.URL, Token: "api-key-test", Timeout: time.Second}); err != nil {
			t.Fatalf("Send() error = %v", err)
		}
	}

	if len(bodies) != 2 {
		t.Fatalf("captured bodies = %d, want 2", len(bodies))
	}
	var nonTerminal map[string]any
	if err := json.Unmarshal(bodies[0], &nonTerminal); err != nil {
		t.Fatalf("decode non-terminal body: %v", err)
	}
	if _, ok := nonTerminal["usage"]; ok {
		t.Fatalf("non-terminal event unexpectedly enriched: %#v", nonTerminal)
	}
	var provider map[string]any
	if err := json.Unmarshal(bodies[1], &provider); err != nil {
		t.Fatalf("decode provider body: %v", err)
	}
	usage, ok := provider["usage"].(map[string]any)
	if !ok || usage["total_tokens"] != float64(10) {
		t.Fatalf("provider usage = %#v, want existing usage preserved", provider["usage"])
	}
	if _, ok := provider["usage_source"]; ok {
		t.Fatalf("provider event unexpectedly received transcript marker: %#v", provider)
	}
}

func TestSendTreatsUnreadableTranscriptAsBestEffort(t *testing.T) {
	var body []byte
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		body, _ = io.ReadAll(request.Body)
		writer.WriteHeader(http.StatusAccepted)
	}))
	defer server.Close()

	input := `{"session_id":"session-1","hook_event_name":"Stop","transcript_path":"C:\\missing\\rollout.jsonl"}`
	if err := Send(context.Background(), strings.NewReader(input), Config{URL: server.URL, Token: "api-key-test", Timeout: time.Second}); err != nil {
		t.Fatalf("Send() error = %v", err)
	}
	var captured map[string]any
	if err := json.Unmarshal(body, &captured); err != nil {
		t.Fatalf("decode captured body: %v", err)
	}
	if _, ok := captured["usage"]; ok {
		t.Fatalf("unreadable transcript unexpectedly produced usage: %#v", captured)
	}
}

func mustJSONString(t *testing.T, value string) string {
	t.Helper()
	encoded, err := json.Marshal(value)
	if err != nil {
		t.Fatalf("marshal JSON string: %v", err)
	}
	return string(encoded)
}
