package services

import (
	"context"
	"errors"
	"fmt"
	"math"
	"os"
	"strconv"
	"strings"
	"time"

	"fanuc-backend/models"
	"fanuc-backend/utils"
	"gorm.io/gorm"
)

// Classification reference resolution — the single entry point for "what is
// this product, and may that decision publish?".
//
// Four call sites used to answer that question independently: the SEO job, the
// category optimization job, the bulk product import, and the catalog audit.
// They disagreed with each other (only the audit consulted administrator name
// hints, only some consulted public evidence), and each new rule had to be
// added in four places. Everything now flows through
// ResolveClassificationReference so the same product cannot be "confirmed" in
// one screen and "unresolved" in another.

// Classification decision sources, in the order the resolver tries them. The
// value is persisted in audit trails, so keep the strings stable.
const (
	ClassificationSourceLearned    = "learned"    // a previously verified decision for this model/family
	ClassificationSourceRules      = "rules"      // deterministic in-code model rules
	ClassificationSourceWeb        = "web"        // bounded public evidence naming the exact model
	ClassificationSourceNameHint   = "name-hint"  // administrator-written product name
	ClassificationSourceAI         = "ai"         // AI classifier that passed every validator
	ClassificationSourceUnresolved = "unresolved" // nothing verified the identity
)

// ClassificationConfidenceNeedsReview is the confidence band where an AI
// answer is too weak to publish but too informative to throw away. Such an
// answer is stored as a candidate for one-click administrator review.
const (
	ClassificationConfidenceMin       = 0.9
	ClassificationConfidenceReviewMin = 0.6
)

// ClassificationReferenceOptions selects how much verification work a caller
// may spend on one product.
type ClassificationReferenceOptions struct {
	DB *gorm.DB
	// UseWebSearch enables the bounded public evidence lookup. Full-catalog
	// scans leave it off; imports and background jobs turn it on.
	UseWebSearch bool
	// DisableLearnedRules and DisableNameHints exist so a caller (or a test) can
	// reproduce the pre-learning behavior exactly.
	DisableLearnedRules bool
	DisableNameHints    bool
	WebSearchTimeout    time.Duration
}

// ClassificationProposal is the shared result of every classification entry
// point: what was decided, how it was decided, and whether it may publish.
type ClassificationProposal struct {
	ProductID  uint                     `json:"product_id"`
	SKU        string                   `json:"sku,omitempty"`
	Model      string                   `json:"model"`
	Inference  ProductCategoryInference `json:"inference"`
	Source     string                   `json:"source"`
	Confirmed  bool                     `json:"confirmed"`
	Confidence float64                  `json:"confidence,omitempty"`
	Reason     string                   `json:"reason,omitempty"`
	// Conflict marks an explicit contradiction between two verified sources.
	// It always requires a human: the product must not be published from it.
	Conflict bool `json:"conflict,omitempty"`
	// Evidence and SearchError are reported separately from the decision so an
	// administrator can tell "nothing found" apart from "the search broke".
	Evidence    []ProductWebEvidence `json:"evidence,omitempty"`
	SearchError string               `json:"search_error,omitempty"`
}

// ProductID/CategoryID helpers keep the proposal usable as a DTO.

func proposalFor(product models.Product, model string) ClassificationProposal {
	return ClassificationProposal{ProductID: product.ID, SKU: product.SKU, Model: model}
}

// ConfirmedProposal builds a proposal that may publish.
func ConfirmedProposal(product models.Product, model string, inference ProductCategoryInference, source string) ClassificationProposal {
	proposal := proposalFor(product, model)
	proposal.Inference = inference
	proposal.Source = source
	proposal.Confirmed = true
	return proposal
}

// UnresolvedProposal builds a proposal that must not publish, explaining why.
func UnresolvedProposal(product models.Product, model string, inference ProductCategoryInference) ClassificationProposal {
	proposal := proposalFor(product, model)
	proposal.Inference = inference
	proposal.Source = ClassificationSourceUnresolved
	proposal.Reason = ClassificationFailureReason(inference, model)
	return proposal
}

// WithReason annotates an unresolved proposal. It is a no-op once a proposal is
// confirmed, so callers can add detail without risking the decision.
func (p ClassificationProposal) WithReason(reason string) ClassificationProposal {
	reason = strings.TrimSpace(reason)
	if p.Confirmed || reason == "" {
		return p
	}
	if p.Reason == "" {
		p.Reason = reason
		return p
	}
	p.Reason = p.Reason + "; " + reason
	return p
}

// WithConflict records that a verified source disagrees with the decision.
func (p ClassificationProposal) WithConflict(reason string) ClassificationProposal {
	p.Confirmed = false
	p.Conflict = true
	p.Source = ClassificationSourceUnresolved
	return p.WithReason(reason)
}

// ResolveClassificationReference verifies one product's identity using, in
// order: learned rules, deterministic model rules, bounded public evidence, and
// finally administrator-written name hints.
//
// Evidence always outranks a name hint, so a product name can never overturn a
// verified contradiction. An AI answer is not resolved here — it needs an
// outbound provider call — so callers append it with WithAIProposal.
func ResolveClassificationReference(ctx context.Context, product models.Product, opts ClassificationReferenceOptions) ClassificationProposal {
	model := ClassificationModel(product)
	brand := strings.TrimSpace(product.Brand)
	proposal := proposalFor(product, model)

	if strings.TrimSpace(model) == "" {
		proposal.Source = ClassificationSourceUnresolved
		return proposal.WithReason(ClassificationFailureReason(ProductCategoryInference{}, model))
	}

	// 1. A decision this catalog already verified for the same identity. This is
	//    the cheapest step and the most stable one: a second SKU of the same
	//    part cannot land somewhere else.
	if !opts.DisableLearnedRules {
		if inference, ok := LearnedClassificationInference(opts.DB, brand, model); ok {
			return ConfirmedProposal(product, model, inference, ClassificationSourceLearned)
		}
	}

	// 2. Deterministic, unit-tested in-code model rules.
	inference := InferProductCategory(brand, model)
	if IsConfirmedProductCategory(inference, model) {
		return ConfirmedProposal(product, model, inference, ClassificationSourceRules)
	}
	proposal.Inference = inference

	// 3. Bounded public evidence. Search failures are reported but never fatal:
	//    a network problem must not change the classification outcome.
	if opts.UseWebSearch {
		timeout := opts.WebSearchTimeout
		if timeout <= 0 {
			timeout = 12 * time.Second
		}
		searchCtx := ctx
		if searchCtx == nil {
			searchCtx = context.Background()
		}
		searchCtx, cancel := context.WithTimeout(searchCtx, timeout)
		resolved, evidence, err := ResolveProductCategoryWithWebEvidence(searchCtx, brand, model)
		cancel()
		proposal.Evidence = evidence
		if err != nil {
			proposal.SearchError = err.Error()
		}
		proposal.Inference = resolved
		if IsConfirmedProductCategory(resolved, model) {
			confirmed := ConfirmedProposal(product, model, resolved, ClassificationSourceWeb)
			confirmed.Evidence = evidence
			return confirmed
		}
	}

	// 4. Administrator-written names are hints, not independent proof, so they
	//    are only consulted when nothing else verified the product.
	if !opts.DisableNameHints {
		if nameInference, ok := inferAdminNameCategory(brand, model, product.Name); ok {
			return ConfirmedProposal(product, model, nameInference, ClassificationSourceNameHint)
		}
	}

	proposal.Source = ClassificationSourceUnresolved
	proposal.Reason = ClassificationFailureReason(proposal.Inference, model)
	if proposal.SearchError != "" && !IsConfirmedProductCategory(proposal.Inference, model) {
		proposal.Reason = fmt.Sprintf("%s; web verification failed: %s", proposal.Reason, proposal.SearchError)
	}
	return proposal
}

// InferenceFromAIClassification builds the inference for an AI answer, applying
// the canonical product-type vocabulary and the field limits that the taxonomy
// relies on. Keeping the conversion here means the classifier, the review queue
// and the learned-rule loader all speak the same vocabulary: an AI answer of
// "Servo Drive" resolves to the existing "Servo Amplifier / Drive" node instead
// of creating a near-duplicate one.
func InferenceFromAIClassification(brand, partType, modelFamily string) (ProductCategoryInference, error) {
	brand = strings.TrimSpace(brand)
	partType = strings.Join(strings.Fields(strings.TrimSpace(partType)), " ")
	if brand == "" {
		return ProductCategoryInference{}, errors.New("AI could not verify the manufacturer brand")
	}
	brandKey := NormalizeBrandKey(brand)
	if brandKey == "" || brandKey == "unknown" {
		return ProductCategoryInference{}, errors.New("AI could not verify the manufacturer brand")
	}
	if len([]rune(brand)) > 60 || len([]rune(partType)) > 60 {
		return ProductCategoryInference{}, errors.New("AI classification fields exceed length limits")
	}
	if IsGenericProductType(partType) {
		return ProductCategoryInference{}, errors.New("AI returned a generic product type")
	}
	canonicalType := CanonicalProductType(partType)
	brandName := CanonicalBrandName(brand)
	if brandName == "" {
		brandName = brand
	}
	return ProductCategoryInference{
		BrandKey:     brandKey,
		BrandName:    brandName,
		PartType:     canonicalType,
		CategorySlug: utils.GenerateSlug(canonicalType),
		ModelFamily:  strings.TrimSpace(modelFamily),
		MatchRule:    "llm:type:" + utils.GenerateSlug(canonicalType),
	}, nil
}

// ClassificationMinConfidence returns the publication threshold for an AI
// classification, from AI_CLASSIFICATION_MIN_CONFIDENCE. Different catalogs
// tolerate different amounts of doubt, and a hard-coded constant also made the
// threshold impossible to tune without a release. An unset or malformed value
// falls back to the documented default rather than disabling the gate.
func ClassificationMinConfidence() float64 {
	raw := strings.TrimSpace(os.Getenv("AI_CLASSIFICATION_MIN_CONFIDENCE"))
	if raw == "" {
		return ClassificationConfidenceMin
	}
	value, err := strconv.ParseFloat(raw, 64)
	if err != nil || math.IsNaN(value) || math.IsInf(value, 0) || value < 0 || value > 1 {
		return ClassificationConfidenceMin
	}
	return value
}

// ValidateAIClassificationAgainst verifies an AI answer against every source
// already available locally and returns the proposal the job should act on.
//
// A below-threshold answer is returned as an unresolved proposal carrying the
// candidate, so the administrator gets a review entry instead of a lost
// provider call.
func ValidateAIClassificationAgainst(product models.Product, model string, inference ProductCategoryInference, confidence float64, reason string, evidence []ProductWebEvidence, searchErr string) ClassificationProposal {
	proposal := proposalFor(product, model)
	proposal.Inference = inference
	// Source records who proposed the answer, not whether it was accepted. A
	// rejected-but-informative answer keeps it so the review queue can show
	// "the AI suggested X at 0.85" instead of an anonymous row.
	proposal.Source = ClassificationSourceAI
	proposal.Confidence = confidence
	proposal.Evidence = evidence
	if searchErr != "" {
		proposal.SearchError = searchErr
	}
	// Whitespace is not a rationale, and the raw string must be trimmed before
	// it is persisted as the audit reason.
	proposal.Reason = strings.TrimSpace(reason)
	if proposal.Reason == "" {
		return proposal.WithReason("AI classification omitted its evidence rationale")
	}
	if math.IsNaN(confidence) || math.IsInf(confidence, 0) || confidence > 1 || confidence < 0 {
		return proposal.WithReason(fmt.Sprintf("AI confidence %.2f is not a valid value", confidence))
	}
	if threshold := ClassificationMinConfidence(); confidence < threshold {
		return proposal.WithReason(fmt.Sprintf("AI confidence %.2f is below the %.2f publication threshold", confidence, threshold))
	}
	// A brand already recorded on the product is evidence in its own right. An
	// AI answer that contradicts it must not be applied silently.
	if hint := NormalizeBrandKey(product.Brand); hint != "" && hint != "unknown" && hint != inference.BrandKey {
		return proposal.WithConflict("AI manufacturer conflicts with existing identity; review required")
	}
	// Deterministic rules remain a conflict check: when they verified a
	// different type, the disagreement is exactly what a human should see.
	corroboration := InferProductCategory(product.Brand, model)
	if !IsConfirmedProductCategory(corroboration, model) {
		corroboration = InferProductCategoryFromEvidence(product.Brand, model, ProductWebEvidenceText(evidence))
	}
	if IsConfirmedProductCategory(corroboration, model) && !classificationsAgree(corroboration, inference) {
		return proposal.WithConflict("AI proposal conflicts with verified product type; review required")
	}
	// A confirmed AI proposal keeps the confidence, the rationale and the
	// evidence it was judged on: the review queue and the audit trail need them
	// to explain the decision later.
	confirmed := ConfirmedProposal(product, model, inference, ClassificationSourceAI)
	confirmed.Confidence = confidence
	confirmed.Reason = proposal.Reason
	confirmed.Evidence = evidence
	confirmed.SearchError = searchErr
	return confirmed
}

func classificationsAgree(left, right ProductCategoryInference) bool {
	if NormalizeBrandKey(left.BrandKey) != NormalizeBrandKey(right.BrandKey) {
		return false
	}
	normalize := func(value string) string {
		return strings.TrimSuffix(strings.ToLower(strings.Join(strings.Fields(strings.TrimSpace(value)), " ")), "s")
	}
	return normalize(left.PartType) == normalize(right.PartType)
}
