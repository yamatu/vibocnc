package services

import (
	"fmt"
	"strings"

	"fanuc-backend/models"
)

// BuildDefaultProductSEO produces the fallback content for a stored product.
// It delegates to the brand-agnostic skeleton so the commercial promise comes
// from the admin-editable commerce policy instead of hard-coded text, and any
// specification already known by the catalogue is published rather than left
// empty.
func BuildDefaultProductSEO(product *models.Product) EnrichedProduct {
	if product == nil {
		return EnrichedProduct{}
	}

	brandLabel := CanonicalBrandName(product.Brand)
	if brandLabel == "" {
		brandLabel = "Industrial Automation"
	}

	enriched := EnrichProductForRecord(product)

	model := NormalizeProductModel(product.Model)
	if model == "" {
		model = NormalizeProductModel(product.PartNumber)
	}
	if model == "" {
		model = NormalizeProductModel(product.SKU)
	}

	// Without a model number the meta title has to fall back to the stored name,
	// which is what the indexed page already uses.
	if strings.TrimSpace(model) == "" {
		label := strings.TrimSpace(product.Name)
		if label == "" {
			label = strings.TrimSpace(enriched.PartType)
		}
		if label != "" {
			enriched.Name = label
			enriched.MetaTitle = BuildSafeMetaTitle(
				fmt.Sprintf("%s %s | Vibocnc", brandLabel, label),
				fmt.Sprintf("%s | Vibocnc", label),
			)
		}
	}

	if strings.TrimSpace(enriched.Name) == "" {
		enriched.Name = strings.TrimSpace(product.Name)
	}

	return enriched
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
