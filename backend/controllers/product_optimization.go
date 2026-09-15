package controllers

import (
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"fanuc-backend/config"
	"fanuc-backend/models"
	"fanuc-backend/services"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// ProductOptimizationController handles product content optimization
type ProductOptimizationController struct{}

// OptimizeProduct optimizes a single product's SEO content
func (poc *ProductOptimizationController) OptimizeProduct(c *gin.Context) {
	var request models.ProductOptimizationRequest
	if err := c.ShouldBindJSON(&request); err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{
			Success: false,
			Message: "Invalid request",
			Error:   err.Error(),
		})
		return
	}

	db := config.GetDB()
	if db == nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{
			Success: false,
			Message: "Database connection failed",
		})
		return
	}

	// Get the product with category for category-aware optimization
	var product models.Product
	if err := db.Preload("Category").First(&product, request.ProductID).Error; err != nil {
		c.JSON(http.StatusNotFound, models.APIResponse{
			Success: false,
			Message: "Product not found",
		})
		return
	}

	// Check if optimization is needed
	if !request.ForceUpdate && product.LastOptimizedAt != nil {
		// Check if product was optimized recently (within 7 days)
		if time.Since(*product.LastOptimizedAt) < 7*24*time.Hour {
			c.JSON(http.StatusOK, models.ProductOptimizationResponse{
				ProductID:          request.ProductID,
				SKU:                product.SKU,
				OptimizationStatus: "skipped",
				ContentUpdated:     false,
				SEOScoreBefore:     product.SEOScore,
				SEOScoreAfter:      product.SEOScore,
				Message:            "Product was recently optimized",
			})
			return
		}
	}

	if override := services.CanonicalBrandName(request.Brand); override != "" {
		product.Brand = override
	}

	seoBefore := product.SEOScore

	// Calculate SEO score and update product
	seoScore := poc.calculateSEOScore(&product)
	now := time.Now()

	// Update product with optimization timestamp and score
	updateData := map[string]interface{}{
		"seo_score":         seoScore,
		"last_optimized_at": &now,
		"updated_at":        now,
	}
	if override := services.CanonicalBrandName(request.Brand); override != "" {
		updateData["brand"] = override
	}

	// Enhance content if needed
	contentUpdated := poc.enhanceProductContent(&product, updateData)

	if err := db.Model(&product).Updates(updateData).Error; err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{
			Success: false,
			Message: "Failed to update product",
			Error:   err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, models.ProductOptimizationResponse{
		ProductID:          request.ProductID,
		SKU:                product.SKU,
		OptimizationStatus: "completed",
		ContentUpdated:     contentUpdated,
		SEOScoreBefore:     seoBefore,
		SEOScoreAfter:      seoScore,
		Message:            "Product optimization completed successfully",
	})
}

// BulkOptimizeProducts optimizes multiple products
func (poc *ProductOptimizationController) BulkOptimizeProducts(c *gin.Context) {
	var request models.BulkOptimizationRequest
	if err := c.ShouldBindJSON(&request); err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{
			Success: false,
			Message: "Invalid request",
			Error:   err.Error(),
		})
		return
	}

	db := config.GetDB()
	if db == nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{
			Success: false,
			Message: "Database connection failed",
		})
		return
	}

	var products []models.Product
	query := db.Preload("Category").Where("is_active = ?", true)

	canonicalBrand := services.CanonicalBrandName(request.Brand)

	// Apply filters
	if len(request.ProductIDs) > 0 {
		query = query.Where("id IN ?", request.ProductIDs)
	}

	if request.CategoryID != nil {
		query = query.Where("category_id = ?", *request.CategoryID)
	}

	if canonicalBrand != "" {
		query = query.Where("LOWER(brand) = LOWER(?) OR brand = '' OR brand IS NULL", canonicalBrand)
	}

	if !request.ForceUpdate {
		// Only get products that need optimization
		query = query.Where("(last_optimized_at IS NULL OR last_optimized_at < ?)",
			time.Now().AddDate(0, 0, -7))
	}

	// Apply limit
	limit := request.Limit
	if limit <= 0 || limit > 100 {
		limit = 50 // Default limit
	}
	query = query.Limit(limit)

	if err := query.Find(&products).Error; err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{
			Success: false,
			Message: "Failed to fetch products",
			Error:   err.Error(),
		})
		return
	}

	results := make([]models.ProductOptimizationResponse, 0, len(products))

	for _, product := range products {
		if canonicalBrand != "" {
			product.Brand = canonicalBrand
		}
		seoBefore := product.SEOScore
		seoScore := poc.calculateSEOScore(&product)
		now := time.Now()

		updateData := map[string]interface{}{
			"updated_at":        now,
			"seo_score":         seoScore,
			"last_optimized_at": &now,
		}
		if canonicalBrand != "" {
			updateData["brand"] = canonicalBrand
		}

		contentUpdated := poc.enhanceProductContent(&product, updateData)

		if err := db.Model(&product).Updates(updateData).Error; err == nil {
			results = append(results, models.ProductOptimizationResponse{
				ProductID:          int(product.ID),
				SKU:                product.SKU,
				OptimizationStatus: "completed",
				ContentUpdated:     contentUpdated,
				SEOScoreBefore:     seoBefore,
				SEOScoreAfter:      seoScore,
				Message:            "Optimized successfully",
			})
		} else {
			results = append(results, models.ProductOptimizationResponse{
				ProductID:          int(product.ID),
				SKU:                product.SKU,
				OptimizationStatus: "failed",
				ContentUpdated:     false,
				SEOScoreBefore:     seoBefore,
				SEOScoreAfter:      seoBefore,
				Message:            "Update failed: " + err.Error(),
			})
		}
	}

	c.JSON(http.StatusOK, models.APIResponse{
		Success: true,
		Message: "Bulk optimization completed",
		Data:    results,
	})
}

// GetOptimizationStatus returns products that need optimization
func (poc *ProductOptimizationController) GetOptimizationStatus(c *gin.Context) {
	db := config.GetDB()
	if db == nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{
			Success: false,
			Message: "Database connection failed",
		})
		return
	}

	var stats struct {
		TotalProducts     int64   `json:"total_products"`
		OptimizedProducts int64   `json:"optimized_products"`
		NeedsOptimization int64   `json:"needs_optimization"`
		AverageSEOScore   float64 `json:"average_seo_score"`
	}
	// Total products
	db.Model(&models.Product{}).Where("is_active = ?", true).Count(&stats.TotalProducts)

	// Optimized products (within last 30 days)
	db.Model(&models.Product{}).Where("is_active = ? AND last_optimized_at > ?",
		true, time.Now().AddDate(0, 0, -30)).Count(&stats.OptimizedProducts)

	// Needs optimization
	stats.NeedsOptimization = stats.TotalProducts - stats.OptimizedProducts

	// Average SEO score
	var avgResult struct {
		AvgScore float64
	}
	db.Model(&models.Product{}).Where("is_active = ?", true).
		Select("AVG(seo_score) as avg_score").Scan(&avgResult)
	stats.AverageSEOScore = avgResult.AvgScore

	// Which model-derivable fields are still missing, per field. This is the
	// operator-facing "did the model-number pass fill everything?" check.
	coverage := computeFieldCoverage(db)

	c.JSON(http.StatusOK, models.APIResponse{
		Success: true,
		Message: "Optimization status retrieved",
		Data: map[string]any{
			"total_products":       stats.TotalProducts,
			"optimized_products":   stats.OptimizedProducts,
			"needs_optimization":   stats.NeedsOptimization,
			"average_seo_score":    stats.AverageSEOScore,
			"field_coverage":       coverage,
			"field_coverage_total": stats.TotalProducts,
		},
	})
}

// modelDerivedField is one column that the model-driven optimization pass can
// fill without inventing anything, together with its display order.
type modelDerivedField struct {
	Key    string
	Column string
	// JSON columns store an empty table as "{}" instead of "".
	JSON bool
}

// modelDerivedFields mirrors enhanceProductContent + applyKnownTechnicalSpecs.
// Keep both lists in sync: the coverage report is what tells the operator that
// "optimize by model number" has nothing left to fill.
var modelDerivedFields = []modelDerivedField{
	{Key: "name", Column: "name"},
	{Key: "short_description", Column: "short_description"},
	{Key: "description", Column: "description"},
	{Key: "meta_title", Column: "meta_title"},
	{Key: "meta_description", Column: "meta_description"},
	{Key: "meta_keywords", Column: "meta_keywords"},
	{Key: "compatibility_info", Column: "compatibility_info"},
	{Key: "installation_guide", Column: "installation_guide"},
	{Key: "maintenance_tips", Column: "maintenance_tips"},
	{Key: "technical_specs", Column: "technical_specs", JSON: true},
	{Key: "warranty_period", Column: "warranty_period"},
	{Key: "lead_time", Column: "lead_time"},
	{Key: "manufacturer", Column: "manufacturer"},
	{Key: "origin_country", Column: "origin_country"},
}

// fieldCoverageSelections renders the aggregate expressions used by the field
// coverage report. One SUM per field keeps the report to a single query on both
// MySQL and Postgres; the empty marker differs for JSON columns, which store an
// empty table as "{}".
func fieldCoverageSelections() []string {
	selections := make([]string, 0, len(modelDerivedFields))
	for _, field := range modelDerivedFields {
		empty := "''"
		if field.JSON {
			empty = "'{}'"
		}
		selections = append(selections, fmt.Sprintf(
			"SUM(CASE WHEN %s IS NULL OR %s = %s THEN 1 ELSE 0 END) AS %s",
			field.Column, field.Column, empty, field.Key,
		))
	}
	return selections
}

// computeFieldCoverage counts active products that still miss each
// model-derivable field. It runs a single aggregate query and degrades to an
// empty map instead of failing the whole status endpoint.
func computeFieldCoverage(db *gorm.DB) map[string]int64 {
	coverage := make(map[string]int64, len(modelDerivedFields))
	if db == nil {
		return coverage
	}

	selections := fieldCoverageSelections()

	row := map[string]any{}
	err := db.Model(&models.Product{}).
		Where("is_active = ?", true).
		Select(strings.Join(selections, ", ")).
		Scan(&row).Error
	if err != nil {
		return coverage
	}

	for _, field := range modelDerivedFields {
		if count, ok := numericCell(row[field.Key]); ok {
			coverage[field.Key] = count
		}
	}
	return coverage
}

// numericCell normalises the driver-specific aggregate result (MySQL returns
// []byte, Postgres returns int64, some drivers return float64).
func numericCell(value any) (int64, bool) {
	switch v := value.(type) {
	case nil:
		return 0, true
	case int64:
		return v, true
	case int:
		return int64(v), true
	case float64:
		return int64(v), true
	case []byte:
		parsed, err := strconv.ParseInt(strings.TrimSpace(string(v)), 10, 64)
		if err != nil {
			return 0, false
		}
		return parsed, true
	case string:
		parsed, err := strconv.ParseInt(strings.TrimSpace(v), 10, 64)
		if err != nil {
			return 0, false
		}
		return parsed, true
	default:
		return 0, false
	}
}

// calculateSEOScore calculates SEO score based on various factors
func (poc *ProductOptimizationController) calculateSEOScore(product *models.Product) float64 {
	score := 0.0
	// 10.5 = the weighted maximum of every block below; keep in sync when a block
	// is added so the reported score stays on the 0-5 scale.
	maxScore := 10.5

	// Name (1 point)
	if len(product.Name) > 10 && len(product.Name) < 100 {
		score += 1.0
	}

	// Description (2 points)
	if len(product.Description) > 100 {
		score += 1.0
	}
	if len(product.Description) > 300 {
		score += 1.0
	}

	// Meta title (1 point)
	if len(product.MetaTitle) > 20 && len(product.MetaTitle) < 60 {
		score += 1.0
	}

	// Meta description (1 point)
	if len(product.MetaDescription) > 50 && len(product.MetaDescription) < 160 {
		score += 1.0
	}

	// Meta keywords (0.5 points)
	if len(product.MetaKeywords) > 20 {
		score += 0.5
	}

	// Short description (0.5 points)
	if len(product.ShortDescription) > 50 {
		score += 0.5
	}

	// Images (1 point)
	if product.ImageURLs != "" && product.ImageURLs != "[]" {
		score += 1.0
	}

	// Brand and model (1 point)
	if product.Brand != "" && product.Model != "" {
		score += 1.0
	}

	// Technical specs (1 point)
	if product.TechnicalSpecs != "" && product.TechnicalSpecs != "{}" {
		score += 1.0
	}

	// Compliance and logistics fields (0.5 points)
	if product.ConditionType != "" || product.OriginCountry != "" || product.LeadTime != "" {
		score += 0.5
	}

	// Warranty and certifications (0.5 points)
	if product.WarrantyPeriod != "" || product.Certifications != "" {
		score += 0.5
	}

	// Additional content (0.5 points)
	if product.InstallationGuide != "" || product.MaintenanceTips != "" {
		score += 0.5
	}

	return (score / maxScore) * 5.0 // Scale to 0-5
}

func shouldRefreshBrandSpecificContent(current string, brand string, minLen int) bool {
	current = strings.TrimSpace(current)
	if len(current) < minLen {
		return true
	}

	// Refresh whenever the stored copy names a brand other than the product's
	// own. This used to be a FANUC-only check, which left a Siemens meta title
	// saying "FANUC" in place forever; the generated skeleton never names a
	// foreign brand, so any mention means the text predates the current rules.
	return len(services.ForeignBrandMentions(current, brand)) > 0
}

func (poc *ProductOptimizationController) applyDefaultContentForDisabledAutoSEO(product *models.Product, updateData map[string]interface{}) bool {
	if product == nil {
		return false
	}

	defaults := services.BuildDefaultProductSEO(product)
	contentUpdated := false

	if shouldRefreshBrandSpecificContent(product.MetaTitle, product.Brand, services.MetaTitleMinLength) && strings.TrimSpace(defaults.MetaTitle) != "" {
		updateData["meta_title"] = defaults.MetaTitle
		contentUpdated = true
	}
	if shouldRefreshBrandSpecificContent(product.MetaDescription, product.Brand, services.MetaDescriptionMinLength) && strings.TrimSpace(defaults.MetaDescription) != "" {
		updateData["meta_description"] = defaults.MetaDescription
		contentUpdated = true
	}
	if shouldRefreshBrandSpecificContent(product.MetaKeywords, product.Brand, 20) && strings.TrimSpace(defaults.MetaKeywords) != "" {
		updateData["meta_keywords"] = defaults.MetaKeywords
		contentUpdated = true
	}
	if shouldRefreshBrandSpecificContent(product.ShortDescription, product.Brand, 50) && strings.TrimSpace(defaults.ShortDescription) != "" {
		updateData["short_description"] = defaults.ShortDescription
		contentUpdated = true
	}
	if shouldRefreshBrandSpecificContent(product.Description, product.Brand, 120) && strings.TrimSpace(defaults.Description) != "" {
		updateData["description"] = defaults.Description
		contentUpdated = true
	}
	if shouldRefreshBrandSpecificContent(product.CompatibilityInfo, product.Brand, 80) && strings.TrimSpace(defaults.CompatibilityInfo) != "" {
		updateData["compatibility_info"] = defaults.CompatibilityInfo
		contentUpdated = true
	}
	if shouldRefreshBrandSpecificContent(product.InstallationGuide, product.Brand, 80) && strings.TrimSpace(defaults.InstallationGuide) != "" {
		updateData["installation_guide"] = defaults.InstallationGuide
		contentUpdated = true
	}
	if shouldRefreshBrandSpecificContent(product.MaintenanceTips, product.Brand, 80) && strings.TrimSpace(defaults.MaintenanceTips) != "" {
		updateData["maintenance_tips"] = defaults.MaintenanceTips
		contentUpdated = true
	}

	// Publish the specification table built from fields the catalogue already
	// owns (brand, part number, weight, dimensions, condition, packaging,
	// certifications). Nothing is invented and an existing table is never
	// overwritten, so indexed pages keep their content.
	if poc.applyKnownTechnicalSpecs(product, updateData) {
		contentUpdated = true
	}

	return contentUpdated
}

// applyKnownTechnicalSpecs writes the JSON specification table into the pending
// update when the product has none yet. Every value comes from a column the
// catalogue already owns, or from an approved research draft, which is why the
// generator can safely double as the "fill the specs from the model number"
// step without inventing parameters.
func (poc *ProductOptimizationController) applyKnownTechnicalSpecs(product *models.Product, updateData map[string]interface{}) bool {
	if product == nil || updateData == nil {
		return false
	}
	if current := strings.TrimSpace(product.TechnicalSpecs); current != "" && current != "{}" {
		// A published table stays untouched; approving a research draft is the
		// only path that replaces it.
		return false
	}
	specs := services.KnownTechnicalSpecs(product, services.CurrentCommercePolicy())
	if len(specs) == 0 {
		return false
	}
	encoded := strings.TrimSpace(services.TechnicalSpecsJSON(specs))
	if encoded == "" || encoded == "{}" {
		return false
	}
	updateData["technical_specs"] = encoded
	return true
}

// enhanceProductContent enhances product content with category-aware SEO optimization
func (poc *ProductOptimizationController) enhanceProductContent(product *models.Product, updateData map[string]interface{}) bool {
	if product == nil || product.DisableAutoSEO {
		return false
	}

	contentUpdated := false
	categoryName := strings.ToLower(product.Category.Name)
	brand := strings.TrimSpace(product.Brand)
	model := services.NormalizeProductModel(product.Model)
	if model == "" {
		model = services.NormalizeProductModel(product.PartNumber)
	}
	if model == "" {
		model = services.NormalizeProductModel(product.SKU)
	}
	if model == "" {
		model = product.SKU
	}
	brandDisplay := services.CanonicalBrandName(brand)
	if brandDisplay == "" {
		brandDisplay = "Industrial Automation"
	}
	brandPartsLabel := services.CanonicalBrandName(brand)
	if brandPartsLabel == "" {
		brandPartsLabel = "industrial automation"
	}

	// Category-aware keyword phrases for meta content
	categoryKeyword := poc.getCategoryKeyword(categoryName)
	categoryBenefit := poc.getCategoryBenefit(categoryName)
	enriched := services.EnrichProductForRecord(product)
	if categoryKeyword == "CNC Spare Part" && strings.TrimSpace(enriched.PartType) != "" {
		categoryKeyword = enriched.PartType
	}

	// A record captured from a model number alone still has no title. Generate
	// one from the brand + model + inferred component type, and only when empty
	// so an existing (indexed) title is never rewritten.
	if strings.TrimSpace(product.Name) == "" {
		if name := strings.TrimSpace(enriched.Name); name != "" {
			updateData["name"] = name
			contentUpdated = true
		}
	}

	// Enhance meta title if missing or too short (target: 50-60 chars)
	if len(strings.TrimSpace(product.MetaTitle)) < services.MetaTitleMinLength || len(strings.TrimSpace(product.MetaTitle)) > services.MetaTitleMaxLength {
		stockTag := "In Stock"
		if product.StockQuantity <= 0 {
			stockTag = "Available"
		}
		metaTitle := services.BuildSafeMetaTitle(
			strings.TrimSpace(enriched.MetaTitle),
			fmt.Sprintf("%s %s - %s | Vibocnc", product.SKU, categoryKeyword, stockTag),
			fmt.Sprintf("%s %s | Vibocnc", brandDisplay, product.SKU),
			fmt.Sprintf("%s %s", brandDisplay, product.SKU),
		)
		updateData["meta_title"] = metaTitle
		contentUpdated = true
	}

	// Enhance meta description if missing or too short (target: 145-158 chars)
	if len(strings.TrimSpace(product.MetaDescription)) < services.MetaDescriptionMinLength || len(strings.TrimSpace(product.MetaDescription)) > services.MetaDescriptionMaxLength {
		stockPhrase := "In stock and ready to ship."
		if product.StockQuantity <= 0 {
			stockPhrase = "Available to order."
		}
		// The commercial promise in the meta description is admin-editable.
		policy := services.CurrentCommercePolicy()
		shipScope := "worldwide"
		if !services.CommercePolicyShipsWorldwide(policy) {
			shipScope = "to " + strings.Join(services.CommercePolicyCountryList(policy), ", ")
		}
		metaDesc := services.BuildSafeMetaDescription(
			strings.TrimSpace(enriched.MetaDescription),
			fmt.Sprintf(
				"%s %s %s for %s. %s Compatibility support, %s warranty, and fast shipping %s.",
				brandDisplay, product.SKU, categoryKeyword, categoryBenefit, stockPhrase,
				services.CommercePolicyWarrantyText(policy), shipScope,
			),
			fmt.Sprintf("%s %s %s for CNC repair and replacement. %s", brandDisplay, product.SKU, categoryKeyword, stockPhrase),
		)
		updateData["meta_description"] = metaDesc
		contentUpdated = true
	}

	// Enhance meta keywords if missing
	if len(product.MetaKeywords) < 20 {
		metaKeywords := strings.TrimSpace(enriched.MetaKeywords)
		if metaKeywords == "" {
			keywords := []string{
				product.SKU,
				product.Name,
				brandDisplay + " " + categoryKeyword,
				brandPartsLabel + " parts",
				"CNC spare parts",
				"industrial automation",
				"Vibocnc",
			}
			if model != "" {
				keywords = append(keywords, model)
			}
			metaKeywords = strings.Join(keywords, ", ")
		}
		updateData["meta_keywords"] = metaKeywords
		contentUpdated = true
	}

	// Enhance short description if missing (category-aware)
	if len(product.ShortDescription) < 50 {
		shortDesc := strings.TrimSpace(enriched.ShortDescription)
		if shortDesc == "" {
			stockText := "In stock and ready to ship."
			if product.StockQuantity <= 0 {
				stockText = "Available for order with fast handling."
			}
			shortDesc = fmt.Sprintf(
				"%s %s %s for %s. %s Quality tested with %s warranty.",
				brandDisplay, product.SKU, categoryKeyword, categoryBenefit, stockText,
				services.CommercePolicyWarrantyText(services.CurrentCommercePolicy()),
			)
		}
		if len(shortDesc) > 200 {
			shortDesc = shortDesc[:197] + "..."
		}
		updateData["short_description"] = shortDesc
		contentUpdated = true
	}

	if len(strings.TrimSpace(product.Description)) < 220 && strings.TrimSpace(enriched.Description) != "" {
		updateData["description"] = enriched.Description
		contentUpdated = true
	}

	if len(strings.TrimSpace(product.CompatibilityInfo)) < 80 && strings.TrimSpace(enriched.CompatibilityInfo) != "" {
		updateData["compatibility_info"] = enriched.CompatibilityInfo
		contentUpdated = true
	}

	if len(strings.TrimSpace(product.InstallationGuide)) < 80 && strings.TrimSpace(enriched.InstallationGuide) != "" {
		updateData["installation_guide"] = enriched.InstallationGuide
		contentUpdated = true
	}

	if len(strings.TrimSpace(product.MaintenanceTips)) < 80 && strings.TrimSpace(enriched.MaintenanceTips) != "" {
		updateData["maintenance_tips"] = enriched.MaintenanceTips
		contentUpdated = true
	}

	// Publish the specification table the model number + catalogue columns can
	// already support (see applyKnownTechnicalSpecs): brand, model/part number,
	// SKU, component type, condition, weight, dimensions, origin, MOQ, warranty,
	// lead time, packaging and certifications.
	if poc.applyKnownTechnicalSpecs(product, updateData) {
		contentUpdated = true
	}

	// Set default values for new fields if empty
	if product.WarrantyPeriod == "" {
		updateData["warranty_period"] = services.CurrentCommercePolicy().DefaultWarrantyPeriod
		contentUpdated = true
	}

	if product.Manufacturer == "" {
		if canonicalManufacturer := services.CanonicalBrandName(brand); canonicalManufacturer != "" {
			updateData["manufacturer"] = canonicalManufacturer
			contentUpdated = true
		}
	}

	if product.OriginCountry == "" {
		updateData["origin_country"] = "China"
		contentUpdated = true
	}

	if product.LeadTime == "" {
		updateData["lead_time"] = services.CurrentCommercePolicy().DefaultLeadTime
		contentUpdated = true
	}

	return contentUpdated
}

// getCategoryKeyword returns a descriptive keyword phrase for the product category
func (poc *ProductOptimizationController) getCategoryKeyword(categoryName string) string {
	categoryKeywords := map[string]string{
		"servo":         "Servo Drive Unit",
		"motor":         "Servo Motor",
		"pcb":           "Control PCB Board",
		"board":         "Circuit Board",
		"power supply":  "Power Supply Module",
		"power":         "Power Supply Unit",
		"i/o":           "I/O Module",
		"interface":     "Interface Board",
		"encoder":       "Encoder Unit",
		"sensor":        "Sensor Module",
		"cable":         "Connection Cable",
		"connector":     "Connector Part",
		"display":       "Display Unit",
		"keypad":        "Keypad Panel",
		"spindle":       "Spindle Drive",
		"amplifier":     "Servo Amplifier",
		"controller":    "CNC Controller",
		"teach pendant": "Teach Pendant",
		"robot":         "Robot Controller",
		"battery":       "Battery Unit",
		"fan":           "Cooling Fan Unit",
		"membrane":      "Membrane Keysheet",
	}

	for key, keyword := range categoryKeywords {
		if strings.Contains(categoryName, key) {
			return keyword
		}
	}
	return "CNC Spare Part"
}

// getCategoryBenefit returns a benefit phrase for the product category
func (poc *ProductOptimizationController) getCategoryBenefit(categoryName string) string {
	categoryBenefits := map[string]string{
		"servo":        "precise motion control in CNC systems",
		"motor":        "high-torque performance in CNC machines",
		"pcb":          "reliable signal processing in automation",
		"board":        "stable control in CNC equipment",
		"power supply": "stable power delivery in industrial systems",
		"power":        "reliable power for CNC operations",
		"i/o":          "robust input/output control in automation",
		"interface":    "reliable communication in CNC systems",
		"encoder":      "accurate position feedback in CNC machines",
		"sensor":       "precision measurement in automation",
		"cable":        "reliable connections in industrial equipment",
		"display":      "clear operator interface in CNC machines",
		"spindle":      "high-speed spindle control in CNC systems",
		"amplifier":    "precise servo control in CNC machines",
		"controller":   "advanced CNC machine control",
		"robot":        "industrial robot automation",
	}

	for key, benefit := range categoryBenefits {
		if strings.Contains(categoryName, key) {
			return benefit
		}
	}
	return "CNC and industrial automation applications"
}
