package services

import (
	"strings"
	"testing"

	"fanuc-backend/models"
)

// TestReviewIdentifierFallsBackToTheTitleCandidate pins where a review's
// identifier comes from. A draft column always wins, because a field the listing
// recorded is what the AI's reading is checked against; the candidate is only a
// fallback for a draft that recorded nothing.
func TestReviewIdentifierFallsBackToTheTitleCandidate(t *testing.T) {
	draft := models.EbayImportDraft{
		Status:   EbayDraftStatusPending,
		TitleRaw: "1pcs New Omron G7SA-2A2B G7SA2A2B safety relay US Free TAX",
	}

	identifier, speculative := EbayDraftReviewIdentifier(draft, "G7SA-2A2B")
	if identifier != "G7SA-2A2B" {
		t.Fatalf("identifier = %q, want G7SA-2A2B", identifier)
	}
	if !speculative {
		t.Fatal("a model that only a title candidate supplied must be reported as speculative")
	}

	// A recorded identifier is never the speculative one, even when the caller
	// hands a candidate in as well.
	recorded := models.EbayImportDraft{NormalizedModel: "CJ1W-DA08C", TitleRaw: draft.TitleRaw}
	if identifier, speculative = EbayDraftReviewIdentifier(recorded, "SOMETHING-ELSE"); identifier != "CJ1W-DA08C" || speculative {
		t.Fatalf("identifier = %q, speculative = %v, want the draft's own model and speculative=false", identifier, speculative)
	}

	// Nothing anywhere: still nothing, and not speculative.
	if identifier, speculative = EbayDraftReviewIdentifier(models.EbayImportDraft{}, ""); identifier != "" || speculative {
		t.Fatalf("identifier = %q, speculative = %v, want no identifier", identifier, speculative)
	}

	// A candidate is normalised the way every other model in the importer is, so
	// "g7sa-2a2b" and "G7SA 2A2B" cannot produce two identities for one part.
	if identifier, _ = EbayDraftReviewIdentifier(models.EbayImportDraft{}, "g7sa 2a2b"); identifier != "G7SA-2A2B" {
		t.Fatalf("identifier = %q, want the normalised G7SA-2A2B", identifier)
	}
}

// TestPreflightAcceptsATitleCandidateInPlaceOfAMissingIdentifier covers the two
// conditions that were conflated: a draft with no identifier *and* no parsed
// title is still refused, while a draft whose title named the part is reviewable.
func TestPreflightAcceptsATitleCandidateInPlaceOfAMissingIdentifier(t *testing.T) {
	prose := models.EbayImportDraft{
		Status:   EbayDraftStatusPending,
		TitleRaw: "Lot of 5 FANUC Servo Motors USED, no model marked",
	}
	if reason, ok := EbayDraftPreflightWithIdentifier(prose, ""); ok || reason != "missing_identifier" {
		t.Fatalf("preflight = %q, %v; a draft with no identifier and no parseable title must stay refused", reason, ok)
	}
	if reason, ok := EbayDraftPreflightWithIdentifier(prose, "G7SA-2A2B"); !ok {
		t.Fatalf("preflight refused a draft that a title candidate identifies: %q", reason)
	}

	// The status and title rules are untouched: a processed draft is still
	// skipped, and an identifier without a title is still unusable.
	processed := models.EbayImportDraft{Status: EbayDraftStatusImported}
	if reason, ok := EbayDraftPreflightWithIdentifier(processed, "G7SA-2A2B"); ok || reason != "already_processed" {
		t.Fatalf("preflight = %q, %v; an imported draft must stay skipped", reason, ok)
	}
	untitled := models.EbayImportDraft{Status: EbayDraftStatusPending}
	if reason, ok := EbayDraftPreflightWithIdentifier(untitled, "G7SA-2A2B"); ok || reason != "missing_title" {
		t.Fatalf("preflight = %q, %v; a draft with no title must stay refused", reason, ok)
	}

	// And EbayDraftPreflight itself is unchanged for the callers that pass no
	// candidate.
	if reason, ok := EbayDraftPreflight(prose); ok || reason != "missing_identifier" {
		t.Fatalf("EbayDraftPreflight() = %q, %v, want missing_identifier", reason, ok)
	}
}

// TestRescueDraftIdentifierSeparatesConfirmedFromGuessedModels is the guard on
// the rule that keeps a guess off the draft.
//
// A family the tables know is written back as the draft's model. A family they do
// not know yields a candidate that is carried to the model's own reading instead,
// because persisting it would make a correct identification look like a mismatch
// against a guess.
func TestRescueDraftIdentifierSeparatesConfirmedFromGuessedModels(t *testing.T) {
	cases := []struct {
		name           string
		draft          models.EbayImportDraft
		wantModel      string
		wantConfirmed  bool
		wantReviewable bool
	}{
		{
			name:           "a known family is confirmed",
			draft:          models.EbayImportDraft{Status: EbayDraftStatusPending, TitleRaw: "Omron SRT2-ROC16 PLC Module New One Fast Shipping"},
			wantModel:      "SRT2-ROC16",
			wantConfirmed:  true,
			wantReviewable: true,
		},
		{
			name:           "markup inside the model is joined, not dropped",
			draft:          models.EbayImportDraft{Status: EbayDraftStatusPending, TitleRaw: "1PC NEW IN BOX Omron Servo Motor R88M-G40030H-S<wbr/>2 FAST SHIP"},
			wantModel:      "R88M-G40030H-S2",
			wantConfirmed:  true,
			wantReviewable: true,
		},
		{
			name:           "an unseen family is reviewable but unconfirmed",
			draft:          models.EbayImportDraft{Status: EbayDraftStatusPending, TitleRaw: "Keyence FS-N18N Fiber Optic Sensor Amplifier New"},
			wantModel:      "FS-N18N",
			wantConfirmed:  false,
			wantReviewable: true,
		},
		{
			name:           "a draft that already has an identifier needs no rescue",
			draft:          models.EbayImportDraft{Status: EbayDraftStatusPending, NormalizedModel: "A06B-6079-H208", TitleRaw: "FANUC A06B-6079-H208 Servo Amplifier"},
			wantReviewable: true,
		},
		{
			name:           "prose without a part number stays refused",
			draft:          models.EbayImportDraft{Status: EbayDraftStatusPending, TitleRaw: "Lot of 5 FANUC Servo Motors USED, no model marked"},
			wantReviewable: false,
		},
		{
			name:           "an imported draft stays skipped whatever its title says",
			draft:          models.EbayImportDraft{Status: EbayDraftStatusImported, TitleRaw: "Omron SRT2-ROC16 PLC Module New One Fast Shipping"},
			wantReviewable: false,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rescue := rescueDraftIdentifier(tc.draft)
			if rescue.Reviewable != tc.wantReviewable {
				t.Fatalf("Reviewable = %v, want %v", rescue.Reviewable, tc.wantReviewable)
			}
			if rescue.Model != tc.wantModel {
				t.Fatalf("Model = %q, want %q", rescue.Model, tc.wantModel)
			}
			if rescue.Confirmed != tc.wantConfirmed {
				t.Fatalf("Confirmed = %v, want %v", rescue.Confirmed, tc.wantConfirmed)
			}
		})
	}
}

// TestModelDisagreementLetsTheAIModelStandForATitleCandidate is the rule the
// reported batch turned on.
//
// Rejecting a disagreement is what protects a product from a mislabelling *when
// the draft recorded the part number*. When the identifier is a guess recovered
// from a title by a table that had never seen the family, the guess is the wrong
// side of the disagreement, so the model's reading stands.
func TestModelDisagreementLetsTheAIModelStandForATitleCandidate(t *testing.T) {
	reject, note := modelDisagreement("G7SA-2A2B", true)
	if reject {
		t.Fatal("an unconfirmed candidate must not reject the draft")
	}
	if !strings.Contains(note, "G7SA-2A2B") {
		t.Fatalf("note = %q, want it to name the identifier that was overruled", note)
	}

	reject, note = modelDisagreement("A06B-6079-H208", false)
	if !reject {
		t.Fatal("a recorded identifier that disagrees with the AI reading must still reject the draft")
	}
	if !strings.Contains(note, "不一致") {
		t.Fatalf("note = %q, want the mismatch explanation", note)
	}
}

// TestSkipCountsTreatATitleCandidateAsProgressNotRefusal keeps the batch message
// honest: a queue whose titles were all parsed is not a failure, and the counts
// that reach the administrator must not read as one.
func TestSkipCountsTreatATitleCandidateAsProgressNotRefusal(t *testing.T) {
	counts := EbayReviewSkipCounts{
		"missing_identifier":           3,
		EbayReviewRecoveredReason:      7,
		EbayReviewTitleCandidateReason: 35,
	}
	summary := counts.Summary()
	if strings.Contains(summary, "candidate") || strings.Contains(summary, "recovered") {
		t.Fatalf("Summary() = %q; a parsed title is progress, not a reason the batch was refused", summary)
	}
	if !strings.Contains(summary, "no model or part number: 3") {
		t.Fatalf("Summary() = %q, want the one real refusal in it", summary)
	}

	recovered := counts.RecoveredSummary()
	for _, want := range []string{"7", "35"} {
		if !strings.Contains(recovered, want) {
			t.Fatalf("RecoveredSummary() = %q, want it to report %s", recovered, want)
		}
	}
	if got := (EbayReviewSkipCounts{"missing_identifier": 1}).RecoveredSummary(); got != "" {
		t.Fatalf("RecoveredSummary() = %q, want an empty string when nothing was recovered", got)
	}

	if text := EbayReviewSkipReasonText(EbayReviewTitleCandidateReason); text == EbayReviewTitleCandidateReason {
		t.Fatalf("reason %q has no human-readable text", EbayReviewTitleCandidateReason)
	}
}
