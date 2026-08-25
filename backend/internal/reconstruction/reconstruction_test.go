package reconstruction

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/azhry/nala-trace/backend/internal/storage"
	"go.mongodb.org/mongo-driver/bson"
)

func TestReconstructConversationPreservesTurnsAndCompaction(t *testing.T) {
	base := time.Date(2026, 8, 20, 10, 0, 0, 0, time.UTC)
	events := []storage.HookEvent{
		hookEvent("stop-2", "Stop", "turn-2", base.Add(5*time.Second), map[string]any{"response": "second answer"}),
		hookEvent("compact", "PreCompact", "turn-1", base.Add(3*time.Second), map[string]any{"reason": "context_window"}),
		hookEvent("prompt-1", "UserPromptSubmit", "turn-1", base, map[string]any{"prompt": "first question"}),
		hookEvent("prompt-2", "UserPromptSubmit", "turn-2", base.Add(4*time.Second), map[string]any{"prompt": "second question"}),
		hookEvent("stop-1", "Stop", "turn-1", base.Add(2*time.Second), map[string]any{"response": "first answer"}),
	}

	result := Reconstruct("session-1", "user-1", events)
	if len(result.Conversation) != 4 {
		t.Fatalf("conversation length = %d, want 4", len(result.Conversation))
	}
	wantRoles := []string{"user", "assistant", "user", "assistant"}
	wantTurns := []string{"turn-1", "turn-1", "turn-2", "turn-2"}
	for index, item := range result.Conversation {
		if item.Role != wantRoles[index] {
			t.Errorf("conversation[%d].Role = %q, want %q", index, item.Role, wantRoles[index])
		}
		if item.TurnID == nil || *item.TurnID != wantTurns[index] {
			t.Errorf("conversation[%d].TurnID = %v, want %q", index, item.TurnID, wantTurns[index])
		}
	}
	if result.Summary.MessageCount != 4 {
		t.Errorf("message count = %d, want 4", result.Summary.MessageCount)
	}
	if len(result.Timeline) != len(events) || result.Timeline[1].HookEventName != "Stop" {
		t.Errorf("timeline did not retain ordered compaction boundary: %#v", result.Timeline)
	}
}

func TestReconstructConversationSkipsMissingContent(t *testing.T) {
	events := []storage.HookEvent{
		hookEvent("missing", "UserPromptSubmit", "turn-1", time.Unix(10, 0).UTC(), map[string]any{}),
		hookEvent("structured", "Stop", "turn-1", time.Unix(11, 0).UTC(), map[string]any{"content": map[string]any{"text": "structured answer"}}),
	}

	result := Reconstruct("session-1", "user-1", events)
	if len(result.Conversation) != 1 {
		t.Fatalf("conversation length = %d, want 1", len(result.Conversation))
	}
	var content map[string]string
	if err := json.Unmarshal(result.Conversation[0].Content, &content); err != nil {
		t.Fatalf("structured content is not JSON: %v", err)
	}
	if content["text"] != "structured answer" {
		t.Errorf("content = %#v, want structured answer", content)
	}
	if result.Summary.EventCount != 2 {
		t.Errorf("event count = %d, want 2", result.Summary.EventCount)
	}
}

func TestReconstructConversationReadsCodexAssistantMessages(t *testing.T) {
	base := time.Unix(40, 0).UTC()
	agentID := "agent-1"
	agentType := "worker"
	events := []storage.HookEvent{
		hookEvent("prompt", "UserPromptSubmit", "turn-1", base, map[string]any{
			"prompt": "What changed?",
		}),
		hookEvent("stop", "Stop", "turn-1", base.Add(time.Second), map[string]any{
			"last_assistant_message": "The trace now includes assistant replies.",
		}),
		hookEvent("subagent-stop", "SubagentStop", "turn-1", base.Add(2*time.Second), map[string]any{
			"agent_id":               agentID,
			"agent_type":             agentType,
			"last_assistant_message": "Internal worker result.",
		}),
	}

	result := Reconstruct("session-1", "user-1", events)
	if len(result.Conversation) != 3 {
		t.Fatalf("conversation length = %d, want 3", len(result.Conversation))
	}
	if result.Conversation[0].EventID != "prompt" || result.Conversation[0].Role != "user" || string(result.Conversation[0].Content) != `"What changed?"` {
		t.Fatalf("user conversation item = %#v", result.Conversation[0])
	}
	if result.Conversation[1].EventID != "stop" || result.Conversation[1].Role != "assistant" || string(result.Conversation[1].Content) != `"The trace now includes assistant replies."` {
		t.Fatalf("assistant conversation item = %#v", result.Conversation[1])
	}
	if result.Conversation[2].Role != "assistant" || string(result.Conversation[2].Content) != `"Internal worker result."` {
		t.Fatalf("subagent conversation item = %#v", result.Conversation[2])
	}
	var raw map[string]any
	if err := json.Unmarshal(result.Conversation[2].Raw, &raw); err != nil {
		t.Fatalf("subagent raw payload is not JSON: %v", err)
	}
	if raw["agent_id"] != agentID || raw["agent_type"] != agentType {
		t.Fatalf("subagent provenance = %#v", raw)
	}
}

func TestReconstructDetectsApplyPatchShellFileSkillAndAmbiguousPayloads(t *testing.T) {
	base := time.Unix(20, 0).UTC()
	events := []storage.HookEvent{
		hookEventWithTool("patch", "PreToolUse", "turn-1", "patch", base, map[string]any{
			"tool_input": "*** Begin Patch\n*** Update File: backend/main.go\n*** Add File: backend/internal/reconstruction/reconstruction_test.go\n*** End Patch",
		}),
		hookEventWithTool("read", "PreToolUse", "turn-1", "read_file", base.Add(time.Second), map[string]any{
			"tool_input": map[string]any{"file_path": "README.md"},
		}),
		hookEventWithTool("write", "PreToolUse", "turn-1", "shell_command", base.Add(2*time.Second), map[string]any{
			"tool_input": map[string]any{"command": "Set-Content -Path notes.md -Value done"},
		}),
		hookEventWithTool("skill", "PreToolUse", "turn-1", "skill", base.Add(3*time.Second), map[string]any{
			"tool_input": map[string]any{"name": "frontend-design"},
		}),
		hookEventWithTool("ambiguous", "PreToolUse", "turn-1", "custom_tool", base.Add(4*time.Second), map[string]any{
			"tool_input": map[string]any{"path": "notes.md"},
		}),
	}

	result := Reconstruct("session-1", "user-1", events)
	if len(result.Files) != 5 {
		t.Fatalf("file operation count = %d, want 5", len(result.Files))
	}
	if result.Files[0].Path != "backend/main.go" || result.Files[0].Operation != "write" || result.Files[0].Confidence != confidenceExplicit {
		t.Errorf("first patch operation = %#v", result.Files[0])
	}
	if result.Files[2].Operation != "read" || result.Files[2].Confidence != confidenceExplicit {
		t.Errorf("read operation = %#v", result.Files[2])
	}
	if result.Files[3].Operation != "write" || result.Files[3].Confidence != confidenceInferred {
		t.Errorf("shell operation = %#v", result.Files[3])
	}
	if result.Files[4].Operation != "ambiguous" || result.Files[4].Confidence != confidenceAmbiguous {
		t.Errorf("ambiguous operation = %#v", result.Files[4])
	}
	if len(result.SkillInvocations) != 1 || result.SkillInvocations[0].Name != "frontend-design" || result.SkillInvocations[0].Confidence != confidenceInferred {
		t.Errorf("skill invocation = %#v", result.SkillInvocations)
	}
	if result.Summary.FileOperationCount != 5 || result.Summary.SkillInvocationCount != 1 {
		t.Errorf("summary = %#v", result.Summary)
	}
	if result.Files[0].EventID != "patch" || result.Files[0].ToolName != "patch" {
		t.Errorf("file metadata = %#v", result.Files[0])
	}
}

func TestReconstructDetectsMultipleShellReadPaths(t *testing.T) {
	base := time.Unix(25, 0).UTC()
	result := Reconstruct("session-1", "user-1", []storage.HookEvent{
		hookEventWithTool("multi-read", "PreToolUse", "turn-1", "shell_command", base, map[string]any{
			"tool_input": map[string]any{
				"command": "Get-Content -LiteralPath '.agents/skills/linear/SKILL.md'; Get-Content -LiteralPath 'C:\\Users\\Lyrid\\.agents\\skills\\diagnose\\SKILL.md'",
			},
		}),
	})

	if len(result.Files) != 2 {
		t.Fatalf("file operation count = %d, want 2: %#v", len(result.Files), result.Files)
	}
	for index, want := range []string{
		".agents/skills/linear/SKILL.md",
		"C:\\Users\\Lyrid\\.agents\\skills\\diagnose\\SKILL.md",
	} {
		if result.Files[index].Path != want || result.Files[index].Operation != "read" || result.Files[index].Confidence != confidenceInferred {
			t.Errorf("file operation[%d] = %#v, want read %q", index, result.Files[index], want)
		}
	}
	if result.Summary.FileReadCount != 2 {
		t.Fatalf("file read count = %d, want 2", result.Summary.FileReadCount)
	}
}

func TestReconstructCountsSkillDocumentReadsAsInvocations(t *testing.T) {
	base := time.Unix(26, 0).UTC()
	result := Reconstruct("session-1", "user-1", []storage.HookEvent{
		hookEventWithTool("multi-skill-read", "PreToolUse", "turn-1", "shell_command", base, map[string]any{
			"tool_input": map[string]any{
				"command": "Get-Content -LiteralPath '.agents/skills/linear/SKILL.md'; Get-Content -LiteralPath 'C:\\Users\\Lyrid\\.agents\\skills\\diagnose\\SKILL.md'",
			},
		}),
	})

	if len(result.SkillInvocations) != 2 {
		t.Fatalf("skill invocation count = %d, want 2: %#v", len(result.SkillInvocations), result.SkillInvocations)
	}
	for index, want := range []string{"linear", "diagnose"} {
		if result.SkillInvocations[index].Name != want || result.SkillInvocations[index].Confidence != confidenceInferred {
			t.Fatalf("skill invocation[%d] = %#v, want inferred %q", index, result.SkillInvocations[index], want)
		}
	}
	if result.Summary.SkillInvocationCount != 2 {
		t.Fatalf("summary skill invocation count = %d, want 2", result.Summary.SkillInvocationCount)
	}
}

func TestReconstructCountsSkillMetadataArray(t *testing.T) {
	result := Reconstruct("session-1", "user-1", []storage.HookEvent{
		hookEventWithTool("skill-metadata", "PreToolUse", "turn-1", "shell_command", time.Unix(27, 0).UTC(), map[string]any{
			"skills":     []any{"linear", "diagnose"},
			"tool_input": map[string]any{"command": "go test ./..."},
		}),
	})

	if len(result.SkillInvocations) != 2 || result.Summary.SkillInvocationCount != 2 {
		t.Fatalf("skill metadata = %#v, want two invocations", result.SkillInvocations)
	}
	if result.SkillInvocations[0].Name != "linear" || result.SkillInvocations[1].Name != "diagnose" {
		t.Fatalf("skill metadata names = %#v", result.SkillInvocations)
	}
}

func TestReconstructSeparatesMCPCallsAndServersFromToolCalls(t *testing.T) {
	base := time.Unix(90, 0).UTC()
	result := Reconstruct("session-1", "user-1", []storage.HookEvent{
		hookEventWithTool("mcp-linear", "PreToolUse", "turn-1", "mcp__codex_apps__linear_get_issue", base, map[string]any{
			"tool_input": map[string]any{"id": "AZH-500"},
		}),
		hookEventWithTool("mcp-github", "PreToolUse", "turn-1", "mcp__github__get_issue", base.Add(time.Second), map[string]any{
			"tool_input": map[string]any{"number": 26},
		}),
		hookEventWithTool("mcp-linear-post", "PostToolUse", "turn-1", "mcp__codex_apps__linear_get_issue", base.Add(2*time.Second), map[string]any{
			"tool_response": map[string]any{"id": "AZH-500"},
		}),
		hookEventWithTool("ordinary", "PreToolUse", "turn-1", "shell_command", base.Add(3*time.Second), map[string]any{
			"tool_input": map[string]any{"command": "go test ./..."},
		}),
	})

	if result.Summary.ToolCallCount != 4 || result.Summary.MCPCallCount != 1 {
		t.Fatalf("summary counts = %#v, want 4 total calls and 1 MCP call", result.Summary)
	}
	wantServers := []string{"github"}
	if len(result.Summary.MCPServers) != len(wantServers) {
		t.Fatalf("MCP servers = %#v, want %#v", result.Summary.MCPServers, wantServers)
	}
	for index, want := range wantServers {
		if result.Summary.MCPServers[index] != want {
			t.Fatalf("MCP server[%d] = %q, want %q", index, result.Summary.MCPServers[index], want)
		}
	}
	if result.ToolCalls[0].MCPServer != "" || result.ToolCalls[1].MCPServer != "github" {
		t.Fatalf("tool MCP server projection = %#v", result.ToolCalls[:2])
	}
}

func TestReconstructDetectsSignalsInsideNestedRawPayload(t *testing.T) {
	payload, err := bson.Marshal(bson.M{
		"payload": bson.M{
			"hook_event_name": "PreToolUse",
			"tool_name":       "skill",
			"tool_use_id":     "skill-1",
			"tool_input": bson.M{
				"skill_name": "frontend-design",
			},
		},
	})
	if err != nil {
		t.Fatalf("marshal nested payload: %v", err)
	}

	result := Reconstruct("session-1", "user-1", []storage.HookEvent{{
		ID:            "nested-skill",
		UserID:        "user-1",
		SessionID:     "session-1",
		HookEventName: "PreToolUse",
		ToolName:      stringPointer("skill"),
		ToolUseID:     stringPointer("skill-1"),
		Payload:       bson.Raw(payload),
		ReceivedAt:    time.Unix(80, 0).UTC(),
	}})

	if len(result.SkillInvocations) != 1 || result.SkillInvocations[0].Name != "frontend-design" {
		t.Fatalf("nested skill invocations = %#v", result.SkillInvocations)
	}
	if result.Summary.SkillInvocationCount != 1 {
		t.Fatalf("nested summary = %#v", result.Summary)
	}
}

func TestReconstructExtractsAllowlistedRuntimeMetadataAndFileReads(t *testing.T) {
	base := time.Unix(60, 0).UTC()
	result := Reconstruct("session-1", "user-1", []storage.HookEvent{
		hookEvent("settings", "SessionStart", "", base, map[string]any{
			"metadata": map[string]any{
				"model":                 "gpt-5",
				"provider":              "openai",
				"reasoning_effort":      "high",
				"context_window_tokens": 258400,
				"client":                "Codex Desktop",
				"client_version":        "0.148.0",
				"source":                "vscode",
				"permission_mode":       "workspace-write",
				"thread_source":         "user",
				"api_key":               "must-not-be-projected",
			},
		}),
		hookEventWithTool("read", "PreToolUse", "turn-1", "read_file", base.Add(time.Second), map[string]any{
			"tool_input": map[string]any{"file_path": "README.md"},
		}),
	})

	if result.RuntimeMetadata.Model != "gpt-5" || result.RuntimeMetadata.Provider != "openai" || result.RuntimeMetadata.ContextWindowTokens != 258400 || result.RuntimeMetadata.PermissionMode != "workspace-write" {
		t.Fatalf("runtime metadata = %#v", result.RuntimeMetadata)
	}
	if result.RuntimeMetadata.RecordedFrom != "SessionStart" {
		t.Fatalf("runtime metadata source = %q, want SessionStart", result.RuntimeMetadata.RecordedFrom)
	}
	if result.Summary.FileReadCount != 1 {
		t.Fatalf("file read count = %d, want 1", result.Summary.FileReadCount)
	}
	encoded, err := json.Marshal(result.RuntimeMetadata)
	if err != nil {
		t.Fatalf("marshal runtime metadata: %v", err)
	}
	if strings.Contains(string(encoded), "must-not-be-projected") {
		t.Fatalf("runtime metadata leaked an unallowlisted value: %s", encoded)
	}
}

func TestReconstructExtractsRuntimeMetadataFromNestedPayloadContexts(t *testing.T) {
	base := time.Unix(70, 0).UTC()
	result := Reconstruct("session-1", "user-1", []storage.HookEvent{
		hookEvent("settings", "SessionStart", "", base, map[string]any{
			"payload": map[string]any{
				"turn_context": map[string]any{
					"provider":            "openai",
					"reasoningEffort":     "xhigh",
					"contextWindowTokens": 258400,
					"client":              "Codex Desktop",
					"clientVersion":       "0.148.0",
					"permissionMode":      "workspace-write",
					"threadSource":        "user",
				},
			},
		}),
	})

	metadata := result.RuntimeMetadata
	if metadata.Provider != "openai" || metadata.ReasoningEffort != "xhigh" || metadata.ContextWindowTokens != 258400 || metadata.Client != "Codex Desktop" || metadata.ClientVersion != "0.148.0" || metadata.PermissionMode != "workspace-write" || metadata.ThreadSource != "user" {
		t.Fatalf("nested runtime metadata = %#v", metadata)
	}

	encodedContext, err := json.Marshal(map[string]any{"provider": "openai", "reasoning_effort": "high"})
	if err != nil {
		t.Fatalf("marshal encoded runtime metadata: %v", err)
	}
	encodedResult := Reconstruct("session-1", "user-1", []storage.HookEvent{
		hookEvent("encoded-settings", "SessionStart", "", base, map[string]any{
			"payload": map[string]any{
				"execution_settings": string(encodedContext),
			},
		}),
	})
	if encodedResult.RuntimeMetadata.Provider != "openai" || encodedResult.RuntimeMetadata.ReasoningEffort != "high" {
		t.Fatalf("JSON-encoded nested runtime metadata = %#v", encodedResult.RuntimeMetadata)
	}
}

func TestReconstructPreservesOnlySettingsEmittedByCodexHookPayload(t *testing.T) {
	result := Reconstruct("session-1", "user-1", []storage.HookEvent{
		hookEvent("session-start", "SessionStart", "", time.Unix(75, 0).UTC(), map[string]any{
			"model":           "gpt-5.6-luna",
			"permission_mode": "workspace-write",
			"source":          "startup",
		}),
	})

	metadata := result.RuntimeMetadata
	if metadata.Model != "gpt-5.6-luna" || metadata.PermissionMode != "workspace-write" || metadata.Source != "startup" {
		t.Fatalf("Codex hook metadata = %#v", metadata)
	}
	if metadata.Provider != "" || metadata.ReasoningEffort != "" || metadata.ContextWindowTokens != 0 || metadata.Client != "" || metadata.ClientVersion != "" || metadata.ThreadSource != "" {
		t.Fatalf("runtime metadata inferred fields that were not emitted: %#v", metadata)
	}
}

func TestReconstructBoundsMalformedAndOversizedPayloads(t *testing.T) {
	oversized, err := bson.Marshal(map[string]any{"content": strings.Repeat("x", maxReconstructionPayloadBytes)})
	if err != nil {
		t.Fatalf("marshal oversized payload: %v", err)
	}
	base := time.Unix(30, 0).UTC()
	result := Reconstruct("session-1", "user-1", []storage.HookEvent{
		{
			ID:            "malformed",
			UserID:        "user-1",
			SessionID:     "session-1",
			HookEventName: "UserPromptSubmit",
			Payload:       bson.Raw{0x01},
			ReceivedAt:    base,
		},
		{
			ID:            "oversized",
			UserID:        "user-1",
			SessionID:     "session-1",
			HookEventName: "Stop",
			Payload:       bson.Raw(oversized),
			ReceivedAt:    base.Add(time.Second),
		},
	})

	if len(result.Timeline) != 2 {
		t.Fatalf("timeline length = %d, want 2", len(result.Timeline))
	}
	if result.Timeline[0].PartialReason != "malformed_payload" || string(result.Timeline[0].Raw) != `{"error":"malformed_payload"}` {
		t.Fatalf("malformed event = %#v", result.Timeline[0])
	}
	if result.Timeline[1].PartialReason != "payload_too_large" || string(result.Timeline[1].Raw) != `{"error":"payload_too_large"}` {
		t.Fatalf("oversized event = %#v", result.Timeline[1])
	}
	if len(result.Conversation) != 0 || result.Summary.EventCount != 2 {
		t.Fatalf("bounded trace = %#v", result)
	}
}

func hookEvent(id, eventName, turnID string, receivedAt time.Time, payload map[string]any) storage.HookEvent {
	return hookEventWithTool(id, eventName, turnID, "", receivedAt, map[string]any{"payload": payload})
}

func hookEventWithTool(id, eventName, turnID, toolName string, receivedAt time.Time, values map[string]any) storage.HookEvent {
	payload := values
	if nested, ok := values["payload"].(map[string]any); ok {
		payload = nested
	}
	encoded, err := bson.Marshal(payload)
	if err != nil {
		panic(err)
	}
	return storage.HookEvent{
		ID:            id,
		UserID:        "user-1",
		SessionID:     "session-1",
		TurnID:        stringPointer(turnID),
		HookEventName: eventName,
		ToolName:      stringPointerOrNil(toolName),
		ToolUseID:     stringPointer(id + "-tool"),
		Payload:       bson.Raw(encoded),
		ReceivedAt:    receivedAt,
	}
}

func stringPointer(value string) *string {
	return &value
}

func stringPointerOrNil(value string) *string {
	if value == "" {
		return nil
	}
	return &value
}
