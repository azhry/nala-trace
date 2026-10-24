package reconstruction

import (
	"strings"
	"testing"
	"time"

	"github.com/azhry/nala-trace/backend/internal/storage"
)

func TestSessionSummaryAccumulatorExtractsListFeatures(t *testing.T) {
	base := time.Date(2026, 10, 22, 10, 0, 0, 0, time.UTC)
	accumulator := NewSessionSummaryAccumulator()
	accumulator.Add(hookEventWithTool("mcp", "PreToolUse", "turn-1", "mcp__codex_apps__github_search", base, map[string]any{
		"tool_input": map[string]any{"file_path": "README.md", "operation": "read", "skill_name": "triage"},
	}))
	accumulator.Add(hookEvent("prompt", "UserPromptSubmit", "turn-1", base.Add(time.Second), map[string]any{"prompt": "inspect the trace"}))
	accumulator.Add(hookEvent("stop", "Stop", "turn-1", base.Add(2*time.Second), map[string]any{
		"title": "Session title",
		"usage": map[string]any{"input_tokens": 12, "output_tokens": 4, "total_tokens": 16},
	}))

	features := accumulator.Result("session-1")
	if features.Title != "Session title" {
		t.Fatalf("title = %q, want explicit session title", features.Title)
	}
	if features.MCPCallCount != 1 || len(features.MCPServers) != 1 || features.MCPServers[0] != "github" {
		t.Fatalf("MCP features = %#v", features)
	}
	if features.SkillInvocationCount != 1 || features.FileOperationCount != 1 || features.FileReadCount != 1 {
		t.Fatalf("file and skill features = %#v", features)
	}
	if features.TokenUsage.InputTokens != 12 || features.TokenUsage.OutputTokens != 4 || features.TokenUsage.TotalTokens != 16 {
		t.Fatalf("token usage = %#v", features.TokenUsage)
	}
}

func TestSessionSummaryAccumulatorAddsOnlyPreToolFeatures(t *testing.T) {
	base := time.Date(2026, 10, 22, 10, 0, 0, 0, time.UTC)
	accumulator := NewSessionSummaryAccumulator()
	accumulator.AddPreToolFeature(hookEventWithTool("mcp", "PreToolUse", "turn-1", "mcp__codex_apps__github_search", base, map[string]any{
		"title":      "ignored by feature-only pass",
		"usage":      map[string]any{"input_tokens": 12, "output_tokens": 4, "total_tokens": 16},
		"tool_input": map[string]any{"file_path": "README.md", "operation": "read", "skill_name": "triage"},
	}))

	features := accumulator.Result("session-1")
	if features.Title != "session-1" || features.TokenUsage.TotalTokens != 0 {
		t.Fatalf("feature-only pass changed title or token usage: %#v", features)
	}
	if features.MCPCallCount != 1 || len(features.MCPServers) != 1 || features.MCPServers[0] != "github" {
		t.Fatalf("MCP features = %#v", features)
	}
	if features.SkillInvocationCount != 1 || features.FileOperationCount != 1 || features.FileReadCount != 1 {
		t.Fatalf("file and skill features = %#v", features)
	}
}

func TestSummaryFeaturePayloadDecodesOnlyFeatureFields(t *testing.T) {
	event := hookEventWithTool("feature", "PreToolUse", "turn-1", "Read", time.Date(2026, 10, 22, 10, 0, 0, 0, time.UTC), map[string]any{
		"tool_input": map[string]any{
			"file_path":  "README.md",
			"operation":  "read",
			"skill_name": "triage",
			"content":    strings.Repeat("unused", 32),
		},
	})

	document, input := summaryFeaturePayload(event.Payload)
	if got, ok := input["file_path"].(string); !ok || got != "README.md" {
		t.Fatalf("file path = %#v, want README.md", input["file_path"])
	}
	if got, ok := input["skill_name"].(string); !ok || got != "triage" {
		t.Fatalf("skill name = %#v, want triage", input["skill_name"])
	}
	if _, ok := input["content"]; ok {
		t.Fatal("feature input retained unrelated content")
	}
	if len(document) != 0 {
		t.Fatalf("feature payload metadata = %#v, want no unrelated root fields", document)
	}
}

func TestSessionSummaryAccumulatorFindsPatchFilesInToolInput(t *testing.T) {
	accumulator := NewSessionSummaryAccumulator()
	patchEvent := hookEventWithTool("patch", "PreToolUse", "turn-1", "apply_patch", time.Date(2026, 10, 22, 10, 0, 0, 0, time.UTC), map[string]any{
		"tool_input": map[string]any{"content": "*** Begin Patch\n*** Update File: backend/main.go\n@@\n- old\n+ new\n*** End Patch"},
	})
	accumulator.AddPreToolFeature(patchEvent)
	features := accumulator.Result("session-1")
	if features.FileOperationCount != 1 {
		t.Fatalf("file operation count = %d, want 1", features.FileOperationCount)
	}
}

func TestSummaryFeatureFastCountsMatchDetailedReconstruction(t *testing.T) {
	base := time.Date(2026, 10, 22, 10, 0, 0, 0, time.UTC)
	events := []struct {
		name  string
		event storage.HookEvent
	}{
		{
			name:  "explicit MCP file read and skill",
			event: hookEventWithTool("mcp", "PreToolUse", "turn-1", "mcp__codex_apps__github_search", base, map[string]any{"tool_input": map[string]any{"file_path": "README.md", "operation": "read", "skill_name": "triage"}}),
		},
		{
			name:  "patch body",
			event: hookEventWithTool("patch", "PreToolUse", "turn-1", "apply_patch", base, map[string]any{"tool_input": map[string]any{"content": "*** Begin Patch\n*** Update File: backend/main.go\n*** End Patch"}}),
		},
		{
			name:  "skill document read from command",
			event: hookEventWithTool("skill-read", "PreToolUse", "turn-1", "shell", base, map[string]any{"tool_input": map[string]any{"command": "cat /project/skills/triage/SKILL.md"}}),
		},
		{
			name:  "multiple command paths",
			event: hookEventWithTool("multi-read", "PreToolUse", "turn-1", "shell", base, map[string]any{"tool_input": map[string]any{"command": "cat /project/README.md /project/skills/triage/SKILL.md"}}),
		},
		{
			name:  "skill tool",
			event: hookEventWithTool("skill-tool", "PreToolUse", "turn-1", "Skill", base, map[string]any{"tool_input": map[string]any{"name": "triage"}}),
		},
	}

	for _, test := range events {
		t.Run(test.name, func(t *testing.T) {
			document, input := summaryFeaturePayload(test.event.Payload)
			patchText := summaryPatchText(input)
			files := detectFileOperationsFromDocument(test.event, test.event.ID, nil, input, patchText)
			wantRead := false
			for _, file := range files {
				if file.Operation == "read" {
					wantRead = true
					break
				}
			}
			wantSkill := len(detectSkillInvocationsFromDocuments(test.event, test.event.ID, nil, files, document, input)) > 0
			gotFile, gotRead, gotSkillFile := summaryFileFeatureFacts(test.event, input)
			gotSkill := hasSummarySkillInvocation(test.event, document, input, gotSkillFile)
			if gotFile != (len(files) > 0) || gotRead != wantRead || gotSkill != wantSkill {
				t.Fatalf("summary facts = (%t, %t, %t), detailed reconstruction = (%t, %t, %t)", gotFile, gotRead, gotSkill, len(files) > 0, wantRead, wantSkill)
			}
		})
	}
}

func TestSessionSummaryAccumulatorFallsBackToPromptThenSessionID(t *testing.T) {
	accumulator := NewSessionSummaryAccumulator()
	accumulator.Add(hookEvent("prompt", "UserPromptSubmit", "turn-1", time.Date(2026, 10, 22, 10, 0, 0, 0, time.UTC), map[string]any{"prompt": "first prompt"}))
	if got := accumulator.Result("session-1").Title; got != "first prompt" {
		t.Fatalf("prompt title = %q, want first prompt", got)
	}
	if got := NewSessionSummaryAccumulator().Result("session-2").Title; got != "session-2" {
		t.Fatalf("fallback title = %q, want session-2", got)
	}
}
