package services

import (
	"fanuc-backend/models"
)

// EnrichProductByBrand generates catalogue copy for any supported brand. All
// brands share one content skeleton (see product_content_skeleton.go) so the
// structure, the compliance wording and the commercial promise stay consistent
// whether the part is FANUC, Mitsubishi, Siemens, ABB or something else.
func EnrichProductByBrand(brand string, model string) (EnrichedProduct, error) {
	brandKey := NormalizeBrandKey(brand)
	if brandKey == "" || brandKey == "unknown" {
		if inferred := inferBrandKeyFromModel(model); inferred != "" {
			brandKey = inferred
		}
	}
	if brandKey == "" || brandKey == "unknown" {
		return GenericEnrich(model), nil
	}
	return enrichWithContentSkeleton(brandKey, CanonicalBrandName(brandKey), model, nil), nil
}

// EnrichProductForRecord enriches a stored product. It has access to catalogue
// fields (condition, weight, dimensions, MOQ, packaging) which are folded into
// the specification table instead of being invented.
func EnrichProductForRecord(product *models.Product) EnrichedProduct {
	if product == nil {
		return GenericEnrich("")
	}
	brandKey := NormalizeBrandKey(product.Brand)
	if brandKey == "" || brandKey == "unknown" {
		if inferred := inferBrandKeyFromModel(firstNonEmpty(product.Model, product.PartNumber, product.SKU)); inferred != "" {
			brandKey = inferred
		}
	}
	model := firstNonEmpty(product.Model, product.PartNumber, product.SKU)
	if brandKey == "" || brandKey == "unknown" {
		return enrichWithoutBrand(model, product)
	}
	return enrichWithContentSkeleton(brandKey, CanonicalBrandName(brandKey), model, product)
}

func GenericEnrich(model string) EnrichedProduct {
	return enrichWithoutBrand(model, nil)
}

// enrichWithoutBrand covers records where no brand could be established. It uses
// the same skeleton, labelled as a generic industrial automation part, rather
// than a separate "thin" template.
func enrichWithoutBrand(model string, product *models.Product) EnrichedProduct {
	normalizedModel := NormalizeProductModel(model)
	if normalizedModel == "" && product != nil {
		normalizedModel = NormalizeProductModel(firstNonEmpty(product.Model, product.PartNumber, product.SKU))
	}

	inference := InferProductCategory("", normalizedModel)
	return BuildProductContentSkeleton(ContentSkeletonInput{
		BrandKey:     "",
		BrandName:    "Industrial Automation",
		Model:        normalizedModel,
		PartType:     inference.PartType,
		CategorySlug: inference.CategorySlug,
		Product:      product,
		Policy:       CurrentCommercePolicy(),
	})
}
