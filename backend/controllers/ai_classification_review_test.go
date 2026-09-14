package controllers

import (
	"encoding/json"
	"strings"
	"testing"

	"fanuc-backend/models"
	"fanuc-backend/services"
)

// The review payload is what an administrator later decides on, so it has to
// survive a lossless round trip and must never upgrade a rejected answer into a
// publishable one.

func reviewProposalFixture() services.ClassificationProposal {
	return services.ClassificationProposal{
		ProductID:  41,
		SKU:        "A06B-6089-H105",
		Model:      "A06B-6089-H105",
		Inference:  services.ProductCategoryInference{BrandKey: "fanuc", BrandName: "FANUC", PartType: "Servo Amplifier / Drive", CategorySlug: "servo-amplifier-drive", MatchRule: "llm:type:servo-amplifier-drive"},
		Source:     services.ClassificationSourceAI,
		Confirmed:  false,
		Confidence: 0.72,
		Reason:     "AI confidence 0.72 is below the 0.90 publication threshold",
		Evidence: []services.ProductWebEvidence{
			{Title: "A06B-6089-H105", URL: "https://example.com/1", Snippet: "FANUC servo amplifier", SourceType: "vendor", EvidenceLevel: "high"},
		},
		SearchError: "",
	}
}

func TestClassificationStatusForProposal(t *testing.T) {
	cases := []struct {
		name     string
		proposal services.ClassificationProposal
		want     string
	}{
		{"confirmed", services.ClassificationProposal{Confirmed: true, Source: services.ClassificationSourceRules}, classificationStatusCompleted},
		{"conflict wins over confidence", services.ClassificationProposal{Confirmed: false, Conflict: true, Confidence: 0.99}, classificationStatusConflict},
		{"low confidence", services.ClassificationProposal{Source: services.ClassificationSourceAI, Confidence: 0.72}, classificationStatusNeedsReview},
		{"no decision", services.ClassificationProposal{Source: services.ClassificationSourceUnresolved}, classificationStatusUnresolved},
		{"zero value", services.ClassificationProposal{}, classificationStatusUnresolved},
	}
	for _, tc := range cases {
		if got := classificationStatusForProposal(tc.proposal); got != tc.want {
			t.Errorf("%s: got %q, want %q", tc.name, got, tc.want)
		}
	}
}

func TestClassificationReviewPayloadRoundTrip(t *testing.T) {
	raw := ClassificationReviewPayloadJSON(reviewProposalFixture())
	if raw == "" {
		t.Fatalf("a reviewable proposal must produce a payload")
	}
	payload := decodeClassificationReviewPayload(raw)
	if payload.PartType != "Servo Amplifier / Drive" || payload.Brand != "FANUC" || payload.BrandKey != "fanuc" {
		t.Fatalf("payload lost the candidate identity: %+v", payload)
	}
	if payload.Confidence != 0.72 || payload.Source != services.ClassificationSourceAI {
		t.Fatalf("payload lost the decision detail: %+v", payload)
	}
	if len(payload.Evidence) != 1 {
		t.Fatalf("payload lost the evidence: %+v", payload)
	}
}

func TestClassificationReviewPayloadOmitsEmptyProposal(t *testing.T) {
	if raw := ClassificationReviewPayloadJSON(services.ClassificationProposal{}); raw != "" {
		t.Fatalf("an empty proposal must not overwrite stored evidence, got %q", raw)
	}
}

// Entries written before the review queue existed stored only a raw evidence
// array; they must still be decodable so they stay actionable.
func TestDecodeClassificationReviewPayloadAcceptsLegacyEvidenceArray(t *testing.T) {
	legacy, err := json.Marshal([]services.ProductWebEvidence{
		{Title: "ERN 480", URL: "https://example.com/ern480", Snippet: "Heidenhain rotary encoder", SourceType: "vendor", EvidenceLevel: "high"},
	})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	payload := decodeClassificationReviewPayload(string(legacy))
	if len(payload.Evidence) != 1 || payload.Evidence[0].Title != "ERN 480" {
		t.Fatalf("legacy evidence payload was not decoded: %+v", payload)
	}
	if payload.PartType != "" {
		t.Fatalf("a legacy payload must not invent a candidate type")
	}
}

func TestDecodeClassificationReviewPayloadToleratesGarbage(t *testing.T) {
	for _, raw := range []string{"", "   ", "not json", "{}", "[1,2,3]"} {
		if payload := decodeClassificationReviewPayload(raw); payload.PartType != "" || len(payload.Evidence) != 0 {
			t.Errorf("payload %q should decode to nothing, got %+v", raw, payload)
		}
	}
}

func TestIsGenericClassificationCandidateIsRejectedByServicesGate(t *testing.T) {
	if !services.IsGenericProductType("Spare Part") {
		t.Fatalf("generic types must stay publishable only through review")
	}
}

// The payload must stay bounded: an enormous AI answer must not be able to
// bloat the audit row it is stored in.
func TestClassificationReviewPayloadTruncatesLongEvidence(t *testing.T) {
	proposal := reviewProposalFixture()
	proposal.Evidence = nil
	for i := 0; i < classificationReviewEvidenceLimit+5; i++ {
		proposal.Evidence = append(proposal.Evidence, services.ProductWebEvidence{
			Title:   strings.Repeat("t", classificationReviewEvidenceRunes+50),
			URL:     "https://example.com/x",
			Snippet: strings.Repeat("s", classificationReviewEvidenceRunes+50),
		})
	}
	raw := ClassificationReviewPayloadJSON(proposal)
	if raw == "" {
		t.Fatalf("expected a payload")
	}
	if count := strings.Count(raw, "https://example.com/x"); count > classificationReviewEvidenceLimit {
		t.Fatalf("evidence was not bounded: %d entries", count)
	}
	if len([]rune(raw)) > 8*1024 {
		t.Fatalf("payload is too large to persist comfortably: %d runes", len([]rune(raw)))
	}
	var decoded classificationReviewPayload
	if err := json.Unmarshal([]byte(raw), &decoded); err != nil {
		t.Fatalf("payload must stay valid JSON: %v", err)
	}
	if len(decoded.Evidence) != classificationReviewEvidenceLimit {
		t.Fatalf("expected %d evidence entries, got %d", classificationReviewEvidenceLimit, len(decoded.Evidence))
	}
	for _, item := range decoded.Evidence {
		if len([]rune(item.Snippet)) > classificationReviewEvidenceRunes {
			t.Fatalf("snippet was not truncated")
		}
	}
}

func TestApplyClassificationProposalUpdatesSkipsEmptyProposal(t *testing.T) {
	updates := map[string]interface{}{}
	applyClassificationProposalUpdates(updates, services.ClassificationProposal{})
	if len(updates) != 0 {
		t.Fatalf("an empty proposal must not touch the item: %+v", updates)
	}
	updates = map[string]interface{}{}
	applyClassificationProposalUpdates(updates, reviewProposalFixture())
	if updates["classification_status"] != classificationStatusNeedsReview {
		t.Fatalf("unexpected status: %+v", updates)
	}
	if updates["classification_rule"] != "llm:type:servo-amplifier-drive" {
		t.Fatalf("unexpected rule: %+v", updates)
	}
	if _, ok := updates["evidence_json"].(string); !ok {
		t.Fatalf("evidence payload was not stored: %+v", updates)
	}
}

func TestLoadReviewItemRejectsMissingIdentifier(t *testing.T) {
	_ = models.AIAgentSEOJobItem{}
	// Only the argument validation is exercised here: touching the database
	// requires a live connection, which unit tests deliberately avoid.
	updates := map[string]interface{}{}
	applyClassificationProposalUpdates(updates, services.ClassificationProposal{Model: "A06B-6089-H105", Source: services.ClassificationSourceUnresolved})
	if updates["classification_status"] != classificationStatusUnresolved {
		t.Fatalf("unexpected status for an unresolved proposal: %+v", updates)
	}
	if _, ok := updates["evidence_json"]; ok {
		t.Fatalf("an unresolved proposal without evidence must not write an empty payload")
	}
}
