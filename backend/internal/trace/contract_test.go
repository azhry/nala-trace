package trace

import (
	"encoding/json"
	"testing"
)

func TestTokenUsageJSONIncludesTokenCountsOnly(t *testing.T) {
	encoded, err := json.Marshal(TokenUsage{InputTokens: 10, CachedInputTokens: 2, OutputTokens: 4, ReasoningTokens: 1, TotalTokens: 14})
	if err != nil {
		t.Fatalf("marshal token usage: %v", err)
	}
	var fields map[string]any
	if err := json.Unmarshal(encoded, &fields); err != nil {
		t.Fatalf("decode token usage: %v", err)
	}
	if fields["input_tokens"] != float64(10) || fields["cached_input_tokens"] != float64(2) || fields["output_tokens"] != float64(4) || fields["reasoning_tokens"] != float64(1) || fields["total_tokens"] != float64(14) {
		t.Fatalf("token usage = %#v, want all token counts", fields)
	}
	if _, ok := fields["cost_usd"]; ok {
		t.Fatalf("token usage unexpectedly contains cost = %#v", fields["cost_usd"])
	}
}
