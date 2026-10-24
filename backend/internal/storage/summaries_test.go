package storage

import (
	"encoding/json"
	"fmt"
	"reflect"
	"strings"
	"testing"

	"github.com/azhry/nala-trace/backend/internal/trace"
	"go.mongodb.org/mongo-driver/bson"
)

func TestSessionSummaryJSONIncludesTitle(t *testing.T) {
	encoded, err := json.Marshal(SessionSummary{SessionID: "session-1", Title: "Inspect the trace", FileReadCount: 2, MCPCallCount: 3, MCPServers: []string{"linear", "github"}, TokenUsage: trace.TokenUsage{InputTokens: 10, TotalTokens: 12}})
	if err != nil {
		t.Fatalf("marshal summary: %v", err)
	}

	var fields map[string]any
	if err := json.Unmarshal(encoded, &fields); err != nil {
		t.Fatalf("decode summary: %v", err)
	}
	if got, want := fields["title"], "Inspect the trace"; got != want {
		t.Fatalf("title = %#v, want %q", got, want)
	}
	if got, want := fields["file_read_count"], float64(2); got != want {
		t.Fatalf("file_read_count = %#v, want %v", got, want)
	}
	if got, want := fields["mcp_call_count"], float64(3); got != want {
		t.Fatalf("mcp_call_count = %#v, want %v", got, want)
	}
	if got, ok := fields["mcp_servers"].([]any); !ok || len(got) != 2 || got[0] != "linear" || got[1] != "github" {
		t.Fatalf("mcp_servers = %#v, want [linear github]", fields["mcp_servers"])
	}
	usage, ok := fields["token_usage"].(map[string]any)
	if !ok || usage["input_tokens"] != float64(10) || usage["total_tokens"] != float64(12) {
		t.Fatalf("token_usage = %#v, want input 10 total 12", fields["token_usage"])
	}
	if _, ok := usage["cost_usd"]; ok {
		t.Fatalf("token_usage unexpectedly contains cost = %#v", usage["cost_usd"])
	}
}

func TestSessionSummaryPipelineDerivesAndProjectsTitle(t *testing.T) {
	pipeline := sessionSummaryPipelineForUser("user-1", 10)
	pipelineValue := make(bson.A, 0, len(pipeline))
	for _, stage := range pipeline {
		pipelineValue = append(pipelineValue, stage)
	}
	if _, err := bson.Marshal(bson.D{{Key: "pipeline", Value: pipelineValue}}); err != nil {
		t.Fatalf("marshal summary pipeline: %v", err)
	}
	if len(pipeline) != 9 {
		t.Fatalf("pipeline stages = %d, want 9", len(pipeline))
	}
	if _, ok := stageDocument(pipeline[0], "$match"); !ok {
		t.Fatalf("first stage = %#v, want owner match", pipeline[0])
	}
	if _, ok := stageDocument(pipeline[1], "$sort"); !ok {
		t.Fatalf("second stage = %#v, want chronological sort", pipeline[1])
	}

	group, ok := stageDocument(pipeline[5], "$group")
	if !ok {
		t.Fatalf("group stage = %#v", pipeline[5])
	}
	for _, field := range []string{"explicit_title", "prompt_title"} {
		if _, ok := documentField(group, field); !ok {
			t.Fatalf("group stage missing %q: %#v", field, group)
		}
	}

	project, ok := stageDocument(pipeline[6], "$project")
	if !ok {
		t.Fatalf("project stage = %#v", pipeline[6])
	}
	title, ok := documentField(project, "title")
	if !ok {
		t.Fatalf("project stage missing title: %#v", project)
	}
	if _, ok := title.(bson.D); !ok {
		t.Fatalf("title expression = %T, want bson.D", title)
	}
	serialized := fmt.Sprintf("%#v", pipeline)
	for _, expected := range []string{"$addFields", "_summary_tool_event", "_summary_mcp_event", "_summary_file_read_event", "_summary_explicit_title_rank", "_summary_prompt_title_rank", "_summary_has_token_usage", "$top", "$payload.tool_input", "$payload.hook_event_name", "$payload.tool_name", "$payload.payload.tool_input", "$payload.payload.hook_event_name", "$payload.payload.tool_name", "$payload.skills", "$payload.tool_input.skills", "$isArray", "SKILL\\\\.md", "file_read_count", "mcp_call_count", "mcp_servers", "token_input_tokens", "token_cached_input_tokens", "token_output_tokens", "token_reasoning_tokens", "token_total_tokens", "token_cumulative_present", "token_cumulative_total_tokens", "token_usage", "$payload.usage.input_tokens", "$payload.usage_source", "$payload.response.usage.output_tokens", "$hook_event_name", "$convert", "$max", "$cond", "^mcp__(?:codex_apps__(?!(?:node_repl)_)[^_\\\\s]+_.+|(?!(?:codex_apps|node_repl)__).+__.+)$", "PreToolUse"} {
		if !strings.Contains(serialized, expected) {
			t.Fatalf("pipeline missing %q: %s", expected, serialized)
		}
	}
	for _, forbidden := range []string{"token_cost_usd", "token_cost_present", "token_cumulative_cost_usd", "token_cumulative_cost_present", "cost_usd", "cost_recorded"} {
		if strings.Contains(serialized, forbidden) {
			t.Fatalf("pipeline unexpectedly contains cost field %q", forbidden)
		}
	}
}

func TestSessionSummaryPipelineForSelectedSessionsUsesOwnerAndSessionScope(t *testing.T) {
	pipeline := sessionSummaryPipelineForUserSessions("user-1", []string{"session-2", "session-1"}, 2)
	pipelineValue := make(bson.A, 0, len(pipeline))
	for _, stage := range pipeline {
		pipelineValue = append(pipelineValue, stage)
	}
	if _, err := bson.Marshal(bson.D{{Key: "pipeline", Value: pipelineValue}}); err != nil {
		t.Fatalf("marshal selected-session pipeline: %v", err)
	}
	match, ok := stageDocument(pipeline[0], "$match")
	if !ok {
		t.Fatalf("first stage = %#v, want owner and session match", pipeline[0])
	}
	if userID, ok := documentField(match, "user_id"); !ok || userID != "user-1" {
		t.Fatalf("user match = %#v, want user-1", userID)
	}
	sessionFilterValue, ok := documentField(match, "session_id")
	if !ok {
		t.Fatalf("match stage missing selected session IDs: %#v", match)
	}
	sessionFilter, ok := sessionFilterValue.(bson.D)
	if !ok {
		t.Fatalf("session filter = %T, want bson.D", sessionFilterValue)
	}
	selectedIDs, ok := documentField(sessionFilter, "$in")
	if !ok || !reflect.DeepEqual(selectedIDs, bson.A{"session-2", "session-1"}) {
		t.Fatalf("selected session IDs = %#v, want the requested IDs", selectedIDs)
	}
	sort, ok := stageDocument(pipeline[1], "$sort")
	if !ok || !reflect.DeepEqual(sort, bson.D{{Key: "session_id", Value: 1}, {Key: "received_at", Value: 1}, {Key: "_id", Value: 1}}) {
		t.Fatalf("sort stage = %#v, want per-session chronological order", pipeline[1])
	}
	limit, ok := documentField(pipeline[len(pipeline)-1], "$limit")
	if !ok || limit != 2 {
		t.Fatalf("last stage limit = %#v, want 2", limit)
	}
}

func TestFastSessionSummaryPipelineLimitsPayloadWorkToRelevantEvents(t *testing.T) {
	pipeline := sessionSummaryPipelineForUserSessionsFast("user-1", []string{"session-1"}, 1)
	pipelineValue := make(bson.A, 0, len(pipeline))
	for _, stage := range pipeline {
		pipelineValue = append(pipelineValue, stage)
	}
	if _, err := bson.Marshal(bson.D{{Key: "pipeline", Value: pipelineValue}}); err != nil {
		t.Fatalf("marshal fast summary pipeline: %v", err)
	}
	serialized := fmt.Sprintf("%#v", pipeline)
	for _, expected := range []string{"$hook_event_name", "PreToolUse", "SubagentStop", "Stop", "_summary_has_token_usage", "$payload.usage", "$payload.response.usage"} {
		if !strings.Contains(serialized, expected) {
			t.Fatalf("fast summary pipeline missing %q: %s", expected, serialized)
		}
	}
	for _, unexpected := range []string{"$payload.payload", "$payload.raw", "$payload.data", "$payload.event"} {
		if strings.Contains(serialized, unexpected) {
			t.Fatalf("fast summary pipeline includes fallback payload path %q: %s", unexpected, serialized)
		}
	}
}

func TestSessionSummaryMetadataPipelineLimitsEventsAndKeepsOwnerScope(t *testing.T) {
	pipeline := sessionSummaryMetadataPipelineForUserSessionsFast("user-1", []string{"session-1"})
	pipelineValue := make(bson.A, 0, len(pipeline))
	for _, stage := range pipeline {
		pipelineValue = append(pipelineValue, stage)
	}
	if _, err := bson.Marshal(bson.D{{Key: "pipeline", Value: pipelineValue}}); err != nil {
		t.Fatalf("marshal metadata summary pipeline: %v", err)
	}
	match, ok := stageDocument(pipeline[0], "$match")
	if !ok {
		t.Fatalf("metadata match stage = %#v", pipeline[0])
	}
	if userID, ok := documentField(match, "user_id"); !ok || userID != "user-1" {
		t.Fatalf("metadata owner scope = %#v, want user-1", userID)
	}
	hookFilterValue, ok := documentField(match, "hook_event_name")
	if !ok {
		t.Fatalf("metadata match is missing event scope: %#v", match)
	}
	hookFilter, ok := hookFilterValue.(bson.D)
	if !ok {
		t.Fatalf("metadata event filter = %T, want bson.D", hookFilterValue)
	}
	if _, ok := documentField(hookFilter, "$in"); !ok {
		t.Fatalf("metadata event filter = %#v, want indexed event names", hookFilter)
	}
	serialized := fmt.Sprintf("%#v", pipeline)
	for _, expected := range []string{"SessionStart", "UserPromptSubmit", "Stop", "SubagentStop", "token_usage", "title"} {
		if !strings.Contains(serialized, expected) {
			t.Fatalf("metadata pipeline missing %q: %s", expected, serialized)
		}
	}
	if strings.Contains(serialized, "PostToolUse") {
		t.Fatalf("metadata pipeline should skip tool events without transcript usage: %s", serialized)
	}
}

func TestSessionSummaryBasePipelineUsesOnlyIndexedEventFields(t *testing.T) {
	pipeline := sessionSummaryBasePipelineForUserSessions("user-1", []string{"session-1", "session-2"}, 2)
	pipelineValue := make(bson.A, 0, len(pipeline))
	for _, stage := range pipeline {
		pipelineValue = append(pipelineValue, stage)
	}
	if _, err := bson.Marshal(bson.D{{Key: "pipeline", Value: pipelineValue}}); err != nil {
		t.Fatalf("marshal base summary pipeline: %v", err)
	}
	if len(pipeline) != 6 {
		t.Fatalf("base pipeline stages = %d, want 6", len(pipeline))
	}
	match, ok := stageDocument(pipeline[0], "$match")
	if !ok {
		t.Fatalf("first stage = %#v, want owner and selected-session match", pipeline[0])
	}
	if userID, ok := documentField(match, "user_id"); !ok || userID != "user-1" {
		t.Fatalf("user match = %#v, want user-1", userID)
	}
	if _, ok := documentField(match, "session_id"); !ok {
		t.Fatalf("match stage missing selected session IDs: %#v", match)
	}
	serialized := fmt.Sprintf("%#v", pipeline)
	if strings.Contains(serialized, "$payload") {
		t.Fatalf("base pipeline reads event payloads: %s", serialized)
	}
	for _, field := range []string{"event_count", "tool_call_count", "first_event_at", "last_event_at"} {
		if !strings.Contains(serialized, field) {
			t.Fatalf("base pipeline missing %q: %s", field, serialized)
		}
	}
}

func TestSessionSummaryPipelineFallsBackToSessionID(t *testing.T) {
	expression := sessionTitleExpression()
	if len(expression) != 1 || expression[0].Key != "$let" {
		t.Fatalf("title expression = %#v, want $let", expression)
	}
	let, ok := expression[0].Value.(bson.D)
	if !ok {
		t.Fatalf("$let value = %T, want bson.D", expression[0].Value)
	}
	in, ok := documentField(let, "in")
	if !ok {
		t.Fatalf("title expression missing in clause: %#v", let)
	}
	inDocument, ok := in.(bson.D)
	if !ok || !containsKey(inDocument, "$ifNull") {
		t.Fatalf("title expression missing fallback: %#v", in)
	}
}

func stageDocument(stage bson.D, key string) (bson.D, bool) {
	value, ok := documentField(stage, key)
	if !ok {
		return nil, false
	}
	document, ok := value.(bson.D)
	return document, ok
}

func documentField(document bson.D, key string) (any, bool) {
	for _, element := range document {
		if element.Key == key {
			return element.Value, true
		}
	}
	return nil, false
}

func containsKey(document bson.D, key string) bool {
	_, ok := documentField(document, key)
	return ok
}
