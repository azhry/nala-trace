package storage

import (
	"context"
	"errors"
	"reflect"
	"testing"

	"go.mongodb.org/mongo-driver/bson"
)

func TestHookEventIndexModelsSupportSessionSummaryRead(t *testing.T) {
	models := hookEventIndexModels()
	want := []bson.D{
		{{Key: "session_id", Value: 1}, {Key: "received_at", Value: 1}},
		{{Key: "user_id", Value: 1}, {Key: "received_at", Value: 1}, {Key: "_id", Value: 1}},
	}
	if len(models) != len(want) {
		t.Fatalf("index model count = %d, want %d", len(models), len(want))
	}
	for index, model := range models {
		if !reflect.DeepEqual(model.Keys, want[index]) {
			t.Errorf("index %d keys = %#v, want %#v", index, model.Keys, want[index])
		}
	}
}

func TestHookEventFromDocumentHydratesLegacyPayloadFields(t *testing.T) {
	payload, err := bson.Marshal(bson.M{
		"hook_event_name": "PreToolUse",
		"tool_name":       "skill",
		"tool_use_id":     "skill-1",
	})
	if err != nil {
		t.Fatalf("marshal payload: %v", err)
	}

	event := hookEventFromDocument(hookEventDocument{Payload: payload})
	if event.HookEventName != "PreToolUse" || event.ToolName == nil || *event.ToolName != "skill" || event.ToolUseID == nil || *event.ToolUseID != "skill-1" {
		t.Fatalf("hydrated event = %#v", event)
	}
}

func TestHookEventFromDocumentHydratesNestedRawPayloadFields(t *testing.T) {
	payload, err := bson.Marshal(bson.M{
		"payload": bson.M{
			"hook_event_name": "PreToolUse",
			"tool_name":       "skill",
			"tool_use_id":     "skill-1",
		},
	})
	if err != nil {
		t.Fatalf("marshal payload: %v", err)
	}

	event := hookEventFromDocument(hookEventDocument{Payload: payload})
	if event.HookEventName != "PreToolUse" || event.ToolName == nil || *event.ToolName != "skill" || event.ToolUseID == nil || *event.ToolUseID != "skill-1" {
		t.Fatalf("hydrated nested event = %#v", event)
	}
}

func TestListSessionEventsForUserPassesOwnerAndSessionScope(t *testing.T) {
	calledUser, calledSession := "", ""
	repository := &HookEventRepository{
		findForUser: func(_ context.Context, userID, sessionID string) ([]HookEvent, error) {
			calledUser, calledSession = userID, sessionID
			return []HookEvent{{SessionID: sessionID, UserID: userID}}, nil
		},
	}

	rows, err := repository.ListSessionEventsForUser(context.Background(), "user-1", "session-1")
	if err != nil {
		t.Fatalf("ListSessionEventsForUser() error = %v", err)
	}
	if calledUser != "user-1" || calledSession != "session-1" {
		t.Fatalf("scope = (%q, %q), want (user-1, session-1)", calledUser, calledSession)
	}
	if len(rows) != 1 || rows[0].UserID != "user-1" || rows[0].SessionID != "session-1" {
		t.Fatalf("rows = %#v", rows)
	}
}

func TestListSessionEventsForUserMapsReadFailure(t *testing.T) {
	repository := &HookEventRepository{
		findForUser: func(context.Context, string, string) ([]HookEvent, error) {
			return nil, errors.New("mongo unavailable")
		},
	}

	_, err := repository.ListSessionEventsForUser(context.Background(), "user-1", "session-1")
	var repositoryErr *RepositoryError
	if !errors.As(err, &repositoryErr) || repositoryErr.Operation != "find_session_events" {
		t.Fatalf("error = %v, want find_session_events RepositoryError", err)
	}
}

func TestListSessionEventsForUserRejectsMissingScope(t *testing.T) {
	repository := &HookEventRepository{findForUser: func(context.Context, string, string) ([]HookEvent, error) {
		return nil, nil
	}}
	for _, test := range []struct {
		name    string
		userID  string
		session string
	}{
		{name: "user", session: "session-1"},
		{name: "session", userID: "user-1"},
	} {
		t.Run(test.name, func(t *testing.T) {
			if _, err := repository.ListSessionEventsForUser(context.Background(), test.userID, test.session); err == nil {
				t.Fatal("expected missing scope error")
			}
		})
	}
}
