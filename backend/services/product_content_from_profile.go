package services

import (
	"strings"

	"fanuc-backend/models"
)

// This file turns an approved AI product profile into the storefront-facing
// fields. It is the second half of the identification feature: the profile says
// what the part is, these builders say how it is presented.
//
// Everything here is deterministic. Given the same profile and policy it always
// produces the same text, so an administrator can review it before it is
// written and the result can be re-derived later during an audit.

// ProfileTitleProposal is a title built from a verified product profile.
type ProfileTitleProposal struct {
	Status   string `json:"status"`
	Message  string `json:"message,omitempty"`
	Brand    string `json:"brand,omitempty"`
	Model    string `json:"model,omitempty"`
	PartType string `json:"part_type,omitempty"`
	OldName  string `json:"old_name"`
	NewName  string `json:"new_name,omitempty"`
}

// BuildProfileProductTitle composes the canonical storefront title from a
// profile: "FANUC A06B-6077-H106 Servo Amplifier".
//
// The profile must be confident and specific. A low-confidence or generic
// profile is reported as unresolved rather than shipped as a vague title,
// because a wrong title is worse than the one already in place.
func BuildProfileProductTitle(profile ProductProfile, currentName string) ProfileTitleProposal {
	proposal := ProfileTitleProposal{
		OldName: currentName,
		Status:  "unresolved",
		Model:   strings.TrimSpace(profile.Model),
	}

	brand := strings.TrimSpace(profile.Brand)
	partType := strings.TrimSpace(profile.PartType)

	if brand == "" || partType == "" {
		proposal.Message = "profile did not establish both a brand and a specific product type"
		return proposal
	}
	if IsGenericProductType(partType) {
		proposal.Message = "profile product type is still generic"
		return proposal
	}
	if profile.Confidence < 0.5 {
		proposal.Message = "profile confidence is too low to rename the product"
		return proposal
	}
	if proposal.Model == "" {
		proposal.Message = "profile has no model number"
		return proposal
	}

	proposal.Brand = brand
	proposal.PartType = canonicalCategoryTypeName(partType)
	newName := composeStandardProductTitle(brand, proposal.Model, proposal.PartType)
	proposal.NewName = newName

	if strings.EqualFold(strings.TrimSpace(currentName), newName) {
		proposal.Status = "skipped"
		proposal.Message = "name already matches the identified profile"
		return proposal
	}
	proposal.Status = "ready"
	return proposal
}

// ProfileContent holds every text field a profile can fill.
type ProfileContent struct {
	ShortDescription  string            `json:"short_description"`
	Description       string            `json:"description"`
	MetaTitle         string            `json:"meta_title"`
	MetaDescription   string            `json:"meta_description"`
	MetaKeywords      string            `json:"meta_keywords"`
	CompatibilityInfo string            `json:"compatibility_info"`
	Applications      string            `json:"applications"`
	TechnicalSpecs    map[string]string `json:"technical_specs,omitempty"`
	SpecSources       map[string]string `json:"spec_sources,omitempty"`
}

// BuildProfileContent derives the product copy from a profile.
//
// `catalog` carries the fields only the catalogue knows (SKU, condition,
// origin). The commerce policy supplies the logistics promises, so this
// function never hardcodes a warranty or transit time.
func BuildProfileContent(profile ProductProfile, catalog ProfileContentCatalog) ProfileContent {
	policy := CurrentCommercePolicy()
	brand := strings.TrimSpace(profile.Brand)
	model := strings.TrimSpace(profile.Model)
	partType := strings.TrimSpace(profile.PartType)

	subject := strings.TrimSpace(strings.Join(nonEmptyStrings(brand, model, partType), " "))
	if subject == "" {
		subject = model
	}

	content := ProfileContent{}

	// Short description: what it is, in one line.
	summary := strings.TrimSpace(profile.WhatItIs)
	if summary == "" {
		summary = "Original " + partType + " for " + brand + " automation equipment."
	}
	content.ShortDescription = truncateRunesSafe(summary, 300)

	// Description: identity, function, application, then the commercial promise.
	var builder strings.Builder
	builder.WriteString("## " + subject + "\n\n")
	builder.WriteString(summary)
	builder.WriteString("\n\n")

	if len(profile.KeyFunctions) > 0 {
		builder.WriteString("### Key functions\n\n")
		for _, item := range profile.KeyFunctions {
			builder.WriteString("- " + item + "\n")
		}
		builder.WriteString("\n")
	}
	if len(profile.Applications) > 0 {
		builder.WriteString("### Typical applications\n\n")
		for _, item := range profile.Applications {
			builder.WriteString("- " + item + "\n")
		}
		builder.WriteString("\n")
	}

	if len(profile.Specs) > 0 {
		builder.WriteString("### Specifications\n\n")
		for _, spec := range profile.Specs {
			builder.WriteString("- **" + spec.Label + ":** " + spec.Value + "\n")
		}
		builder.WriteString("\n")
	}

	if compliance := profileComplianceParagraph(catalog, policy); compliance != "" {
		builder.WriteString(compliance)
		builder.WriteString("\n\n")
	}
	builder.WriteString(CommercePolicyWarrantyText(policy) + " " + CommercePolicyLeadTimeText(policy))
	content.Description = strings.TrimSpace(builder.String())

	// SEO: identity first, then the commercial promise.
	content.MetaTitle = truncateRunesSafe(subject, 60)

	metaDescription := summary
	if catalog.SKU != "" {
		metaDescription = subject + " — " + summary
	}
	content.MetaDescription = truncateRunesSafe(metaDescription, 160)

	keywords := []string{model, brand, partType}
	keywords = append(keywords, profile.CompatibleWith...)
	content.MetaKeywords = truncateRunesSafe(strings.Join(uniqueNonEmptyStrings(keywords...), ", "), 255)

	if len(profile.CompatibleWith) > 0 {
		content.CompatibilityInfo = "Compatible with: " + strings.Join(profile.CompatibleWith, ", ") + "."
	}

	if len(profile.Applications) > 0 {
		content.Applications = strings.Join(profile.Applications, ", ")
	}

	if len(profile.Specs) > 0 {
		specs := make(map[string]string, len(profile.Specs))
		sources := make(map[string]string, len(profile.Specs))
		for _, spec := range profile.Specs {
			specs[spec.Label] = spec.Value
			if spec.Source != "" {
				sources[spec.Label] = spec.Source
			}
		}
		content.TechnicalSpecs = specs
		content.SpecSources = sources
	}

	return content
}

// ProfileContentCatalog carries the catalogue-owned facts the profile cannot
// know. Every field is optional; empty values are simply not mentioned.
type ProfileContentCatalog struct {
	SKU           string
	Condition     string
	OriginCountry string
	Manufacturer  string
	DatasheetURL  string
}

// profileComplianceParagraph describes condition, origin and documentation.
// It only states what the catalogue actually holds.
func profileComplianceParagraph(catalog ProfileContentCatalog, policy models.CommercePolicySetting) string {
	parts := []string{}
	if value := strings.TrimSpace(catalog.Condition); value != "" {
		parts = append(parts, "Condition: "+value+".")
	}
	if value := strings.TrimSpace(catalog.OriginCountry); value != "" {
		parts = append(parts, "Origin: "+value+".")
	}
	if value := strings.TrimSpace(catalog.DatasheetURL); value != "" {
		parts = append(parts, "Documentation is available on request.")
	}
	if len(parts) == 0 {
		return ""
	}
	return "### Product details\n\n" + strings.Join(parts, " ")
}

func nonEmptyStrings(values ...string) []string {
	out := make([]string, 0, len(values))
	for _, value := range values {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			out = append(out, trimmed)
		}
	}
	return out
}
