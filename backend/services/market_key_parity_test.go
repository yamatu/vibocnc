package services

import "testing"

// MarketModelKey is a cross-language contract: the Python crawler computes the
// same key in ebay_scraper.model_matcher.normalize_model, and a scraped model
// only resolves to a catalogue product when both sides agree byte for byte.
//
// The expected values below were produced by running that Python function. If
// this test fails, the crawler and the backend have drifted and market quotes
// will silently stop matching products — fix both sides together.
func TestMarketModelKeyParityWithCrawler(t *testing.T) {
	cases := map[string]string{
		"A06B-6077-H106":     "A06B6077H106", // hyphenated part number
		"a06b 6077 h106":     "A06B6077H106", // lowercase + spaces
		"A06B-6077-H106-OEM": "A06B6077H106", // trailing OEM marker
		"  Series 0i-MF  ":   "SERIES0IMF",   // padded, mixed alphanumerics
		"MR-J4-70A":          "MRJ470A",      // Mitsubishi drive
		"":                   "",
	}
	for input, want := range cases {
		if got := MarketModelKey(input); got != want {
			t.Errorf("MarketModelKey(%q) = %q, want %q (see model_matcher.normalize_model)", input, got, want)
		}
	}
}

// MarketQuoteMatchKey prefixes the brand so the same model sold under two
// manufacturers stays distinct, while an unknown brand still matches on the
// bare model key.
func TestMarketQuoteMatchKeyShape(t *testing.T) {
	if got, want := MarketQuoteMatchKey("FANUC", "A06B-6077-H106"), "fanuc|A06B6077H106"; got != want {
		t.Errorf("got %q, want %q", got, want)
	}
	if got, want := MarketQuoteMatchKey("", "A06B-6077-H106"), "A06B6077H106"; got != want {
		t.Errorf("brand-less key: got %q, want %q", got, want)
	}
}
