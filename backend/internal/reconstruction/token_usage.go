package reconstruction

import (
	"encoding/json"
	"math"
	"strconv"
	"strings"

	"github.com/azhry/nala-trace/backend/internal/trace"
	"go.mongodb.org/mongo-driver/bson"
)

const maxTokenUsageDepth = 6

type tokenUsageEvidence struct {
	usage      trace.TokenUsage
	cumulative bool
}

var tokenUsageContainerKeys = []string{
	"usage",
	"response",
	"tool_response",
	"output",
	"result",
	"payload",
	"raw",
	"data",
	"event",
}

func tokenUsageFromPayload(payload bson.Raw) *trace.TokenUsage {
	evidence, ok := tokenUsageEvidenceFromPayload(payload)
	if !ok {
		return nil
	}
	return &evidence.usage
}

func tokenUsageEvidenceFromPayload(payload bson.Raw) (tokenUsageEvidence, bool) {
	if len(payload) == 0 || len(payload) > maxReconstructionPayloadBytes {
		return tokenUsageEvidence{}, false
	}
	document := payloadDocument(payload)
	usage, ok := findTokenUsage(document, 0)
	if !ok {
		return tokenUsageEvidence{}, false
	}
	source, _ := mapValue(document, "usage_source")
	sourceName, _ := source.(string)
	return tokenUsageEvidence{usage: usage, cumulative: strings.EqualFold(strings.TrimSpace(sourceName), "codex_transcript")}, true
}

func findTokenUsage(document map[string]any, depth int) (trace.TokenUsage, bool) {
	if document == nil || depth > maxTokenUsageDepth {
		return trace.TokenUsage{}, false
	}
	if usage, ok := tokenUsageDocument(document); ok {
		return usage, true
	}
	for _, key := range tokenUsageContainerKeys {
		nestedValue, ok := mapValue(document, key)
		if !ok {
			continue
		}
		nested, ok := nestedDocument(nestedValue)
		if !ok {
			continue
		}
		if usage, ok := findTokenUsage(nested, depth+1); ok {
			return usage, true
		}
	}
	return trace.TokenUsage{}, false
}

func tokenUsageDocument(document map[string]any) (trace.TokenUsage, bool) {
	inputTokens, inputPresent := firstTokenCountField(document, "input_tokens", "prompt_tokens")
	outputTokens, outputPresent := firstTokenCountField(document, "output_tokens", "completion_tokens")
	cachedInputTokens, cachedPresent := firstTokenCountField(document, "cached_input_tokens", "cached_tokens")
	if !cachedPresent {
		cachedInputTokens, cachedPresent = nestedTokenCountField(document, "input_tokens_details", "cached_tokens")
	}
	if !cachedPresent {
		cachedInputTokens, cachedPresent = nestedTokenCountField(document, "prompt_tokens_details", "cached_tokens")
	}
	reasoningTokens, reasoningPresent := firstTokenCountField(document, "reasoning_tokens", "reasoning_output_tokens")
	if !reasoningPresent {
		reasoningTokens, reasoningPresent = nestedTokenCountField(document, "output_tokens_details", "reasoning_tokens")
	}
	if !reasoningPresent {
		reasoningTokens, reasoningPresent = nestedTokenCountField(document, "completion_tokens_details", "reasoning_tokens")
	}
	totalTokens, totalPresent := firstTokenCountField(document, "total_tokens")
	costUSD, costPresent := firstCostField(document, "cost_usd", "total_cost_usd")

	if !inputPresent && !cachedPresent && !outputPresent && !reasoningPresent && !totalPresent && !costPresent {
		return trace.TokenUsage{}, false
	}
	if !totalPresent {
		totalTokens = inputTokens + outputTokens
	}
	return trace.TokenUsage{
		InputTokens:       inputTokens,
		CachedInputTokens: cachedInputTokens,
		OutputTokens:      outputTokens,
		ReasoningTokens:   reasoningTokens,
		TotalTokens:       totalTokens,
		CostUSD:           costUSD,
		CostRecorded:      costPresent,
	}, true
}

func firstTokenCountField(document map[string]any, keys ...string) (int64, bool) {
	for _, key := range keys {
		value, ok := mapValue(document, key)
		if !ok {
			continue
		}
		if parsed, ok := tokenCount(value); ok {
			return parsed, true
		}
	}
	return 0, false
}

func nestedTokenCountField(document map[string]any, container, field string) (int64, bool) {
	nestedValue, ok := mapValue(document, container)
	if !ok {
		return 0, false
	}
	nested, ok := nestedDocument(nestedValue)
	if !ok {
		return 0, false
	}
	return firstTokenCountField(nested, field)
}

func firstCostField(document map[string]any, keys ...string) (float64, bool) {
	for _, key := range keys {
		value, ok := mapValue(document, key)
		if !ok {
			continue
		}
		if parsed, ok := costValue(value); ok {
			return parsed, true
		}
	}
	return 0, false
}

func tokenCount(value any) (int64, bool) {
	var parsed int64
	switch value := value.(type) {
	case int:
		parsed = int64(value)
	case int8:
		parsed = int64(value)
	case int16:
		parsed = int64(value)
	case int32:
		parsed = int64(value)
	case int64:
		parsed = value
	case uint:
		if uint64(value) > math.MaxInt64 {
			return 0, false
		}
		parsed = int64(value)
	case uint8:
		parsed = int64(value)
	case uint16:
		parsed = int64(value)
	case uint32:
		parsed = int64(value)
	case uint64:
		if value > math.MaxInt64 {
			return 0, false
		}
		parsed = int64(value)
	case float32:
		if !validInteger(float64(value)) {
			return 0, false
		}
		parsed = int64(value)
	case float64:
		if !validInteger(value) || value > math.MaxInt64 {
			return 0, false
		}
		parsed = int64(value)
	case json.Number:
		var err error
		parsed, err = strconv.ParseInt(string(value), 10, 64)
		if err != nil {
			return 0, false
		}
	case string:
		var err error
		parsed, err = strconv.ParseInt(strings.TrimSpace(value), 10, 64)
		if err != nil {
			return 0, false
		}
	default:
		return 0, false
	}
	if parsed < 0 {
		return 0, false
	}
	return parsed, true
}

func costValue(value any) (float64, bool) {
	var parsed float64
	switch value := value.(type) {
	case int:
		parsed = float64(value)
	case int8:
		parsed = float64(value)
	case int16:
		parsed = float64(value)
	case int32:
		parsed = float64(value)
	case int64:
		parsed = float64(value)
	case uint:
		parsed = float64(value)
	case uint8:
		parsed = float64(value)
	case uint16:
		parsed = float64(value)
	case uint32:
		parsed = float64(value)
	case uint64:
		parsed = float64(value)
	case float32:
		parsed = float64(value)
	case float64:
		parsed = value
	case json.Number:
		var err error
		parsed, err = strconv.ParseFloat(string(value), 64)
		if err != nil {
			return 0, false
		}
	case string:
		var err error
		parsed, err = strconv.ParseFloat(strings.TrimSpace(value), 64)
		if err != nil {
			return 0, false
		}
	default:
		return 0, false
	}
	if math.IsNaN(parsed) || math.IsInf(parsed, 0) || parsed < 0 {
		return 0, false
	}
	return parsed, true
}

func validInteger(value float64) bool {
	return !math.IsNaN(value) && !math.IsInf(value, 0) && value >= 0 && math.Trunc(value) == value
}
