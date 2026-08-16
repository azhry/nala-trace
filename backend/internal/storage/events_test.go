package storage

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/azhry/nala-trace/backend/internal/events"
	"go.mongodb.org/mongo-driver/bson"
)

func TestNewHookEventAndInsertSerializeNullableFields(t *testing.T) {
	event, err := events.Decode([]byte(`{"session_id":"session-1","hook_event_name":"Stop","payload":{"kept":true}}`))
	if err != nil {
		t.Fatalf("decode event: %v", err)
	}
	received := time.Date(2026, 8, 15, 1, 2, 3, 0, time.UTC)
	hookEvent, err := NewHookEvent("user-1", event, received)
	if err != nil {
		t.Fatalf("new hook event: %v", err)
	}
	var captured hookEventDocument
	repository := &HookEventRepository{insert: func(_ context.Context, document hookEventDocument) error {
		captured = document
		return nil
	}}
	if err := repository.InsertHookEvent(context.Background(), hookEvent); err != nil {
		t.Fatalf("insert hook event: %v", err)
	}
	encoded, err := bson.Marshal(captured)
	if err != nil {
		t.Fatalf("marshal document: %v", err)
	}
	var decoded bson.M
	if err := bson.Unmarshal(encoded, &decoded); err != nil {
		t.Fatalf("unmarshal document: %v", err)
	}
	for _, field := range []string{"user_id", "session_id", "hook_event_name", "turn_id", "tool_name", "tool_use_id", "payload", "received_at"} {
		if _, ok := decoded[field]; !ok {
			t.Fatalf("document missing %s: %v", field, decoded)
		}
	}
	if decoded["turn_id"] != nil || decoded["tool_name"] != nil || decoded["tool_use_id"] != nil {
		t.Fatalf("nullable fields were not explicit nulls: %v", decoded)
	}
	if decoded["user_id"] != "user-1" || decoded["session_id"] != "session-1" {
		t.Fatalf("identity fields were not preserved: %v", decoded)
	}
}

func TestHookEventRepositoryIsAppendOnlyAndCreatesIndex(t *testing.T) {
	indexCreated := false
	insertCount := 0
	repository := &HookEventRepository{
		createIndex: func(context.Context) error { indexCreated = true; return nil },
		insert:      func(context.Context, hookEventDocument) error { insertCount++; return nil },
	}
	if err := repository.EnsureIndexes(context.Background()); err != nil || !indexCreated {
		t.Fatalf("index creation failed: created=%v err=%v", indexCreated, err)
	}
	event := HookEvent{UserID: "user", SessionID: "session", HookEventName: "Stop", Payload: bson.Raw{5, 0, 0, 0, 0}, ReceivedAt: time.Now()}
	if err := repository.InsertHookEvent(context.Background(), event); err != nil {
		t.Fatalf("insert failed: %v", err)
	}
	if insertCount != 1 {
		t.Fatalf("insert count = %d, want 1", insertCount)
	}
}

func TestHookEventRepositoryRejectsInvalidEventWithoutCallingInsert(t *testing.T) {
	called := false
	repository := &HookEventRepository{insert: func(context.Context, hookEventDocument) error { called = true; return nil }}
	err := repository.InsertHookEvent(context.Background(), HookEvent{SessionID: "session"})
	if err == nil || called {
		t.Fatalf("invalid event was accepted or inserted: err=%v called=%v", err, called)
	}
}

func TestSessionSummaryRepositoryReturnsEmptyAndRedactsErrors(t *testing.T) {
	repository := &HookEventRepository{aggregate: func(context.Context) ([]SessionSummary, error) { return nil, nil }}
	rows, err := repository.ListSessionSummaries(context.Background())
	if err != nil || rows == nil || len(rows) != 0 {
		t.Fatalf("empty aggregation = %#v, err=%v", rows, err)
	}
	repository.aggregate = func(context.Context) ([]SessionSummary, error) {
		return nil, errors.New("mongodb://user:password@host")
	}
	_, err = repository.ListSessionSummaries(context.Background())
	if err == nil || !strings.Contains(err.Error(), "aggregate_session_summaries") || strings.Contains(err.Error(), "password") {
		t.Fatalf("unexpected aggregation error: %v", err)
	}
}

func TestSessionSummaryPipelineGroupsAndSortsBySession(t *testing.T) {
	pipeline := sessionSummaryPipeline()
	encoded, err := json.Marshal(pipeline)
	if err != nil {
		t.Fatalf("marshal pipeline: %v", err)
	}
	for _, expected := range []string{"$group", "$project", "$sort", "session_id", "received_at", "tool_call_count"} {
		if !strings.Contains(string(encoded), expected) {
			t.Fatalf("pipeline missing %q: %s", expected, encoded)
		}
	}
}

func TestUserSessionSummaryRepositoryScopesAndBoundsAggregation(t *testing.T) {
	var capturedUser string
	var capturedLimit int
	repository := &HookEventRepository{aggregateForUser: func(_ context.Context, userID string, limit int) ([]SessionSummary, error) {
		capturedUser = userID
		capturedLimit = limit
		return []SessionSummary{{SessionID: "session-1", UserID: userID}}, nil
	}}
	rows, err := repository.ListSessionSummariesForUser(context.Background(), "user-1", 10)
	if err != nil || len(rows) != 1 || capturedUser != "user-1" || capturedLimit != 10 {
		t.Fatalf("user summary lookup = %#v, err=%v, captured=%q/%d", rows, err, capturedUser, capturedLimit)
	}
	if _, err := repository.ListSessionSummariesForUser(context.Background(), "", 10); err == nil {
		t.Fatal("empty user ID was accepted")
	}
	if _, err := repository.ListSessionSummariesForUser(context.Background(), "user-1", 0); err == nil {
		t.Fatal("invalid limit was accepted")
	}

	pipeline, err := json.Marshal(sessionSummaryPipelineForUser("user-1", 10))
	if err != nil {
		t.Fatalf("marshal user pipeline: %v", err)
	}
	for _, expected := range []string{"$match", "user-1", "$limit", "10"} {
		if !strings.Contains(string(pipeline), expected) {
			t.Fatalf("user pipeline missing %q: %s", expected, pipeline)
		}
	}
}
