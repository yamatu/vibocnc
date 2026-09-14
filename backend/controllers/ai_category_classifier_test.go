package controllers

import (
	"strings"
	"testing"

	"fanuc-backend/models"
	"fanuc-backend/services"
)

func TestParseAICategoryClassificationHandlesMarkdownFence(t *testing.T) {
	raw := "```json\n{\"brand\": \"Heidenhain\", \"part_type\": \"Encoder\", \"model_family\": \"ERN\", \"confidence\": 0.92, \"reason\": \"ERN 480 is a Heidenhain rotary encoder series.\"}\n```"
	classification, err := parseAICategoryClassification(raw)
	if err != nil {
		t.Fatalf("parse failed: %v", err)
	}
	if classification.Brand != "Heidenhain" || classification.PartType != "Encoder" || classification.Confidence != 0.92 {
		t.Fatalf("unexpected classification: %+v", classification)
	}
}

func TestInferenceFromAIClassificationAcceptsUnknownBrand(t *testing.T) {
	inference, err := services.InferenceFromAIClassification("Heidenhain", "Encoder", "ERN")
	if err != nil {
		t.Fatalf("validation failed: %v", err)
	}
	if inference.BrandName != "Heidenhain" || inference.PartType != "Encoder" {
		t.Fatalf("unexpected inference: %+v", inference)
	}
	if inference.MatchRule != "llm:type:encoder" {
		t.Fatalf("unexpected match rule %q", inference.MatchRule)
	}
}

// The canonical type vocabulary is what keeps an AI answer inside the existing
// taxonomy: "Servo Drive" must resolve to the node the catalog already calls
// "Servo Amplifier / Drive" instead of creating a near-duplicate sibling.
func TestInferenceFromAIClassificationCanonicalisesType(t *testing.T) {
	inference, err := services.InferenceFromAIClassification("FANUC", "  servo   drive ", "")
	if err != nil {
		t.Fatalf("validation failed: %v", err)
	}
	if inference.PartType != "Servo Amplifier / Drive" {
		t.Fatalf("expected canonical type, got %q", inference.PartType)
	}
	if inference.MatchRule != "llm:type:servo-amplifier-drive" {
		t.Fatalf("unexpected match rule %q", inference.MatchRule)
	}
}

func TestInferenceFromAIClassificationRejections(t *testing.T) {
	cases := []struct{ brand, partType string }{
		{"", "Encoder"},
		{"unknown", "Encoder"},
		{"Heidenhain", "Spare Part"},
		{"Heidenhain", "   "},
		{strings.Repeat("B", 61), "Encoder"},
		{"Heidenhain", strings.Repeat("t", 61)},
	}
	for index, testCase := range cases {
		if _, err := services.InferenceFromAIClassification(testCase.brand, testCase.partType, ""); err == nil {
			t.Errorf("case %d should be rejected: %+v", index, testCase)
		}
	}
}

// A below-threshold answer is no longer thrown away: it becomes a review
// candidate that keeps the brand, type and confidence the model reported.
func TestValidateAIClassificationAgainstKeepsBelowThresholdCandidate(t *testing.T) {
	product := models.Product{ID: 7, SKU: "A06B-6089-H105", Brand: "FANUC", Model: "A06B-6089-H105"}
	inference, err := services.InferenceFromAIClassification("FANUC", "Servo Amplifier", "")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	proposal := services.ValidateAIClassificationAgainst(product, "A06B-6089-H105", inference, 0.85, "A06B-6089 is the FANUC alpha i series.", nil, "")
	if proposal.Confirmed {
		t.Fatalf("0.85 is below the publication threshold but was confirmed")
	}
	if !strings.Contains(proposal.Reason, "below") {
		t.Fatalf("expected the threshold to be explained, got %q", proposal.Reason)
	}
	payload := ClassificationReviewPayloadJSON(proposal)
	for _, want := range []string{"Servo Amplifier", "0.85", "FANUC"} {
		if !strings.Contains(payload, want) {
			t.Fatalf("review payload %q is missing %q", payload, want)
		}
	}
	if status := classificationStatusForProposal(proposal); status != classificationStatusNeedsReview {
		t.Fatalf("expected needs_review, got %q", status)
	}
	updates := map[string]interface{}{}
	applyClassificationProposalUpdates(updates, proposal)
	if updates["classification_status"] != classificationStatusNeedsReview {
		t.Fatalf("updates did not record the review state: %+v", updates)
	}
}

// A disagreement between two verified sources needs a human; it must never be
// presented as an actionable candidate.
func TestValidateAIClassificationAgainstFlagsBrandConflict(t *testing.T) {
	product := models.Product{ID: 8, SKU: "X", Brand: "Siemens", Model: "6ES7-315-2AG10-0AB0"}
	inference, err := services.InferenceFromAIClassification("FANUC", "Servo Amplifier", "")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	proposal := services.ValidateAIClassificationAgainst(product, "6ES7-315-2AG10-0AB0", inference, 0.99, "guess", nil, "")
	if proposal.Confirmed || !proposal.Conflict {
		t.Fatalf("expected a conflict, got %+v", proposal)
	}
	if status := classificationStatusForProposal(proposal); status != classificationStatusConflict {
		t.Fatalf("expected conflict status, got %q", status)
	}
}

func TestApplyClassificationProposalUpdatesIgnoresZeroProposal(t *testing.T) {
	updates := map[string]interface{}{"status": "unresolved"}
	applyClassificationProposalUpdates(updates, services.ClassificationProposal{})
	if _, found := updates["classification_status"]; found {
		t.Fatalf("zero proposal must not write classification state: %+v", updates)
	}
}

func TestClassificationMinConfidenceFromEnvironment(t *testing.T) {
	t.Setenv("AI_CLASSIFICATION_MIN_CONFIDENCE", "")
	if got := services.ClassificationMinConfidence(); got != services.ClassificationConfidenceMin {
		t.Fatalf("default threshold changed: %v", got)
	}
	t.Setenv("AI_CLASSIFICATION_MIN_CONFIDENCE", "0.75")
	if got := services.ClassificationMinConfidence(); got != 0.75 {
		t.Fatalf("expected 0.75, got %v", got)
	}
	for _, invalid := range []string{"nonsense", "-1", "1.5"} {
		t.Setenv("AI_CLASSIFICATION_MIN_CONFIDENCE", invalid)
		if got := services.ClassificationMinConfidence(); got != services.ClassificationConfidenceMin {
			t.Fatalf("invalid value %q must fall back to the default, got %v", invalid, got)
		}
	}
}
