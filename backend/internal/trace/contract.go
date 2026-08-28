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
	RuntimeMetadata  RuntimeMetadata    `json:"runtime_metadata"`
	Summary          Summary            `json:"summary"`
}

type TimelineEvent struct {
	ID            string          `json:"id"`
	HookEventName string          `json:"hook_event_name"`
	OccurredAt    time.Time       `json:"occurred_at"`
	Kind          string          `json:"kind"`
	PartialReason string          `json:"partial_reason,omitempty"`
	ToolCallIndex *int            `json:"tool_call_index,omitempty"`
	TokenUsage    *TokenUsage     `json:"token_usage,omitempty"`
	Raw           json.RawMessage `json:"raw"`
}

type ConversationItem struct {
	EventID    string          `json:"event_id,omitempty"`
	Role       string          `json:"role"`
	Content    json.RawMessage `json:"content"`
	OccurredAt time.Time       `json:"occurred_at"`
	TurnID     *string         `json:"turn_id"`
	Raw        json.RawMessage `json:"raw"`
}

type ToolCall struct {
	ToolUseID   *string         `json:"tool_use_id"`
	ToolName    string          `json:"tool_name"`
	MCPServer   string          `json:"mcp_server,omitempty"`
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

// TokenUsage is the canonical token usage contract.
// Cached input tokens are a subset of input tokens and are reported separately.
type TokenUsage struct {
	InputTokens       int64 `bson:"input_tokens" json:"input_tokens"`
	CachedInputTokens int64 `bson:"cached_input_tokens" json:"cached_input_tokens"`
	OutputTokens      int64 `bson:"output_tokens" json:"output_tokens"`
	ReasoningTokens   int64 `bson:"reasoning_tokens" json:"reasoning_tokens"`
	TotalTokens       int64 `bson:"total_tokens" json:"total_tokens"`
}

func (usage *TokenUsage) Add(other TokenUsage) {
	if usage == nil {
		return
	}
	usage.InputTokens += other.InputTokens
	usage.CachedInputTokens += other.CachedInputTokens
	usage.OutputTokens += other.OutputTokens
	usage.ReasoningTokens += other.ReasoningTokens
	usage.TotalTokens += other.TotalTokens
}

// RuntimeMetadata contains only allowlisted scalar execution settings found
// in captured hook payloads or their bounded Codex transcript enrichment.
// Missing producer fields remain empty.
type RuntimeMetadata struct {
	Model               string `json:"model,omitempty"`
	Provider            string `json:"provider,omitempty"`
	ReasoningEffort     string `json:"reasoning_effort,omitempty"`
	ContextWindowTokens int64  `json:"context_window_tokens,omitempty"`
	Client              string `json:"client,omitempty"`
	ClientVersion       string `json:"client_version,omitempty"`
	Source              string `json:"source,omitempty"`
	PermissionMode      string `json:"permission_mode,omitempty"`
	ThreadSource        string `json:"thread_source,omitempty"`
	RecordedFrom        string `json:"recorded_from,omitempty"`
}

type Summary struct {
	EventCount           int        `json:"event_count"`
	MessageCount         int        `json:"message_count"`
	ToolCallCount        int        `json:"tool_call_count"`
	MCPCallCount         int        `json:"mcp_call_count"`
	MCPServers           []string   `json:"mcp_servers"`
	SkillInvocationCount int        `json:"skill_invocation_count"`
	FileOperationCount   int        `json:"file_operation_count"`
	FileReadCount        int        `json:"file_read_count"`
	TokenUsage           TokenUsage `json:"token_usage"`
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
		Summary:          Summary{MCPServers: make([]string, 0)},
	}
}
