package server

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/azhry/nala-trace/backend/internal/auth"
	"github.com/azhry/nala-trace/backend/internal/storage"
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
