package services

import (
	"testing"

	"fanuc-backend/models"
)

func TestMarketQuoteMatchKeyNormalizesSeparators(t *testing.T) {
	cases := []struct {
		brand    string
		model    string
		expected string
	}{
		{"FANUC", "A06B-6077-H106", "fanuc|A06B6077H106"},
		{"fanuc", "a06b 6077 h106", "fanuc|A06B6077H106"},
		{"", "A06B-6077-H106", "A06B6077H106"},
	}
	for _, testCase := range cases {
		got := MarketQuoteMatchKey(testCase.brand, testCase.model)
		if got != testCase.expected {
			t.Errorf("MarketQuoteMatchKey(%q, %q) = %q, want %q",
				testCase.brand, testCase.model, got, testCase.expected)
		}
	}
}

func TestPriceDeltaPercent(t *testing.T) {
	cases := []struct {
		current   float64
		suggested float64
		expected  float64
	}{
		{100, 150, 50},
		{100, 50, -50},
		{100, 100, 0},
		{0, 100, 0},
	}
	for _, testCase := range cases {
		got := PriceDeltaPercent(testCase.current, testCase.suggested)
		if got != testCase.expected {
			t.Errorf("PriceDeltaPercent(%v, %v) = %v, want %v",
				testCase.current, testCase.suggested, got, testCase.expected)
		}
	}
}

func TestPriceSuggestionStatusThresholds(t *testing.T) {
	policy := models.CommercePolicySetting{
		PriceSyncMinSamples:  3,
		PriceSyncMaxDeltaPct: 50,
	}
	cases := []struct {
		name     string
		delta    float64
		matched  int
		expected string
	}{
		{"thin", 10, 2, "insufficient_samples"},
		{"too big up", 80, 10, "needs_manual_review"},
		{"too big down", -80, 10, "needs_manual_review"},
		{"tiny", 0.1, 10, "unchanged"},
		{"ready", 12, 10, "ready"},
	}
	for _, testCase := range cases {
		got := PriceSuggestionStatus(testCase.delta, policy, testCase.matched)
		if got != testCase.expected {
			t.Errorf("%s: got %q, want %q", testCase.name, got, testCase.expected)
		}
	}
}

func TestSuggestPriceFromQuoteRespectsPolicy(t *testing.T) {
	quote := &models.EbayMarketQuote{
		MedianPrice:  100,
		MatchedCount: 10,
	}

	// Suggestions are opt-in: disabled by default.
	got := SuggestPriceFromQuote(nil, quote)
	if got != nil {
		t.Fatalf("expected no suggestion while price sync is disabled, got %v", *got)
	}
}

func TestIsMarketConditionPriceable(t *testing.T) {
	cases := map[string]bool{
		"":                      true,
		"New":                   true,
		"Used":                  true,
		"For parts or not working": false,
		"Not working":           false,
	}
	for input, expected := range cases {
		if got := IsMarketConditionPriceable(input); got != expected {
			t.Errorf("IsMarketConditionPriceable(%q) = %v, want %v", input, got, expected)
		}
	}
}
