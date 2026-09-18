package controllers

import (
	"context"
	"errors"
	"strings"
	"time"

	"fanuc-backend/models"
	"fanuc-backend/services"

	"gorm.io/gorm"
)

type automaticProductOptimizationResult struct {
	ContentUpdated bool
	FAQUpdated     bool
	SEOScore       float64
}

type automaticProductOptimizationOptions struct {
	ForceCategory bool
	BrandOverride string
	// PreserveActivation keeps an administrator's explicit is_active choice.
	// The automatic classification gate must never silently unpublish a product
	// the operator just enabled in the admin form: the model number alone may be
	// unresolved while the operator confirmed the category and identity by hand.
	PreserveActivation bool
}

func optimizeProductAfterSave(db *gorm.DB, productID uint) (automaticProductOptimizationResult, error) {
	return optimizeProductAfterSaveWithCategoryMap(db, productID, nil, automaticProductOptimizationOptions{})
}

func optimizeProductAfterSaveWithCategoryMap(db *gorm.DB, productID uint, catBySlug map[string]uint, opts automaticProductOptimizationOptions) (automaticProductOptimizationResult, error) {
	result := automaticProductOptimizationResult{}
	if db == nil || productID == 0 {
		return result, nil
	}

	var product models.Product
	if err := db.Preload("Category").First(&product, productID).Error; err != nil {
		return result, err
	}

	brandInput := strings.TrimSpace(product.Brand)
	if override := services.CanonicalBrandName(opts.BrandOverride); override != "" {
		brandInput = override
	}
	brandName := services.CanonicalBrandName(brandInput)

	model := services.NormalizeProductModel(product.Model)
	if model == "" {
		model = services.NormalizeProductModel(product.PartNumber)
	}
	if model == "" {
		model = services.NormalizeProductModel(product.SKU)
	}
	if model == "" {
		model = strings.TrimSpace(product.SKU)
	}

	// An active product saved from the admin form keeps its published state even
	// when the automatic classifier cannot confirm the model.
	preserveActivation := opts.PreserveActivation && product.IsActive

	inference := services.InferProductCategory(brandInput, model)
	if !services.IsConfirmedProductCategory(inference, model) {
		searchCtx, cancel := context.WithTimeout(context.Background(), 12*time.Second)
		inference, _, _ = services.ResolveProductCategoryWithWebEvidence(searchCtx, brandInput, model)
		cancel()
	}
	if (services.NormalizeBrandKey(brandInput) == "" || services.NormalizeBrandKey(brandInput) == "unknown") && inference.BrandKey != "" && inference.BrandKey != "unknown" {
		brandInput = inference.BrandKey
	}
	brandName = services.CanonicalBrandName(brandInput)
	updateData := map[string]any{}

	if brandName != "" && (services.NormalizeBrandKey(product.Brand) == "" || strings.TrimSpace(opts.BrandOverride) != "") {
		updateData["brand"] = brandName
		product.Brand = brandName
	}
	if strings.TrimSpace(product.Model) == "" && model != "" {
		updateData["model"] = model
		product.Model = model
	}
	if strings.TrimSpace(product.PartNumber) == "" && model != "" {
		updateData["part_number"] = model
		product.PartNumber = model
	}

	// Automatic optimization shares the same publication gate as imports and
	// AI SEO jobs. A slug-only lookup could silently route an unknown model into
	// a generic node, so resolve the active leaf from the complete brand/type
	// path instead.
	if !services.IsConfirmedProductCategory(inference, model) {
		_, categoryChanged := updateData["category_id"]
		if autoClassificationForcesInactive(product.IsActive, categoryChanged, preserveActivation) {
			updateData["is_active"] = false
			product.IsActive = false
		}
	} else {
		categoryID, categoryErr := services.ResolveExistingCategoryForInference(db, inference, product.Category.Name)
		if categoryErr != nil || categoryID == 0 {
			// A recognized model is still not publishable unless the active
			// taxonomy contains a compatible leaf. Keep the record for review.
			if autoClassificationForcesInactive(product.IsActive, false, preserveActivation) {
				updateData["is_active"] = false
				product.IsActive = false
			}
		} else if product.CategoryID == 0 || product.CategoryID != categoryID {
			updateData["category_id"] = categoryID
			product.CategoryID = categoryID
		}
	}

	if product.CategoryID != 0 && (product.Category.ID != product.CategoryID || strings.TrimSpace(product.Category.Name) == "") {
		var category models.Category
		if err := db.Select("id", "name", "slug").First(&category, product.CategoryID).Error; err == nil {
			product.Category = category
		}
	}
	if strings.TrimSpace(product.Category.Name) == "" {
		product.Category = models.Category{
			ID:   product.CategoryID,
			Name: inference.PartType,
			Slug: inference.CategorySlug,
		}
	}

	optimizer := &ProductOptimizationController{}

	if product.DisableAutoSEO {
		result.ContentUpdated = optimizer.applyDefaultContentForDisabledAutoSEO(&product, updateData)
		applyProductUpdateData(&product, updateData)

		seoScore := optimizer.calculateSEOScore(&product)
		now := time.Now()
		updateData["seo_score"] = seoScore
		updateData["last_optimized_at"] = &now
		updateData["updated_at"] = now

		if err := persistAutomaticProductUpdates(db, product, updateData, inference, model, !preserveActivation); err != nil {
			return result, err
		}

		applyProductUpdateData(&product, updateData)
		result.SEOScore = seoScore
		return result, nil
	}

	result.ContentUpdated = optimizer.enhanceProductContent(&product, updateData)
	applyProductUpdateData(&product, updateData)

	seoScore := optimizer.calculateSEOScore(&product)
	now := time.Now()
	updateData["seo_score"] = seoScore
	updateData["last_optimized_at"] = &now
	updateData["updated_at"] = now

	if err := persistAutomaticProductUpdates(db, product, updateData, inference, model, !preserveActivation); err != nil {
		return result, err
	}

	applyProductUpdateData(&product, updateData)
	if err := upsertGeneratedProductFAQs(db, &product, inference.PartType); err != nil {
		return result, err
	}

	result.FAQUpdated = true
	result.SEOScore = seoScore
	return result, nil
}

func persistAutomaticProductUpdates(db *gorm.DB, product models.Product, updateData map[string]any, inference services.ProductCategoryInference, model string, enforcePublicationGate bool) error {
	return db.Transaction(func(tx *gorm.DB) error {
		// Recheck the taxonomy at the final write boundary. If this product is
		// going to remain public, the selected category must still be an active
		// matching leaf after any concurrent administrator edits. An explicitly
		// enabled product skips the gate: the administrator confirmed the
		// category, so a weak model match must not re-hide it.
		if shouldEnforcePublicationGate(product, enforcePublicationGate) {
			if !services.IsConfirmedProductCategory(inference, model) {
				return errors.New("product classification is unresolved")
			}
			if _, err := services.ValidateExistingCategoryForInference(tx, product.CategoryID, inference); err != nil {
				return err
			}
		}
		return tx.Model(&models.Product{}).Where("id = ?", product.ID).Updates(updateData).Error
	})
}

// autoClassificationForcesInactive reports whether the model-only classifier
// must unpublish the record. An explicit manual activation (PreserveActivation)
// opts out so the admin form stays authoritative.
func autoClassificationForcesInactive(productWasActive bool, categoryChanged bool, preserveActivation bool) bool {
	if preserveActivation {
		return false
	}
	return productWasActive || categoryChanged
}

// shouldEnforcePublicationGate reports whether the automatic pipeline must run
// the taxonomy gate before writing. A manually activated product skips it.
func shouldEnforcePublicationGate(product models.Product, enforcePublicationGate bool) bool {
	return product.IsActive && enforcePublicationGate
}

func applyProductUpdateData(product *models.Product, updateData map[string]any) {
	if product == nil {
		return
	}

	for key, value := range updateData {
		switch key {
		case "name":
			if v, ok := value.(string); ok {
				product.Name = v
			}
		case "short_description":
			if v, ok := value.(string); ok {
				product.ShortDescription = v
			}
		case "description":
			if v, ok := value.(string); ok {
				product.Description = v
			}
		case "meta_title":
			if v, ok := value.(string); ok {
				product.MetaTitle = v
			}
		case "meta_description":
			if v, ok := value.(string); ok {
				product.MetaDescription = v
			}
		case "meta_keywords":
			if v, ok := value.(string); ok {
				product.MetaKeywords = v
			}
		case "compatibility_info":
			if v, ok := value.(string); ok {
				product.CompatibilityInfo = v
			}
		case "installation_guide":
			if v, ok := value.(string); ok {
				product.InstallationGuide = v
			}
		case "maintenance_tips":
			if v, ok := value.(string); ok {
				product.MaintenanceTips = v
			}
		case "technical_specs":
			if v, ok := value.(string); ok {
				product.TechnicalSpecs = v
			}
		case "warranty_period":
			if v, ok := value.(string); ok {
				product.WarrantyPeriod = v
			}
		case "manufacturer":
			if v, ok := value.(string); ok {
				product.Manufacturer = v
			}
		case "origin_country":
			if v, ok := value.(string); ok {
				product.OriginCountry = v
			}
		case "lead_time":
			if v, ok := value.(string); ok {
				product.LeadTime = v
			}
		case "brand":
			if v, ok := value.(string); ok {
				product.Brand = v
			}
		case "disable_auto_seo":
			if v, ok := value.(bool); ok {
				product.DisableAutoSEO = v
			}
		case "model":
			if v, ok := value.(string); ok {
				product.Model = v
			}
		case "part_number":
			if v, ok := value.(string); ok {
				product.PartNumber = v
			}
		case "category_id":
			switch v := value.(type) {
			case uint:
				product.CategoryID = v
			case int:
				product.CategoryID = uint(v)
			case int64:
				product.CategoryID = uint(v)
			}
		case "seo_score":
			if v, ok := value.(float64); ok {
				product.SEOScore = v
			}
		case "last_optimized_at":
			if v, ok := value.(*time.Time); ok {
				product.LastOptimizedAt = v
			}
		}
	}
}
