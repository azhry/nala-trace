package server

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/azhry/nala-trace/backend/internal/auth"
	"github.com/azhry/nala-trace/backend/internal/storage"
)

type fakeSessionSummaryReader struct {
	rows   []storage.SessionSummary
	userID string
	limit  int
	err    error
}

func (f *fakeSessionSummaryReader) ListSessionSummariesForUser(_ context.Context, userID string, limit int) ([]storage.SessionSummary, error) {
	f.userID = userID
	f.limit = limit
	if f.err != nil {
		return nil, f.err
	}
	return f.rows, nil
}

func authenticatedSessionsRequest(path string) *http.Request {
	request := httptest.NewRequest(http.MethodGet, path, nil)
	return request.WithContext(auth.WithUser(request.Context(), auth.User{ID: "user-1", Tier: auth.TierDeveloper}))
}

func TestSessionsHandlerReturnsStableEmptySingleAndMultipleEnvelopes(t *testing.T) {
	base := storage.SessionSummary{
		SessionID: "session-1", UserID: "user-1",
		FirstEventAt: time.Date(2026, 8, 17, 1, 0, 0, 0, time.UTC),
		LastEventAt:  time.Date(2026, 8, 17, 1, 1, 0, 0, time.UTC), EventCount: 3,
		ToolCallCount: 1, SkillInvocationCount: 2, FileOperationCount: 1,
	}
	for name, rows := range map[string][]storage.SessionSummary{
		"empty":    {},
		"single":   {base},
		"multiple": {base, {SessionID: "session-2", UserID: "user-1"}},
	} {
		t.Run(name, func(t *testing.T) {
			repository := &fakeSessionSummaryReader{rows: rows}
			recorder := httptest.NewRecorder()
			NewSessionsHandler(repository).ServeHTTP(recorder, authenticatedSessionsRequest("/sessions"))
			if recorder.Code != http.StatusOK || !strings.Contains(recorder.Body.String(), `"sessions"`) || strings.Contains(recorder.Body.String(), `"sessions":null`) {
				t.Fatalf("unexpected sessions response: %d %q", recorder.Code, recorder.Body.String())
			}
			if repository.userID != "user-1" || repository.limit != defaultSessionLimit {
				t.Fatalf("repository scope = %q/%d", repository.userID, repository.limit)
			}
		})
	}
}

func TestSessionsHandlerValidatesQueryAndAuthentication(t *testing.T) {
	for _, path := range []string{"/sessions?limit=0", "/sessions?limit=101", "/sessions?limit=nope", "/sessions?limit=1&limit=2", "/sessions?offset=1"} {
		repository := &fakeSessionSummaryReader{}
		recorder := httptest.NewRecorder()
		NewSessionsHandler(repository).ServeHTTP(recorder, authenticatedSessionsRequest(path))
		if recorder.Code != http.StatusBadRequest || !strings.Contains(recorder.Body.String(), `"code":"invalid_query"`) {
			t.Fatalf("invalid query %s returned %d %q", path, recorder.Code, recorder.Body.String())
		}
	}

	unauthenticated := httptest.NewRequest(http.MethodGet, "/sessions", nil)
	recorder := httptest.NewRecorder()
	NewSessionsHandler(&fakeSessionSummaryReader{}).ServeHTTP(recorder, unauthenticated)
	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated sessions status = %d", recorder.Code)
	}
}

func TestSessionsHandlerRedactsRepositoryFailures(t *testing.T) {
	repository := &fakeSessionSummaryReader{err: errors.New("mongodb://user:secret@host")}
	recorder := httptest.NewRecorder()
	NewSessionsHandler(repository).ServeHTTP(recorder, authenticatedSessionsRequest("/sessions?limit=2"))
	if recorder.Code != http.StatusInternalServerError || strings.Contains(recorder.Body.String(), "secret") || !strings.Contains(recorder.Body.String(), `"code":"sessions_failed"`) {
		t.Fatalf("repository failure was not redacted: %d %q", recorder.Code, recorder.Body.String())
	}
}
