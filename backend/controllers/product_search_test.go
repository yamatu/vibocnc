package controllers

import "testing"

// The FULLTEXT path is opt-in, so the default must remain byte-for-byte the
// historical substring filter - otherwise enabling nothing would still change
// search results for existing deployments.
func TestProductSearchDefaultsToLike(t *testing.T) {
	t.Setenv("PRODUCT_SEARCH_MODE", "")
	if got := productSearchMode(); got != productSearchModeLike {
		t.Fatalf("expected default mode %q, got %q", productSearchModeLike, got)
	}

	condition, args := productSearchLikeFilter("A06B")
	if condition == "" {
		t.Fatal("expected a LIKE condition")
	}
	if len(args) != 5 {
		t.Fatalf("expected 5 args, got %d", len(args))
	}
	for _, a := range args {
		if a != "%A06B%" {
			t.Fatalf("expected leading-wildcard pattern, got %v", a)
		}
	}
}

func TestProductSearchModeOptIn(t *testing.T) {
	t.Setenv("PRODUCT_SEARCH_MODE", "FULLTEXT")
	if got := productSearchMode(); got != productSearchModeFulltext {
		t.Fatalf("expected fulltext mode, got %q", got)
	}
	t.Setenv("PRODUCT_SEARCH_MODE", "nonsense")
	if got := productSearchMode(); got != productSearchModeLike {
		t.Fatalf("unknown mode should fall back to like, got %q", got)
	}
}

func TestBuildBooleanFulltextQuery(t *testing.T) {
	cases := []struct {
		name  string
		input string
		want  string
	}{
		{"prefix per term", "fanuc servo", "+fanuc* +servo*"},
		{"part number with dash", "A06B-6079", "+A06B6079*"},
		{"strips boolean operators", "+fanuc -broken*", "+fanuc* +broken*"},
		{"too short falls back", "ab", ""},
		{"one short term falls back", "fanuc ab", ""},
		{"only operators", "+++", ""},
		{"empty", "   ", ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := buildBooleanFulltextQuery(tc.input); got != tc.want {
				t.Fatalf("buildBooleanFulltextQuery(%q) = %q, want %q", tc.input, got, tc.want)
			}
		})
	}
}

// A user-supplied boolean operator must never be able to reach the SQL string,
// because MySQL would interpret it as query syntax rather than a search term.
func TestBuildBooleanFulltextQueryIsInjectionSafe(t *testing.T) {
	// Any residual operator inside the expression must be one we added ('+'/'*').
	got := buildBooleanFulltextQuery(`")(*~` + "fanuc")
	if got != "+fanuc*" {
		t.Fatalf("operators leaked into the query: %q", got)
	}
}
