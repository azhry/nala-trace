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

type fakeHookEventInserter struct {
	events []storage.HookEvent
	err    error
}

func (f *fakeHookEventInserter) InsertHookEvent(_ context.Context, event storage.HookEvent) error {
	if f.err != nil {
		return f.err
	}
	f.events = append(f.events, event)
	return nil
}

func TestIngestHandlerPersistsAuthenticatedEventWithServerTimestamp(t *testing.T) {
	repository := &fakeHookEventInserter{}
	request := httptest.NewRequest(http.MethodPost, "/ingest", strings.NewReader(`{"session_id":"session-1","hook_event_name":"Stop","secret":"must-remain-raw"}`))
	request = request.WithContext(auth.WithUser(request.Context(), auth.User{ID: "user-1", Tier: auth.TierDeveloper}))
	recorder := httptest.NewRecorder()

	NewIngestHandler(repository).ServeHTTP(recorder, request)

	if recorder.Code != http.StatusAccepted || recorder.Body.String() != "{\"accepted\":true}\n" {
		t.Fatalf("unexpected success response: %d %q", recorder.Code, recorder.Body.String())
	}
	if len(repository.events) != 1 {
		t.Fatalf("inserted events = %d, want 1", len(repository.events))
	}
	event := repository.events[0]
	if event.UserID != "user-1" || event.SessionID != "session-1" || event.ReceivedAt.IsZero() || event.ReceivedAt.After(time.Now().UTC()) {
		t.Fatalf("event metadata was not set safely: %+v", event)
	}
}

func TestIngestHandlerRejectsInvalidRequestsBeforeInsert(t *testing.T) {
	for name, body := range map[string]string{
		"malformed":         `{`,
		"missing session":   `{"hook_event_name":"Stop"}`,
		"unsupported event": `{"session_id":"session-1","hook_event_name":"Unknown"}`,
	} {
		t.Run(name, func(t *testing.T) {
			repository := &fakeHookEventInserter{}
			request := httptest.NewRequest(http.MethodPost, "/ingest", strings.NewReader(body))
			request = request.WithContext(auth.WithUser(request.Context(), auth.User{ID: "user-1", Tier: auth.TierDeveloper}))
			recorder := httptest.NewRecorder()

			NewIngestHandler(repository).ServeHTTP(recorder, request)

			if recorder.Code != http.StatusBadRequest || !strings.Contains(recorder.Body.String(), `"code":"invalid_event"`) {
				t.Fatalf("unexpected invalid response: %d %q", recorder.Code, recorder.Body.String())
			}
			if len(repository.events) != 0 {
				t.Fatalf("invalid request inserted %d events", len(repository.events))
			}
		})
	}

	repository := &fakeHookEventInserter{}
	request := httptest.NewRequest(http.MethodPost, "/ingest", strings.NewReader(`{"session_id":"session-1","hook_event_name":"Stop"}`))
	recorder := httptest.NewRecorder()
	NewIngestHandler(repository).ServeHTTP(recorder, request)
	if recorder.Code != http.StatusUnauthorized || len(repository.events) != 0 {
		t.Fatalf("unauthenticated request was not rejected: %d events=%d", recorder.Code, len(repository.events))
	}
}

func TestIngestHandlerRedactsRepositoryFailures(t *testing.T) {
	repository := &fakeHookEventInserter{err: errors.New("mongodb://user:secret@host")}
	request := httptest.NewRequest(http.MethodPost, "/ingest", strings.NewReader(`{"session_id":"session-1","hook_event_name":"Stop"}`))
	request = request.WithContext(auth.WithUser(request.Context(), auth.User{ID: "user-1", Tier: auth.TierDeveloper}))
	recorder := httptest.NewRecorder()

	NewIngestHandler(repository).ServeHTTP(recorder, request)

	if recorder.Code != http.StatusInternalServerError || strings.Contains(recorder.Body.String(), "secret") || !strings.Contains(recorder.Body.String(), `"code":"ingest_failed"`) {
		t.Fatalf("repository error was not redacted: %d %q", recorder.Code, recorder.Body.String())
	}
}
