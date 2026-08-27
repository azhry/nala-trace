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
}

func (repository *sessionSummaryRepository) ListSessionSummariesForUser(_ context.Context, userID string, limit int) ([]storage.SessionSummary, error) {
	repository.userID = userID
	repository.limit = limit
	return repository.rows, repository.err
}

func TestSessionsHandlerReturnsTokenUsage(t *testing.T) {
	repository := &sessionSummaryRepository{rows: []storage.SessionSummary{{
		SessionID:  "session-1",
		TokenUsage: trace.TokenUsage{InputTokens: 10, OutputTokens: 4, TotalTokens: 14, CostUSD: 0.02},
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
	if usage.InputTokens != 10 || usage.OutputTokens != 4 || usage.TotalTokens != 14 || usage.CostUSD != 0.02 {
		t.Fatalf("session token usage = %#v", usage)
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
