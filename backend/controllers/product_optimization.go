package controllers

import (
	"fmt"
	"net/http"
	"strings"
	"time"

	"fanuc-backend/config"
	"fanuc-backend/models"
	"fanuc-backend/services"

	"github.com/gin-gonic/gin"
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

	c.JSON(http.StatusOK, models.APIResponse{
		Success: true,
		Message: "Optimization status retrieved",
		Data:    stats,
	})
}

// calculateSEOScore calculates SEO score based on various factors
func (poc *ProductOptimizationController) calculateSEOScore(product *models.Product) float64 {
	score := 0.0
	maxScore := 10.0

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

	if services.CanonicalBrandName(brand) == "FANUC" {
		return false
	}

	return strings.Contains(strings.ToUpper(current), "FANUC")
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

	return contentUpdated
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
	enriched, _ := services.EnrichProductByBrand(brand, model)
	if categoryKeyword == "CNC Spare Part" && strings.TrimSpace(enriched.PartType) != "" {
		categoryKeyword = enriched.PartType
	}

	// Enhance meta title if missing or too short (target: 50-60 chars)
	if len(strings.TrimSpace(product.MetaTitle)) < services.MetaTitleMinLength || len(strings.TrimSpace(product.MetaTitle)) > services.MetaTitleMaxLength {
		stockTag := "In Stock"
		if product.StockQuantity <= 0 {
			stockTag = "Available"
		}
		metaTitle := services.BuildSafeMetaTitle(
			strings.TrimSpace(enriched.MetaTitle),
			fmt.Sprintf("%s %s - %s | VIBO CNC", product.SKU, categoryKeyword, stockTag),
			fmt.Sprintf("%s %s | VIBO CNC", brandDisplay, product.SKU),
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
		metaDesc := services.BuildSafeMetaDescription(
			strings.TrimSpace(enriched.MetaDescription),
			fmt.Sprintf(
				"%s %s %s for %s. %s Compatibility support, 12-month warranty, and fast worldwide shipping.",
				brandDisplay, product.SKU, categoryKeyword, categoryBenefit, stockPhrase,
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
				"VIBO CNC",
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
				"%s %s %s for %s. %s Quality tested with 12-month warranty.",
				brandDisplay, product.SKU, categoryKeyword, categoryBenefit, stockText,
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

	// Set default values for new fields if empty
	if product.WarrantyPeriod == "" {
		updateData["warranty_period"] = "12 months"
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
		updateData["lead_time"] = "3-7 days"
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
