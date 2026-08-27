package reconstruction

import (
	"math"
	"testing"
	"time"

	"github.com/azhry/nala-trace/backend/internal/storage"
	"github.com/azhry/nala-trace/backend/internal/trace"
)

func TestReconstructTokenUsageFromNestedProviderResponses(t *testing.T) {
	base := time.Date(2026, 8, 22, 10, 0, 0, 0, time.UTC)
	result := Reconstruct("session-1", "user-1", []storage.HookEvent{
		hookEvent("derived", "Stop", "turn-1", base.Add(time.Second), map[string]any{
			"tool_response": map[string]any{
				"input_tokens":     3,
				"cached_tokens":    1,
				"output_tokens":    4,
				"reasoning_tokens": 2,
				"total_cost_usd":   0.0003,
			},
		}),
		hookEvent("explicit", "Stop", "turn-1", base, map[string]any{
			"response": map[string]any{
				"usage": map[string]any{
					"input_tokens": 100,
					"input_tokens_details": map[string]any{
						"cached_tokens": 20,
					},
					"output_tokens": 40,
					"output_tokens_details": map[string]any{
						"reasoning_tokens": 5,
					},
					"total_tokens": 140,
					"cost_usd":     0.0012,
				},
			},
		}),
		hookEvent("without-usage", "UserPromptSubmit", "turn-1", base.Add(2*time.Second), map[string]any{
			"prompt": "continue",
		}),
	})

	if len(result.Timeline) != 3 {
		t.Fatalf("timeline length = %d, want 3", len(result.Timeline))
	}
	assertTokenUsage(t, result.Timeline[0].TokenUsage, trace.TokenUsage{
		InputTokens: 100, CachedInputTokens: 20, OutputTokens: 40, ReasoningTokens: 5, TotalTokens: 140, CostUSD: 0.0012,
	})
	assertTokenUsage(t, result.Timeline[1].TokenUsage, trace.TokenUsage{
		InputTokens: 3, CachedInputTokens: 1, OutputTokens: 4, ReasoningTokens: 2, TotalTokens: 7, CostUSD: 0.0003,
	})
	if result.Timeline[2].TokenUsage != nil {
		t.Fatalf("usage on event without usage = %#v, want nil", result.Timeline[2].TokenUsage)
	}
	assertTokenUsage(t, &result.Summary.TokenUsage, trace.TokenUsage{
		InputTokens: 103, CachedInputTokens: 21, OutputTokens: 44, ReasoningTokens: 7, TotalTokens: 147, CostUSD: 0.0015,
	})
}

func TestReconstructTokenUsageSupportsAliasesAndIgnoresInvalidCost(t *testing.T) {
	result := Reconstruct("session-1", "user-1", []storage.HookEvent{
		hookEvent("aliases", "Stop", "turn-1", time.Date(2026, 8, 22, 10, 0, 0, 0, time.UTC), map[string]any{
			"usage": map[string]any{
				"prompt_tokens":     "8",
				"cached_tokens":     "1",
				"completion_tokens": "2",
				"reasoning_tokens":  "3",
				"total_tokens":      "10",
				"cost_usd":          "not-a-number",
			},
		}),
	})

	assertTokenUsage(t, result.Timeline[0].TokenUsage, trace.TokenUsage{
		InputTokens: 8, CachedInputTokens: 1, OutputTokens: 2, ReasoningTokens: 3, TotalTokens: 10,
	})
	if result.Summary.TokenUsage.CostUSD != 0 {
		t.Fatalf("invalid cost = %v, want 0", result.Summary.TokenUsage.CostUSD)
	}
}

func assertTokenUsage(t *testing.T, got *trace.TokenUsage, want trace.TokenUsage) {
	t.Helper()
	if got == nil {
		t.Fatalf("token usage = nil, want %#v", want)
	}
	if got.InputTokens != want.InputTokens || got.CachedInputTokens != want.CachedInputTokens || got.OutputTokens != want.OutputTokens || got.ReasoningTokens != want.ReasoningTokens || got.TotalTokens != want.TotalTokens || math.Abs(got.CostUSD-want.CostUSD) > 1e-9 {
		t.Fatalf("token usage = %#v, want %#v", *got, want)
	}
}
