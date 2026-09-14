package services

import (
	"context"
	"strings"
	"testing"

	"fanuc-backend/models"
	"gorm.io/driver/mysql"
	"gorm.io/gorm"
)

// ResolveClassificationReference is the single entry point every caller shares,
// so its ordering is the contract that keeps screens and jobs in agreement.

func TestResolveClassificationReferenceUsesDeterministicRulesWithoutWebSearch(t *testing.T) {
	product := models.Product{ID: 1, SKU: "A06B-6089-H105", Brand: "FANUC", Model: "A06B-6089-H105"}
	proposal := ResolveClassificationReference(context.Background(), product, ClassificationReferenceOptions{})
	if !proposal.Confirmed {
		t.Fatalf("a known FANUC servo amplifier must be confirmed: %+v", proposal)
	}
	if proposal.Source != ClassificationSourceRules {
		t.Fatalf("expected the deterministic rule source, got %q", proposal.Source)
	}
}

func TestResolveClassificationReferenceReportsMissingModel(t *testing.T) {
	proposal := ResolveClassificationReference(context.Background(), models.Product{ID: 2}, ClassificationReferenceOptions{})
	if proposal.Confirmed {
		t.Fatalf("an empty model must never confirm: %+v", proposal)
	}
	if proposal.Source != ClassificationSourceUnresolved || proposal.Reason == "" {
		t.Fatalf("expected an explained unresolved proposal: %+v", proposal)
	}
}

// An administrator-written name is a hint, not proof: it may only be trusted
// when it repeats the exact model identifier, and it loses to real rules.
func TestResolveClassificationReferencePrefersRulesOverNameHints(t *testing.T) {
	product := models.Product{ID: 3, SKU: "A06B-6089-H105", Brand: "FANUC", Model: "A06B-6089-H105", Name: "FANUC A06B-6089-H105 power supply"}
	proposal := ResolveClassificationReference(context.Background(), product, ClassificationReferenceOptions{})
	if !proposal.Confirmed || proposal.Source != ClassificationSourceRules {
		t.Fatalf("a deterministic rule must beat a name hint: %+v", proposal)
	}
	if strings.Contains(strings.ToLower(proposal.Inference.PartType), "power supply") {
		t.Fatalf("the name hint overrode the verified type: %+v", proposal.Inference)
	}
}

func TestResolveClassificationReferenceCanDisableNameHints(t *testing.T) {
	product := models.Product{ID: 4, SKU: "X1", Brand: "FANUC", Model: "A06B-9999-H999", Name: "FANUC A06B-9999-H999 servo motor"}
	withHints := ResolveClassificationReference(context.Background(), product, ClassificationReferenceOptions{})
	withoutHints := ResolveClassificationReference(context.Background(), product, ClassificationReferenceOptions{DisableNameHints: true})
	if withHints.Confirmed && !withoutHints.Confirmed {
		t.Fatalf("DisableNameHints must reproduce the pre-hint behaviour")
	}
}

func TestValidateAIClassificationAgainstConfirmsCorroboratedAnswer(t *testing.T) {
	product := models.Product{ID: 5, SKU: "A06B-6089-H105", Brand: "FANUC", Model: "A06B-6089-H105"}
	inference, err := InferenceFromAIClassification("FANUC", "Servo Amplifier", "")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	proposal := ValidateAIClassificationAgainst(product, "A06B-6089-H105", inference, 0.95, "A06B-6089 is a FANUC servo amplifier series.", nil, "")
	if !proposal.Confirmed || proposal.Source != ClassificationSourceAI || proposal.Conflict {
		t.Fatalf("expected a confirmed proposal: %+v", proposal)
	}
}

func TestValidateAIClassificationAgainstCarriesSearchError(t *testing.T) {
	product := models.Product{ID: 6, SKU: "X", Brand: "Heidenhain", Model: "ERN-480-1000"}
	inference, err := InferenceFromAIClassification("Heidenhain", "Encoder / Feedback", "")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	proposal := ValidateAIClassificationAgainst(product, "ERN-480-1000", inference, 0.95, "ERN 480 is a Heidenhain encoder.", nil, "dial tcp: lookup search.example: no such host")
	if !proposal.Confirmed {
		t.Fatalf("a search outage must not change the decision: %+v", proposal)
	}
	if proposal.SearchError == "" {
		t.Fatalf("the search failure must stay visible instead of being discarded")
	}
}

func TestValidateAIClassificationOmittedReasonIsRejected(t *testing.T) {
	product := models.Product{ID: 7, SKU: "X", Brand: "FANUC", Model: "A06B-6089-H105"}
	inference, err := InferenceFromAIClassification("FANUC", "Servo Amplifier", "")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	proposal := ValidateAIClassificationAgainst(product, "A06B-6089-H105", inference, 0.99, "  ", nil, "")
	if proposal.Confirmed || !strings.Contains(proposal.Reason, "rationale") {
		t.Fatalf("an unexplained answer must not publish: %+v", proposal)
	}
}

func TestWithConflictMarksTheProposalForHumanReview(t *testing.T) {
	product := models.Product{ID: 8, Brand: "Siemens", Model: "6ES7-315-2AG10-0AB0"}
	base := ConfirmedProposal(product, "6ES7-315-2AG10-0AB0", ProductCategoryInference{BrandKey: "siemens", PartType: "Programmable Logic Controller"}, ClassificationSourceRules)
	conflict := base.WithConflict("two sources disagree")
	if conflict.Confirmed || !conflict.Conflict || conflict.Source != ClassificationSourceUnresolved {
		t.Fatalf("unexpected conflict proposal: %+v", conflict)
	}
	if !strings.Contains(conflict.Reason, "two sources disagree") {
		t.Fatalf("the conflict must be explained: %+v", conflict)
	}
	// Annotating a confirmed proposal must never weaken or alter it.
	if annotated := base.WithReason("extra detail"); !annotated.Confirmed || annotated.Reason != "" {
		t.Fatalf("WithReason must be a no-op on a confirmed proposal: %+v", annotated)
	}
}

// Auto-creation may only reuse vocabulary the taxonomy already has. This is the
// gate that stops an AI-authored product type from minting a public category.
func TestIsKnownProductTypeNameUsesDictionaryAndCategoryTree(t *testing.T) {
	if !IsKnownProductTypeName(nil, "servo motor") {
		t.Fatalf("a canonical dictionary type must be known")
	}
	if !IsKnownProductTypeName(nil, "Servo Drive") {
		t.Fatalf("dictionary aliases must resolve to a canonical type")
	}
	if IsKnownProductTypeName(nil, "Quantum Flux Harmoniser") {
		t.Fatalf("an invented type must not be treated as known vocabulary")
	}
	if IsKnownProductTypeName(nil, "") {
		t.Fatalf("an empty type must not be known")
	}
}

// The tenant-vocabulary check must consult the category tree too, so a type the
// store already uses in its own words stays usable.
func TestIsKnownProductTypeNameReadsExistingCategoryNodes(t *testing.T) {
	db := newDryRunServiceDB(t)
	if db == nil {
		t.Skip("dry-run database unavailable")
	}
	if IsKnownProductTypeName(db, "Quantum Flux Harmoniser") {
		t.Fatalf("dry-run database cannot confirm an invented type")
	}
}

// newDryRunServiceDB builds a GORM handle that renders SQL without a server, so
// query construction can be asserted without a live database.
func newDryRunServiceDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(mysql.New(mysql.Config{
		DSN:                       "user:password@tcp(localhost:3306)/test?charset=utf8mb4&parseTime=True&loc=Local",
		SkipInitializeWithVersion: true,
	}), &gorm.Config{DryRun: true, DisableAutomaticPing: true})
	if err != nil {
		return nil
	}
	return db
}
