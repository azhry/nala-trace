package hookclient

import (
	"bufio"
	"context"
	"encoding/json"
	"os"
	"strings"
)

const (
	maxTranscriptBytes     int64 = 64 << 20
	maxTranscriptLineBytes       = 4 << 20
)

// enrichWithTranscriptMetadata is deliberately best effort. Hook delivery
// must still work when the producer removes, rotates, or cannot read its
// transcript.
func enrichWithTranscriptMetadata(ctx context.Context, payload []byte) []byte {
	var object map[string]json.RawMessage
	if err := json.Unmarshal(payload, &object); err != nil || object == nil {
		return payload
	}
	hookEventName, ok := rawString(object, "hook_event_name")
	if !ok {
		return payload
	}
	terminalEvent := hookEventName == "Stop" || hookEventName == "SubagentStop"
	if !terminalEvent && !capturesReasoningEffort(hookEventName) {
		return payload
	}
	transcriptPath, ok := rawString(object, "transcript_path")
	if !ok {
		return payload
	}
	metadata, ok := latestTranscriptMetadata(ctx, transcriptPath)
	if !ok {
		return payload
	}
	changed := false
	if terminalEvent && !containsUsageEvidence(object, 0) && metadata.usage != nil {
		encodedUsage, err := json.Marshal(metadata.usage)
		if err != nil {
			return payload
		}
		object["usage"] = encodedUsage
		object["usage_source"] = json.RawMessage(`"codex_transcript"`)
		object["usage_scope"] = json.RawMessage(`"session_cumulative"`)
		changed = true
	}
	if metadata.reasoningEffort != "" && !hasRuntimeReasoningEffort(object) {
		runtimeMetadata, _ := rawObjectField(object, "runtime_metadata")
		if runtimeMetadata == nil {
			runtimeMetadata = make(map[string]json.RawMessage)
		}
		reasoningEffort, err := json.Marshal(metadata.reasoningEffort)
		if err != nil {
			return payload
		}
		runtimeMetadata["reasoning_effort"] = reasoningEffort
		enrichedMetadata, err := json.Marshal(runtimeMetadata)
		if err != nil {
			return payload
		}
		object["runtime_metadata"] = enrichedMetadata
		changed = true
	}
	if !changed {
		return payload
	}
	enriched, err := json.Marshal(object)
	if err != nil {
		return payload
	}
	return enriched
}

func capturesReasoningEffort(hookEventName string) bool {
	switch hookEventName {
	case "SessionStart", "UserPromptSubmit", "SubagentStart", "PreCompact", "PostCompact":
		return true
	default:
		return false
	}
}

type transcriptMetadata struct {
	usage           map[string]int64
	reasoningEffort string
}

func latestTranscriptUsage(ctx context.Context, path string) (map[string]int64, bool) {
	metadata, ok := latestTranscriptMetadata(ctx, path)
	if !ok || metadata.usage == nil {
		return nil, false
	}
	return metadata.usage, true
}

func latestTranscriptMetadata(ctx context.Context, path string) (transcriptMetadata, bool) {
	file, err := os.Open(path)
	if err != nil {
		return transcriptMetadata{}, false
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil || info.Size() < 0 || info.Size() > maxTranscriptBytes {
		return transcriptMetadata{}, false
	}

	scanner := bufio.NewScanner(file)
	scanner.Buffer(make([]byte, 64<<10), maxTranscriptLineBytes)
	metadata := transcriptMetadata{}
	for scanner.Scan() {
		select {
		case <-ctx.Done():
			return transcriptMetadata{}, false
		default:
		}
		var record map[string]json.RawMessage
		if err := json.Unmarshal(scanner.Bytes(), &record); err != nil {
			continue
		}
		recordType, ok := rawString(record, "type")
		if !ok {
			continue
		}
		payload, ok := rawObject(record, "payload")
		if !ok {
			continue
		}
		switch recordType {
		case "event_msg":
			payloadType, ok := rawString(payload, "type")
			if !ok {
				continue
			}
			if payloadType == "token_count" {
				info, ok := rawObject(payload, "info")
				if !ok {
					continue
				}
				cumulative, ok := rawObject(info, "total_token_usage")
				if !ok {
					continue
				}
				if usage, ok := normalizedTranscriptUsage(cumulative); ok {
					metadata.usage = usage
				}
			}
			if payloadType == "thread_settings_applied" {
				if effort := transcriptReasoningEffort(payload); effort != "" {
					metadata.reasoningEffort = effort
				}
			}
		case "turn_context":
			if effort := transcriptReasoningEffort(payload); effort != "" {
				metadata.reasoningEffort = effort
			}
		}
	}
	if scanner.Err() != nil || (metadata.usage == nil && metadata.reasoningEffort == "") {
		return transcriptMetadata{}, false
	}
	return metadata, true
}

func transcriptReasoningEffort(payload map[string]json.RawMessage) string {
	if value := firstRawStringField(payload, "reasoning_effort", "reasoningEffort", "effort"); value != "" {
		return value
	}
	threadSettings, ok := rawObjectField(payload, "thread_settings")
	if !ok {
		return ""
	}
	return firstRawStringField(threadSettings, "reasoning_effort", "reasoningEffort", "effort")
}

func normalizedTranscriptUsage(document map[string]json.RawMessage) (map[string]int64, bool) {
	fields := []struct {
		source string
		target string
	}{
		{source: "input_tokens", target: "input_tokens"},
		{source: "cached_input_tokens", target: "cached_input_tokens"},
		{source: "output_tokens", target: "output_tokens"},
		{source: "reasoning_output_tokens", target: "reasoning_tokens"},
		{source: "total_tokens", target: "total_tokens"},
	}
	usage := make(map[string]int64, len(fields))
	for _, field := range fields {
		value, ok := document[field.source]
		if !ok {
			continue
		}
		var count int64
		if err := json.Unmarshal(value, &count); err != nil || count < 0 {
			continue
		}
		usage[field.target] = count
	}
	return usage, len(usage) > 0
}

func containsUsageEvidence(value any, depth int) bool {
	if depth > 8 {
		return false
	}
	switch typed := value.(type) {
	case map[string]json.RawMessage:
		for key, raw := range typed {
			if strings.EqualFold(key, "usage") {
				if document, ok := rawJSONDocument(raw); ok && containsTokenField(document) {
					return true
				}
			}
			if document, ok := rawJSONDocument(raw); ok && containsUsageEvidence(document, depth+1) {
				return true
			}
			var list []json.RawMessage
			if json.Unmarshal(raw, &list) == nil {
				for _, item := range list {
					if containsUsageEvidence(item, depth+1) {
						return true
					}
				}
			}
		}
	case map[string]any:
		for key, nested := range typed {
			if strings.EqualFold(key, "usage") {
				if document, ok := nested.(map[string]any); ok && containsTokenFieldAny(document) {
					return true
				}
			}
			if containsUsageEvidence(nested, depth+1) {
				return true
			}
		}
	}
	return false
}

func containsTokenField(document map[string]json.RawMessage) bool {
	for key := range document {
		if isTokenUsageField(key) {
			return true
		}
	}
	return false
}

func containsTokenFieldAny(document map[string]any) bool {
	for key := range document {
		if isTokenUsageField(key) {
			return true
		}
	}
	return false
}

func isTokenUsageField(key string) bool {
	switch strings.ToLower(key) {
	case "input_tokens", "prompt_tokens", "cached_input_tokens", "cached_tokens", "output_tokens", "completion_tokens", "reasoning_tokens", "reasoning_output_tokens", "total_tokens":
		return true
	default:
		return false
	}
}

func hasRuntimeReasoningEffort(document map[string]json.RawMessage) bool {
	const maxDepth = 4
	containerKeys := []string{"metadata", "runtime", "runtime_metadata", "execution_settings", "session_meta", "turn_context", "task_started", "payload"}
	var visit func(map[string]json.RawMessage, int) bool
	visit = func(current map[string]json.RawMessage, depth int) bool {
		if current == nil || depth > maxDepth {
			return false
		}
		if firstRawStringField(current, "reasoning_effort", "reasoningEffort", "effort") != "" {
			return true
		}
		for _, key := range containerKeys {
			nested, ok := rawObjectField(current, key)
			if ok && visit(nested, depth+1) {
				return true
			}
		}
		return false
	}
	return visit(document, 0)
}

func firstRawStringField(document map[string]json.RawMessage, keys ...string) string {
	for _, key := range keys {
		for actual, raw := range document {
			if strings.EqualFold(actual, key) {
				var value string
				if err := json.Unmarshal(raw, &value); err != nil {
					continue
				}
				value = strings.TrimSpace(value)
				if value != "" {
					return value
				}
			}
		}
	}
	return ""
}

func rawString(document map[string]json.RawMessage, key string) (string, bool) {
	value, ok := document[key]
	if !ok {
		return "", false
	}
	var decoded string
	if err := json.Unmarshal(value, &decoded); err != nil {
		return "", false
	}
	decoded = strings.TrimSpace(decoded)
	return decoded, decoded != ""
}

func rawObject(document map[string]json.RawMessage, key string) (map[string]json.RawMessage, bool) {
	value, ok := document[key]
	if !ok {
		return nil, false
	}
	return rawJSONDocument(value)
}

func rawObjectField(document map[string]json.RawMessage, key string) (map[string]json.RawMessage, bool) {
	for actual, value := range document {
		if strings.EqualFold(actual, key) {
			return rawJSONDocument(value)
		}
	}
	return nil, false
}

func rawJSONDocument(value json.RawMessage) (map[string]json.RawMessage, bool) {
	var document map[string]json.RawMessage
	if err := json.Unmarshal(value, &document); err != nil || document == nil {
		return nil, false
	}
	return document, true
}
