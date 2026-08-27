package trace

import (
	"encoding/json"
	"testing"
)

func TestTokenUsageJSONOmitsUnreportedCost(t *testing.T) {
	withoutCost, err := json.Marshal(TokenUsage{InputTokens: 10, TotalTokens: 10})
	if err != nil {
		t.Fatalf("marshal usage without cost: %v", err)
	}
	var withoutCostFields map[string]any
	if err := json.Unmarshal(withoutCost, &withoutCostFields); err != nil {
		t.Fatalf("decode usage without cost: %v", err)
	}
	if _, ok := withoutCostFields["cost_usd"]; ok {
		t.Fatalf("unreported cost = %#v, want omitted", withoutCostFields["cost_usd"])
	}

	withExplicitZero, err := json.Marshal(TokenUsage{InputTokens: 10, TotalTokens: 10, CostRecorded: true})
	if err != nil {
		t.Fatalf("marshal usage with explicit zero cost: %v", err)
	}
	var withExplicitZeroFields map[string]any
	if err := json.Unmarshal(withExplicitZero, &withExplicitZeroFields); err != nil {
		t.Fatalf("decode usage with explicit zero cost: %v", err)
	}
	if got, ok := withExplicitZeroFields["cost_usd"]; !ok || got != float64(0) {
		t.Fatalf("explicit zero cost = %#v, want 0", withExplicitZeroFields["cost_usd"])
	}
}
