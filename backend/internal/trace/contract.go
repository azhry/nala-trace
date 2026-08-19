package trace

import (
	"encoding/json"
	"time"
)

const SchemaVersion = "1"

type ToolCallStatus string

const (
	ToolCallPending   ToolCallStatus = "pending"
	ToolCallCompleted ToolCallStatus = "completed"
	ToolCallFailed    ToolCallStatus = "failed"
	ToolCallUnmatched ToolCallStatus = "unmatched"
)

// Trace is the versioned read contract for one reconstructed Codex session.
// Slices are intentionally non-nil in responses so missing data is an empty
// collection rather than an ambiguous null.
type Trace struct {
	SchemaVersion    string             `json:"schema_version"`
	SessionID        string             `json:"session_id"`
	UserID           string             `json:"user_id"`
	Timeline         []TimelineEvent    `json:"timeline"`
	Conversation     []ConversationItem `json:"conversation"`
	ToolCalls        []ToolCall         `json:"tool_calls"`
	SkillInvocations []SkillInvocation  `json:"skill_invocations"`
	Files            []FileOperation    `json:"files"`
	Summary          Summary            `json:"summary"`
}

type TimelineEvent struct {
	ID            string          `json:"id"`
	HookEventName string          `json:"hook_event_name"`
	OccurredAt    time.Time       `json:"occurred_at"`
	Kind          string          `json:"kind"`
	PartialReason string          `json:"partial_reason,omitempty"`
	ToolCallIndex *int            `json:"tool_call_index,omitempty"`
	Raw           json.RawMessage `json:"raw"`
}

type ConversationItem struct {
	Role       string          `json:"role"`
	Content    json.RawMessage `json:"content"`
	OccurredAt time.Time       `json:"occurred_at"`
	TurnID     *string         `json:"turn_id"`
	Raw        json.RawMessage `json:"raw"`
}

type ToolCall struct {
	ToolUseID   *string         `json:"tool_use_id"`
	ToolName    string          `json:"tool_name"`
	Input       json.RawMessage `json:"input"`
	Output      json.RawMessage `json:"output"`
	StartedAt   *time.Time      `json:"started_at"`
	CompletedAt *time.Time      `json:"completed_at"`
	Status      ToolCallStatus  `json:"status"`
	Raw         json.RawMessage `json:"raw"`
}

type SkillInvocation struct {
	Name       string          `json:"name"`
	EventID    string          `json:"event_id"`
	ToolUseID  *string         `json:"tool_use_id"`
	ToolName   string          `json:"tool_name"`
	Confidence string          `json:"confidence"`
	OccurredAt time.Time       `json:"occurred_at"`
	Raw        json.RawMessage `json:"raw"`
}

type FileOperation struct {
	Path       string          `json:"path"`
	Operation  string          `json:"operation"`
	EventID    string          `json:"event_id"`
	ToolUseID  *string         `json:"tool_use_id"`
	ToolName   string          `json:"tool_name"`
	Confidence string          `json:"confidence"`
	OccurredAt time.Time       `json:"occurred_at"`
	Raw        json.RawMessage `json:"raw"`
}

type Summary struct {
	EventCount           int `json:"event_count"`
	MessageCount         int `json:"message_count"`
	ToolCallCount        int `json:"tool_call_count"`
	SkillInvocationCount int `json:"skill_invocation_count"`
	FileOperationCount   int `json:"file_operation_count"`
}

func New(sessionID, userID string) Trace {
	return Trace{
		SchemaVersion:    SchemaVersion,
		SessionID:        sessionID,
		UserID:           userID,
		Timeline:         make([]TimelineEvent, 0),
		Conversation:     make([]ConversationItem, 0),
		ToolCalls:        make([]ToolCall, 0),
		SkillInvocations: make([]SkillInvocation, 0),
		Files:            make([]FileOperation, 0),
	}
}
