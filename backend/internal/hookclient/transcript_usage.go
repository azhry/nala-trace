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

// enrichWithTranscriptUsage is deliberately best effort. Hook delivery must
// still work when the producer removes, rotates, or cannot read its transcript.
func enrichWithTranscriptUsage(ctx context.Context, payload []byte) []byte {
	var object map[string]json.RawMessage
	if err := json.Unmarshal(payload, &object); err != nil || object == nil {
		return payload
	}
	hookEventName, ok := rawString(object, "hook_event_name")
	if !ok || (hookEventName != "Stop" && hookEventName != "SubagentStop") {
		return payload
	}
	if containsUsageEvidence(object, 0) {
		return payload
	}
	transcriptPath, ok := rawString(object, "transcript_path")
	if !ok {
		return payload
	}
	usage, ok := latestTranscriptUsage(ctx, transcriptPath)
	if !ok {
		return payload
	}
	encodedUsage, err := json.Marshal(usage)
	if err != nil {
		return payload
	}
	object["usage"] = encodedUsage
	object["usage_source"] = json.RawMessage(`"codex_transcript"`)
	object["usage_scope"] = json.RawMessage(`"session_cumulative"`)
	enriched, err := json.Marshal(object)
	if err != nil {
		return payload
	}
	return enriched
}

func latestTranscriptUsage(ctx context.Context, path string) (map[string]int64, bool) {
	file, err := os.Open(path)
	if err != nil {
		return nil, false
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil || info.Size() < 0 || info.Size() > maxTranscriptBytes {
		return nil, false
	}

	scanner := bufio.NewScanner(file)
	scanner.Buffer(make([]byte, 64<<10), maxTranscriptLineBytes)
	var latest map[string]int64
	for scanner.Scan() {
		select {
		case <-ctx.Done():
			return nil, false
		default:
		}
		var record map[string]json.RawMessage
		if err := json.Unmarshal(scanner.Bytes(), &record); err != nil {
			continue
		}
		if value, ok := rawString(record, "type"); !ok || value != "event_msg" {
			continue
		}
		payload, ok := rawObject(record, "payload")
		if !ok {
			continue
		}
		if value, ok := rawString(payload, "type"); !ok || value != "token_count" {
			continue
		}
		info, ok := rawObject(payload, "info")
		if !ok {
			continue
		}
		cumulative, ok := rawObject(info, "total_token_usage")
		if !ok {
			continue
		}
		if usage, ok := normalizedTranscriptUsage(cumulative); ok {
			latest = usage
		}
	}
	if scanner.Err() != nil || latest == nil {
		return nil, false
	}
	return latest, true
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
	case "input_tokens", "prompt_tokens", "cached_input_tokens", "cached_tokens", "output_tokens", "completion_tokens", "reasoning_tokens", "reasoning_output_tokens", "total_tokens", "cost_usd", "total_cost_usd":
		return true
	default:
		return false
	}
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

func rawJSONDocument(value json.RawMessage) (map[string]json.RawMessage, bool) {
	var document map[string]json.RawMessage
	if err := json.Unmarshal(value, &document); err != nil || document == nil {
		return nil, false
	}
	return document, true
}
