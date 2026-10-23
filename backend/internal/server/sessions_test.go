package server

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/azhry/nala-trace/backend/internal/auth"
	"github.com/azhry/nala-trace/backend/internal/storage"
	"github.com/azhry/nala-trace/backend/internal/testfixtures"
	"github.com/azhry/nala-trace/backend/internal/trace"
	"go.mongodb.org/mongo-driver/bson"
)

type traceEventRepository struct {
	userID    string
	sessionID string
	events    []storage.HookEvent
	err       error
	calls     int
}

func (repository *traceEventRepository) ListSessionEventsForUser(_ context.Context, userID, sessionID string) ([]storage.HookEvent, error) {
	repository.calls++
	repository.userID = userID
	repository.sessionID = sessionID
	return repository.events, repository.err
}

type sessionSummaryRepository struct {
	userID string
	limit  int
	rows   []storage.SessionSummary
	err    error
	calls  int
}

type sessionSummaryEventsRepository struct {
	summary *sessionSummaryRepository
	events  []storage.HookEvent
	err     error
	userID  string
	ids     []string
}

type sessionSummaryFeatureEventsRepository struct {
	summary *sessionSummaryRepository
	events  []storage.HookEvent
	err     error
	userID  string
	ids     []string
}

type sessionSummaryWindowRepository struct {
	rows         []storage.SessionSummary
	summaryUser  string
	summaryLimit int
	baseUserID   string
	eventUserID  string
	sessionIDs   []string
	eventCalls   int
}

type sessionSummaryFeatureWindowRepository struct {
	rows              []storage.SessionSummary
	events            []storage.HookEvent
	recentUser        string
	baseUser          string
	baseSessionIDs    []string
	featureUser       string
	featureSessionIDs []string
}

func (repository *sessionSummaryEventsRepository) ListSessionSummariesForUser(ctx context.Context, userID string, limit int) ([]storage.SessionSummary, error) {
	return repository.summary.ListSessionSummariesForUser(ctx, userID, limit)
}

func (repository *sessionSummaryEventsRepository) WalkSessionSummaryEventsForUser(_ context.Context, userID string, sessionIDs []string, yield func(storage.HookEvent) error) error {
	repository.userID = userID
	repository.ids = append([]string(nil), sessionIDs...)
	if repository.err != nil {
		return repository.err
	}
	for _, event := range repository.events {
		if err := yield(event); err != nil {
			return err
		}
	}
	return nil
}

func (repository *sessionSummaryFeatureEventsRepository) ListSessionSummariesForUser(ctx context.Context, userID string, limit int) ([]storage.SessionSummary, error) {
	return repository.summary.ListSessionSummariesForUser(ctx, userID, limit)
}

func (repository *sessionSummaryFeatureEventsRepository) WalkSessionSummaryFeatureEventsForUser(_ context.Context, userID string, sessionIDs []string, yield func(storage.HookEvent) error) error {
	repository.userID = userID
	repository.ids = append([]string(nil), sessionIDs...)
	if repository.err != nil {
		return repository.err
	}
	for _, event := range repository.events {
		if err := yield(event); err != nil {
			return err
		}
	}
	return nil
}

func (repository *sessionSummaryRepository) ListSessionSummariesForUser(_ context.Context, userID string, limit int) ([]storage.SessionSummary, error) {
	repository.calls++
	repository.userID = userID
	repository.limit = limit
	return repository.rows, repository.err
}

func (repository *sessionSummaryWindowRepository) ListSessionSummariesForUser(_ context.Context, userID string, limit int) ([]storage.SessionSummary, error) {
	repository.summaryUser = userID
	repository.summaryLimit = limit
	return repository.rows, nil
}

func (repository *sessionSummaryWindowRepository) ListRecentSessionIDsForUser(_ context.Context, userID string, _ int) ([]string, error) {
	repository.baseUserID = userID
	return []string{"session-1"}, nil
}

func (repository *sessionSummaryWindowRepository) ListSessionSummariesForUserSessions(_ context.Context, userID string, sessionIDs []string, _ int) ([]storage.SessionSummary, error) {
	repository.baseUserID = userID
	repository.sessionIDs = append([]string(nil), sessionIDs...)
	return repository.rows, nil
}

func (repository *sessionSummaryWindowRepository) WalkSessionSummaryEventsForUser(_ context.Context, userID string, _ []string, yield func(storage.HookEvent) error) error {
	repository.eventCalls++
	repository.eventUserID = userID
	return nil
}

func (repository *sessionSummaryFeatureWindowRepository) ListSessionSummariesForUser(context.Context, string, int) ([]storage.SessionSummary, error) {
	return nil, errors.New("unwindowed session summary query should not be used")
}

func (repository *sessionSummaryFeatureWindowRepository) ListRecentSessionIDsForUser(_ context.Context, userID string, _ int) ([]string, error) {
	repository.recentUser = userID
	return []string{"session-1"}, nil
}

func (repository *sessionSummaryFeatureWindowRepository) ListSessionSummariesForUserSessions(_ context.Context, userID string, sessionIDs []string, _ int) ([]storage.SessionSummary, error) {
	repository.baseUser = userID
	repository.baseSessionIDs = append([]string(nil), sessionIDs...)
	return repository.rows, nil
}

func (repository *sessionSummaryFeatureWindowRepository) WalkSessionSummaryFeatureEventsForUser(_ context.Context, userID string, sessionIDs []string, yield func(storage.HookEvent) error) error {
	repository.featureUser = userID
	repository.featureSessionIDs = append([]string(nil), sessionIDs...)
	for _, event := range repository.events {
		if err := yield(event); err != nil {
			return err
		}
	}
	return nil
}

func TestSessionsHandlerReturnsTokenUsage(t *testing.T) {
	repository := &sessionSummaryRepository{rows: []storage.SessionSummary{{
		SessionID:  "session-1",
		TokenUsage: trace.TokenUsage{InputTokens: 10, OutputTokens: 4, TotalTokens: 14},
	}}}
	request := authenticatedTraceRequest(http.MethodGet, "/sessions?limit=10")
	response := httptest.NewRecorder()

	NewSessionsHandler(repository).ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d: %s", response.Code, http.StatusOK, response.Body.String())
	}
	if repository.userID != "user-1" || repository.limit != 10 {
		t.Fatalf("repository request = (%q, %d), want (user-1, 10)", repository.userID, repository.limit)
	}
	var result struct {
		Sessions []storage.SessionSummary `json:"sessions"`
		Limit    int                      `json:"limit"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if result.Limit != 10 || len(result.Sessions) != 1 {
		t.Fatalf("response = %#v, want one session with limit 10", result)
	}
	usage := result.Sessions[0].TokenUsage
	if usage.InputTokens != 10 || usage.OutputTokens != 4 || usage.TotalTokens != 14 {
		t.Fatalf("session token usage = %#v", usage)
	}
}

func TestSessionsHandlerEnrichesBaseRowsFromSummaryEvents(t *testing.T) {
	base := time.Date(2026, 10, 22, 10, 0, 0, 0, time.UTC)
	toolName := "mcp__codex_apps__github_search"
	toolEvent := testHookEvent("tool", "PreToolUse", "turn-1", "tool-1", base, map[string]any{
		"tool_input": map[string]any{"file_path": "README.md", "operation": "read", "skill_name": "triage"},
	})
	toolEvent.ToolName = &toolName
	repository := &sessionSummaryEventsRepository{
		summary: &sessionSummaryRepository{rows: []storage.SessionSummary{{SessionID: "session-1", UserID: "user-1", EventCount: 3, ToolCallCount: 1}}},
		events: []storage.HookEvent{
			toolEvent,
			testHookEvent("prompt", "UserPromptSubmit", "turn-1", "", base.Add(time.Second), map[string]any{"prompt": "inspect the trace"}),
			testHookEvent("stop", "Stop", "turn-1", "", base.Add(2*time.Second), map[string]any{"usage": map[string]any{"input_tokens": 12, "output_tokens": 4, "total_tokens": 16}}),
		},
	}
	request := authenticatedTraceRequest(http.MethodGet, "/sessions?limit=10")
	response := httptest.NewRecorder()

	NewSessionsHandler(repository).ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d: %s", response.Code, http.StatusOK, response.Body.String())
	}
	if repository.userID != "user-1" || !reflect.DeepEqual(repository.ids, []string{"session-1"}) {
		t.Fatalf("summary event scope = (%q, %#v), want (user-1, [session-1])", repository.userID, repository.ids)
	}
	var result struct {
		Sessions []storage.SessionSummary `json:"sessions"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(result.Sessions) != 1 {
		t.Fatalf("sessions = %d, want 1", len(result.Sessions))
	}
	summary := result.Sessions[0]
	if summary.Title != "inspect the trace" || summary.MCPCallCount != 1 || !reflect.DeepEqual(summary.MCPServers, []string{"github"}) || summary.SkillInvocationCount != 1 || summary.FileOperationCount != 1 || summary.FileReadCount != 1 {
		t.Fatalf("session features = %#v", summary)
	}
	if summary.EventCount != 3 || summary.ToolCallCount != 1 || summary.TokenUsage.InputTokens != 12 || summary.TokenUsage.OutputTokens != 4 || summary.TokenUsage.TotalTokens != 16 {
		t.Fatalf("session base and usage fields = %#v", summary)
	}
}

func TestSessionsHandlerAddsStreamedFeaturesWithoutReplacingBaseFields(t *testing.T) {
	base := time.Date(2026, 10, 22, 10, 0, 0, 0, time.UTC)
	toolName := "mcp__codex_apps__github_search"
	toolEvent := testHookEvent("tool", "PreToolUse", "turn-1", "tool-1", base, map[string]any{
		"tool_input": map[string]any{"file_path": "README.md", "operation": "read", "skill_name": "triage"},
	})
	toolEvent.ToolName = &toolName
	repository := &sessionSummaryFeatureEventsRepository{
		summary: &sessionSummaryRepository{rows: []storage.SessionSummary{{
			SessionID:  "session-1",
			UserID:     "user-1",
			Title:      "precomputed title",
			EventCount: 4,
			TokenUsage: trace.TokenUsage{InputTokens: 12, OutputTokens: 4, TotalTokens: 16},
		}}},
		events: []storage.HookEvent{toolEvent},
	}
	response := httptest.NewRecorder()
	NewSessionsHandler(repository).ServeHTTP(response, authenticatedTraceRequest(http.MethodGet, "/sessions?limit=10"))
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d: %s", response.Code, http.StatusOK, response.Body.String())
	}
	if repository.userID != "user-1" || !reflect.DeepEqual(repository.ids, []string{"session-1"}) {
		t.Fatalf("feature event scope = (%q, %#v), want (user-1, [session-1])", repository.userID, repository.ids)
	}
	var result struct {
		Sessions []storage.SessionSummary `json:"sessions"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(result.Sessions) != 1 {
		t.Fatalf("sessions = %d, want 1", len(result.Sessions))
	}
	summary := result.Sessions[0]
	if summary.Title != "precomputed title" || summary.EventCount != 4 || summary.TokenUsage.InputTokens != 12 || summary.TokenUsage.OutputTokens != 4 || summary.TokenUsage.TotalTokens != 16 {
		t.Fatalf("base summary fields changed during feature merge: %#v", summary)
	}
	if summary.MCPCallCount != 1 || !reflect.DeepEqual(summary.MCPServers, []string{"github"}) || summary.SkillInvocationCount != 1 || summary.FileOperationCount != 1 || summary.FileReadCount != 1 {
		t.Fatalf("streamed feature fields = %#v", summary)
	}
}

func TestSessionsHandlerLoadsSummaryWindowAndFeaturesTogether(t *testing.T) {
	base := time.Date(2026, 10, 22, 10, 0, 0, 0, time.UTC)
	event := testHookEvent("feature", "PreToolUse", "turn-1", "call-1", base, map[string]any{
		"tool_input": map[string]any{"file_path": "README.md", "operation": "read"},
	})
	toolName := "mcp__codex_apps__github_search"
	event.ToolName = &toolName
	repository := &sessionSummaryFeatureWindowRepository{
		rows: []storage.SessionSummary{{
			SessionID:  "session-1",
			UserID:     "user-1",
			Title:      "precomputed title",
			EventCount: 4,
			TokenUsage: trace.TokenUsage{InputTokens: 12, OutputTokens: 4, TotalTokens: 16},
		}},
		events: []storage.HookEvent{event},
	}
	response := httptest.NewRecorder()
	NewSessionsHandler(repository).ServeHTTP(response, authenticatedTraceRequest(http.MethodGet, "/sessions?limit=10"))
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d: %s", response.Code, http.StatusOK, response.Body.String())
	}
	if repository.recentUser != "user-1" || repository.baseUser != "user-1" || repository.featureUser != "user-1" {
		t.Fatalf("window query owners = (%q, %q, %q), want user-1", repository.recentUser, repository.baseUser, repository.featureUser)
	}
	wantIDs := []string{"session-1"}
	if !reflect.DeepEqual(repository.baseSessionIDs, wantIDs) || !reflect.DeepEqual(repository.featureSessionIDs, wantIDs) {
		t.Fatalf("window query sessions = (%#v, %#v), want %#v", repository.baseSessionIDs, repository.featureSessionIDs, wantIDs)
	}
	var result struct {
		Sessions []storage.SessionSummary `json:"sessions"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(result.Sessions) != 1 {
		t.Fatalf("sessions = %d, want 1", len(result.Sessions))
	}
	summary := result.Sessions[0]
	if summary.Title != "precomputed title" || summary.EventCount != 4 || summary.TokenUsage.InputTokens != 12 || summary.TokenUsage.OutputTokens != 4 || summary.TokenUsage.TotalTokens != 16 {
		t.Fatalf("base summary fields changed during feature merge: %#v", summary)
	}
	if summary.MCPCallCount != 1 || !reflect.DeepEqual(summary.MCPServers, []string{"github"}) || summary.FileOperationCount != 1 || summary.FileReadCount != 1 {
		t.Fatalf("window feature fields = %#v", summary)
	}
}

func TestSessionsHandlerUsesPrecomputedSessionSummaryRows(t *testing.T) {
	repository := &sessionSummaryWindowRepository{
		rows: []storage.SessionSummary{{SessionID: "session-1", Title: "precomputed session", EventCount: 2, MCPServers: []string{"github"}}},
	}
	request := authenticatedTraceRequest(http.MethodGet, "/sessions?limit=10")
	response := httptest.NewRecorder()
	NewSessionsHandler(repository).ServeHTTP(response, request)
	if repository.summaryUser != "user-1" || repository.summaryLimit != 10 {
		t.Fatalf("summary repository request = (%q, %d), want (user-1, 10)", repository.summaryUser, repository.summaryLimit)
	}
	if repository.eventCalls != 0 {
		t.Fatalf("event walk calls = %d, want precomputed session summaries only", repository.eventCalls)
	}
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d: %s", response.Code, http.StatusOK, response.Body.String())
	}
	var result struct {
		Sessions []storage.SessionSummary `json:"sessions"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(result.Sessions) != 1 || result.Sessions[0].Title != "precomputed session" || result.Sessions[0].EventCount != 2 || !reflect.DeepEqual(result.Sessions[0].MCPServers, []string{"github"}) {
		t.Fatalf("sessions = %#v, want precomputed summary row", result.Sessions)
	}
}

func TestSessionsHandlerMapsSummaryEventFailure(t *testing.T) {
	repository := &sessionSummaryEventsRepository{
		summary: &sessionSummaryRepository{rows: []storage.SessionSummary{{SessionID: "session-1"}}},
		err:     errors.New("mongo unavailable"),
	}
	response := httptest.NewRecorder()
	NewSessionsHandler(repository).ServeHTTP(response, authenticatedTraceRequest(http.MethodGet, "/sessions?limit=1"))
	if response.Code != http.StatusInternalServerError || !strings.Contains(response.Body.String(), `"code":"sessions_failed"`) {
		t.Fatalf("response = %d %q, want safe sessions_failed response", response.Code, response.Body.String())
	}
}

func TestSessionsHandlerReturnsEmptyList(t *testing.T) {
	repository := &sessionSummaryRepository{}
	request := authenticatedTraceRequest(http.MethodGet, "/sessions?limit=10")
	response := httptest.NewRecorder()

	NewSessionsHandler(repository).ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d: %s", response.Code, http.StatusOK, response.Body.String())
	}
	var result struct {
		Sessions []storage.SessionSummary `json:"sessions"`
		Limit    int                      `json:"limit"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if result.Sessions == nil || len(result.Sessions) != 0 || result.Limit != 10 {
		t.Fatalf("response = %#v, want an empty session array with limit 10", result)
	}
}

func TestSessionsHandlerMapsRepositoryFailure(t *testing.T) {
	repository := &sessionSummaryRepository{err: errors.New("mongo unavailable")}
	request := authenticatedTraceRequest(http.MethodGet, "/sessions?limit=1")
	response := httptest.NewRecorder()

	NewSessionsHandler(repository).ServeHTTP(response, request)

	if response.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want %d: %s", response.Code, http.StatusInternalServerError, response.Body.String())
	}
	var result struct {
		Error struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
		t.Fatalf("decode error response: %v", err)
	}
	if result.Error.Code != "sessions_failed" || result.Error.Message != "sessions could not be loaded" {
		t.Fatalf("error response = %#v, want stable sessions_failed error", result.Error)
	}
}

func TestSessionsHandlerRequiresAuthenticationBeforeReading(t *testing.T) {
	repository := &sessionSummaryRepository{}
	request := httptest.NewRequest(http.MethodGet, "/sessions?limit=1", nil)
	response := httptest.NewRecorder()

	NewSessionsHandler(repository).ServeHTTP(response, request)

	if response.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d: %s", response.Code, http.StatusUnauthorized, response.Body.String())
	}
	if repository.calls != 0 {
		t.Fatalf("repository calls = %d, want 0", repository.calls)
	}
}

func TestSessionTraceHandlerReconstructsOwnerScopedTrace(t *testing.T) {
	base := time.Date(2026, 8, 22, 10, 0, 0, 0, time.UTC)
	repository := &traceEventRepository{events: []storage.HookEvent{
		testHookEvent("stop", "Stop", "turn-1", "", base.Add(4*time.Second), map[string]any{"response": "done"}),
		testHookEvent("post", "PostToolUse", "turn-1", "read-call", base.Add(3*time.Second), map[string]any{"tool_response": "file contents"}),
		testHookEvent("prompt", "UserPromptSubmit", "turn-1", "", base, map[string]any{"prompt": "inspect the file"}),
		testHookEvent("skill", "PreToolUse", "turn-1", "skill-call", base.Add(2*time.Second), map[string]any{
			"tool_input": map[string]any{"name": "frontend-design"},
		}),
		testHookEvent("read", "PreToolUse", "turn-1", "read-call", base.Add(time.Second), map[string]any{
			"tool_input": map[string]any{"file_path": "README.md"},
		}),
	}}

	request := authenticatedTraceRequest(http.MethodGet, "/sessions/session-1")
	response := httptest.NewRecorder()
	NewSessionTraceHandler(repository).ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d: %s", response.Code, http.StatusOK, response.Body.String())
	}
	if repository.userID != "user-1" || repository.sessionID != "session-1" {
		t.Fatalf("repository scope = (%q, %q), want (user-1, session-1)", repository.userID, repository.sessionID)
	}
	var result trace.Trace
	if err := json.NewDecoder(response.Body).Decode(&result); err != nil {
		t.Fatalf("decode trace: %v", err)
	}
	if result.SchemaVersion != trace.SchemaVersion || result.SessionID != "session-1" || result.UserID != "user-1" {
		t.Fatalf("trace identity = %#v", result)
	}
	if len(result.Conversation) != 2 || len(result.ToolCalls) != 2 || len(result.SkillInvocations) != 1 || len(result.Files) != 1 {
		t.Fatalf("trace collections = conversation:%d tools:%d skills:%d files:%d", len(result.Conversation), len(result.ToolCalls), len(result.SkillInvocations), len(result.Files))
	}
	if result.ToolCalls[0].Status != trace.ToolCallCompleted || result.Summary.MessageCount != 2 || result.Summary.ToolCallCount != 2 || result.Summary.SkillInvocationCount != 1 || result.Summary.FileOperationCount != 1 {
		t.Fatalf("trace summary = %#v, tools = %#v", result.Summary, result.ToolCalls)
	}
}

func TestSessionTraceHandlerReturnsCompleteFixtureResponse(t *testing.T) {
	events, err := testfixtures.Load(testfixtures.CompleteSession)
	if err != nil {
		t.Fatalf("load complete fixture: %v", err)
	}
	repository := &traceEventRepository{events: events}
	request := authenticatedTraceRequest(http.MethodGet, "/sessions/fixture-session-1")
	response := httptest.NewRecorder()

	NewSessionTraceHandler(repository).ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d: %s", response.Code, http.StatusOK, response.Body.String())
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(response.Body.Bytes(), &fields); err != nil {
		t.Fatalf("decode response fields: %v", err)
	}
	wantFields := map[string]bool{
		"schema_version": true, "session_id": true, "user_id": true, "timeline": true,
		"conversation": true, "tool_calls": true, "skill_invocations": true, "files": true, "summary": true, "runtime_metadata": true,
	}
	if len(fields) != len(wantFields) {
		t.Fatalf("response field count = %d, want %d: %#v", len(fields), len(wantFields), fields)
	}
	for field := range wantFields {
		if _, ok := fields[field]; !ok {
			t.Errorf("response missing field %q", field)
		}
	}
	var result trace.Trace
	if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
		t.Fatalf("decode trace: %v", err)
	}
	if result.SchemaVersion != trace.SchemaVersion || result.SessionID != "fixture-session-1" || result.UserID != "user-1" {
		t.Fatalf("trace identity = %#v", result)
	}
	if len(result.Timeline) != 14 || result.Timeline[0].ID != "session-start-01" || result.Timeline[13].ID != "stop-01" {
		t.Fatalf("timeline boundary = %#v", result.Timeline)
	}
	if len(result.Conversation) != 2 || len(result.ToolCalls) != 4 || len(result.SkillInvocations) != 1 || len(result.Files) != 2 {
		t.Fatalf("trace collections = conversation:%d tools:%d skills:%d files:%d", len(result.Conversation), len(result.ToolCalls), len(result.SkillInvocations), len(result.Files))
	}
	if result.Conversation[0].Role != "user" || result.Conversation[1].Role != "assistant" || result.ToolCalls[0].Status != trace.ToolCallCompleted || result.ToolCalls[2].Status != trace.ToolCallUnmatched {
		t.Fatalf("trace content = conversation:%#v tools:%#v", result.Conversation, result.ToolCalls)
	}
	wantSummary := trace.Summary{EventCount: 14, MessageCount: 2, ToolCallCount: 4, MCPCallCount: 0, MCPServers: []string{}, SkillInvocationCount: 1, FileOperationCount: 2, FileReadCount: 1}
	if !reflect.DeepEqual(result.Summary, wantSummary) {
		t.Fatalf("summary = %#v, want %#v", result.Summary, wantSummary)
	}
}

func TestSessionTraceHandlerRequiresAuthenticationBeforeReading(t *testing.T) {
	repository := &traceEventRepository{}
	request := httptest.NewRequest(http.MethodGet, "/sessions/session-1", nil)
	response := httptest.NewRecorder()

	NewSessionTraceHandler(repository).ServeHTTP(response, request)

	if response.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusUnauthorized)
	}
	if repository.calls != 0 {
		t.Fatalf("repository calls = %d, want 0", repository.calls)
	}
}

func TestSessionTraceHandlerMapsMissingUnavailableAndFailure(t *testing.T) {
	tests := []struct {
		name       string
		repository SessionEventReader
		wantStatus int
		wantCode   string
	}{
		{name: "missing", repository: &traceEventRepository{}, wantStatus: http.StatusNotFound, wantCode: "trace_not_found"},
		{name: "unavailable", repository: nil, wantStatus: http.StatusServiceUnavailable, wantCode: "trace_unavailable"},
		{name: "failure", repository: &traceEventRepository{err: errors.New("database unavailable")}, wantStatus: http.StatusInternalServerError, wantCode: "trace_failed"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			request := authenticatedTraceRequest(http.MethodGet, "/sessions/session-1")
			response := httptest.NewRecorder()
			NewSessionTraceHandler(test.repository).ServeHTTP(response, request)
			if response.Code != test.wantStatus {
				t.Fatalf("status = %d, want %d: %s", response.Code, test.wantStatus, response.Body.String())
			}
			if !strings.Contains(response.Body.String(), `"code":"`+test.wantCode+`"`) {
				t.Fatalf("body = %q, want code %q", response.Body.String(), test.wantCode)
			}
		})
	}
}

func TestSessionTraceHandlerRejectsNonGetAndInvalidPath(t *testing.T) {
	repository := &traceEventRepository{}
	for _, test := range []struct {
		method string
		path   string
	}{
		{method: http.MethodPost, path: "/sessions/session-1"},
		{method: http.MethodGet, path: "/sessions/"},
	} {
		request := authenticatedTraceRequest(test.method, test.path)
		response := httptest.NewRecorder()
		NewSessionTraceHandler(repository).ServeHTTP(response, request)
		wantStatus := http.StatusMethodNotAllowed
		if test.method == http.MethodGet {
			wantStatus = http.StatusNotFound
		}
		if response.Code != wantStatus {
			t.Errorf("%s %s status = %d, want %d", test.method, test.path, response.Code, wantStatus)
		}
	}
}

func authenticatedTraceRequest(method, path string) *http.Request {
	request := httptest.NewRequest(method, path, nil)
	user := auth.User{ID: "user-1", Tier: auth.TierDeveloper}
	return request.WithContext(auth.WithUser(request.Context(), user))
}

func testHookEvent(id, eventName, turnID, toolUseID string, receivedAt time.Time, payload map[string]any) storage.HookEvent {
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
		ToolName:      stringPointerOrNil(toolNameForEvent(eventName, toolUseID)),
		ToolUseID:     stringPointerOrNil(toolUseID),
		Payload:       bson.Raw(encoded),
		ReceivedAt:    receivedAt,
	}
}

func toolNameForEvent(eventName, toolUseID string) string {
	switch {
	case eventName == "PreToolUse" && toolUseID == "read-call":
		return "read_file"
	case eventName == "PreToolUse" && toolUseID == "skill-call":
		return "skill"
	case eventName == "PostToolUse":
		return "read_file"
	default:
		return ""
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
