package trace

import (
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func TestTraceSerializationPreservesContractAndRawData(t *testing.T) {
	toolID := "tool-1"
	started := time.Date(2026, 8, 15, 1, 2, 3, 0, time.UTC)
	trace := New("session-1", "user-1")
	trace.Timeline = append(trace.Timeline, TimelineEvent{
		ID: "event-1", HookEventName: "PreToolUse", OccurredAt: started,
		Kind: "tool", Raw: json.RawMessage(`{"new_field":"kept"}`),
	})
	trace.ToolCalls = append(trace.ToolCalls, ToolCall{
		ToolUseID: &toolID, ToolName: "shell_command", Input: json.RawMessage(`{"command":"pwd"}`),
		Status: ToolCallPending, Raw: json.RawMessage(`{"future":true}`),
	})
	trace.Summary.EventCount = 1
	encoded, err := json.Marshal(trace)
	if err != nil {
		t.Fatalf("marshal trace: %v", err)
	}
	body := string(encoded)
	for _, expected := range []string{"\"schema_version\":\"1\"", "\"session_id\":\"session-1\"", "\"tool_calls\"", "\"status\":\"pending\"", "new_field", "future"} {
		if !strings.Contains(body, expected) {
			t.Fatalf("serialized trace missing %q: %s", expected, body)
		}
	}
	if strings.Contains(body, "\"conversation\":null") || strings.Contains(body, "\"files\":null") {
		t.Fatalf("empty collections must serialize as arrays: %s", body)
	}
}

func TestTraceSupportsEveryToolCallStatus(t *testing.T) {
	for _, status := range []ToolCallStatus{ToolCallPending, ToolCallCompleted, ToolCallFailed, ToolCallUnmatched} {
		t.Run(string(status), func(t *testing.T) {
			encoded, err := json.Marshal(ToolCall{ToolName: "tool", Status: status})
			if err != nil || !strings.Contains(string(encoded), `"status":"`+string(status)+`"`) {
				t.Fatalf("status did not serialize: %s %v", encoded, err)
			}
		})
	}
}
