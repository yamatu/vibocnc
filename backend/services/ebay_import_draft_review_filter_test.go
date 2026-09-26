package services

import "testing"

// TestEbayDraftReviewStatusClause pins the three review-status filter cases.
//
// The `unreviewed` case is the one worth locking down: an untouched draft has no
// stored state, so an equality comparison against "unreviewed" would match zero
// rows and the "not yet reviewed" filter would look like the queue is empty
// rather than broken.
func TestEbayDraftReviewStatusClause(t *testing.T) {
	tests := []struct {
		name       string
		input      string
		wantOK     bool
		wantClause string
		wantArgs   int
	}{
		{
			name:   "empty filter adds no condition",
			input:  "",
			wantOK: false,
		},
		{
			name:   "whitespace only filter adds no condition",
			input:  "   ",
			wantOK: false,
		},
		{
			name:       "unreviewed matches null or empty",
			input:      "unreviewed",
			wantOK:     true,
			wantClause: "ai_review_status IS NULL OR ai_review_status = ''",
			wantArgs:   0,
		},
		{
			name:       "concrete state uses an equality with one argument",
			input:      "ready",
			wantOK:     true,
			wantClause: "ai_review_status = ?",
			wantArgs:   1,
		},
		{
			name:       "surrounding whitespace is trimmed before comparison",
			input:      "  failed  ",
			wantOK:     true,
			wantClause: "ai_review_status = ?",
			wantArgs:   1,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			clause, args, ok := EbayDraftReviewStatusClause(tc.input)
			if ok != tc.wantOK {
				t.Fatalf("ok = %v, want %v", ok, tc.wantOK)
			}
			if !ok {
				if clause != "" || args != nil {
					t.Fatalf("inactive filter must return no clause, got %q / %v", clause, args)
				}
				return
			}
			if clause != tc.wantClause {
				t.Fatalf("clause = %q, want %q", clause, tc.wantClause)
			}
			if len(args) != tc.wantArgs {
				t.Fatalf("args = %v, want %d argument(s)", args, tc.wantArgs)
			}
			// The trimmed value must reach the query, otherwise
			// "  ready  " would filter on a value that can never be stored.
			if tc.wantArgs == 1 {
				got, _ := args[0].(string)
				if got != "failed" && got != "ready" {
					t.Fatalf("arg = %q, want the trimmed filter value", got)
				}
			}
		})
	}
}

// TestMaxEbayImportDraftPageSizeMatchesUIOptions guards the contract between the
// server-side page cap and the sizes the admin list offers. A mismatch means the
// UI asks for a page the server silently shrinks, which is exactly the bug that
// made the page-size selector appear to do nothing.
func TestMaxEbayImportDraftPageSizeMatchesUIOptions(t *testing.T) {
	if MaxEbayImportDraftPageSize < 200 {
		t.Fatalf("MaxEbayImportDraftPageSize = %d, want at least 200", MaxEbayImportDraftPageSize)
	}
}
