package services

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"fanuc-backend/models"

	"gorm.io/gorm"
)

// ProductProfileDraftPayload is the decoded, reviewer-facing representation of
// one persisted profile proposal.
type ProductProfileDraftPayload struct {
	Profile  ProductProfile                  `json:"profile"`
	Content  ProfileContent                  `json:"content"`
	Evidence []models.EbayMarketEvidenceItem `json:"evidence"`
}

// BuildProductProfileDraft converts an AI profile into a deterministic title
// and content preview, but performs no database writes.
func BuildProductProfileDraft(product *models.Product, quote *models.EbayMarketQuote, profile ProductProfile, requestedBy uint) (models.ProductProfileDraft, ProductProfileDraftPayload, error) {
	profile = SanitizeProductProfileForStorefront(profile)
	if strings.TrimSpace(profile.Brand) == "" || strings.TrimSpace(profile.PartType) == "" || profile.Confidence < 0.5 {
		return models.ProductProfileDraft{}, ProductProfileDraftPayload{}, errors.New("the product profile is not specific or confident enough for review")
	}

	currentName := ""
	catalog := ProfileContentCatalog{}
	if product != nil {
		currentName = product.Name
		catalog = ProfileContentCatalog{
			SKU:           product.SKU,
			Condition:     product.ConditionType,
			OriginCountry: product.OriginCountry,
			Manufacturer:  product.Manufacturer,
			DatasheetURL:  product.DatasheetURL,
		}
	}
	title := BuildProfileProductTitle(profile, currentName)
	if title.Status == "unresolved" {
		return models.ProductProfileDraft{}, ProductProfileDraftPayload{}, errors.New(title.Message)
	}
	content := BuildProfileContent(profile, catalog)

	// Brand isolation is a hard publication rule. Sanitize list items first, then
	// verify the complete generated copy so a foreign manufacturer cannot leak
	// through the summary or an unexpected model reply.
	publicCopy := strings.Join([]string{
		title.NewName,
		content.ShortDescription,
		content.Description,
		content.MetaTitle,
		content.MetaDescription,
		content.MetaKeywords,
		content.CompatibilityInfo,
	}, "\n")
	if foreign := ForeignBrandMentions(publicCopy, profile.Brand); len(foreign) > 0 {
		return models.ProductProfileDraft{}, ProductProfileDraftPayload{}, fmt.Errorf(
			"generated profile contains another manufacturer: %s", strings.Join(foreign, ", "),
		)
	}

	evidence := []models.EbayMarketEvidenceItem{}
	quoteID := uint(0)
	if quote != nil {
		quoteID = quote.ID
		evidence = MarketEvidenceItems(*quote)
	}

	profileJSON, err := json.Marshal(profile)
	if err != nil {
		return models.ProductProfileDraft{}, ProductProfileDraftPayload{}, err
	}
	contentJSON, err := json.Marshal(content)
	if err != nil {
		return models.ProductProfileDraft{}, ProductProfileDraftPayload{}, err
	}
	evidenceJSON, err := json.Marshal(evidence)
	if err != nil {
		return models.ProductProfileDraft{}, ProductProfileDraftPayload{}, err
	}

	draft := models.ProductProfileDraft{
		QuoteID:              quoteID,
		Brand:                profile.Brand,
		Model:                profile.Model,
		Status:               "pending",
		Confidence:           profile.Confidence,
		ProposedTitle:        title.NewName,
		ProposedCategoryName: profile.PartType,
		CurrentNameSnapshot:  currentName,
		ProfileJSON:          string(profileJSON),
		ContentJSON:          string(contentJSON),
		EvidenceJSON:         string(evidenceJSON),
		Reason:               profile.Reason,
		RequestedBy:          requestedBy,
	}
	if product != nil {
		draft.ProductID = product.ID
		draft.SKU = product.SKU
		updatedAt := product.UpdatedAt
		draft.ProductUpdatedAt = &updatedAt
	}

	return draft, ProductProfileDraftPayload{Profile: profile, Content: content, Evidence: evidence}, nil
}

// StoreProductProfileDraft persists a proposal and supersedes older pending
// proposals for the same product/model. Re-running identification therefore
// creates one clear current answer instead of an ambiguous pile of drafts.
func StoreProductProfileDraft(db *gorm.DB, draft *models.ProductProfileDraft) error {
	if db == nil {
		return errors.New("database is not available")
	}
	if draft == nil {
		return errors.New("profile draft is nil")
	}
	return db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(draft).Error; err != nil {
			return err
		}
		supersede := tx.Model(&models.ProductProfileDraft{}).
			Where("id <> ? AND status = ? AND model = ?", draft.ID, "pending", draft.Model)
		if draft.ProductID > 0 {
			supersede = supersede.Where("product_id = ?", draft.ProductID)
		} else if strings.TrimSpace(draft.SKU) != "" {
			supersede = supersede.Where("product_id = 0 AND sku = ?", draft.SKU)
		} else {
			// Bare model research still gets a single current draft.
			supersede = supersede.Where("product_id = 0")
		}
		return supersede.Update("status", "superseded").Error
	})
}

// DecodeProductProfileDraft validates and decodes persisted proposal payloads.
func DecodeProductProfileDraft(draft models.ProductProfileDraft) (ProductProfileDraftPayload, error) {
	var payload ProductProfileDraftPayload
	if err := json.Unmarshal([]byte(draft.ProfileJSON), &payload.Profile); err != nil {
		return payload, fmt.Errorf("decode profile: %w", err)
	}
	if err := json.Unmarshal([]byte(draft.ContentJSON), &payload.Content); err != nil {
		return payload, fmt.Errorf("decode content: %w", err)
	}
	if strings.TrimSpace(draft.EvidenceJSON) != "" {
		if err := json.Unmarshal([]byte(draft.EvidenceJSON), &payload.Evidence); err != nil {
			return payload, fmt.Errorf("decode evidence: %w", err)
		}
	}
	return payload, nil
}

// SanitizeProductProfileForStorefront removes profile phrases that name a
// manufacturer other than the identified product's own brand. Evidence and
// cited specs remain available to reviewers, but foreign brands never enter
// generated public copy.
func SanitizeProductProfileForStorefront(profile ProductProfile) ProductProfile {
	brand := strings.TrimSpace(profile.Brand)
	if brand == "" {
		return profile
	}
	if len(ForeignBrandMentions(profile.WhatItIs, brand)) > 0 {
		profile.WhatItIs = ""
	}
	profile.KeyFunctions = filterProfileBrandSafeList(profile.KeyFunctions, brand)
	profile.Applications = filterProfileBrandSafeList(profile.Applications, brand)
	profile.CompatibleWith = filterProfileBrandSafeList(profile.CompatibleWith, brand)
	return profile
}

func filterProfileBrandSafeList(values []string, brand string) []string {
	out := make([]string, 0, len(values))
	for _, value := range values {
		if len(ForeignBrandMentions(value, brand)) == 0 {
			out = append(out, value)
		}
	}
	return out
}

// ProductProfileSpecCandidates converts cited AI profile specs into the
// existing ProductSpecDraft candidate format. It never writes technical_specs.
func ProductProfileSpecCandidates(profile ProductProfile) []SpecResearchCandidate {
	candidates := make([]SpecResearchCandidate, 0, len(profile.Specs))
	for _, spec := range profile.Specs {
		if strings.TrimSpace(spec.Label) == "" || strings.TrimSpace(spec.Value) == "" || strings.TrimSpace(spec.Source) == "" {
			continue
		}
		candidates = append(candidates, SpecResearchCandidate{
			Label:      strings.TrimSpace(spec.Label),
			Value:      strings.TrimSpace(spec.Value),
			SourceURL:  strings.TrimSpace(spec.Source),
			SourceType: "ebay_listing",
			Evidence:   truncateRunesSafe(profile.Reason, 400),
			Origin:     "ai",
		})
	}
	return candidates
}

// ProfileConfidenceLabel maps numeric identification confidence to the labels
// used by ProductSpecDraft.
func ProfileConfidenceLabel(confidence float64) string {
	switch {
	case confidence >= 0.8:
		return "high"
	case confidence >= 0.5:
		return "medium"
	default:
		return "low"
	}
}
