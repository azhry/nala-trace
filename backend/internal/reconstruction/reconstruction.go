package reconstruction

import (
	"encoding/json"
	"fmt"
	"regexp"
	"sort"
	"strconv"
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

const maxReconstructionPayloadBytes = 1 << 20

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
		timelineID := eventID(event, item.OriginalIndex)
		result.RuntimeMetadata = mergeRuntimeMetadata(result.RuntimeMetadata, runtimeMetadataFromPayload(event.Payload, event.HookEventName))
		reason := partialReason(event)
		payloadSafe := payloadIssue(event.Payload) == ""
		kind := "lifecycle"
		var toolCallIndex *int
		if payloadSafe {
			if role := conversationRole(event.HookEventName); role != "" {
				if content := messageContent(event.Payload, event.HookEventName); content != nil {
					result.Conversation = append(result.Conversation, trace.ConversationItem{
						EventID:    timelineID,
						Role:       role,
						Content:    content,
						OccurredAt: event.ReceivedAt.UTC(),
						TurnID:     event.TurnID,
						Raw:        raw,
					})
				}
			}
		}
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
				Input:     nil,
				Status:    trace.ToolCallPending,
				Raw:       raw,
			}
			if payloadSafe {
				call.Input = payloadField(event.Payload, "tool_input")
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
				if payloadSafe {
					result.ToolCalls[index].Output = payloadField(event.Payload, "tool_response")
					if result.ToolCalls[index].Output == nil {
						result.ToolCalls[index].Output = payloadField(event.Payload, "response")
					}
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
					Output:    nil,
					Status:    trace.ToolCallUnmatched,
					Raw:       raw,
				})
				if payloadSafe {
					result.ToolCalls[index].Output = payloadField(event.Payload, "tool_response")
				}
				reason = joinReasons(reason, "unmatched_post_tool_use")
			}
		}
		if event.HookEventName == "PreToolUse" && payloadSafe {
			if invocation, ok := detectSkillInvocation(event, timelineID, raw); ok {
				result.SkillInvocations = append(result.SkillInvocations, invocation)
			}
			result.Files = append(result.Files, detectFileOperations(event, timelineID, raw)...)
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
	result.Summary.MessageCount = len(result.Conversation)
	result.Summary.ToolCallCount = len(result.ToolCalls)
	result.Summary.SkillInvocationCount = len(result.SkillInvocations)
	result.Summary.FileOperationCount = len(result.Files)
	for _, file := range result.Files {
		if file.Operation == "read" {
			result.Summary.FileReadCount++
		}
	}
	return result
}

func conversationRole(eventName string) string {
	switch eventName {
	case "UserPromptSubmit":
		return "user"
	case "Stop", "SubagentStop":
		return "assistant"
	default:
		return ""
	}
}

func messageContent(payload bson.Raw, eventName string) json.RawMessage {
	keys := []string{"prompt", "user_prompt", "content", "text"}
	if eventName == "Stop" || eventName == "SubagentStop" {
		keys = []string{"last_assistant_message", "response", "stop_message", "message", "content", "text"}
	}
	for _, key := range keys {
		content := payloadField(payload, key)
		if hasMessageContent(content) {
			return content
		}
	}
	return nil
}

func hasMessageContent(content json.RawMessage) bool {
	trimmed := strings.TrimSpace(string(content))
	if trimmed == "" || trimmed == "null" {
		return false
	}
	var text string
	if err := json.Unmarshal(content, &text); err == nil {
		return strings.TrimSpace(text) != ""
	}
	return true
}

const (
	confidenceExplicit  = "explicit"
	confidenceInferred  = "inferred"
	confidenceAmbiguous = "ambiguous"
)

var (
	applyPatchFilePattern = regexp.MustCompile(`(?mi)^\*\*\* (Add|Update|Delete|Move to) File:\s*(.+?)\s*$`)
	shellReadPattern      = regexp.MustCompile(`(?i)(^|\s)(cat|head|tail|type|get-content|read)(\s|$)`)
	shellWritePattern     = regexp.MustCompile(`(?i)(set-content|out-file|tee\b|>>?\s*)`)
	shellDeletePattern    = regexp.MustCompile(`(?i)(remove-item|\brm\b|\bdel\b|\bdelete\b)`)
	commandPathPattern    = regexp.MustCompile(`(?i)(?:-literalpath|-filepath|-path|>\s*|>>\s*)\s*(?:"([^"]+)"|'([^']+)'|([^"'\s;&|]+))|(?:^|[;&|])\s*(?:cat|head|tail|type|get-content|read)\s+(?:"([^"]+)"|'([^']+)'|([^"'\s;&|-][^"'\s;&|]*))`)
)

func detectSkillInvocation(event storage.HookEvent, eventID string, raw json.RawMessage) (trace.SkillInvocation, bool) {
	input := toolInputDocument(event.Payload)
	payload := payloadDocument(event.Payload)
	toolName := value(event.ToolName)
	if name, ok := stringField(input, "skill_name", "skill"); ok {
		return newSkillInvocation(name, event, eventID, raw, confidenceExplicit), true
	}
	if name, ok := stringField(payload, "skill_name", "skill"); ok {
		return newSkillInvocation(name, event, eventID, raw, confidenceExplicit), true
	}
	if !strings.Contains(strings.ToLower(toolName), "skill") {
		return trace.SkillInvocation{}, false
	}
	if name, ok := stringField(input, "name"); ok {
		return newSkillInvocation(name, event, eventID, raw, confidenceInferred), true
	}
	name := skillNameFromToolName(toolName)
	return newSkillInvocation(name, event, eventID, raw, confidenceAmbiguous), true
}

func newSkillInvocation(name string, event storage.HookEvent, eventID string, raw json.RawMessage, confidence string) trace.SkillInvocation {
	return trace.SkillInvocation{
		Name:       name,
		EventID:    eventID,
		ToolUseID:  event.ToolUseID,
		ToolName:   value(event.ToolName),
		Confidence: confidence,
		OccurredAt: event.ReceivedAt.UTC(),
		Raw:        raw,
	}
}

func skillNameFromToolName(toolName string) string {
	parts := strings.FieldsFunc(toolName, func(r rune) bool { return r == ':' || r == '/' })
	if len(parts) == 0 {
		return toolName
	}
	name := strings.TrimSpace(parts[len(parts)-1])
	if name == "" || strings.EqualFold(name, "skill") || strings.EqualFold(name, "invoke") {
		return toolName
	}
	return name
}

func detectFileOperations(event storage.HookEvent, eventID string, raw json.RawMessage) []trace.FileOperation {
	input := toolInputDocument(event.Payload)
	toolName := value(event.ToolName)
	toolNameLower := strings.ToLower(toolName)
	toolInputText := toolInputText(event.Payload)
	patchText := toolInputText
	if value, ok := stringField(input, "patch", "patch_text", "diff"); ok {
		patchText = value
	}
	if strings.Contains(toolNameLower, "apply_patch") || strings.Contains(patchText, "*** Begin Patch") {
		operations := make([]trace.FileOperation, 0)
		for _, match := range applyPatchFilePattern.FindAllStringSubmatch(patchText, -1) {
			operation := "write"
			switch strings.ToLower(strings.TrimSpace(match[1])) {
			case "delete":
				operation = "delete"
			case "move to":
				operation = "modify"
			}
			operations = append(operations, newFileOperation(strings.TrimSpace(match[2]), operation, confidenceExplicit, event, eventID, raw))
		}
		if len(operations) > 0 {
			return operations
		}
	}

	paths := filePaths(input)
	command, hasCommand := stringField(input, "command", "cmd", "script")
	if len(paths) == 0 && hasCommand {
		seen := make(map[string]struct{}, len(paths))
		for _, path := range paths {
			seen[path] = struct{}{}
		}
		for _, match := range commandPathPattern.FindAllStringSubmatch(command, -1) {
			path := ""
			for _, candidate := range match[1:] {
				if candidate != "" {
					path = candidate
					break
				}
			}
			if path == "" {
				continue
			}
			if _, exists := seen[path]; exists {
				continue
			}
			seen[path] = struct{}{}
			paths = append(paths, path)
		}
	}
	if len(paths) == 0 {
		return nil
	}
	operation, confidence := classifyFileOperation(toolNameLower, input, command, hasCommand)
	operations := make([]trace.FileOperation, 0, len(paths))
	for _, path := range paths {
		operations = append(operations, newFileOperation(path, operation, confidence, event, eventID, raw))
	}
	return operations
}

func newFileOperation(path, operation, confidence string, event storage.HookEvent, eventID string, raw json.RawMessage) trace.FileOperation {
	return trace.FileOperation{
		Path:       path,
		Operation:  operation,
		EventID:    eventID,
		ToolUseID:  event.ToolUseID,
		ToolName:   value(event.ToolName),
		Confidence: confidence,
		OccurredAt: event.ReceivedAt.UTC(),
		Raw:        raw,
	}
}

func filePaths(input map[string]any) []string {
	paths := make([]string, 0, 2)
	seen := make(map[string]struct{})
	for _, key := range []string{"file_path", "path", "target_file", "filename", "file", "old_path", "new_path"} {
		if path, ok := stringField(input, key); ok {
			if _, exists := seen[path]; exists {
				continue
			}
			seen[path] = struct{}{}
			paths = append(paths, path)
		}
	}
	return paths
}

func classifyFileOperation(toolName string, input map[string]any, command string, hasCommand bool) (string, string) {
	if operation, ok := stringField(input, "operation", "action"); ok {
		switch strings.ToLower(operation) {
		case "read", "write", "modify", "delete":
			return strings.ToLower(operation), confidenceExplicit
		}
	}
	switch {
	case strings.Contains(toolName, "read"), strings.Contains(toolName, "cat"), strings.Contains(toolName, "get-content"), strings.Contains(toolName, "open"):
		return "read", confidenceExplicit
	case strings.Contains(toolName, "write"), strings.Contains(toolName, "create"), strings.Contains(toolName, "edit"), strings.Contains(toolName, "patch"):
		return "write", confidenceExplicit
	case strings.Contains(toolName, "delete"), strings.Contains(toolName, "remove"):
		return "delete", confidenceExplicit
	case hasCommand && shellDeletePattern.MatchString(command):
		return "delete", confidenceInferred
	case hasCommand && shellWritePattern.MatchString(command):
		return "write", confidenceInferred
	case hasCommand && shellReadPattern.MatchString(command):
		return "read", confidenceInferred
	default:
		return "ambiguous", confidenceAmbiguous
	}
}

func toolInputDocument(payload bson.Raw) map[string]any {
	return documentValue(payloadField(payload, "tool_input"))
}

func toolInputText(payload bson.Raw) string {
	value := payloadField(payload, "tool_input")
	if len(value) == 0 {
		return ""
	}
	var text string
	if err := json.Unmarshal(value, &text); err == nil {
		return text
	}
	return string(value)
}

func payloadDocument(payload bson.Raw) map[string]any {
	if len(payload) == 0 {
		return nil
	}
	var document bson.M
	if err := bson.Unmarshal(payload, &document); err != nil {
		return nil
	}
	return map[string]any(document)
}

func documentValue(raw json.RawMessage) map[string]any {
	if len(raw) == 0 {
		return nil
	}
	var document map[string]any
	if err := json.Unmarshal(raw, &document); err == nil && document != nil {
		return document
	}
	var text string
	if err := json.Unmarshal(raw, &text); err != nil {
		return nil
	}
	if err := json.Unmarshal([]byte(text), &document); err != nil {
		return nil
	}
	return document
}

func stringField(document map[string]any, keys ...string) (string, bool) {
	return nestedStringField(document, keys, 0)
}

func nestedStringField(document map[string]any, keys []string, depth int) (string, bool) {
	for actual, raw := range document {
		for _, key := range keys {
			if !strings.EqualFold(actual, key) {
				continue
			}
			value, ok := raw.(string)
			value = strings.TrimSpace(value)
			if ok && value != "" {
				return value, true
			}
		}
	}
	if depth >= 3 {
		return "", false
	}
	for _, key := range []string{"payload", "raw", "data", "event"} {
		nested, ok := nestedDocument(document[key])
		if !ok {
			continue
		}
		if value, ok := nestedStringField(nested, keys, depth+1); ok {
			return value, true
		}
	}
	return "", false
}

func nestedDocument(value any) (map[string]any, bool) {
	switch typed := value.(type) {
	case map[string]any:
		return typed, true
	case bson.M:
		return map[string]any(typed), true
	case string:
		var decoded map[string]any
		if err := json.Unmarshal([]byte(typed), &decoded); err == nil && decoded != nil {
			return decoded, true
		}
	}
	return nil, false
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
	if issue := payloadIssue(event.Payload); issue != "" {
		return issue
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
	if issue := payloadIssue(payload); issue != "" {
		return json.RawMessage(fmt.Sprintf(`{"error":%q}`, issue))
	}
	if len(payload) == 0 {
		return json.RawMessage(`{}`)
	}
	encoded, err := bson.MarshalExtJSON(payload, true, false)
	if err != nil {
		return json.RawMessage(`{}`)
	}
	return json.RawMessage(encoded)
}

func payloadIssue(payload bson.Raw) string {
	if len(payload) > maxReconstructionPayloadBytes {
		return "payload_too_large"
	}
	if len(payload) == 0 {
		return ""
	}
	var document bson.M
	if err := bson.Unmarshal(payload, &document); err != nil {
		return "malformed_payload"
	}
	return ""
}

func payloadField(payload bson.Raw, field string) json.RawMessage {
	if len(payload) == 0 {
		return nil
	}
	var document bson.M
	if err := bson.Unmarshal(payload, &document); err != nil {
		return nil
	}
	value, ok := nestedPayloadField(document, field, 0)
	if !ok {
		return nil
	}
	encoded, err := json.Marshal(value)
	if err != nil {
		return nil
	}
	return json.RawMessage(encoded)
}

func nestedPayloadField(document bson.M, field string, depth int) (any, bool) {
	if value, ok := document[field]; ok {
		return value, true
	}
	if depth >= 3 {
		return nil, false
	}
	for _, key := range []string{"payload", "raw", "data", "event"} {
		nested, ok := document[key]
		if !ok {
			continue
		}
		switch value := nested.(type) {
		case bson.M:
			if result, ok := nestedPayloadField(value, field, depth+1); ok {
				return result, true
			}
		case map[string]any:
			if result, ok := nestedPayloadField(bson.M(value), field, depth+1); ok {
				return result, true
			}
		case string:
			var decoded map[string]any
			if json.Unmarshal([]byte(value), &decoded) == nil && decoded != nil {
				if result, ok := nestedPayloadField(bson.M(decoded), field, depth+1); ok {
					return result, true
				}
			}
		}
	}
	return nil, false
}

func value(pointer *string) string {
	if pointer == nil {
		return ""
	}
	return *pointer
}

func runtimeMetadataFromPayload(payload bson.Raw, eventName string) trace.RuntimeMetadata {
	document := payloadDocument(payload)
	if document == nil {
		return trace.RuntimeMetadata{}
	}
	documents := runtimeMetadataDocuments(document)
	metadata := trace.RuntimeMetadata{
		Model:           firstStringField(documents, "model", "model_name", "modelName"),
		Provider:        firstStringField(documents, "provider", "model_provider", "modelProvider"),
		ReasoningEffort: firstStringField(documents, "reasoning_effort", "reasoningEffort", "effort"),
		Client:          firstStringField(documents, "client", "originator"),
		ClientVersion:   firstStringField(documents, "client_version", "clientVersion", "cli_version", "cliVersion"),
		Source:          firstStringField(documents, "source"),
		ThreadSource:    firstStringField(documents, "thread_source", "threadSource"),
	}
	metadata.ContextWindowTokens = firstInt64Field(documents, "context_window_tokens", "contextWindowTokens", "model_context_window", "modelContextWindow")
	if hasRuntimeMetadata(metadata) {
		metadata.RecordedFrom = eventName
	}
	return metadata
}

func runtimeMetadataDocuments(document map[string]any) []map[string]any {
	const maxDepth = 4
	containerKeys := []string{"metadata", "runtime", "runtime_metadata", "execution_settings", "session_meta", "turn_context", "task_started", "payload"}
	documents := make([]map[string]any, 0, 1)
	var visit func(map[string]any, int)
	visit = func(current map[string]any, depth int) {
		if current == nil || depth > maxDepth {
			return
		}
		documents = append(documents, current)
		for _, key := range containerKeys {
			raw, ok := mapValue(current, key)
			if !ok {
				continue
			}
			if nested, ok := runtimeMetadataDocumentValue(raw); ok {
				visit(nested, depth+1)
			}
		}
	}
	visit(document, 0)
	return documents
}

func mapValue(document map[string]any, key string) (any, bool) {
	for actual, value := range document {
		if strings.EqualFold(actual, key) {
			return value, true
		}
	}
	return nil, false
}

func runtimeMetadataDocumentValue(raw any) (map[string]any, bool) {
	switch value := raw.(type) {
	case map[string]any:
		return value, true
	case bson.M:
		return map[string]any(value), true
	case string:
		var document map[string]any
		if err := json.Unmarshal([]byte(value), &document); err == nil && document != nil {
			return document, true
		}
	}
	return nil, false
}

func firstStringField(documents []map[string]any, keys ...string) string {
	for _, document := range documents {
		if value, ok := stringField(document, keys...); ok {
			return value
		}
	}
	return ""
}

func firstInt64Field(documents []map[string]any, keys ...string) int64 {
	for _, document := range documents {
		for actual, raw := range document {
			matched := false
			for _, key := range keys {
				if strings.EqualFold(actual, key) {
					matched = true
					break
				}
			}
			if !matched {
				continue
			}
			switch value := raw.(type) {
			case int:
				return int64(value)
			case int32:
				return int64(value)
			case int64:
				return value
			case float32:
				return int64(value)
			case float64:
				return int64(value)
			case string:
				if parsed, err := strconv.ParseInt(strings.TrimSpace(value), 10, 64); err == nil {
					return parsed
				}
			}
		}
	}
	return 0
}

func hasRuntimeMetadata(metadata trace.RuntimeMetadata) bool {
	return metadata.Model != "" || metadata.Provider != "" || metadata.ReasoningEffort != "" || metadata.ContextWindowTokens != 0 || metadata.Client != "" || metadata.ClientVersion != "" || metadata.Source != "" || metadata.ThreadSource != ""
}

func mergeRuntimeMetadata(current, incoming trace.RuntimeMetadata) trace.RuntimeMetadata {
	if current.Model == "" {
		current.Model = incoming.Model
	}
	if current.Provider == "" {
		current.Provider = incoming.Provider
	}
	if current.ReasoningEffort == "" {
		current.ReasoningEffort = incoming.ReasoningEffort
	}
	if current.ContextWindowTokens == 0 {
		current.ContextWindowTokens = incoming.ContextWindowTokens
	}
	if current.Client == "" {
		current.Client = incoming.Client
	}
	if current.ClientVersion == "" {
		current.ClientVersion = incoming.ClientVersion
	}
	if current.Source == "" {
		current.Source = incoming.Source
	}
	if current.ThreadSource == "" {
		current.ThreadSource = incoming.ThreadSource
	}
	if incoming.RecordedFrom != "" && !strings.Contains(current.RecordedFrom, incoming.RecordedFrom) {
		if current.RecordedFrom == "" {
			current.RecordedFrom = incoming.RecordedFrom
		} else {
			current.RecordedFrom += " + " + incoming.RecordedFrom
		}
	}
	return current
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
