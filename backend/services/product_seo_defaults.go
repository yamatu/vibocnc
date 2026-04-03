package services

import (
	"fmt"
	"strings"

	"fanuc-backend/models"
)

func BuildDefaultProductSEO(product *models.Product) EnrichedProduct {
	if product == nil {
		return EnrichedProduct{}
	}

	brand := CanonicalBrandName(product.Brand)
	model := NormalizeProductModel(product.Model)
	if model == "" {
		model = NormalizeProductModel(product.PartNumber)
	}
	if model == "" {
		model = NormalizeProductModel(product.SKU)
	}
	if model == "" {
		model = strings.TrimSpace(product.SKU)
	}

	inference := InferProductCategory(brand, model)
	partType := inference.PartType
	if strings.TrimSpace(partType) == "" {
		partType = "Spare Part"
	}

	brandLabel := brand
	if brandLabel == "" {
		brandLabel = "Industrial Automation"
	}
	partsBrandLabel := brand
	if partsBrandLabel == "" {
		partsBrandLabel = "industrial automation"
	}

	nameParts := []string{brand, model, partType}
	name := strings.TrimSpace(strings.Join(filterNonEmpty(nameParts), " "))
	if name == "" {
		name = strings.TrimSpace(strings.Join(filterNonEmpty([]string{model, partType}), " "))
	}
	if name == "" {
		name = strings.TrimSpace(product.Name)
	}

	shortDesc := limitLen(fmt.Sprintf(
		"%s %s for industrial automation maintenance, repair, and replacement. 12-month warranty and worldwide shipping available.",
		brandLabel,
		model,
	), 200)

	descriptionLines := []string{
		name,
		"",
		"Overview",
	}
	if brand != "" {
		descriptionLines = append(descriptionLines, fmt.Sprintf("- Brand: %s", brand))
	}
	if model != "" {
		descriptionLines = append(descriptionLines, fmt.Sprintf("- Part No.: %s", model))
	}
	descriptionLines = append(descriptionLines,
		fmt.Sprintf("- Type: %s", partType),
		"- Condition: New / Refurbished / Used (please confirm before ordering)",
		"- Warranty: 12 months",
		"- Lead time: 3-7 days",
		"- Shipping: Worldwide",
	)

	return EnrichedProduct{
		Name:             name,
		ShortDescription: shortDesc,
		Description:      strings.Join(descriptionLines, "\n"),
		MetaTitle: BuildSafeMetaTitle(
			fmt.Sprintf("%s %s %s | Vcocnc", brandLabel, model, partType),
			fmt.Sprintf("%s %s | Vcocnc", brandLabel, model),
			fmt.Sprintf("%s %s | Vcocnc", model, partType),
			fmt.Sprintf("%s | Vcocnc", model),
			fmt.Sprintf("%s | Vcocnc", strings.TrimSpace(product.Name)),
		),
		MetaDescription: BuildSafeMetaDescription(
			fmt.Sprintf("%s %s %s for industrial automation repair and replacement. Compatibility support, 12-month warranty, and fast worldwide shipping.", brandLabel, model, partType),
			fmt.Sprintf("%s %s for industrial automation support. Worldwide shipping and 12-month warranty available.", brandLabel, model),
			fmt.Sprintf("%s %s available from Vcocnc with compatibility support and global delivery.", model, partType),
		),
		MetaKeywords: strings.Join(dedupeStrings(filterNonEmpty([]string{
			strings.TrimSpace(product.SKU),
			model,
			strings.TrimSpace(product.PartNumber),
			strings.TrimSpace(product.Name),
			brandLabel + " " + partType,
			partsBrandLabel + " parts",
			"industrial automation parts",
			"CNC replacement parts",
			"Vcocnc",
		})), ", "),
		CompatibilityInfo: fmt.Sprintf("Confirm compatibility for %s against your original part number, controller model, machine model, and option code before ordering.", model),
		InstallationGuide: fmt.Sprintf("Install %s according to your machine maintenance procedure after isolating power and checking connector orientation.", model),
		MaintenanceTips:   fmt.Sprintf("Keep %s clean, dry, and properly stored to support reliable industrial operation.", model),
		PartType:          partType,
		CategorySlug:      inference.CategorySlug,
	}
}

func filterNonEmpty(values []string) []string {
	out := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value != "" {
			out = append(out, value)
		}
	}
	return out
}
