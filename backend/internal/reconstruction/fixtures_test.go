package reconstruction

import (
	"encoding/json"
	"reflect"
	"testing"

	"github.com/azhry/nala-trace/backend/internal/testfixtures"
	"github.com/azhry/nala-trace/backend/internal/trace"
)

func TestReconstructCompleteFixtureAssertsFullTraceContract(t *testing.T) {
	events, err := testfixtures.Load(testfixtures.CompleteSession)
	if err != nil {
		t.Fatalf("load complete fixture: %v", err)
	}

	result := Reconstruct("fixture-session-1", "user-1", events)
	wantTimeline := []string{
		"session-start-01", "prompt-01", "exec-pre-01", "exec-post-01",
		"web-pre-01", "web-post-01", "skill-pre-01", "patch-pre-01",
		"patch-post-01", "subagent-start-01", "subagent-stop-01",
		"compact-pre-01", "compact-post-01", "stop-01",
	}
	gotTimeline := make([]string, 0, len(result.Timeline))
	for _, event := range result.Timeline {
		gotTimeline = append(gotTimeline, event.ID)
	}
	if !reflect.DeepEqual(gotTimeline, wantTimeline) {
		t.Fatalf("timeline IDs = %#v, want %#v", gotTimeline, wantTimeline)
	}

	if len(result.Conversation) != 2 {
		t.Fatalf("conversation length = %d, want 2", len(result.Conversation))
	}
	assertMessage(t, result.Conversation[0].Role, result.Conversation[0].Content, "user", "Inspect README and summarize the tracked changes.")
	assertMessage(t, result.Conversation[1].Role, result.Conversation[1].Content, "assistant", "Summary complete.")

	if len(result.ToolCalls) != 4 {
		t.Fatalf("tool call count = %d, want 4", len(result.ToolCalls))
	}
	wantTools := []struct {
		name   string
		status trace.ToolCallStatus
		id     string
	}{
		{name: "unified_exec", status: trace.ToolCallCompleted, id: "exec-1"},
		{name: "WebSearch", status: trace.ToolCallCompleted, id: "search-1"},
		{name: "skill", status: trace.ToolCallUnmatched, id: "skill-1"},
		{name: "apply_patch", status: trace.ToolCallCompleted, id: "patch-1"},
	}
	for index, want := range wantTools {
		call := result.ToolCalls[index]
		if call.ToolName != want.name || call.Status != want.status || call.ToolUseID == nil || *call.ToolUseID != want.id {
			t.Errorf("tool call[%d] = %#v, want name=%q status=%q id=%q", index, call, want.name, want.status, want.id)
		}
	}
	assertJSONMap(t, result.ToolCalls[0].Input, map[string]any{"command": "cat README.md"})
	assertJSONMap(t, result.ToolCalls[1].Input, map[string]any{"query": "Codex hooks lifecycle"})
	assertJSONString(t, result.ToolCalls[3].Input, "*** Begin Patch\n*** Update File: README.md\n*** End Patch")

	if len(result.SkillInvocations) != 1 {
		t.Fatalf("skill invocation count = %d, want 1", len(result.SkillInvocations))
	}
	if result.SkillInvocations[0].Name != "frontend-design" || result.SkillInvocations[0].Confidence != confidenceExplicit || result.SkillInvocations[0].EventID != "skill-pre-01" {
		t.Fatalf("skill invocation = %#v", result.SkillInvocations[0])
	}

	wantFiles := []trace.FileOperation{
		{Path: "README.md", Operation: "read", EventID: "exec-pre-01", ToolName: "unified_exec", Confidence: confidenceInferred},
		{Path: "README.md", Operation: "write", EventID: "patch-pre-01", ToolName: "apply_patch", Confidence: confidenceExplicit},
	}
	if len(result.Files) != len(wantFiles) {
		t.Fatalf("file operation count = %d, want %d", len(result.Files), len(wantFiles))
	}
	for index, want := range wantFiles {
		got := result.Files[index]
		if got.Path != want.Path || got.Operation != want.Operation || got.EventID != want.EventID || got.ToolName != want.ToolName || got.Confidence != want.Confidence {
			t.Errorf("file operation[%d] = %#v, want %#v", index, got, want)
		}
	}

	wantSummary := trace.Summary{EventCount: 14, MessageCount: 2, ToolCallCount: 4, MCPCallCount: 0, MCPServers: []string{}, SkillInvocationCount: 1, FileOperationCount: 2, FileReadCount: 1}
	if !reflect.DeepEqual(result.Summary, wantSummary) {
		t.Fatalf("summary = %#v, want %#v", result.Summary, wantSummary)
	}
	assertToolIndexes(t, result.Timeline, map[string]int{
		"exec-pre-01": 0, "exec-post-01": 0, "web-pre-01": 1, "web-post-01": 1,
		"skill-pre-01": 2, "patch-pre-01": 3, "patch-post-01": 3,
	})
}

func TestReconstructPartialFixturePreservesBoundedMarkers(t *testing.T) {
	events, err := testfixtures.Load(testfixtures.PartialSequences)
	if err != nil {
		t.Fatalf("load partial fixture: %v", err)
	}

	result := Reconstruct("fixture-session-2", "user-1", events)
	partialReasons := make(map[string]string)
	for _, event := range result.Timeline {
		if event.PartialReason != "" {
			partialReasons[event.ID] = event.PartialReason
		}
	}
	wantReasons := map[string]string{
		"missing-tool-id-01": "missing_tool_use_id",
		"orphan-post-01":     "unmatched_post_tool_use",
		"duplicate-pre-02":   "duplicate_tool_use_id",
	}
	if !reflect.DeepEqual(partialReasons, wantReasons) {
		t.Fatalf("partial reasons = %#v, want %#v", partialReasons, wantReasons)
	}
	if len(result.ToolCalls) != 4 {
		t.Fatalf("partial tool call count = %d, want 4", len(result.ToolCalls))
	}
	for index, call := range result.ToolCalls {
		if call.Status != trace.ToolCallUnmatched {
			t.Errorf("partial tool call[%d] status = %q, want unmatched", index, call.Status)
		}
	}
	if len(result.SkillInvocations) != 2 || result.SkillInvocations[0].Name != "frontend-design" || result.SkillInvocations[1].Name != "diagnose" {
		t.Fatalf("partial skills = %#v", result.SkillInvocations)
	}
	if len(result.Files) != 1 || result.Files[0].Path != "TODO.md" || result.Files[0].Operation != "read" {
		t.Fatalf("partial files = %#v", result.Files)
	}
	wantSummary := trace.Summary{EventCount: 7, MessageCount: 2, ToolCallCount: 4, MCPCallCount: 0, MCPServers: []string{}, SkillInvocationCount: 2, FileOperationCount: 1, FileReadCount: 1}
	if !reflect.DeepEqual(result.Summary, wantSummary) {
		t.Fatalf("partial summary = %#v, want %#v", result.Summary, wantSummary)
	}
}

func assertMessage(t *testing.T, role string, content json.RawMessage, wantRole, wantContent string) {
	t.Helper()
	if role != wantRole {
		t.Errorf("message role = %q, want %q", role, wantRole)
	}
	assertJSONString(t, content, wantContent)
}

func assertJSONString(t *testing.T, content json.RawMessage, want string) {
	t.Helper()
	var got string
	if err := json.Unmarshal(content, &got); err != nil {
		t.Fatalf("decode JSON string %s: %v", content, err)
	}
	if got != want {
		t.Errorf("JSON string = %q, want %q", got, want)
	}
}

func assertJSONMap(t *testing.T, content json.RawMessage, want map[string]any) {
	t.Helper()
	var got map[string]any
	if err := json.Unmarshal(content, &got); err != nil {
		t.Fatalf("decode JSON object %s: %v", content, err)
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("JSON object = %#v, want %#v", got, want)
	}
}

func assertToolIndexes(t *testing.T, timeline []trace.TimelineEvent, want map[string]int) {
	t.Helper()
	for _, event := range timeline {
		wantIndex, ok := want[event.ID]
		if !ok {
			if event.ToolCallIndex != nil {
				t.Errorf("timeline event %q has unexpected tool index %d", event.ID, *event.ToolCallIndex)
			}
			continue
		}
		if event.ToolCallIndex == nil || *event.ToolCallIndex != wantIndex {
			t.Errorf("timeline event %q tool index = %v, want %d", event.ID, event.ToolCallIndex, wantIndex)
		}
	}
}
