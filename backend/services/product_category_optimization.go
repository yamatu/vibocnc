package services

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"fanuc-backend/models"
	"fanuc-backend/utils"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// ProductCategoryOptimizationOptions controls the explicit administrator-only
// taxonomy repair flow. Category creation is deliberately opt-in and is not
// used by imports, ordinary AI SEO jobs, or the AI assistant. The dedicated
// administrator category-only background job is the sole queued caller.
type ProductCategoryOptimizationOptions struct {
	UseWebSearch            bool
	CreateMissingCategories bool
	ActivateResolved        bool
	// BeforeWrite is used by background jobs to fence writes after a task was
	// cancelled or superseded. It is called inside the same transaction that
	// performs each category/product mutation.
	BeforeWrite func(*gorm.DB) error
	AuditJobID  string
}

type ProductCategoryOptimizationResult struct {
	ProductID       uint                     `json:"product_id"`
	SKU             string                   `json:"sku"`
	Status          string                   `json:"status"`
	Message         string                   `json:"message"`
	Brand           string                   `json:"brand,omitempty"`
	Model           string                   `json:"model,omitempty"`
	PartType        string                   `json:"part_type,omitempty"`
	MatchRule       string                   `json:"match_rule,omitempty"`
	CategoryID      uint                     `json:"category_id,omitempty"`
	CategoryPath    string                   `json:"category_path,omitempty"`
	CategoryCreated bool                     `json:"category_created"`
	Evidence        []ProductWebEvidence     `json:"evidence,omitempty"`
	Inference       ProductCategoryInference `json:"inference"`
}

var categoryCreationMu sync.Mutex

// OptimizeProductCategory verifies one product's brand and product type,
// resolves an active brand/type leaf, and applies the category at the final
// transactional write boundary. Unresolved products are always kept inactive.
func OptimizeProductCategory(ctx context.Context, db *gorm.DB, product models.Product, opts ProductCategoryOptimizationOptions) ProductCategoryOptimizationResult {
	result := ProductCategoryOptimizationResult{
		ProductID: product.ID,
		SKU:       product.SKU,
		Status:    "failed",
	}
	if db == nil {
		result.Message = "database is nil"
		return result
	}
	if ctx == nil {
		ctx = context.Background()
	}

	model := productClassificationModel(product)
	result.Model = model
	brandInput := strings.TrimSpace(product.Brand)
	inference := InferProductCategory(brandInput, model)
	if !IsConfirmedProductCategory(inference, model) {
		if nameInference, ok := inferAdminNameCategory(brandInput, model, product.Name); ok {
			inference = nameInference
		}
	}
	var evidence []ProductWebEvidence
	var searchErr error
	if opts.UseWebSearch && !IsConfirmedProductCategory(inference, model) {
		searchCtx, cancel := context.WithTimeout(ctx, 12*time.Second)
		inference, evidence, searchErr = ResolveProductCategoryWithWebEvidence(searchCtx, brandInput, model)
		cancel()
	}
	result.Inference = inference
	result.Evidence = evidence
	result.PartType = strings.TrimSpace(inference.PartType)
	result.MatchRule = strings.TrimSpace(inference.MatchRule)
	result.Brand = strings.TrimSpace(inference.BrandName)
	if result.Brand == "" {
		result.Brand = CanonicalBrandName(brandInput)
	}

	if !IsConfirmedProductCategory(inference, model) {
		reason := ClassificationFailureReason(inference, model)
		if searchErr != nil {
			reason = fmt.Sprintf("%s; web verification failed: %v", reason, searchErr)
		}
		if err := keepProductInactiveWithGuard(db.WithContext(ctx), product.ID, result.Brand, opts.BeforeWrite); err != nil {
			result.Message = fmt.Sprintf("%s; failed to keep product inactive: %v", reason, err)
			return result
		}
		result.Status = "unresolved"
		result.Message = reason
		_ = writeClassificationAudit(db, product, result, opts.AuditJobID)
		return result
	}

	result = applyConfirmedCategoryInference(ctx, db, product, inference, result, opts)
	_ = writeClassificationAudit(db, product, result, opts.AuditJobID)
	return result
}

// ApplyProductCategoryInference assigns a category from an inference that was
// verified outside the deterministic rules — currently the administrator's
// LLM fallback in category jobs. The same resolve/create/validate/write path
// is used, so an unconfirmed inference can never publish a product.
func ApplyProductCategoryInference(ctx context.Context, db *gorm.DB, product models.Product, inference ProductCategoryInference, opts ProductCategoryOptimizationOptions) ProductCategoryOptimizationResult {
	result := ProductCategoryOptimizationResult{
		ProductID: product.ID,
		SKU:       product.SKU,
		Status:    "failed",
		Model:     productClassificationModel(product),
		Inference: inference,
	}
	if db == nil {
		result.Message = "database is nil"
		return result
	}
	if ctx == nil {
		ctx = context.Background()
	}
	result.PartType = strings.TrimSpace(inference.PartType)
	result.MatchRule = strings.TrimSpace(inference.MatchRule)
	result.Brand = strings.TrimSpace(inference.BrandName)
	if result.Brand == "" {
		result.Brand = CanonicalBrandName(inference.BrandKey)
	}
	if !isConfirmedInference(inference) {
		result.Status = "unresolved"
		result.Message = "classification is not verified"
		_ = writeClassificationAudit(db, product, result, opts.AuditJobID)
		return result
	}
	result = applyConfirmedCategoryInference(ctx, db, product, inference, result, opts)
	_ = writeClassificationAudit(db, product, result, opts.AuditJobID)
	return result
}

func writeClassificationAudit(db *gorm.DB, product models.Product, result ProductCategoryOptimizationResult, jobID string) error {
	if db == nil || product.ID == 0 {
		return nil
	}
	evidence, _ := json.Marshal(result.Evidence)
	return db.Create(&models.ProductClassificationAudit{ProductID: product.ID, JobID: jobID, Model: result.Model, BrandInput: product.Brand, Brand: result.Brand, ProductType: result.PartType, Status: result.Status, MatchRule: result.MatchRule, CategoryID: result.CategoryID, CategoryPath: result.CategoryPath, EvidenceJSON: string(evidence), Reason: result.Message}).Error
}

// RecordClassificationAudit lets non-category SEO flows persist the same
// decision record without duplicating the audit schema or JSON encoding.
func RecordClassificationAudit(db *gorm.DB, product models.Product, inference ProductCategoryInference, model string, evidence []ProductWebEvidence, status, reason, jobID string) error {
	result := ProductCategoryOptimizationResult{ProductID: product.ID, SKU: product.SKU, Model: model, Status: status, Message: reason, Brand: inference.BrandName, PartType: inference.PartType, MatchRule: inference.MatchRule, Evidence: evidence, Inference: inference}
	return writeClassificationAudit(db, product, result, jobID)
}

func applyConfirmedCategoryInference(ctx context.Context, db *gorm.DB, product models.Product, inference ProductCategoryInference, result ProductCategoryOptimizationResult, opts ProductCategoryOptimizationOptions) ProductCategoryOptimizationResult {
	categoryID, err := ResolveExistingCategoryForInference(db.WithContext(ctx), inference, product.Category.Name)
	created := false
	if (err != nil || categoryID == 0) && opts.CreateMissingCategories {
		categoryID, created, err = resolveOrCreateCategoryForInferenceWithGuard(db.WithContext(ctx), inference, opts.BeforeWrite)
	}
	if err != nil || categoryID == 0 {
		reason := fmt.Sprintf("no active category matches verified brand %q and product type %q", inference.BrandName, inference.PartType)
		if err != nil {
			reason = err.Error()
		}
		if inactiveErr := keepProductInactiveWithGuard(db.WithContext(ctx), product.ID, result.Brand, opts.BeforeWrite); inactiveErr != nil {
			result.Message = fmt.Sprintf("%s; failed to keep product inactive: %v", reason, inactiveErr)
			return result
		}
		result.Status = "unresolved"
		result.Message = reason
		return result
	}

	var categoryPath string
	err = db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if opts.BeforeWrite != nil {
			if guardErr := opts.BeforeWrite(tx); guardErr != nil {
				return guardErr
			}
		}
		// The category may have been disabled, moved, or gained children after
		// resolution. Re-validate under row locks before changing the product.
		path, validateErr := ValidateExistingCategoryForInference(tx, categoryID, inference)
		if validateErr != nil {
			return validateErr
		}
		categoryPath = path
		updates := map[string]any{
			"category_id": categoryID,
			"updated_at":  time.Now(),
		}
		if canonicalBrand := strings.TrimSpace(inference.BrandName); canonicalBrand != "" {
			updates["brand"] = canonicalBrand
		}
		if opts.ActivateResolved {
			updates["is_active"] = true
		}
		return tx.Model(&models.Product{}).Where("id = ?", product.ID).Updates(updates).Error
	})
	if err != nil {
		// Do not perform a second product write when a job fence rejected the
		// transaction: the administrator may already have ended this task.
		if opts.BeforeWrite == nil {
			_ = keepProductInactive(db.WithContext(ctx), product.ID, result.Brand)
		}
		result.Message = "final category validation failed: " + err.Error()
		return result
	}

	result.Status = "completed"
	result.Message = "category optimized"
	result.CategoryID = categoryID
	result.CategoryPath = categoryPath
	result.CategoryCreated = created
	return result
}

// ResolveOrCreateCategoryForInference is intentionally reserved for the
// explicit administrator category-optimization endpoint. It creates at most a
// canonical brand root and one verified type child. Existing inactive exact
// nodes are reactivated instead of duplicated.
func ResolveOrCreateCategoryForInference(db *gorm.DB, inference ProductCategoryInference) (uint, bool, error) {
	return resolveOrCreateCategoryForInferenceWithGuard(db, inference, nil)
}

func resolveOrCreateCategoryForInferenceWithGuard(db *gorm.DB, inference ProductCategoryInference, beforeWrite func(*gorm.DB) error) (uint, bool, error) {
	if db == nil {
		return 0, false, errors.New("database is nil")
	}
	if !isConfirmedInference(inference) {
		return 0, false, errors.New("product classification is unresolved")
	}
	brandName := strings.TrimSpace(inference.BrandName)
	if brandName == "" {
		brandName = CanonicalBrandName(inference.BrandKey)
	}
	partType := canonicalCategoryTypeName(inference.PartType)
	if brandName == "" || partType == "" || strings.EqualFold(partType, "Spare Part") {
		return 0, false, errors.New("verified brand and specific product type are required before creating a category")
	}

	categoryID := uint(0)
	created := false
	err := withCategoryCreationLock(func() error {
		return db.Transaction(func(tx *gorm.DB) error {
			if beforeWrite != nil {
				if err := beforeWrite(tx); err != nil {
					return err
				}
			}
			if existingID, resolveErr := ResolveExistingCategoryForInference(tx, inference, ""); resolveErr == nil && existingID > 0 {
				categoryID = existingID
				return nil
			}

			var categories []models.Category
			if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Order("id ASC").Find(&categories).Error; err != nil {
				return err
			}

			brandParent, brandFound := findExactBrandCategory(categories, inference.BrandKey, brandName)
			if brandFound {
				if !brandParent.IsActive {
					if err := tx.Model(&models.Category{}).Where("id = ?", brandParent.ID).Update("is_active", true).Error; err != nil {
						return err
					}
					brandParent.IsActive = true
				}
			} else {
				slug, err := uniqueCategorySlug(tx, utils.GenerateSlug(brandName))
				if err != nil {
					return err
				}
				brandParent = models.Category{
					Name:        brandName,
					Slug:        slug,
					Description: brandName + " industrial automation parts",
					IsActive:    true,
				}
				if err := tx.Create(&brandParent).Error; err != nil {
					return err
				}
				categories = append(categories, brandParent)
				created = true
			}

			childSlugBase := categorySlugForBrandType(inference.BrandKey, inference.CategorySlug, partType)
			if child, ok := findExactTypeChild(categories, brandParent.ID, partType, childSlugBase); ok {
				if !child.IsActive {
					if err := tx.Model(&models.Category{}).Where("id = ?", child.ID).Update("is_active", true).Error; err != nil {
						return err
					}
				}
				categoryID = child.ID
				return nil
			}
			// Legacy trees frequently differ only by pluralization or a stable type
			// synonym ("Servo Drives" versus "Servo Amplifier / Drive"). Reuse a
			// compatible child under the same brand before creating another node.
			if child, ok := findCompatibleTypeChild(categories, brandParent.ID, brandParent.Name, inference); ok {
				if !child.IsActive {
					if err := tx.Model(&models.Category{}).Where("id = ?", child.ID).Update("is_active", true).Error; err != nil {
						return err
					}
				}
				categoryID = child.ID
				return nil
			}

			slug, err := uniqueCategorySlug(tx, childSlugBase)
			if err != nil {
				return err
			}
			child := models.Category{
				Name:        partType,
				Slug:        slug,
				Description: fmt.Sprintf("%s %s", brandName, partType),
				ParentID:    uintPtrForCategoryOptimization(brandParent.ID),
				IsActive:    true,
			}
			if err := tx.Create(&child).Error; err != nil {
				return err
			}
			categoryID = child.ID
			created = true
			return nil
		})
	})
	if err != nil {
		return 0, false, err
	}
	if categoryID == 0 {
		return 0, false, errors.New("category creation did not produce a category")
	}
	return categoryID, created, nil
}

func inferAdminNameCategory(brand, model, productName string) (ProductCategoryInference, bool) {
	model = NormalizeProductModel(model)
	productName = strings.TrimSpace(productName)
	if model == "" || productName == "" || !containsExactProductIdentifier(productName, model) {
		return ProductCategoryInference{}, false
	}
	base := InferProductCategory(brand, model)
	brandKey := NormalizeBrandKey(base.BrandKey)
	if brandKey == "" {
		brandKey = inferBrandKeyFromModel(model)
	}
	// Names are administrator-controlled hints, not independent public proof.
	// Require a supported manufacturer identifiable from the supplied brand or
	// exact model family before trusting the specific type phrase in the name.
	if !isClassificationBrandAllowed(brandKey, "admin-name:type") {
		return ProductCategoryInference{}, false
	}
	inference := inferGenericCategoryInference(brandKey, productName)
	rule := strings.ToLower(strings.TrimSpace(inference.MatchRule))
	if strings.TrimSpace(inference.PartType) == "" || strings.EqualFold(inference.PartType, "Spare Part") || strings.Contains(rule, "fallback") || strings.Contains(rule, "empty-model") {
		return ProductCategoryInference{}, false
	}
	inference.BrandKey = brandKey
	inference.BrandName = CanonicalBrandName(brandKey)
	inference.MatchRule = "admin-name:type:" + utils.GenerateSlug(inference.PartType)
	if !IsConfirmedProductCategory(inference, model) {
		return ProductCategoryInference{}, false
	}
	return inference, true
}

func withCategoryCreationLock(fn func() error) error {
	categoryCreationMu.Lock()
	defer categoryCreationMu.Unlock()
	return fn()
}

func keepProductInactive(db *gorm.DB, productID uint, verifiedBrand string) error {
	return keepProductInactiveWithGuard(db, productID, verifiedBrand, nil)
}

func keepProductInactiveWithGuard(db *gorm.DB, productID uint, verifiedBrand string, beforeWrite func(*gorm.DB) error) error {
	updates := map[string]any{"is_active": false, "updated_at": time.Now()}
	if strings.TrimSpace(verifiedBrand) != "" {
		updates["brand"] = strings.TrimSpace(verifiedBrand)
	}
	return db.Transaction(func(tx *gorm.DB) error {
		if beforeWrite != nil {
			if err := beforeWrite(tx); err != nil {
				return err
			}
		}
		return tx.Model(&models.Product{}).Where("id = ?", productID).Updates(updates).Error
	})
}

func productClassificationModel(product models.Product) string {
	type candidate struct {
		value    string
		priority int
	}
	// PartNumber normally carries the manufacturer's complete ordering code,
	// while Model is sometimes only a broad family such as "MICROMASTER 4".
	// Score all fields so an exact manufacturer identifier wins without making
	// an internal SKU outrank a useful Model when PartNumber is absent.
	candidates := []candidate{
		{value: product.PartNumber, priority: 30},
		{value: product.Model, priority: 20},
		{value: product.SKU, priority: 10},
	}
	bestModel := ""
	bestScore := -1
	for _, candidate := range candidates {
		model := NormalizeProductModel(candidate.value)
		if model == "" {
			continue
		}
		score := candidate.priority + len(compactModel(model))
		if inferBrandKeyFromModel(model) != "" {
			score += 1000
		}
		if IsConfirmedProductCategory(InferProductCategory(product.Brand, model), model) {
			score += 2000
		}
		if score > bestScore {
			bestModel = model
			bestScore = score
		}
	}
	return bestModel
}

func canonicalCategoryTypeName(value string) string {
	return CanonicalProductType(value)
}

func categorySlugForBrandType(brandKey, inferredSlug, partType string) string {
	brandSlug := utils.GenerateSlug(CanonicalBrandName(brandKey))
	if brandSlug == "" {
		brandSlug = utils.GenerateSlug(brandKey)
	}
	typeSlug := utils.GenerateSlug(inferredSlug)
	if typeSlug == "" {
		typeSlug = utils.GenerateSlug(partType)
	}
	base := strings.Trim(strings.Join([]string{brandSlug, typeSlug}, "-"), "-")
	if base == "" {
		base = "product-category"
	}
	if len(base) > 90 {
		base = strings.TrimRight(base[:90], "-")
	}
	return base
}

func findExactBrandCategory(categories []models.Category, brandKey, brandName string) (models.Category, bool) {
	aliases := brandAliases(brandKey, brandName)
	wanted := make(map[string]bool, len(aliases)+2)
	for _, alias := range aliases {
		if normalized := taxonomyNormalize(alias); normalized != "" {
			wanted[normalized] = true
		}
	}
	wanted[taxonomyNormalize(brandName)] = true
	wanted[taxonomyNormalize(brandKey)] = true

	best := models.Category{}
	bestScore := -1
	for _, category := range categories {
		nameMatch := wanted[taxonomyNormalize(category.Name)]
		slugMatch := category.Slug == utils.GenerateSlug(brandName) || category.Slug == utils.GenerateSlug(brandKey)
		if !nameMatch && !slugMatch {
			continue
		}
		score := 0
		if category.ParentID == nil {
			score += 4
		}
		if nameMatch {
			score += 2
		}
		if category.IsActive {
			score++
		}
		if score > bestScore {
			best = category
			bestScore = score
		}
	}
	return best, bestScore >= 0
}

func findExactTypeChild(categories []models.Category, parentID uint, partType, slugBase string) (models.Category, bool) {
	wantedName := taxonomyNormalize(partType)
	for _, activePass := range []bool{true, false} {
		for _, category := range categories {
			if category.ParentID == nil || *category.ParentID != parentID || category.IsActive != activePass {
				continue
			}
			if taxonomyNormalize(category.Name) == wantedName || strings.EqualFold(strings.TrimSpace(category.Slug), strings.TrimSpace(slugBase)) {
				return category, true
			}
		}
	}
	return models.Category{}, false
}

func findCompatibleTypeChild(categories []models.Category, parentID uint, brandName string, inference ProductCategoryInference) (models.Category, bool) {
	for _, activePass := range []bool{true, false} {
		best := models.Category{}
		bestScore := 0
		for _, category := range categories {
			if category.ParentID == nil || *category.ParentID != parentID || category.IsActive != activePass {
				continue
			}
			score := CategoryPathMatchScore(strings.Join([]string{brandName, category.Name}, " > "), inference)
			if score > bestScore {
				best = category
				bestScore = score
			}
		}
		if bestScore > 0 {
			return best, true
		}
	}
	return models.Category{}, false
}

func uniqueCategorySlug(db *gorm.DB, base string) (string, error) {
	base = strings.Trim(strings.TrimSpace(base), "-")
	if base == "" {
		base = "product-category"
	}
	// Leave room for the numeric collision suffix within Category.Slug's
	// 100-character database limit.
	if len(base) > 90 {
		base = strings.TrimRight(base[:90], "-")
	}
	for suffix := 0; suffix < 10000; suffix++ {
		candidate := base
		if suffix > 0 {
			candidate = fmt.Sprintf("%s-%d", base, suffix+1)
		}
		var count int64
		if err := db.Model(&models.Category{}).Where("slug = ?", candidate).Count(&count).Error; err != nil {
			return "", err
		}
		if count == 0 {
			return candidate, nil
		}
	}
	return "", errors.New("could not allocate a unique category slug")
}

func uintPtrForCategoryOptimization(value uint) *uint {
	copy := value
	return &copy
}
