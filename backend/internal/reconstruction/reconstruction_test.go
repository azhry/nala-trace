package reconstruction

import (
	"testing"
	"time"

	"github.com/azhry/nala-trace/backend/internal/events"
	"github.com/azhry/nala-trace/backend/internal/storage"
	"github.com/azhry/nala-trace/backend/internal/trace"
)

func makeEvent(t *testing.T, id, name, toolID string, receivedAt time.Time, extra string) storage.HookEvent {
	t.Helper()
	payload := `{"session_id":"session-1","hook_event_name":"` + name + `"`
	if toolID != "" {
		payload += `,"tool_use_id":"` + toolID + `"`
	}
	if extra != "" {
		payload += "," + extra
	}
	payload += "}"
	event, err := events.Decode([]byte(payload))
	if err != nil {
		t.Fatalf("Decode: %v", err)
	}
	hookEvent, err := storage.NewHookEvent("user-1", event, receivedAt)
	if err != nil {
		t.Fatalf("NewHookEvent: %v", err)
	}
	hookEvent.ID = id
	return hookEvent
}

func TestOrderUsesReceivedAtStableIDAndInputFallback(t *testing.T) {
	when := time.Date(2026, 8, 17, 1, 0, 0, 0, time.UTC)
	ordered := Order([]storage.HookEvent{
		makeEvent(t, "b", "Stop", "", when, ""),
		makeEvent(t, "a", "SessionStart", "", when, ""),
		makeEvent(t, "", "UserPromptSubmit", "", when.Add(-time.Second), ""),
		makeEvent(t, "", "PreCompact", "", when, ""),
	})
	if got := ordered[0].Event.HookEventName; got != "UserPromptSubmit" {
		t.Fatalf("first event = %q", got)
	}
	if got := ordered[1].Event.ID; got != "a" {
		t.Fatalf("equal timestamp stable ID order = %q", got)
	}
	if got := ordered[2].Event.ID; got != "b" {
		t.Fatalf("equal timestamp stable ID order = %q", got)
	}
	if got := ordered[3].Event.HookEventName; got != "PreCompact" {
		t.Fatalf("input fallback order = %q", got)
	}
}

func TestReconstructPairsInterleavedToolsAndRetainsLifecycleEvents(t *testing.T) {
	when := time.Date(2026, 8, 17, 1, 0, 0, 0, time.UTC)
	result := Reconstruct("session-1", "user-1", []storage.HookEvent{
		makeEvent(t, "1", "PreToolUse", "tool-a", when, `"tool_input":{"command":"pwd"}`),
		makeEvent(t, "2", "PreCompact", "", when.Add(time.Millisecond), ""),
		makeEvent(t, "3", "PostToolUse", "tool-a", when.Add(2*time.Millisecond), `"tool_response":{"ok":true}`),
		makeEvent(t, "4", "SubagentStart", "", when.Add(3*time.Millisecond), ""),
	})
	if len(result.Timeline) != 4 || len(result.ToolCalls) != 1 {
		t.Fatalf("unexpected reconstruction sizes: timeline=%d tools=%d", len(result.Timeline), len(result.ToolCalls))
	}
	if result.ToolCalls[0].Status != trace.ToolCallCompleted || string(result.ToolCalls[0].Output) != `{"ok":true}` {
		t.Fatalf("tool pairing = %+v", result.ToolCalls[0])
	}
	if result.Timeline[1].HookEventName != "PreCompact" || result.Timeline[3].HookEventName != "SubagentStart" {
		t.Fatalf("lifecycle events were dropped: %+v", result.Timeline)
	}
}

func TestReconstructPreservesUnmatchedDuplicateAndMalformedPartialState(t *testing.T) {
	when := time.Date(2026, 8, 17, 1, 0, 0, 0, time.UTC)
	result := Reconstruct("session-1", "user-1", []storage.HookEvent{
		makeEvent(t, "1", "PreToolUse", "duplicate", when, ""),
		makeEvent(t, "2", "PreToolUse", "duplicate", when.Add(time.Millisecond), `"timestamp":"not-a-time"`),
		makeEvent(t, "3", "PostToolUse", "duplicate", when.Add(2*time.Millisecond), ""),
		makeEvent(t, "4", "PostToolUse", "missing", when.Add(3*time.Millisecond), ""),
		makeEvent(t, "5", "PreToolUse", "", when.Add(4*time.Millisecond), ""),
	})
	if len(result.ToolCalls) != 4 {
		t.Fatalf("tool calls = %d, want 4", len(result.ToolCalls))
	}
	if result.ToolCalls[0].Status != trace.ToolCallCompleted || result.ToolCalls[1].Status != trace.ToolCallUnmatched || result.ToolCalls[2].Status != trace.ToolCallUnmatched || result.ToolCalls[3].Status != trace.ToolCallUnmatched {
		t.Fatalf("unexpected partial statuses: %+v", result.ToolCalls)
	}
	partialReasons := 0
	for _, event := range result.Timeline {
		if event.Kind == "partial" && event.PartialReason != "" {
			partialReasons++
		}
	}
	if partialReasons < 3 {
		t.Fatalf("partial markers = %d, want at least 3: %+v", partialReasons, result.Timeline)
	}
}
