package storage

import (
	"time"

	"go.mongodb.org/mongo-driver/bson"
)

type SessionSummary struct {
	SessionID            string    `bson:"session_id" json:"session_id"`
	UserID               string    `bson:"user_id" json:"user_id"`
	FirstEventAt         time.Time `bson:"first_event_at" json:"first_event_at"`
	LastEventAt          time.Time `bson:"last_event_at" json:"last_event_at"`
	EventCount           int64     `bson:"event_count" json:"event_count"`
	ToolCallCount        int64     `bson:"tool_call_count" json:"tool_call_count"`
	SkillInvocationCount int64     `bson:"skill_invocation_count" json:"skill_invocation_count"`
	FileOperationCount   int64     `bson:"file_operation_count" json:"file_operation_count"`
}

func sessionSummaryPipeline() []bson.D {
	return sessionSummaryPipelineForUser("", 0)
}

func sessionSummaryPipelineForUser(userID string, limit int) []bson.D {
	toolEvent := bson.D{{Key: "$in", Value: bson.A{"$hook_event_name", bson.A{"PreToolUse"}}}}
	skillEvent := bson.D{{Key: "$regexMatch", Value: bson.D{
		{Key: "input", Value: bson.D{{Key: "$ifNull", Value: bson.A{"$tool_name", ""}}}},
		{Key: "regex", Value: "skill"},
		{Key: "options", Value: "i"},
	}}}
	fileEvent := bson.D{{Key: "$or", Value: bson.A{
		bson.D{{Key: "$ne", Value: bson.A{bson.D{{Key: "$ifNull", Value: bson.A{"$payload.file_path", nil}}}, nil}}},
		bson.D{{Key: "$ne", Value: bson.A{bson.D{{Key: "$ifNull", Value: bson.A{"$payload.path", nil}}}, nil}}},
	}}}
	pipeline := make([]bson.D, 0, 5)
	if userID != "" {
		pipeline = append(pipeline, bson.D{{Key: "$match", Value: bson.D{{Key: "user_id", Value: userID}}}})
	}
	pipeline = append(pipeline, []bson.D{
		{{Key: "$group", Value: bson.D{
			{Key: "_id", Value: "$session_id"},
			{Key: "user_id", Value: bson.D{{Key: "$first", Value: "$user_id"}}},
			{Key: "first_event_at", Value: bson.D{{Key: "$min", Value: "$received_at"}}},
			{Key: "last_event_at", Value: bson.D{{Key: "$max", Value: "$received_at"}}},
			{Key: "event_count", Value: bson.D{{Key: "$sum", Value: 1}}},
			{Key: "tool_call_count", Value: bson.D{{Key: "$sum", Value: bson.D{{Key: "$cond", Value: bson.A{toolEvent, 1, 0}}}}}},
			{Key: "skill_invocation_count", Value: bson.D{{Key: "$sum", Value: bson.D{{Key: "$cond", Value: bson.A{skillEvent, 1, 0}}}}}},
			{Key: "file_operation_count", Value: bson.D{{Key: "$sum", Value: bson.D{{Key: "$cond", Value: bson.A{fileEvent, 1, 0}}}}}},
		}}},
		{{Key: "$project", Value: bson.D{{Key: "_id", Value: 0}, {Key: "session_id", Value: "$_id"}, {Key: "user_id", Value: 1}, {Key: "first_event_at", Value: 1}, {Key: "last_event_at", Value: 1}, {Key: "event_count", Value: 1}, {Key: "tool_call_count", Value: 1}, {Key: "skill_invocation_count", Value: 1}, {Key: "file_operation_count", Value: 1}}}},
		{{Key: "$sort", Value: bson.D{{Key: "last_event_at", Value: -1}, {Key: "session_id", Value: 1}}}},
	}...)
	if limit > 0 {
		pipeline = append(pipeline, bson.D{{Key: "$limit", Value: limit}})
	}
	return pipeline
}
