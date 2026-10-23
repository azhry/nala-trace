package storage

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/azhry/nala-trace/backend/internal/events"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/bsontype"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

const hookEventsCollectionName = "hook_events"

const (
	hookEventPreToolSummaryIndexName = "hook_events_user_session_pretool_summary"
	hookEventPayloadNameIndexName    = "hook_events_user_session_payload_event_summary"
)

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
	insert               func(context.Context, hookEventDocument) error
	createIndex          func(context.Context) error
	aggregate            func(context.Context) ([]SessionSummary, error)
	aggregateForUser     func(context.Context, string, int) ([]SessionSummary, error)
	listRecentSessionIDs func(context.Context, string, int) ([]string, error)
	aggregateForSessions func(context.Context, string, []string, int) ([]SessionSummary, error)
	findForUser          func(context.Context, string, string) ([]HookEvent, error)
	walkSummaryEvents    func(context.Context, string, []string, func(HookEvent) error) error
	walkSummaryFeatures  func(context.Context, string, []string, func(HookEvent) error) error
}

func hookEventIndexModels() []mongo.IndexModel {
	return []mongo.IndexModel{
		{
			Keys: bson.D{{Key: "session_id", Value: 1}, {Key: "received_at", Value: 1}},
		},
		{
			Keys: bson.D{{Key: "user_id", Value: 1}, {Key: "received_at", Value: 1}, {Key: "_id", Value: 1}},
		},
		{
			Keys: bson.D{{Key: "user_id", Value: 1}, {Key: "session_id", Value: 1}, {Key: "received_at", Value: 1}, {Key: "_id", Value: 1}},
		},
		{
			Keys: bson.D{{Key: "user_id", Value: 1}, {Key: "received_at", Value: 1}, {Key: "_id", Value: 1}, {Key: "session_id", Value: 1}},
		},
		{
			Keys: bson.D{{Key: "user_id", Value: 1}, {Key: "session_id", Value: 1}, {Key: "received_at", Value: 1}, {Key: "_id", Value: 1}, {Key: "hook_event_name", Value: 1}},
		},
		{
			Keys:    bson.D{{Key: "user_id", Value: 1}, {Key: "session_id", Value: 1}, {Key: "hook_event_name", Value: 1}, {Key: "received_at", Value: 1}, {Key: "_id", Value: 1}},
			Options: options.Index().SetName(hookEventPreToolSummaryIndexName),
		},
		{
			Keys:    bson.D{{Key: "user_id", Value: 1}, {Key: "session_id", Value: 1}, {Key: "payload.hook_event_name", Value: 1}, {Key: "received_at", Value: 1}, {Key: "_id", Value: 1}},
			Options: options.Index().SetName(hookEventPayloadNameIndexName),
		},
	}
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
			_, err := collection.Indexes().CreateMany(ctx, hookEventIndexModels())
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
			return aggregateUserSessionSummaries(ctx, collection, userID, nil, limit)
		},
		listRecentSessionIDs: func(ctx context.Context, userID string, limit int) ([]string, error) {
			return recentSessionIDsForUser(ctx, collection, userID, limit)
		},
		aggregateForSessions: func(ctx context.Context, userID string, sessionIDs []string, limit int) ([]SessionSummary, error) {
			if len(sessionIDs) == 0 {
				return make([]SessionSummary, 0), nil
			}
			return aggregateUserSessionSummaries(ctx, collection, userID, sessionIDs, limit)
		},
		walkSummaryEvents: func(ctx context.Context, userID string, sessionIDs []string, yield func(HookEvent) error) error {
			queries := []struct {
				name      string
				filter    bson.D
				options   *options.FindOptions
				aggregate bool
			}{
				{name: "pretool", filter: summaryPreToolEventFindFilter(userID, sessionIDs), options: summaryPreToolEventFindOptions()},
				{name: "conversation", filter: summaryConversationEventFindFilter(userID, sessionIDs), options: summaryConversationEventFindOptions(), aggregate: true},
				{name: "payload_pretool", filter: summaryPayloadPreToolEventFindFilter(userID, sessionIDs), options: summaryPayloadNameEventFindOptions()},
				{name: "payload_conversation", filter: summaryPayloadConversationEventFindFilter(userID, sessionIDs), options: summaryPayloadConversationEventFindOptions(), aggregate: true},
			}
			queryEvents := make([][]HookEvent, len(queries))
			queryErrors := make([]error, len(queries))
			var queryWait sync.WaitGroup
			queryWait.Add(len(queries))
			for index := range queries {
				go func(index int) {
					defer queryWait.Done()
					queryEvents[index], queryErrors[index] = findSummaryEvents(ctx, collection, queries[index].name, queries[index].filter, queries[index].options, queries[index].aggregate)
				}(index)
			}
			queryWait.Wait()
			for _, queryErr := range queryErrors {
				if queryErr != nil {
					return queryErr
				}
			}
			eventsByID := make(map[string]HookEvent)
			for _, batch := range queryEvents {
				for _, event := range batch {
					if event.ID == "" {
						continue
					}
					if _, exists := eventsByID[event.ID]; !exists {
						eventsByID[event.ID] = event
					}
				}
			}
			events := make([]HookEvent, 0, len(eventsByID))
			for _, event := range eventsByID {
				events = append(events, event)
			}
			sort.Slice(events, func(left, right int) bool {
				if events[left].SessionID != events[right].SessionID {
					return events[left].SessionID < events[right].SessionID
				}
				if !events[left].ReceivedAt.Equal(events[right].ReceivedAt) {
					return events[left].ReceivedAt.Before(events[right].ReceivedAt)
				}
				return events[left].ID < events[right].ID
			})
			for _, event := range events {
				if err := yield(event); err != nil {
					return err
				}
			}
			return nil
		},
		walkSummaryFeatures: func(ctx context.Context, userID string, sessionIDs []string, yield func(HookEvent) error) error {
			return walkPreToolSummaryEventsForUser(ctx, collection, userID, sessionIDs, yield)
		},
		findForUser: func(ctx context.Context, userID, sessionID string) ([]HookEvent, error) {
			cursor, err := collection.Find(ctx, bson.D{
				{Key: "user_id", Value: userID},
				{Key: "session_id", Value: sessionID},
			}, options.Find().SetSort(bson.D{
				{Key: "received_at", Value: 1},
				{Key: "_id", Value: 1},
			}))
			if err != nil {
				return nil, err
			}
			defer cursor.Close(ctx)
			rows := make([]HookEvent, 0)
			for cursor.Next(ctx) {
				var document hookEventDocument
				if err := cursor.Decode(&document); err != nil {
					return nil, err
				}
				rows = append(rows, hookEventFromDocument(document))
			}
			if err := cursor.Err(); err != nil {
				return nil, err
			}
			return rows, nil
		},
	}, nil
}

func aggregateUserSessionSummaries(ctx context.Context, collection *mongo.Collection, userID string, sessionIDs []string, limit int) ([]SessionSummary, error) {
	var baseRows []SessionSummary
	var metadataRows []SessionSummary
	if len(sessionIDs) > 0 {
		var baseErr error
		var metadataErr error
		var wait sync.WaitGroup
		wait.Add(2)
		go func() {
			defer wait.Done()
			baseRows, baseErr = aggregateSessionSummaryRows(ctx, collection, sessionSummaryBasePipelineForUserSessions(userID, sessionIDs, limit), sessionSummaryIndexHint())
		}()
		go func() {
			defer wait.Done()
			metadataRows, metadataErr = aggregateSessionSummaryRows(ctx, collection, sessionSummaryMetadataPipelineForUserSessionsFast(userID, sessionIDs), hookEventPreToolSummaryIndexName)
		}()
		wait.Wait()
		if baseErr != nil {
			return nil, baseErr
		}
		if metadataErr != nil {
			return nil, metadataErr
		}
	} else {
		var err error
		baseRows, err = aggregateSessionSummaryRows(ctx, collection, sessionSummaryBasePipelineForUserSessions(userID, nil, limit), sessionSummaryIndexHint())
		if err != nil {
			return nil, err
		}
		if len(baseRows) == 0 {
			return make([]SessionSummary, 0), nil
		}
		selectedIDs := make([]string, 0, len(baseRows))
		for _, row := range baseRows {
			selectedIDs = append(selectedIDs, row.SessionID)
		}
		metadataRows, err = aggregateSessionSummaryRows(ctx, collection, sessionSummaryMetadataPipelineForUserSessionsFast(userID, selectedIDs), hookEventPreToolSummaryIndexName)
		if err != nil {
			return nil, err
		}
	}
	if len(baseRows) == 0 {
		return make([]SessionSummary, 0), nil
	}
	metadataBySession := make(map[string]SessionSummary, len(metadataRows))
	for _, row := range metadataRows {
		metadataBySession[row.SessionID] = row
	}
	for index := range baseRows {
		if metadata, ok := metadataBySession[baseRows[index].SessionID]; ok {
			baseRows[index].Title = metadata.Title
			baseRows[index].TokenUsage = metadata.TokenUsage
		}
		if baseRows[index].MCPServers == nil {
			baseRows[index].MCPServers = make([]string, 0)
		}
	}
	return baseRows, nil
}

func walkPreToolSummaryEventsForUser(ctx context.Context, collection *mongo.Collection, userID string, sessionIDs []string, yield func(HookEvent) error) error {
	cursor, err := collection.Find(ctx, summaryPreToolFeatureFindFilter(userID, sessionIDs), summaryPreToolFeatureFindOptions())
	if err != nil {
		return err
	}
	defer cursor.Close(ctx)
	for cursor.Next(ctx) {
		var document hookEventDocument
		if err := cursor.Decode(&document); err != nil {
			return err
		}
		if err := yield(hookEventFromDocument(document)); err != nil {
			return err
		}
	}
	return cursor.Err()
}

func recentSessionIDsForUser(ctx context.Context, collection *mongo.Collection, userID string, limit int) ([]string, error) {
	cursor, err := collection.Aggregate(ctx, recentSessionIDPipeline(userID, limit), options.Aggregate().SetHint(sessionSummaryIndexHint()).SetAllowDiskUse(true))
	if err != nil {
		return nil, err
	}
	defer cursor.Close(ctx)

	var rows []struct {
		SessionID string `bson:"session_id"`
	}
	if err := cursor.All(ctx, &rows); err != nil {
		return nil, err
	}
	sessionIDs := make([]string, 0, len(rows))
	for _, row := range rows {
		if sessionID := strings.TrimSpace(row.SessionID); sessionID != "" {
			sessionIDs = append(sessionIDs, sessionID)
		}
	}
	return sessionIDs, nil
}

func aggregateSessionSummaryRows(ctx context.Context, collection *mongo.Collection, pipeline []bson.D, hint any) ([]SessionSummary, error) {
	cursor, err := collection.Aggregate(ctx, pipeline, options.Aggregate().SetHint(hint).SetAllowDiskUse(true))
	if err != nil {
		return nil, err
	}
	defer cursor.Close(ctx)
	var rows []SessionSummary
	if err := cursor.All(ctx, &rows); err != nil {
		return nil, err
	}
	return rows, nil
}

func recentSessionIDPipeline(userID string, limit int) []bson.D {
	pipeline := []bson.D{
		{{Key: "$match", Value: bson.D{{Key: "user_id", Value: userID}}}},
		{{Key: "$sort", Value: bson.D{{Key: "session_id", Value: 1}, {Key: "received_at", Value: 1}, {Key: "_id", Value: 1}}}},
		{{Key: "$group", Value: bson.D{
			{Key: "_id", Value: "$session_id"},
			{Key: "last_event_at", Value: bson.D{{Key: "$last", Value: "$received_at"}}},
		}}},
		{{Key: "$sort", Value: bson.D{{Key: "last_event_at", Value: -1}, {Key: "_id", Value: 1}}}},
	}
	if limit > 0 {
		pipeline = append(pipeline, bson.D{{Key: "$limit", Value: limit}})
	}
	pipeline = append(pipeline, bson.D{{Key: "$project", Value: bson.D{
		{Key: "_id", Value: 0},
		{Key: "session_id", Value: "$_id"},
	}}})
	return pipeline
}

func sessionSummaryIndexHint() bson.D {
	return bson.D{{Key: "user_id", Value: 1}, {Key: "session_id", Value: 1}, {Key: "received_at", Value: 1}, {Key: "_id", Value: 1}, {Key: "hook_event_name", Value: 1}}
}

func summaryEventFindFilter(userID string, sessionIDs []string) bson.D {
	filter := summaryEventScopeFilter(userID, sessionIDs)
	return append(filter, bson.E{Key: "$expr", Value: summaryFeatureSignalExpression()})
}

func summaryEventFindOptions() *options.FindOptions {
	return options.Find().
		SetProjection(summaryEventFindProjection()).
		SetSort(bson.D{{Key: "session_id", Value: 1}, {Key: "received_at", Value: 1}, {Key: "_id", Value: 1}}).
		SetHint(sessionSummaryIndexHint())
}

const summaryPromptTitlePreviewLength = 128
const summaryToolInputPreviewLength = 1024
const summaryEventsBatchSize = 1500
const summaryFeatureEventsBatchSize = 5000

func summaryEventFindProjection() bson.D {
	return summaryEventProjection(false)
}

func summaryConversationEventFindProjection() bson.D {
	return summaryIndexedEventProjection(false)
}

func summaryEventProjection(truncatePrompt bool) bson.D {
	return summaryEventProjectionWithOptions(truncatePrompt, true, false, 0)
}

func summaryPreToolEventFindProjection() bson.D {
	return summaryIndexedEventProjection(true)
}

func summaryIndexedEventProjection(includeToolInput bool) bson.D {
	projection := bson.D{
		{Key: "_id", Value: 1},
		{Key: "user_id", Value: 1},
		{Key: "session_id", Value: 1},
		{Key: "hook_event_name", Value: 1},
		{Key: "tool_name", Value: 1},
		{Key: "tool_use_id", Value: 1},
		{Key: "received_at", Value: 1},
	}
	appendPayloadField := func(field string, value any) {
		projection = append(projection, bson.E{Key: "payload." + field, Value: value})
	}
	for _, field := range []string{"hook_event_name", "tool_name", "tool_use_id", "title", "session_title", "thread_title", "prompt", "usage_source"} {
		value := summaryFirstAvailableExpression(summaryPayloadPathCandidates(field))
		if field == "title" || field == "session_title" || field == "thread_title" || field == "prompt" {
			value = summaryStringPreviewExpression(value, summaryPromptTitlePreviewLength)
		}
		appendPayloadField(field, value)
	}
	if includeToolInput {
		for _, field := range []string{"file_path", "path", "target_file", "filename", "file", "old_path", "new_path", "operation", "action", "command", "cmd", "script", "patch", "patch_text", "diff", "name", "skill", "skill_name", "skills"} {
			value := summaryFirstAvailableExpression(summaryPayloadPathCandidates("tool_input." + field))
			if field == "command" || field == "cmd" || field == "script" || field == "patch" || field == "patch_text" || field == "diff" {
				value = summaryStringPreviewExpression(value, summaryToolInputPreviewLength)
			}
			appendPayloadField("tool_input."+field, value)
		}
	}
	for _, field := range []string{"input_tokens", "prompt_tokens", "cached_input_tokens", "cached_tokens", "output_tokens", "completion_tokens", "reasoning_tokens", "reasoning_output_tokens", "total_tokens"} {
		appendPayloadField(field, summaryFirstAvailableExpression(summaryTokenUsagePathCandidates(field)))
	}
	for _, field := range []string{"input_tokens_details", "prompt_tokens_details"} {
		appendPayloadField(field+".cached_tokens", summaryFirstAvailableExpression(summaryTokenUsagePathCandidates(field+".cached_tokens")))
	}
	for _, field := range []string{"output_tokens_details", "completion_tokens_details"} {
		appendPayloadField(field+".reasoning_tokens", summaryFirstAvailableExpression(summaryTokenUsagePathCandidates(field+".reasoning_tokens")))
	}
	return projection
}

func summaryPayloadPathCandidates(suffix string) []string {
	paths := make([]string, 0, 5)
	for _, root := range []string{"payload", "payload.payload", "payload.raw", "payload.data", "payload.event"} {
		paths = append(paths, root+"."+suffix)
	}
	return paths
}

func summaryTokenUsagePathCandidates(suffix string) []string {
	paths := make([]string, 0, 50)
	for _, root := range []string{"payload", "payload.payload", "payload.raw", "payload.data", "payload.event"} {
		paths = append(paths, root+"."+suffix, root+".usage."+suffix)
		for _, container := range []string{"response", "tool_response", "output", "result"} {
			paths = append(paths, root+"."+container+"."+suffix, root+"."+container+".usage."+suffix)
		}
	}
	return paths
}

func summaryFirstAvailableExpression(paths []string) bson.D {
	values := make(bson.A, 0, len(paths)+1)
	for _, path := range paths {
		values = append(values, "$"+path)
	}
	values = append(values, nil)
	return bson.D{{Key: "$ifNull", Value: values}}
}

func summaryEventProjectionWithOptions(truncatePrompt, includeToolInput, projectUsageFields bool, toolInputPreviewLength int) bson.D {
	projection := bson.D{
		{Key: "_id", Value: 1},
		{Key: "user_id", Value: 1},
		{Key: "session_id", Value: 1},
		{Key: "hook_event_name", Value: 1},
		{Key: "tool_name", Value: 1},
		{Key: "tool_use_id", Value: 1},
		{Key: "received_at", Value: 1},
	}
	addPath := func(path string) {
		projection = append(projection, bson.E{Key: path, Value: 1})
	}
	directFields := []string{"hook_event_name", "tool_name", "tool_use_id", "title", "session_title", "thread_title", "prompt", "usage_source"}
	tokenFields := []string{"input_tokens", "prompt_tokens", "cached_input_tokens", "cached_tokens", "output_tokens", "completion_tokens", "reasoning_tokens", "reasoning_output_tokens", "total_tokens"}
	for _, root := range []string{"payload", "payload.payload", "payload.raw", "payload.data", "payload.event"} {
		for _, field := range directFields {
			path := root + "." + field
			if truncatePrompt && (field == "prompt" || field == "title" || field == "session_title" || field == "thread_title") {
				projection = append(projection, bson.E{Key: path, Value: summaryStringPreviewExpression("$"+path, summaryPromptTitlePreviewLength)})
				continue
			}
			addPath(path)
		}
		if includeToolInput {
			for _, field := range []string{"file_path", "path", "target_file", "filename", "file", "old_path", "new_path", "operation", "action", "command", "cmd", "script", "patch", "patch_text", "diff", "name", "skill", "skill_name", "skills"} {
				path := root + ".tool_input." + field
				if toolInputPreviewLength > 0 && (field == "command" || field == "cmd" || field == "script" || field == "patch" || field == "patch_text" || field == "diff") {
					projection = append(projection, bson.E{Key: path, Value: summaryStringPreviewExpression("$"+path, toolInputPreviewLength)})
					continue
				}
				addPath(path)
			}
		}
		for _, container := range []string{"usage", "response.usage", "tool_response.usage", "output.usage", "result.usage"} {
			path := root + "." + container
			if projectUsageFields {
				projection = append(projection, bson.E{Key: path, Value: summaryTokenUsageProjection("$" + path)})
			} else {
				addPath(path)
			}
		}
		for _, container := range []string{"response", "tool_response", "output", "result"} {
			for _, field := range tokenFields {
				addPath(root + "." + container + "." + field)
			}
			for _, field := range []string{"input_tokens_details", "prompt_tokens_details"} {
				addPath(root + "." + container + "." + field + ".cached_tokens")
			}
			for _, field := range []string{"output_tokens_details", "completion_tokens_details"} {
				addPath(root + "." + container + "." + field + ".reasoning_tokens")
			}
		}
		for _, field := range tokenFields {
			addPath(root + "." + field)
		}
		for _, field := range []string{"input_tokens_details", "prompt_tokens_details"} {
			addPath(root + "." + field + ".cached_tokens")
		}
		for _, field := range []string{"output_tokens_details", "completion_tokens_details"} {
			addPath(root + "." + field + ".reasoning_tokens")
		}
	}
	return projection
}

func summaryTokenUsageProjection(path string) bson.D {
	projection := bson.D{}
	for _, field := range []string{"input_tokens", "prompt_tokens", "cached_input_tokens", "cached_tokens", "output_tokens", "completion_tokens", "reasoning_tokens", "reasoning_output_tokens", "total_tokens"} {
		projection = append(projection, bson.E{Key: field, Value: path + "." + field})
	}
	for _, field := range []string{"input_tokens_details", "prompt_tokens_details"} {
		projection = append(projection, bson.E{Key: field, Value: bson.D{{Key: "cached_tokens", Value: path + "." + field + ".cached_tokens"}}})
	}
	for _, field := range []string{"output_tokens_details", "completion_tokens_details"} {
		projection = append(projection, bson.E{Key: field, Value: bson.D{{Key: "reasoning_tokens", Value: path + "." + field + ".reasoning_tokens"}}})
	}
	return projection
}

func summaryEventScopeFilter(userID string, sessionIDs []string) bson.D {
	selectedIDs := make(bson.A, len(sessionIDs))
	for index, sessionID := range sessionIDs {
		selectedIDs[index] = sessionID
	}
	return bson.D{
		{Key: "user_id", Value: userID},
		{Key: "session_id", Value: bson.D{{Key: "$in", Value: selectedIDs}}},
	}
}

func summaryPreToolEventFindFilter(userID string, sessionIDs []string) bson.D {
	filter := summaryEventScopeFilter(userID, sessionIDs)
	filter = append(filter, bson.E{Key: "hook_event_name", Value: "PreToolUse"})
	return append(filter, bson.E{Key: "$expr", Value: summaryPreToolFeatureExpression()})
}

func summaryPreToolFeatureFindFilter(userID string, sessionIDs []string) bson.D {
	filter := summaryEventScopeFilter(userID, sessionIDs)
	return append(filter, bson.E{Key: "hook_event_name", Value: "PreToolUse"})
}

func summaryPreToolFeatureFindOptions() *options.FindOptions {
	return options.Find().
		SetProjection(summaryPreToolFeatureProjection()).
		SetHint(hookEventPreToolSummaryIndexName).
		SetBatchSize(summaryFeatureEventsBatchSize)
}

func summaryPreToolFeatureProjection() bson.D {
	projection := bson.D{
		{Key: "_id", Value: 1},
		{Key: "user_id", Value: 1},
		{Key: "session_id", Value: 1},
		{Key: "turn_id", Value: 1},
		{Key: "hook_event_name", Value: 1},
		{Key: "tool_name", Value: 1},
		{Key: "tool_use_id", Value: 1},
		{Key: "received_at", Value: 1},
	}
	roots := []string{"payload", "payload.payload", "payload.raw", "payload.data", "payload.event"}
	toolInputFields := []string{
		"file_path", "path", "target_file", "filename", "file", "old_path", "new_path",
		"operation", "action", "command", "cmd", "script", "patch", "patch_text", "diff",
		"name", "skill", "skill_name", "skills",
	}
	for _, root := range roots {
		for _, field := range []string{"tool_name", "skill_name", "skill", "skills"} {
			projection = append(projection, bson.E{Key: root + "." + field, Value: 1})
		}
		for _, field := range toolInputFields {
			projection = append(projection, bson.E{Key: root + ".tool_input." + field, Value: 1})
		}
		projection = append(projection, bson.E{Key: root + ".tool_input.content", Value: 1})
	}
	return projection
}

func summaryConversationEventFindFilter(userID string, sessionIDs []string) bson.D {
	filter := summaryEventScopeFilter(userID, sessionIDs)
	return append(filter, bson.E{Key: "hook_event_name", Value: bson.D{{Key: "$in", Value: bson.A{"UserPromptSubmit", "Stop", "SubagentStop"}}}})
}

func summaryPayloadPreToolEventFindFilter(userID string, sessionIDs []string) bson.D {
	filter := summaryEventScopeFilter(userID, sessionIDs)
	filter = append(filter, bson.E{Key: "hook_event_name", Value: bson.D{{Key: "$exists", Value: false}}})
	filter = append(filter, bson.E{Key: "payload.hook_event_name", Value: "PreToolUse"})
	return append(filter, bson.E{Key: "$expr", Value: summaryPreToolFeatureExpression()})
}

func summaryPayloadConversationEventFindFilter(userID string, sessionIDs []string) bson.D {
	filter := summaryEventScopeFilter(userID, sessionIDs)
	filter = append(filter, bson.E{Key: "hook_event_name", Value: bson.D{{Key: "$exists", Value: false}}})
	return append(filter, bson.E{Key: "payload.hook_event_name", Value: bson.D{{Key: "$in", Value: bson.A{"UserPromptSubmit", "Stop", "SubagentStop"}}}})
}

func summaryPreToolEventFindOptions() *options.FindOptions {
	return summaryIndexedEventFindOptions(summaryEventFindProjection(), hookEventPreToolSummaryIndexName)
}

func summaryConversationEventFindOptions() *options.FindOptions {
	return summaryIndexedEventFindOptions(summaryConversationEventFindProjection(), hookEventPreToolSummaryIndexName)
}

func summaryPayloadNameEventFindOptions() *options.FindOptions {
	return summaryIndexedEventFindOptions(summaryEventFindProjection(), hookEventPayloadNameIndexName)
}

func summaryPayloadConversationEventFindOptions() *options.FindOptions {
	return summaryIndexedEventFindOptions(summaryConversationEventFindProjection(), hookEventPayloadNameIndexName)
}

func summaryIndexedEventFindOptions(projection bson.D, hint string) *options.FindOptions {
	return options.Find().
		SetProjection(projection).
		SetHint(hint)
}

func summaryStringPreviewExpression(value any, length int) bson.D {
	return bson.D{{Key: "$cond", Value: bson.A{
		bson.D{{Key: "$eq", Value: bson.A{bson.D{{Key: "$type", Value: value}}, "string"}}},
		bson.D{{Key: "$substrCP", Value: bson.A{value, 0, length}}},
		"",
	}}}
}

func findSummaryEvents(ctx context.Context, collection *mongo.Collection, queryName string, filter bson.D, findOptions *options.FindOptions, useAggregation bool) ([]HookEvent, error) {
	var cursor *mongo.Cursor
	var err error
	if useAggregation {
		pipeline := mongo.Pipeline{
			bson.D{{Key: "$match", Value: filter}},
			bson.D{{Key: "$project", Value: findOptions.Projection}},
		}
		cursor, err = collection.Aggregate(ctx, pipeline, options.Aggregate().SetHint(findOptions.Hint).SetBatchSize(summaryEventsBatchSize))
	} else {
		cursor, err = collection.Find(ctx, filter, findOptions)
	}
	if err != nil {
		return nil, err
	}
	defer cursor.Close(ctx)
	events := make([]HookEvent, 0)
	for cursor.Next(ctx) {
		var document hookEventDocument
		if err := cursor.Decode(&document); err != nil {
			return nil, err
		}
		events = append(events, hookEventFromDocument(document))
	}
	if err := cursor.Err(); err != nil {
		return nil, err
	}
	return events, nil
}

func summaryEventPipelineForUserSessions(userID string, sessionIDs []string) []bson.D {
	selectedIDs := make(bson.A, len(sessionIDs))
	for index, sessionID := range sessionIDs {
		selectedIDs[index] = sessionID
	}
	payload := summaryPayloadProjection("$payload", true)
	return []bson.D{
		{{Key: "$match", Value: bson.D{
			{Key: "user_id", Value: userID},
			{Key: "session_id", Value: bson.D{{Key: "$in", Value: selectedIDs}}},
			{Key: "$expr", Value: summaryFeatureSignalExpression()},
		}}},
		{{Key: "$sort", Value: bson.D{{Key: "session_id", Value: 1}, {Key: "received_at", Value: 1}, {Key: "_id", Value: 1}}}},
		{{Key: "$project", Value: bson.D{
			{Key: "_id", Value: 1},
			{Key: "user_id", Value: 1},
			{Key: "session_id", Value: 1},
			{Key: "turn_id", Value: 1},
			{Key: "hook_event_name", Value: 1},
			{Key: "tool_name", Value: 1},
			{Key: "tool_use_id", Value: 1},
			{Key: "received_at", Value: 1},
			{Key: "payload", Value: payload},
		}}},
	}
}

func summaryFeatureSignalExpression() bson.D {
	return orExpression(
		conditionalExpression(preToolUseExpression(), summaryPreToolFeatureExpression(), false),
		summaryConversationSignalExpression(),
	)
}

func summaryPreToolFeatureExpression() bson.D {
	return orExpression(skillSignalExpression(), fileSignalExpression(), mcpSignalExpression())
}

func summaryConversationSignalExpression() bson.D {
	titleFields := make([]bson.D, 0, 4)
	for _, path := range []string{"$payload.title", "$payload.session_title", "$payload.thread_title", "$payload.prompt"} {
		titleFields = append(titleFields, bson.D{{Key: "$ne", Value: bson.A{stringFieldCandidate(path), ""}}})
	}
	return orExpression(orExpression(titleFields...), tokenUsageSignalExpression())
}

func summaryPayloadProjection(path string, includeWrappers bool) bson.D {
	result := bson.D{
		{Key: "hook_event_name", Value: path + ".hook_event_name"},
		{Key: "tool_name", Value: path + ".tool_name"},
		{Key: "tool_use_id", Value: path + ".tool_use_id"},
		{Key: "title", Value: path + ".title"},
		{Key: "session_title", Value: path + ".session_title"},
		{Key: "thread_title", Value: path + ".thread_title"},
		{Key: "prompt", Value: path + ".prompt"},
		{Key: "usage_source", Value: path + ".usage_source"},
		{Key: "usage", Value: path + ".usage"},
	}
	toolInputProjection := bson.D{}
	for _, field := range []string{"file_path", "path", "target_file", "filename", "file", "old_path", "new_path", "operation", "action", "command", "cmd", "script", "patch", "patch_text", "diff", "name", "skill", "skill_name", "skills"} {
		toolInputProjection = append(toolInputProjection, bson.E{Key: field, Value: path + ".tool_input." + field})
	}
	result = append(result, bson.E{Key: "tool_input", Value: toolInputProjection})
	for _, container := range []string{"response", "tool_response", "output", "result"} {
		containerPath := path + "." + container
		containerProjection := bson.D{{Key: "usage", Value: containerPath + ".usage"}}
		for _, field := range []string{"input_tokens", "prompt_tokens", "cached_input_tokens", "cached_tokens", "output_tokens", "completion_tokens", "reasoning_tokens", "reasoning_output_tokens", "total_tokens"} {
			containerProjection = append(containerProjection, bson.E{Key: field, Value: containerPath + "." + field})
		}
		for _, field := range []string{"input_tokens_details", "prompt_tokens_details"} {
			containerProjection = append(containerProjection, bson.E{Key: field, Value: bson.D{{Key: "cached_tokens", Value: containerPath + "." + field + ".cached_tokens"}}})
		}
		for _, field := range []string{"output_tokens_details", "completion_tokens_details"} {
			containerProjection = append(containerProjection, bson.E{Key: field, Value: bson.D{{Key: "reasoning_tokens", Value: containerPath + "." + field + ".reasoning_tokens"}}})
		}
		result = append(result, bson.E{Key: container, Value: containerProjection})
	}
	for _, field := range []string{"input_tokens", "prompt_tokens", "cached_input_tokens", "cached_tokens", "output_tokens", "completion_tokens", "reasoning_tokens", "reasoning_output_tokens", "total_tokens"} {
		result = append(result, bson.E{Key: field, Value: path + "." + field})
	}
	for _, field := range []string{"input_tokens_details", "prompt_tokens_details"} {
		result = append(result, bson.E{Key: field, Value: bson.D{{Key: "cached_tokens", Value: path + "." + field + ".cached_tokens"}}})
	}
	for _, field := range []string{"output_tokens_details", "completion_tokens_details"} {
		result = append(result, bson.E{Key: field, Value: bson.D{{Key: "reasoning_tokens", Value: path + "." + field + ".reasoning_tokens"}}})
	}
	if includeWrappers {
		for _, wrapper := range []string{"payload", "raw", "data", "event"} {
			result = append(result, bson.E{Key: wrapper, Value: summaryPayloadProjection(path+"."+wrapper, false)})
		}
	}
	return result
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
	if r != nil && r.aggregateForUser != nil {
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
	sessionIDs, err := r.ListRecentSessionIDsForUser(ctx, userID, limit)
	if err != nil {
		return nil, err
	}
	return r.ListSessionSummariesForUserSessions(ctx, userID, sessionIDs, limit)
}

func (r *HookEventRepository) ListRecentSessionIDsForUser(ctx context.Context, userID string, limit int) ([]string, error) {
	if r == nil || r.listRecentSessionIDs == nil {
		return nil, &RepositoryError{Operation: "missing_recent_session_id_repository"}
	}
	if strings.TrimSpace(userID) == "" {
		return nil, &RepositoryError{Operation: "missing_user_id"}
	}
	if limit <= 0 {
		return nil, &RepositoryError{Operation: "invalid_session_limit"}
	}
	sessionIDs, err := r.listRecentSessionIDs(ctx, userID, limit)
	if err != nil {
		return nil, &RepositoryError{Operation: "find_user_session_ids"}
	}
	if sessionIDs == nil {
		sessionIDs = make([]string, 0)
	}
	return sessionIDs, nil
}

func (r *HookEventRepository) ListSessionSummariesForUserSessions(ctx context.Context, userID string, sessionIDs []string, limit int) ([]SessionSummary, error) {
	if r == nil || r.aggregateForSessions == nil {
		return nil, &RepositoryError{Operation: "missing_user_aggregate_repository"}
	}
	if strings.TrimSpace(userID) == "" {
		return nil, &RepositoryError{Operation: "missing_user_id"}
	}
	if limit <= 0 {
		return nil, &RepositoryError{Operation: "invalid_session_limit"}
	}
	if len(sessionIDs) == 0 {
		return make([]SessionSummary, 0), nil
	}
	selectedIDs := make([]string, 0, len(sessionIDs))
	for _, sessionID := range sessionIDs {
		sessionID = strings.TrimSpace(sessionID)
		if sessionID == "" {
			return nil, &RepositoryError{Operation: "missing_session_id"}
		}
		selectedIDs = append(selectedIDs, sessionID)
	}
	rows, err := r.aggregateForSessions(ctx, userID, selectedIDs, limit)
	if err != nil {
		return nil, &RepositoryError{Operation: "aggregate_user_session_summaries"}
	}
	if rows == nil {
		rows = make([]SessionSummary, 0)
	}
	return rows, nil
}

func (r *HookEventRepository) WalkSessionSummaryEventsForUser(ctx context.Context, userID string, sessionIDs []string, yield func(HookEvent) error) error {
	if r == nil || r.walkSummaryEvents == nil {
		return &RepositoryError{Operation: "missing_user_summary_event_repository"}
	}
	if strings.TrimSpace(userID) == "" {
		return &RepositoryError{Operation: "missing_user_id"}
	}
	if yield == nil {
		return &RepositoryError{Operation: "missing_summary_event_consumer"}
	}
	if len(sessionIDs) == 0 {
		return nil
	}
	selectedIDs := make([]string, 0, len(sessionIDs))
	for _, sessionID := range sessionIDs {
		sessionID = strings.TrimSpace(sessionID)
		if sessionID == "" {
			return &RepositoryError{Operation: "missing_session_id"}
		}
		selectedIDs = append(selectedIDs, sessionID)
	}
	if err := r.walkSummaryEvents(ctx, userID, selectedIDs, yield); err != nil {
		return &RepositoryError{Operation: "walk_user_session_summary_events"}
	}
	return nil
}

func (r *HookEventRepository) WalkSessionSummaryFeatureEventsForUser(ctx context.Context, userID string, sessionIDs []string, yield func(HookEvent) error) error {
	if r == nil || r.walkSummaryFeatures == nil {
		return &RepositoryError{Operation: "missing_user_summary_feature_repository"}
	}
	if strings.TrimSpace(userID) == "" {
		return &RepositoryError{Operation: "missing_user_id"}
	}
	if yield == nil {
		return &RepositoryError{Operation: "missing_summary_event_consumer"}
	}
	if len(sessionIDs) == 0 {
		return nil
	}
	selectedIDs := make([]string, 0, len(sessionIDs))
	for _, sessionID := range sessionIDs {
		sessionID = strings.TrimSpace(sessionID)
		if sessionID == "" {
			return &RepositoryError{Operation: "missing_session_id"}
		}
		selectedIDs = append(selectedIDs, sessionID)
	}
	if err := r.walkSummaryFeatures(ctx, userID, selectedIDs, yield); err != nil {
		return &RepositoryError{Operation: "walk_user_session_summary_feature_events"}
	}
	return nil
}

func (r *HookEventRepository) ListSessionEventsForUser(ctx context.Context, userID, sessionID string) ([]HookEvent, error) {
	if r == nil || r.findForUser == nil {
		return nil, &RepositoryError{Operation: "missing_session_event_repository"}
	}
	if strings.TrimSpace(userID) == "" {
		return nil, &RepositoryError{Operation: "missing_user_id"}
	}
	if strings.TrimSpace(sessionID) == "" {
		return nil, &RepositoryError{Operation: "missing_session_id"}
	}
	rows, err := r.findForUser(ctx, userID, sessionID)
	if err != nil {
		return nil, &RepositoryError{Operation: "find_session_events"}
	}
	if rows == nil {
		rows = make([]HookEvent, 0)
	}
	return rows, nil
}

func hookEventFromDocument(document hookEventDocument) HookEvent {
	event := HookEvent{
		ID:            documentID(document.ID),
		UserID:        document.UserID,
		SessionID:     document.SessionID,
		TurnID:        document.TurnID,
		HookEventName: document.HookEventName,
		ToolName:      document.ToolName,
		ToolUseID:     document.ToolUseID,
		Payload:       document.Payload,
		ReceivedAt:    document.ReceivedAt,
	}
	if event.HookEventName == "" {
		event.HookEventName = payloadStringField(document.Payload, "hook_event_name")
	}
	if event.ToolName == nil {
		if toolName := payloadStringField(document.Payload, "tool_name"); toolName != "" {
			event.ToolName = &toolName
		}
	}
	if event.ToolUseID == nil {
		if toolUseID := payloadStringField(document.Payload, "tool_use_id"); toolUseID != "" {
			event.ToolUseID = &toolUseID
		}
	}
	return event
}

func payloadStringField(payload bson.Raw, field string) string {
	if len(payload) == 0 {
		return ""
	}
	return nestedPayloadRawStringField(payload, field, 0)
}

func nestedPayloadRawStringField(document bson.Raw, field string, depth int) string {
	if value, ok := document.Lookup(field).StringValueOK(); ok {
		if value = strings.TrimSpace(value); value != "" {
			return value
		}
	}
	if depth >= 3 {
		return ""
	}
	for _, key := range []string{"payload", "raw", "data", "event"} {
		value := document.Lookup(key)
		if value.Type != bsontype.EmbeddedDocument {
			continue
		}
		if result := nestedPayloadRawStringField(value.Document(), field, depth+1); result != "" {
			return result
		}
	}
	return ""
}

func nestedPayloadStringField(document bson.M, field string, depth int) string {
	if value, ok := document[field].(string); ok && strings.TrimSpace(value) != "" {
		return strings.TrimSpace(value)
	}
	if depth >= 3 {
		return ""
	}
	for _, key := range []string{"payload", "raw", "data", "event"} {
		nested, ok := document[key]
		if !ok {
			continue
		}
		switch value := nested.(type) {
		case bson.M:
			if result := nestedPayloadStringField(value, field, depth+1); result != "" {
				return result
			}
		case map[string]any:
			if result := nestedPayloadStringField(bson.M(value), field, depth+1); result != "" {
				return result
			}
		}
	}
	return ""
}

func documentID(value any) string {
	switch typed := value.(type) {
	case nil:
		return ""
	case string:
		return typed
	default:
		return fmt.Sprint(typed)
	}
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
