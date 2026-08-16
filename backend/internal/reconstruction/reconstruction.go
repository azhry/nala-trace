package reconstruction

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/azhry/nala-trace/backend/internal/storage"
	"github.com/azhry/nala-trace/backend/internal/trace"
	"go.mongodb.org/mongo-driver/bson"
)

type OrderedEvent struct {
	Event         storage.HookEvent
	OriginalIndex int
}

func Order(events []storage.HookEvent) []OrderedEvent {
	ordered := make([]OrderedEvent, len(events))
	for index, event := range events {
		ordered[index] = OrderedEvent{Event: event, OriginalIndex: index}
	}
	sort.SliceStable(ordered, func(left, right int) bool {
		leftEvent, rightEvent := ordered[left], ordered[right]
		if !leftEvent.Event.ReceivedAt.Equal(rightEvent.Event.ReceivedAt) {
			return leftEvent.Event.ReceivedAt.Before(rightEvent.Event.ReceivedAt)
		}
		if leftEvent.Event.ID != "" && rightEvent.Event.ID != "" && leftEvent.Event.ID != rightEvent.Event.ID {
			return leftEvent.Event.ID < rightEvent.Event.ID
		}
		return leftEvent.OriginalIndex < rightEvent.OriginalIndex
	})
	return ordered
}

func Reconstruct(sessionID, userID string, events []storage.HookEvent) trace.Trace {
	result := trace.New(sessionID, userID)
	ordered := Order(events)
	pending := make(map[string]int)
	for _, item := range ordered {
		event := item.Event
		raw := payloadJSON(event.Payload)
		reason := partialReason(event)
		kind := "lifecycle"
		var toolCallIndex *int
		if event.HookEventName == "PreToolUse" || event.HookEventName == "PostToolUse" {
			kind = "tool"
		}
		if event.HookEventName == "PreToolUse" {
			index := len(result.ToolCalls)
			toolCallIndex = &index
			toolID := value(event.ToolUseID)
			call := trace.ToolCall{
				ToolUseID: event.ToolUseID,
				ToolName:  value(event.ToolName),
				Input:     payloadField(event.Payload, "tool_input"),
				Status:    trace.ToolCallPending,
				Raw:       raw,
			}
			startedAt := event.ReceivedAt.UTC()
			if !startedAt.IsZero() {
				call.StartedAt = &startedAt
			}
			result.ToolCalls = append(result.ToolCalls, call)
			if toolID == "" {
				reason = joinReasons(reason, "missing_tool_use_id")
			} else if _, exists := pending[toolID]; exists {
				reason = joinReasons(reason, "duplicate_tool_use_id")
			} else {
				pending[toolID] = index
			}
		}
		if event.HookEventName == "PostToolUse" {
			toolID := value(event.ToolUseID)
			if toolID == "" {
				reason = joinReasons(reason, "missing_tool_use_id")
			} else if index, exists := pending[toolID]; exists {
				completedAt := event.ReceivedAt.UTC()
				result.ToolCalls[index].Output = payloadField(event.Payload, "tool_response")
				if result.ToolCalls[index].Output == nil {
					result.ToolCalls[index].Output = payloadField(event.Payload, "response")
				}
				if !completedAt.IsZero() {
					result.ToolCalls[index].CompletedAt = &completedAt
				}
				result.ToolCalls[index].Status = trace.ToolCallCompleted
				toolCallIndex = &index
				delete(pending, toolID)
			} else {
				index := len(result.ToolCalls)
				toolCallIndex = &index
				result.ToolCalls = append(result.ToolCalls, trace.ToolCall{
					ToolUseID: event.ToolUseID,
					ToolName:  value(event.ToolName),
					Output:    payloadField(event.Payload, "tool_response"),
					Status:    trace.ToolCallUnmatched,
					Raw:       raw,
				})
				reason = joinReasons(reason, "unmatched_post_tool_use")
			}
		}
		if reason != "" {
			kind = "partial"
		}
		timeline := trace.TimelineEvent{
			ID:            eventID(event, item.OriginalIndex),
			HookEventName: event.HookEventName,
			OccurredAt:    event.ReceivedAt.UTC(),
			Kind:          kind,
			PartialReason: reason,
			ToolCallIndex: toolCallIndex,
			Raw:           raw,
		}
		result.Timeline = append(result.Timeline, timeline)
	}
	for index := range result.ToolCalls {
		if result.ToolCalls[index].Status == trace.ToolCallPending {
			result.ToolCalls[index].Status = trace.ToolCallUnmatched
		}
	}
	result.Summary.EventCount = len(result.Timeline)
	result.Summary.ToolCallCount = len(result.ToolCalls)
	return result
}

func eventID(event storage.HookEvent, originalIndex int) string {
	if strings.TrimSpace(event.ID) != "" {
		return event.ID
	}
	return fmt.Sprintf("%s-%d", event.HookEventName, originalIndex)
}

func partialReason(event storage.HookEvent) string {
	if event.ReceivedAt.IsZero() {
		return "missing_received_at"
	}
	for _, field := range []string{"timestamp", "occurred_at", "created_at"} {
		value := payloadField(event.Payload, field)
		if value == nil {
			continue
		}
		var timestamp string
		if err := json.Unmarshal(value, &timestamp); err != nil {
			return "malformed_timestamp"
		}
		if _, err := time.Parse(time.RFC3339Nano, timestamp); err != nil {
			return "malformed_timestamp"
		}
	}
	return ""
}

func payloadJSON(payload bson.Raw) json.RawMessage {
	if len(payload) == 0 {
		return json.RawMessage(`{}`)
	}
	encoded, err := bson.MarshalExtJSON(payload, true, false)
	if err != nil {
		return json.RawMessage(`{}`)
	}
	return json.RawMessage(encoded)
}

func payloadField(payload bson.Raw, field string) json.RawMessage {
	if len(payload) == 0 {
		return nil
	}
	var document bson.M
	if err := bson.Unmarshal(payload, &document); err != nil {
		return nil
	}
	value, ok := document[field]
	if !ok {
		return nil
	}
	encoded, err := json.Marshal(value)
	if err != nil {
		return nil
	}
	return json.RawMessage(encoded)
}

func value(pointer *string) string {
	if pointer == nil {
		return ""
	}
	return *pointer
}

func joinReasons(left, right string) string {
	if left == "" {
		return right
	}
	if right == "" || left == right {
		return left
	}
	return left + ";" + right
}
