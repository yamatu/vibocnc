package controllers

import (
	"net/http"
	"strconv"
	"strings"
	"time"

	"fanuc-backend/config"
	"fanuc-backend/models"

	"github.com/gin-gonic/gin"
)

// ProductSitemapMaxPageSize bounds one sitemap shard. The storefront requests
// 1000 per shard; anything above this limit is rejected instead of silently
// falling back to a smaller page, which previously shifted every shard and
// dropped ~98% of the catalogue from the sitemaps.
const ProductSitemapMaxPageSize = 5000

type productSitemapEntry struct {
	SKU           string    `json:"sku"`
	UpdatedAt     time.Time `json:"updated_at"`
	StockQuantity int       `json:"stock_quantity"`
	IsFeatured    bool      `json:"is_featured"`
	// Locales lists languages with a usable translation (name plus some body
	// copy), mirroring the storefront rule for publishing a localized URL.
	Locales []string `json:"locales"`
}

func parseSitemapPagination(c *gin.Context) (page int, pageSize int, ok bool) {
	page = 1
	pageSize = 1000
	if raw := strings.TrimSpace(c.Query("page")); raw != "" {
		v, err := strconv.Atoi(raw)
		if err != nil || v < 1 {
			return 0, 0, false
		}
		page = v
	}
	if raw := strings.TrimSpace(c.Query("page_size")); raw != "" {
		v, err := strconv.Atoi(raw)
		if err != nil || v < 1 || v > ProductSitemapMaxPageSize {
			return 0, 0, false
		}
		pageSize = v
	}
	return page, pageSize, true
}

// GetProductSitemapEntries returns only the fields the XML sitemaps need for
// every active, indexable product. Ordering by id keeps shard membership stable as new
// products are appended.
// GET /api/v1/public/products/sitemap?page=1&page_size=1000
func (pc *ProductController) GetProductSitemapEntries(c *gin.Context) {
	page, pageSize, ok := parseSitemapPagination(c)
	if !ok {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Invalid page or page_size", Error: "page_size must be between 1 and " + strconv.Itoa(ProductSitemapMaxPageSize)})
		return
	}

	db := config.GetDB()
	var total int64
	if err := db.Model(&models.Product{}).Where("is_active = ? AND seo_noindex = ?", true, false).Count(&total).Error; err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Database error", Error: err.Error()})
		return
	}

	var rows []struct {
		ID            uint
		SKU           string
		UpdatedAt     time.Time
		StockQuantity int
		IsFeatured    bool
	}
	if err := db.Model(&models.Product{}).
		Select("id, sku, updated_at, stock_quantity, is_featured").
		Where("is_active = ? AND seo_noindex = ?", true, false).
		Order("id ASC").
		Offset((page - 1) * pageSize).
		Limit(pageSize).
		Scan(&rows).Error; err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Database error", Error: err.Error()})
		return
	}

	localesByProduct := map[uint][]string{}
	if len(rows) > 0 {
		ids := make([]uint, 0, len(rows))
		for _, row := range rows {
			ids = append(ids, row.ID)
		}
		var translations []struct {
			ProductID    uint
			LanguageCode string
		}
		if err := db.Model(&models.ProductTranslation{}).
			Select("product_id, language_code").
			Where("product_id IN ?", ids).
			Where("TRIM(name) <> '' AND (TRIM(COALESCE(description, '')) <> '' OR TRIM(COALESCE(short_description, '')) <> '')").
			Scan(&translations).Error; err != nil {
			c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Database error", Error: err.Error()})
			return
		}
		for _, tr := range translations {
			code := strings.ToLower(strings.TrimSpace(tr.LanguageCode))
			if code == "" || code == "en" {
				continue
			}
			localesByProduct[tr.ProductID] = append(localesByProduct[tr.ProductID], code)
		}
	}

	entries := make([]productSitemapEntry, 0, len(rows))
	for _, row := range rows {
		locales := localesByProduct[row.ID]
		if locales == nil {
			locales = []string{}
		}
		entries = append(entries, productSitemapEntry{
			SKU:           row.SKU,
			UpdatedAt:     row.UpdatedAt,
			StockQuantity: row.StockQuantity,
			IsFeatured:    row.IsFeatured,
			Locales:       locales,
		})
	}

	totalPages := int((total + int64(pageSize) - 1) / int64(pageSize))
	c.JSON(http.StatusOK, models.APIResponse{
		Success: true,
		Message: "OK",
		Data: models.PaginationResponse{
			Data:       entries,
			Page:       page,
			PageSize:   pageSize,
			Total:      total,
			TotalPages: totalPages,
		},
	})
}
