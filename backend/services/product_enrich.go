package services

import (
	"fmt"
	"strings"
)

func EnrichProductByBrand(brand string, model string) (EnrichedProduct, error) {
	b := strings.ToLower(strings.TrimSpace(brand))
	if b == "" {
		b = "fanuc"
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
