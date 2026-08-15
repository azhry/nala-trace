package events

import (
	"bytes"
	"encoding/json"
	"fmt"
	"strings"
)

var supportedEventNames = map[string]struct{}{
	"SessionStart":     {},
	"UserPromptSubmit": {},
	"PreToolUse":       {},
	"PostToolUse":      {},
	"SubagentStart":    {},
	"SubagentStop":     {},
	"PreCompact":       {},
	"PostCompact":      {},
	"Stop":             {},
}

// Event is the canonical representation of one Codex hook payload. Raw keeps
// the complete object available for forward-compatible reconstruction.
type Event struct {
	SessionID     string
	TurnID        *string
	HookEventName string
	ToolName      *string
	ToolUseID     *string
	ToolInput     json.RawMessage
	ToolResponse  json.RawMessage
	Response      json.RawMessage
	Prompt        json.RawMessage
	Payload       map[string]json.RawMessage
	Raw           json.RawMessage
}

// ValidationError identifies only the invalid field and never includes raw
// payload values, which may contain credentials or private user content.
type ValidationError struct {
	Field string
	Code  string
}

func (e *ValidationError) Error() string {
	return fmt.Sprintf("invalid hook event %s: %s", e.Field, e.Code)
}

func SupportedEventNames() []string {
	return []string{
		"SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse",
		"SubagentStart", "SubagentStop", "PreCompact", "PostCompact", "Stop",
	}
}

func Decode(data []byte) (Event, error) {
	trimmed := bytes.TrimSpace(data)
	if len(trimmed) == 0 || trimmed[0] != '{' {
		return Event{}, &ValidationError{Field: "payload", Code: "must be a JSON object"}
	}

	var payload map[string]json.RawMessage
	if err := json.Unmarshal(trimmed, &payload); err != nil || payload == nil {
		return Event{}, &ValidationError{Field: "payload", Code: "must be valid JSON"}
	}

	sessionID, err := requiredString(payload, "session_id")
	if err != nil {
		return Event{}, err
	}
	hookEventName, err := requiredString(payload, "hook_event_name")
	if err != nil {
		return Event{}, err
	}
	if _, ok := supportedEventNames[hookEventName]; !ok {
		return Event{}, &ValidationError{Field: "hook_event_name", Code: "unsupported value"}
	}

	event := Event{
		SessionID:     sessionID,
		HookEventName: hookEventName,
		Payload:       payload,
		Raw:           append(json.RawMessage(nil), trimmed...),
	}
	if event.TurnID, err = nullableString(payload, "turn_id"); err != nil {
		return Event{}, err
	}
	if event.ToolName, err = nullableString(payload, "tool_name"); err != nil {
		return Event{}, err
	}
	if event.ToolUseID, err = nullableString(payload, "tool_use_id"); err != nil {
		return Event{}, err
	}
	event.ToolInput = copyRaw(payload["tool_input"])
	event.ToolResponse = copyRaw(payload["tool_response"])
	event.Response = copyRaw(payload["response"])
	event.Prompt = copyRaw(payload["prompt"])
	return event, nil
}

func requiredString(payload map[string]json.RawMessage, field string) (string, error) {
	raw, ok := payload[field]
	if !ok || bytes.Equal(bytes.TrimSpace(raw), []byte("null")) {
		return "", &ValidationError{Field: field, Code: "is required"}
	}
	var value string
	if err := json.Unmarshal(raw, &value); err != nil || strings.TrimSpace(value) == "" {
		return "", &ValidationError{Field: field, Code: "must be a non-empty string"}
	}
	return value, nil
}

func nullableString(payload map[string]json.RawMessage, field string) (*string, error) {
	raw, ok := payload[field]
	if !ok || bytes.Equal(bytes.TrimSpace(raw), []byte("null")) {
		return nil, nil
	}
	var value string
	if err := json.Unmarshal(raw, &value); err != nil {
		return nil, &ValidationError{Field: field, Code: "must be a string or null"}
	}
	return &value, nil
}

func copyRaw(raw json.RawMessage) json.RawMessage {
	if len(raw) == 0 {
		return nil
	}
	return append(json.RawMessage(nil), raw...)
}
