package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"os"
	"strings"

	"fanuc-backend/config"
	"fanuc-backend/models"
	"fanuc-backend/services"

	"github.com/joho/godotenv"
	"gorm.io/gorm"
)

type optimizeStats struct {
	Total   int64
	Updated int64
	Skipped int64
	Failed  int64
}

func main() {
	var (
		brand        = flag.String("brand", "", "Optional brand to optimize")
		categoryID   = flag.Uint("category-id", 0, "Optional category id filter")
		search       = flag.String("search", "", "Optional search filter")
		batchSize    = flag.Int("batch-size", 500, "Batch size for processing")
		limit        = flag.Int("limit", 0, "Optional max number of products to process")
		forceUpdate  = flag.Bool("force", false, "Force update even if fields already exist")
		status       = flag.String("status", "active", "active, inactive, or all")
		generateFAQs = flag.Bool("generate-faqs", true, "Generate product FAQ entries")
	)
	flag.Parse()

	loadEnv()
	config.ConnectDatabase()

	db := config.GetDB()
	if db == nil {
		log.Fatal("database connection is nil")
	}

	if *batchSize <= 0 {
		*batchSize = 500
	}

	if db.Migrator().HasTable(&models.ProductFAQ{}) == false {
		if err := db.AutoMigrate(&models.ProductFAQ{}); err != nil {
			log.Fatalf("failed to migrate product_faqs table: %v", err)
		}
	}

	stats, err := optimizeProducts(db, strings.TrimSpace(*brand), *categoryID, strings.TrimSpace(*search), *status, *batchSize, *limit, *forceUpdate, *generateFAQs)
	if err != nil {
		log.Fatalf("bulk optimization failed: %v", err)
	}

	log.Printf("bulk optimization completed: total=%d updated=%d skipped=%d failed=%d", stats.Total, stats.Updated, stats.Skipped, stats.Failed)
	if stats.Updated > 0 {
		go services.InvalidatePublicCaches(context.Background(), "cmd:bulk-seo-optimize", nil)
	}
}

func loadEnv() {
	env := os.Getenv("GO_ENV")
	if env == "" {
		env = "development"
	}

	envFile := ".env"
	if env == "production" {
		envFile = ".env.production"
	}

	if err := godotenv.Load(envFile); err != nil {
		_ = godotenv.Load()
	}
}

func optimizeProducts(db *gorm.DB, brand string, categoryID uint, search string, status string, batchSize int, limit int, forceUpdate bool, generateFAQs bool) (optimizeStats, error) {
	stats := optimizeStats{}
	catBySlug := localCategorySlugMap(db)

	query := db.Model(&models.Product{})
	if brand != "" {
		query = query.Where("LOWER(brand) = LOWER(?) OR brand = '' OR brand IS NULL", brand)
	}
	if categoryID > 0 {
		query = query.Where("category_id = ?", categoryID)
	}
	if search != "" {
		like := "%" + search + "%"
		query = query.Where("sku LIKE ? OR name LIKE ? OR description LIKE ? OR part_number LIKE ? OR model LIKE ?", like, like, like, like, like)
	}
	switch strings.ToLower(strings.TrimSpace(status)) {
	case "active":
		query = query.Where("is_active = ?", true)
	case "inactive":
		query = query.Where("is_active = ?", false)
	}
	if limit > 0 {
		query = query.Limit(limit)
	}

	if err := query.Count(&stats.Total).Error; err != nil {
		return stats, err
	}

	optimizer := bulkOptimizer{
		db:           db,
		catBySlug:    catBySlug,
		forceUpdate:  forceUpdate,
		generateFAQs: generateFAQs,
	}

	var batch []models.Product
	err := query.Select(
		"id", "sku", "model", "part_number", "brand", "category_id", "name",
		"short_description", "description", "meta_title", "meta_description", "meta_keywords",
		"compatibility_info", "installation_guide", "maintenance_tips", "warranty_period",
		"manufacturer", "origin_country", "lead_time", "stock_quantity",
	).Order("id ASC").FindInBatches(&batch, batchSize, func(tx *gorm.DB, _ int) error {
		for _, product := range batch {
			updated, err := optimizer.optimizeProduct(product, brand)
			if err != nil {
				stats.Failed++
				log.Printf("product %s failed: %v", product.SKU, err)
				continue
			}
			if updated {
				stats.Updated++
			} else {
				stats.Skipped++
			}
		}
		return nil
	}).Error

	return stats, err
}

type bulkOptimizer struct {
	db           *gorm.DB
	catBySlug    map[string]uint
	forceUpdate  bool
	generateFAQs bool
}

func (bo bulkOptimizer) optimizeProduct(p models.Product, fallbackBrand string) (bool, error) {
	brand := strings.TrimSpace(p.Brand)
	if brand == "" {
		brand = strings.TrimSpace(fallbackBrand)
	}

	model := services.NormalizeProductModel(p.Model)
	if model == "" {
		model = services.NormalizeProductModel(p.PartNumber)
	}
	if model == "" {
		model = services.NormalizeProductModel(p.SKU)
	}

	inference := services.InferProductCategory(brand, model)
	categoryID := bo.catBySlug[inference.CategorySlug]

	updates := map[string]any{}
	if categoryID != 0 && p.CategoryID != categoryID {
		updates["category_id"] = categoryID
	}
	if strings.TrimSpace(p.Brand) == "" {
		if canonicalBrand := services.CanonicalBrandName(brand); canonicalBrand != "" {
			updates["brand"] = canonicalBrand
		}
	}
	if strings.TrimSpace(p.Model) == "" && model != "" {
		updates["model"] = model
	}
	if strings.TrimSpace(p.PartNumber) == "" && model != "" {
		updates["part_number"] = model
	}

	seoUpdates := bo.buildSEOUpdates(p, brand, model, inference.PartType)
	for key, value := range seoUpdates {
		updates[key] = value
	}

	if len(updates) == 0 {
		return false, nil
	}

	if err := bo.db.Model(&models.Product{}).Where("id = ?", p.ID).Updates(updates).Error; err != nil {
		return false, err
	}

	if bo.generateFAQs {
		refreshed := p
		refreshed.Name = valueAsString(updates, "name", p.Name)
		refreshed.CompatibilityInfo = valueAsString(updates, "compatibility_info", p.CompatibilityInfo)
		refreshed.LeadTime = valueAsString(updates, "lead_time", p.LeadTime)
		refreshed.Brand = valueAsString(updates, "brand", brand)
		if err := localUpsertGeneratedProductFAQs(bo.db, &refreshed, inference.PartType); err != nil {
			return true, err
		}
	}

	return true, nil
}

func (bo bulkOptimizer) buildSEOUpdates(p models.Product, brand string, model string, partType string) map[string]any {
	updates := map[string]any{}
	enriched, _ := services.EnrichProductByBrand(brand, model)

	setIfNeeded := func(field string, current string, next string, minLen int) {
		if strings.TrimSpace(next) == "" {
			return
		}
		if bo.forceUpdate || len(strings.TrimSpace(current)) < minLen {
			updates[field] = next
		}
	}

	if strings.TrimSpace(p.Name) == "" {
		updates["name"] = enriched.Name
	}
	setIfNeeded("short_description", p.ShortDescription, enriched.ShortDescription, 50)
	setIfNeeded("description", p.Description, enriched.Description, 220)
	setIfNeeded("meta_title", p.MetaTitle, enriched.MetaTitle, 20)
	setIfNeeded("meta_description", p.MetaDescription, enriched.MetaDescription, 50)
	setIfNeeded("meta_keywords", p.MetaKeywords, enriched.MetaKeywords, 20)
	setIfNeeded("compatibility_info", p.CompatibilityInfo, enriched.CompatibilityInfo, 80)
	setIfNeeded("installation_guide", p.InstallationGuide, enriched.InstallationGuide, 80)
	setIfNeeded("maintenance_tips", p.MaintenanceTips, enriched.MaintenanceTips, 80)

	if bo.forceUpdate || strings.TrimSpace(p.WarrantyPeriod) == "" {
		updates["warranty_period"] = "12 months"
	}
	if bo.forceUpdate || strings.TrimSpace(p.Manufacturer) == "" {
		if canonicalManufacturer := services.CanonicalBrandName(brand); canonicalManufacturer != "" {
			updates["manufacturer"] = canonicalManufacturer
		}
	}
	if bo.forceUpdate || strings.TrimSpace(p.OriginCountry) == "" {
		updates["origin_country"] = "China"
	}
	if bo.forceUpdate || strings.TrimSpace(p.LeadTime) == "" {
		updates["lead_time"] = "3-7 days"
	}

	if partType != "" && strings.TrimSpace(p.Name) == "" && strings.TrimSpace(enriched.Name) == "" {
		updates["name"] = strings.TrimSpace(fmt.Sprintf("%s %s %s", brand, model, partType))
	}

	return updates
}

func valueAsString(m map[string]any, key string, fallback string) string {
	value, ok := m[key]
	if !ok || value == nil {
		return fallback
	}
	if s, ok := value.(string); ok {
		return s
	}
	return fallback
}

func localCategorySlugMap(db *gorm.DB) map[string]uint {
	out := map[string]uint{}
	var cats []models.Category
	if err := db.Model(&models.Category{}).Where("is_active = ?", true).Find(&cats).Error; err == nil {
		for _, c := range cats {
			out[c.Slug] = c.ID
		}
	}
	return out
}

func localEnsureProductFAQ(db *gorm.DB, productID uint, question string, answer string, sortOrder int) error {
	question = strings.TrimSpace(question)
	answer = strings.TrimSpace(answer)
	if question == "" || answer == "" {
		return nil
	}

	var existing models.ProductFAQ
	err := db.Where("product_id = ? AND question = ?", productID, question).First(&existing).Error
	if err == nil {
		updates := map[string]any{}
		if strings.TrimSpace(existing.Answer) == "" {
			updates["answer"] = answer
		}
		if !existing.IsActive {
			updates["is_active"] = true
		}
		if existing.SortOrder == 0 && sortOrder > 0 {
			updates["sort_order"] = sortOrder
		}
		if len(updates) > 0 {
			return db.Model(&existing).Updates(updates).Error
		}
		return nil
	}
	if err != nil && err != gorm.ErrRecordNotFound {
		return err
	}

	return db.Create(&models.ProductFAQ{
		ProductID: productID,
		Question:  question,
		Answer:    answer,
		IsActive:  true,
		SortOrder: sortOrder,
	}).Error
}

func localUpsertGeneratedProductFAQs(db *gorm.DB, product *models.Product, partType string) error {
	partType = strings.TrimSpace(partType)
	if partType == "" {
		partType = "spare part"
	}

	heading := strings.TrimSpace(product.Name)
	if heading == "" {
		heading = strings.TrimSpace(strings.Join([]string{product.Brand, product.SKU, partType}, " "))
	}

	stockAnswer := ""
	if product.StockQuantity > 0 {
		stockAnswer = fmt.Sprintf("%s is currently in stock and ready for worldwide shipment.", product.SKU)
	} else {
		stockAnswer = fmt.Sprintf("%s is available to order with %s lead time.", product.SKU, localDefaultString(product.LeadTime, "3-7 days"))
	}

	faqs := []struct {
		Question string
		Answer   string
	}{
		{
			Question: fmt.Sprintf("What is %s used for?", product.SKU),
			Answer:   fmt.Sprintf("%s is used for CNC repair, maintenance, replacement, and industrial automation support. Buyers usually match it by original part number, machine series, and cabinet configuration.", heading),
		},
		{
			Question: fmt.Sprintf("How do I confirm compatibility for %s?", product.SKU),
			Answer:   localDefaultString(strings.TrimSpace(product.CompatibilityInfo), fmt.Sprintf("Confirm compatibility for %s against your original part label, controller model, machine model, and option code before ordering.", product.SKU)),
		},
		{
			Question: fmt.Sprintf("Is %s in stock and how fast can it ship?", product.SKU),
			Answer:   stockAnswer,
		},
	}

	for index, faq := range faqs {
		if err := localEnsureProductFAQ(db, product.ID, faq.Question, faq.Answer, index+1); err != nil {
			return err
		}
	}
	return nil
}

func localDefaultString(value string, fallback string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return fallback
	}
	return trimmed
}
