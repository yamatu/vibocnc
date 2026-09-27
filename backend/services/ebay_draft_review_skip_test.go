package services

import (
	"strings"
	"testing"

	"fanuc-backend/models"
)

// TestEbayReviewSkipReasonTextCoversEveryPreflightReason keeps the reason table
// and the preflight in step. A reason added to EbayDraftPreflight without a
// matching entry here would reach the administrator as a raw code, which is the
// class of unactionable message this reporting exists to remove.
func TestEbayReviewSkipReasonTextCoversEveryPreflightReason(t *testing.T) {
	cases := []struct {
		name  string
		draft models.EbayImportDraft
		want  string
	}{
		{
			name:  "already imported",
			draft: models.EbayImportDraft{Status: EbayDraftStatusImported, NormalizedModel: "A06B-6079-H208", TitleRaw: "FANUC A06B-6079-H208"},
			want:  "already_processed",
		},
		{
			name:  "already skipped",
			draft: models.EbayImportDraft{Status: EbayDraftStatusSkipped, NormalizedModel: "A06B-6079-H208", TitleRaw: "FANUC A06B-6079-H208"},
			want:  "already_processed",
		},
		{
			name:  "no identifier",
			draft: models.EbayImportDraft{Status: EbayDraftStatusPending, TitleRaw: "FANUC servo amplifier tested"},
			want:  "missing_identifier",
		},
		{
			name:  "identifier but no title",
			draft: models.EbayImportDraft{Status: EbayDraftStatusPending, NormalizedModel: "A06B-6079-H208"},
			want:  "missing_title",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			reason, ok := EbayDraftPreflight(tc.draft)
			if ok {
				t.Fatalf("EbayDraftPreflight() accepted a draft that should be rejected")
			}
			if reason != tc.want {
				t.Fatalf("EbayDraftPreflight() reason = %q, want %q", reason, tc.want)
			}
			if !knownEbayReviewSkipReason(reason) {
				t.Fatalf("reason %q is not in EbayReviewSkipReasons, so it would surface as a raw code", reason)
			}
			if EbayReviewSkipReasonText(reason) == reason {
				t.Fatalf("reason %q has no human-readable text", reason)
			}
		})
	}

	// And a usable draft must still pass, or the reporting above would describe
	// a pipeline that rejects everything.
	usable := models.EbayImportDraft{
		Status:          EbayDraftStatusPending,
		NormalizedModel: "A06B-6079-H208",
		TitleRaw:        "FANUC A06B-6079-H208 Servo Amplifier",
	}
	if reason, ok := EbayDraftPreflight(usable); !ok {
		t.Fatalf("EbayDraftPreflight() rejected a reviewable draft: %q", reason)
	}
}

func knownEbayReviewSkipReason(reason string) bool {
	for _, candidate := range EbayReviewSkipReasons {
		if candidate == reason {
			return true
		}
	}
	return false
}

// TestSkipCountsExcludeRecoveredFromFailureSummary keeps a rescue out of the
// refusal text: "91 drafts refused (model recovered from title: 91)" would read
// as a contradiction.
func TestSkipCountsExcludeRecoveredFromFailureSummary(t *testing.T) {
	counts := EbayReviewSkipCounts{
		"missing_identifier":      2,
		EbayReviewRecoveredReason: 91,
	}
	summary := counts.Summary()
	if strings.Contains(summary, EbayReviewRecoveredReason) || strings.Contains(summary, "recovered") {
		t.Fatalf("Summary() = %q, a recovery must not appear as a refusal reason", summary)
	}
	if !strings.Contains(summary, "no model or part number: 2") {
		t.Fatalf("Summary() = %q, want the real refusal", summary)
	}
	if got := counts.RecoveredSummary(); !strings.Contains(got, "91") {
		t.Fatalf("RecoveredSummary() = %q, want it to report 91", got)
	}

	// And with no rescue there is nothing to announce.
	if got := (EbayReviewSkipCounts{"missing_identifier": 1}).RecoveredSummary(); got != "" {
		t.Fatalf("RecoveredSummary() = %q, want empty", got)
	}
}

// TestSkipSamplesShowRealTitles is the diagnostic that turns "91 drafts were
// refused" into "here is what their titles look like".
func TestSkipSamplesShowRealTitles(t *testing.T) {
	samples := EbayReviewSkipSamples{}
	for i := 0; i < 50; i++ {
		samples.note("missing_identifier", "Title number 1")
	}
	if got := len(samples["missing_identifier"]); got != EbayReviewSkipSampleLimit {
		t.Fatalf("collected %d samples, want the limit of %d", got, EbayReviewSkipSampleLimit)
	}

	// A missing title carries no information and must not occupy a slot.
	samples.note("missing_identifier", "")
	samples.note("missing_identifier", "   ")
	block := samples.SamplesBlock()
	if strings.Contains(block, "|  |") {
		t.Fatalf("SamplesBlock() = %q, must not contain an empty sample", block)
	}
	if !strings.Contains(block, "no model or part number") {
		t.Fatalf("SamplesBlock() = %q, want the human reason label", block)
	}

	if got := (EbayReviewSkipSamples{}).SamplesBlock(); got != "" {
		t.Fatalf("SamplesBlock() = %q, want empty for no samples", got)
	}
}

func TestEbayReviewSkipCountsSummary(t *testing.T) {
	cases := []struct {
		name    string
		counts  EbayReviewSkipCounts
		want    string
		present []string
	}{
		{
			name:    "single reason",
			counts:  EbayReviewSkipCounts{"missing_identifier": 4900},
			want:    "no model or part number: 4900",
			present: []string{"no model or part number: 4900"},
		},
		{
			name:   "stable order regardless of map order",
			counts: EbayReviewSkipCounts{"already_processed": 1, "missing_title": 2, "missing_identifier": 3},
			want:   "no model or part number: 3, no title: 2, already imported or skipped: 1",
		},
		{
			name:   "zero and negative counts are not reported",
			counts: EbayReviewSkipCounts{"missing_identifier": 0, "missing_title": -2},
			want:   "",
		},
		{
			name:    "unknown reason is still reported, sorted after the known ones",
			counts:  EbayReviewSkipCounts{"missing_identifier": 1, "quantum_flux": 7},
			present: []string{"no model or part number: 1", "quantum_flux: 7"},
		},
		{
			name:   "empty",
			counts: EbayReviewSkipCounts{},
			want:   "",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := tc.counts.Summary()
			for _, part := range tc.present {
				if !strings.Contains(got, part) {
					t.Fatalf("Summary() = %q, want it to contain %q", got, part)
				}
			}
			if len(tc.present) > 0 {
				return
			}
			if got != tc.want {
				t.Fatalf("Summary() = %q, want %q", got, tc.want)
			}
		})
	}
}

// TestEbayNoReviewableDraftsErrorExplainsWhy is the regression guard for the
// bare "no reviewable drafts were selected" that made the 409 unactionable.
func TestEbayNoReviewableDraftsErrorExplainsWhy(t *testing.T) {
	err := &EbayNoReviewableDraftsError{
		Selected: 5000,
		Skipped:  EbayReviewSkipCounts{"missing_identifier": 4980, "missing_title": 20},
	}
	message := err.Error()
	for _, want := range []string{"5000", "no model or part number: 4980", "no title: 20"} {
		if !strings.Contains(message, want) {
			t.Fatalf("Error() = %q, want it to contain %q", message, want)
		}
	}

	// A selection that vanished between the page load and the click has no
	// per-reason breakdown, and must still say something usable.
	empty := (&EbayNoReviewableDraftsError{Selected: 3}).Error()
	if !strings.Contains(empty, "3") {
		t.Fatalf("Error() = %q, want it to name the selection size", empty)
	}
	if strings.Contains(empty, "()") {
		t.Fatalf("Error() = %q, must not print empty parentheses", empty)
	}
}
