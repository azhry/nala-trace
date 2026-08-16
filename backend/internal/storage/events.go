package storage

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/azhry/nala-trace/backend/internal/events"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
)

const hookEventsCollectionName = "hook_events"

type HookEvent struct {
	ID            string
	UserID        string
	SessionID     string
	TurnID        *string
	HookEventName string
	ToolName      *string
	ToolUseID     *string
	Payload       bson.Raw
	ReceivedAt    time.Time
}

type hookEventDocument struct {
	ID            interface{} `bson:"_id,omitempty"`
	UserID        string      `bson:"user_id"`
	SessionID     string      `bson:"session_id"`
	TurnID        *string     `bson:"turn_id"`
	HookEventName string      `bson:"hook_event_name"`
	ToolName      *string     `bson:"tool_name"`
	ToolUseID     *string     `bson:"tool_use_id"`
	Payload       bson.Raw    `bson:"payload"`
	ReceivedAt    time.Time   `bson:"received_at"`
}

type RepositoryError struct {
	Operation string
}

func (e *RepositoryError) Error() string {
	return fmt.Sprintf("mongo repository operation failed: %s", e.Operation)
}

func NewHookEvent(userID string, event events.Event, receivedAt time.Time) (HookEvent, error) {
	payload, err := jsonToBSON(event.Raw)
	if err != nil {
		return HookEvent{}, &RepositoryError{Operation: "serialize_event"}
	}
	hookEvent := HookEvent{
		UserID:        userID,
		SessionID:     event.SessionID,
		TurnID:        event.TurnID,
		HookEventName: event.HookEventName,
		ToolName:      event.ToolName,
		ToolUseID:     event.ToolUseID,
		Payload:       payload,
		ReceivedAt:    receivedAt.UTC(),
	}
	if err := hookEvent.validate(); err != nil {
		return HookEvent{}, err
	}
	return hookEvent, nil
}

func (e HookEvent) validate() error {
	if strings.TrimSpace(e.UserID) == "" {
		return &RepositoryError{Operation: "missing_user_id"}
	}
	if strings.TrimSpace(e.SessionID) == "" {
		return &RepositoryError{Operation: "missing_session_id"}
	}
	if strings.TrimSpace(e.HookEventName) == "" {
		return &RepositoryError{Operation: "missing_hook_event_name"}
	}
	if len(e.Payload) == 0 {
		return &RepositoryError{Operation: "missing_payload"}
	}
	if e.ReceivedAt.IsZero() {
		return &RepositoryError{Operation: "missing_received_at"}
	}
	return nil
}

type HookEventRepository struct {
	insert           func(context.Context, hookEventDocument) error
	createIndex      func(context.Context) error
	aggregate        func(context.Context) ([]SessionSummary, error)
	aggregateForUser func(context.Context, string, int) ([]SessionSummary, error)
}

func NewHookEventRepository(database *mongo.Database) (*HookEventRepository, error) {
	if database == nil {
		return nil, &RepositoryError{Operation: "missing_database"}
	}
	collection := database.Collection(hookEventsCollectionName)
	return &HookEventRepository{
		insert: func(ctx context.Context, document hookEventDocument) error {
			_, err := collection.InsertOne(ctx, document)
			return err
		},
		createIndex: func(ctx context.Context) error {
			_, err := collection.Indexes().CreateOne(ctx, mongo.IndexModel{
				Keys: bson.D{{Key: "session_id", Value: 1}, {Key: "received_at", Value: 1}},
			})
			return err
		},
		aggregate: func(ctx context.Context) ([]SessionSummary, error) {
			pipeline := sessionSummaryPipeline()
			cursor, err := collection.Aggregate(ctx, pipeline)
			if err != nil {
				return nil, err
			}
			defer cursor.Close(ctx)
			var rows []SessionSummary
			if err := cursor.All(ctx, &rows); err != nil {
				return nil, err
			}
			return rows, nil
		},
		aggregateForUser: func(ctx context.Context, userID string, limit int) ([]SessionSummary, error) {
			cursor, err := collection.Aggregate(ctx, sessionSummaryPipelineForUser(userID, limit))
			if err != nil {
				return nil, err
			}
			defer cursor.Close(ctx)
			var rows []SessionSummary
			if err := cursor.All(ctx, &rows); err != nil {
				return nil, err
			}
			return rows, nil
		},
	}, nil
}

func (r *HookEventRepository) EnsureIndexes(ctx context.Context) error {
	if r == nil || r.createIndex == nil {
		return &RepositoryError{Operation: "missing_index_repository"}
	}
	if err := r.createIndex(ctx); err != nil {
		return &RepositoryError{Operation: "create_hook_events_index"}
	}
	return nil
}

// InsertHookEvent is intentionally insert-only. There is no update/delete
// method on this repository, which keeps ingestion append-only by construction.
func (r *HookEventRepository) InsertHookEvent(ctx context.Context, event HookEvent) error {
	if r == nil || r.insert == nil {
		return &RepositoryError{Operation: "missing_insert_repository"}
	}
	if err := event.validate(); err != nil {
		return err
	}
	document := hookEventDocument{
		UserID:        event.UserID,
		SessionID:     event.SessionID,
		TurnID:        event.TurnID,
		HookEventName: event.HookEventName,
		ToolName:      event.ToolName,
		ToolUseID:     event.ToolUseID,
		Payload:       event.Payload,
		ReceivedAt:    event.ReceivedAt.UTC(),
	}
	if err := r.insert(ctx, document); err != nil {
		return &RepositoryError{Operation: "insert_hook_event"}
	}
	return nil
}

func (r *HookEventRepository) ListSessionSummaries(ctx context.Context) ([]SessionSummary, error) {
	if r == nil || r.aggregate == nil {
		return nil, &RepositoryError{Operation: "missing_aggregate_repository"}
	}
	rows, err := r.aggregate(ctx)
	if err != nil {
		return nil, &RepositoryError{Operation: "aggregate_session_summaries"}
	}
	if rows == nil {
		rows = make([]SessionSummary, 0)
	}
	return rows, nil
}

func (r *HookEventRepository) ListSessionSummariesForUser(ctx context.Context, userID string, limit int) ([]SessionSummary, error) {
	if r == nil || r.aggregateForUser == nil {
		return nil, &RepositoryError{Operation: "missing_user_aggregate_repository"}
	}
	if strings.TrimSpace(userID) == "" {
		return nil, &RepositoryError{Operation: "missing_user_id"}
	}
	if limit <= 0 {
		return nil, &RepositoryError{Operation: "invalid_session_limit"}
	}
	rows, err := r.aggregateForUser(ctx, userID, limit)
	if err != nil {
		return nil, &RepositoryError{Operation: "aggregate_user_session_summaries"}
	}
	if rows == nil {
		rows = make([]SessionSummary, 0)
	}
	return rows, nil
}

func jsonToBSON(raw json.RawMessage) (bson.Raw, error) {
	var document bson.M
	if err := bson.UnmarshalExtJSON(raw, true, &document); err != nil {
		return nil, err
	}
	encoded, err := bson.Marshal(document)
	if err != nil {
		return nil, err
	}
	return bson.Raw(encoded), nil
}
