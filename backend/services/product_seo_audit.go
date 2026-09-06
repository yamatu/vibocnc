package services

import (
	"errors"
	"strings"

	"fanuc-backend/models"
	"gorm.io/gorm"
)

// SEO audit issues. A product receives its most severe issue only.
const (
	SEOIssueFailed         = "seo_failed"
	SEOIssueMissingMeta    = "missing_meta"
	SEOIssueNeverOptimized = "never_optimized"
	SEOIssueGenericMeta    = "generic_meta"
	SEOIssueModelMissing   = "model_missing"
	SEOIssueBrandMismatch  = "brand_mismatch"
)

type ProductSEOIssue struct {
	ProductID uint   `json:"product_id"`
	SKU       string `json:"sku"`
	Name      string `json:"name"`
	Brand     string `json:"brand"`
	Model     string `json:"model"`
	MetaTitle string `json:"meta_title"`
	Issue     string `json:"issue"`
	Detail    string `json:"detail"`
}

type ProductSEOAuditResult struct {
	Scanned        int    `json:"scanned"`
	OK             int    `json:"ok"`
	SEOFailed      int    `json:"seo_failed"`
	MissingMeta    int    `json:"missing_meta"`
	NeverOptimized int    `json:"never_optimized"`
	GenericMeta    int    `json:"generic_meta"`
	ModelMissing   int    `json:"model_missing"`
	BrandMismatch  int    `json:"brand_mismatch"`
	ProductIDs     []uint `json:"product_ids"`
	// Samples is a bounded illustrative list; ProductIDs is the full fix list.
	Samples []ProductSEOIssue `json:"samples"`
}

const seoAuditSampleLimit = 100

// genericSEOMarkers catch metadata generated while the product still sat in a
// catch-all category, e.g. a meta title built from "Industrial Automation
// Spare Parts" instead of the verified brand and model.
var genericSEOMarkers = []string{"industrial automation", "unidentified", "uncategorized", "generic spare"}

// registrySEOBrands are the canonical display names used for cross-brand
// contamination checks ("FANUC ..." meta title on a Siemens product).
var registrySEOBrands = []string{
	"FANUC", "Mitsubishi", "Siemens", "ABB", "Allen-Bradley", "OMRON", "SICK",
	"Tamagawa", "FLUKE", "Schneider Electric", "Yaskawa", "Panasonic", "KEYENCE",
	"Delta", "Bosch Rexroth",
}

// evaluateProductSEO decides whether one product's public SEO metadata is
// trustworthy. Only active products (plus failed runs) are considered: hidden
// products get their SEO after rework activates them.
func evaluateProductSEO(product models.Product) (string, string) {
	if strings.EqualFold(strings.TrimSpace(product.AISEOStatus), "failed") {
		return SEOIssueFailed, "the last AI SEO run failed"
	}
	if !product.IsActive {
		return "", ""
	}

	metaTitle := strings.TrimSpace(product.MetaTitle)
	metaDescription := strings.TrimSpace(product.MetaDescription)
	if metaTitle == "" || metaDescription == "" {
		return SEOIssueMissingMeta, "meta title or description is empty"
	}

	metaLower := strings.ToLower(metaTitle + " " + metaDescription + " " + product.MetaKeywords)
	for _, marker := range genericSEOMarkers {
		if strings.Contains(metaLower, marker) {
			return SEOIssueGenericMeta, "metadata still references catch-all wording: " + marker
		}
	}

	// A meta title naming a different manufacturer means the SEO was written
	// against a wrong classification. Token comparison avoids substring false
	// positives ("sick" inside a word never matches the SICK brand).
	productBrandKey := NormalizeBrandKey(product.Brand)
	if productBrandKey != "" {
		titleTokens := taxonomyTokenSet(metaTitle)
		for _, brand := range registrySEOBrands {
			if NormalizeBrandKey(brand) == productBrandKey {
				continue
			}
			mentioned := true
			for _, token := range taxonomyTokens(brand) {
				if !titleTokens[token] {
					mentioned = false
					break
				}
			}
			if mentioned {
				return SEOIssueBrandMismatch, "meta title mentions " + brand + " but the product brand is " + product.Brand
			}
		}
	}

	// Product SEO titles must carry the manufacturer identifier; a title
	// built from a category name alone lacks the model string entirely.
	model := compactModel(productClassificationModel(product))
	if len(model) >= 5 && !strings.Contains(compactModel(metaTitle), model) {
		return SEOIssueModelMissing, "meta title does not contain the product model"
	}

	if !strings.EqualFold(strings.TrimSpace(product.AISEOStatus), "optimized") {
		return SEOIssueNeverOptimized, "product has not been through AI SEO yet"
	}
	return "", ""
}

// AuditProductSEO scans the catalog for products whose SEO metadata is
// missing, stale, or built from an obsolete classification. Products already
// queued in an active job are excluded so the fix job can always be created.
func AuditProductSEO(db *gorm.DB, maxProducts int) (*ProductSEOAuditResult, error) {
	if db == nil {
		return nil, errors.New("database is nil")
	}
	

	pending := map[uint]bool{}
	var pendingIDs []uint
	if err := db.Model(&models.AIAgentSEOJobItem{}).
		Where("status IN ?", []string{"queued", "running"}).
		Pluck("product_id", &pendingIDs).Error; err != nil {
		return nil, err
	}
	for _, id := range pendingIDs {
		pending[id] = true
	}

	result := &ProductSEOAuditResult{ProductIDs: []uint{}, Samples: []ProductSEOIssue{}}
	afterID := uint(0)
	for {
		var products []models.Product
		if err := db.Model(&models.Product{}).
			Select("id", "sku", "name", "brand", "model", "part_number", "is_active",
				"meta_title", "meta_description", "meta_keywords", "ai_seo_status").
			Where("id > ?", afterID).
			Order("id ASC").
			Limit(1000).
			Find(&products).Error; err != nil {
			return nil, err
		}
		if len(products) == 0 {
			break
		}
		for _, product := range products {
			afterID = product.ID
			if !product.IsActive && !strings.EqualFold(strings.TrimSpace(product.AISEOStatus), "failed") {
				continue
			}
			result.Scanned++
			issue, detail := evaluateProductSEO(product)
			if issue == "" {
				result.OK++
				continue
			}
			switch issue {
			case SEOIssueFailed:
				result.SEOFailed++
			case SEOIssueMissingMeta:
				result.MissingMeta++
			case SEOIssueNeverOptimized:
				result.NeverOptimized++
			case SEOIssueGenericMeta:
				result.GenericMeta++
			case SEOIssueModelMissing:
				result.ModelMissing++
			case SEOIssueBrandMismatch:
				result.BrandMismatch++
			}
			if len(result.Samples) < seoAuditSampleLimit {
				result.Samples = append(result.Samples, ProductSEOIssue{
					ProductID: product.ID,
					SKU:       product.SKU,
					Name:      product.Name,
					Brand:     product.Brand,
					Model:     productClassificationModel(product),
					MetaTitle: product.MetaTitle,
					Issue:     issue,
					Detail:    detail,
				})
			}
			if !pending[product.ID] && (maxProducts <= 0 || len(result.ProductIDs) < maxProducts) {
				result.ProductIDs = append(result.ProductIDs, product.ID)
			}
		}
	}
	return result, nil
}
