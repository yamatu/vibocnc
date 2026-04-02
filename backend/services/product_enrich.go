package services

import (
	"fmt"
	"strings"
)

func EnrichProductByBrand(brand string, model string) (EnrichedProduct, error) {
	b := NormalizeBrandKey(brand)
	if b == "" {
		return GenericEnrich(model), nil
	}
	switch b {
	case "fanuc":
		return FanucEnrich(model), nil
	case "mitsubishi":
		inference := InferProductCategory(b, model)
		upper := NormalizeProductModel(model)
		name := strings.TrimSpace(fmt.Sprintf("%s %s %s", inference.BrandName, upper, inference.PartType))
		shortDesc := limitLen(fmt.Sprintf("%s %s %s for industrial automation. Worldwide shipping available.", inference.BrandName, upper, inference.PartType), 200)
		desc := strings.Join([]string{
			name,
			"",
			"Overview",
			fmt.Sprintf("- Brand: %s", inference.BrandName),
			fmt.Sprintf("- Part No.: %s", upper),
			fmt.Sprintf("- Type: %s", inference.PartType),
			"- Condition: New / Refurbished / Used (please confirm before ordering)",
			"- Warranty: 12 months",
			"- Lead time: 3-7 days",
			"- Shipping: Worldwide",
		}, "\n")
		return EnrichedProduct{
			Name:              name,
			ShortDescription:  shortDesc,
			Description:       desc,
			MetaTitle:         buildMetaTitle(inference.BrandName, upper, inference.PartType),
			MetaDescription:   buildMetaDescription(inference.BrandName, upper, inference.PartType),
			MetaKeywords:      buildMetaKeywords(inference.BrandName, upper, inference.PartType),
			CompatibilityInfo: fmt.Sprintf("Confirm %s %s compatibility against your original part number and machine configuration before ordering.", inference.BrandName, upper),
			InstallationGuide: fmt.Sprintf("Install %s %s according to your machine maintenance procedure after isolating power and checking connector orientation.", inference.BrandName, upper),
			MaintenanceTips:   fmt.Sprintf("Keep %s %s clean, dry, and properly stored to support reliable industrial operation.", inference.BrandName, upper),
			PartType:          inference.PartType,
			CategorySlug:      inference.CategorySlug,
		}, nil
	default:
		inference := InferProductCategory(b, model)
		upper := NormalizeProductModel(model)
		name := strings.TrimSpace(fmt.Sprintf("%s %s %s", inference.BrandName, upper, inference.PartType))
		shortDesc := limitLen(fmt.Sprintf("%s %s %s for industrial automation. Worldwide shipping available.", inference.BrandName, upper, inference.PartType), 200)
		return EnrichedProduct{
			Name:              name,
			ShortDescription:  shortDesc,
			Description:       strings.TrimSpace(name),
			MetaTitle:         buildMetaTitle(inference.BrandName, upper, inference.PartType),
			MetaDescription:   buildMetaDescription(inference.BrandName, upper, inference.PartType),
			MetaKeywords:      buildMetaKeywords(inference.BrandName, upper, inference.PartType),
			CompatibilityInfo: fmt.Sprintf("Confirm %s %s compatibility against your original part number and machine configuration before ordering.", inference.BrandName, upper),
			InstallationGuide: fmt.Sprintf("Install %s %s according to your machine maintenance procedure after isolating power and checking connector orientation.", inference.BrandName, upper),
			MaintenanceTips:   fmt.Sprintf("Keep %s %s clean, dry, and properly stored to support reliable industrial operation.", inference.BrandName, upper),
			PartType:          inference.PartType,
			CategorySlug:      inference.CategorySlug,
		}, nil
	}
}

func GenericEnrich(model string) EnrichedProduct {
	upper := NormalizeProductModel(model)
	inference := InferProductCategory("", upper)
	if upper == "" {
		upper = "Industrial Automation Part"
	}
	name := strings.TrimSpace(fmt.Sprintf("%s %s", upper, inference.PartType))
	shortDesc := limitLen(fmt.Sprintf("%s for industrial automation maintenance, repair, and replacement. Worldwide shipping available.", name), 200)
	description := strings.Join([]string{
		name,
		"",
		"Overview",
		fmt.Sprintf("- Part No.: %s", upper),
		fmt.Sprintf("- Type: %s", inference.PartType),
		"- Condition: New / Refurbished / Used (please confirm before ordering)",
		"- Warranty: 12 months",
		"- Lead time: 3-7 days",
		"- Shipping: Worldwide",
	}, "\n")

	return EnrichedProduct{
		Name:              name,
		ShortDescription:  shortDesc,
		Description:       description,
		MetaTitle:         buildMetaTitle("Industrial Automation", upper, inference.PartType),
		MetaDescription:   BuildSafeMetaDescription(fmt.Sprintf("%s %s for repair, replacement, and industrial automation support. Compatibility check, 12-month warranty, fast worldwide shipping.", upper, inference.PartType)),
		MetaKeywords:      strings.Join(dedupeStrings([]string{upper, inference.PartType, "industrial automation parts", "CNC replacement parts", "Vcocnc"}), ", "),
		CompatibilityInfo: fmt.Sprintf("Confirm compatibility for %s against your original part number, controller model, machine model, and option code before ordering.", upper),
		InstallationGuide: fmt.Sprintf("Install %s according to your machine maintenance procedure after isolating power and checking connector orientation.", upper),
		MaintenanceTips:   fmt.Sprintf("Keep %s clean, dry, and properly stored to support reliable industrial operation.", upper),
		PartType:          inference.PartType,
		CategorySlug:      inference.CategorySlug,
	}
}
