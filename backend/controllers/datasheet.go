package controllers

import (
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"fanuc-backend/config"
	"fanuc-backend/models"
	"fanuc-backend/services"
	"fanuc-backend/utils"
)

// DatasheetController exposes the Datasheets.com product search API to the
// admin catalogue as a lookup tool.
//
// The contract with the rest of the system is deliberately narrow:
//   - a lookup is read-only. It returns what the provider says, whether each
//     record is an exact match for the part number, and how much of the monthly
//     quota is left,
//   - turning a record into product parameters still goes through
//     ProductSpecDraft and the existing approve/reject endpoints, so the
//     "every published value carries a source" rule keeps holding,
//   - the datasheet URL / description suggestions are returned for an
//     administrator to copy, never written behind their back.
type DatasheetController struct{}

const datasheetProviderLimits = "60/min · 500/hour · 5,000/month (provider default)"

// GetSettings returns the persisted configuration with the API key replaced by
// a boolean.
func (dc *DatasheetController) GetSettings(c *gin.Context) {
	db := config.GetDB()
	settings, row, err := services.LoadDatasheetSettings(db)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to load the Datasheets.com settings", Error: err.Error()})
		return
	}
	data := gin.H{
		"provider":           "datasheets.com",
		"endpoint":           "GET /api/v1/search",
		"provider_limits":    datasheetProviderLimits,
		"has_api_key":        strings.TrimSpace(settings.APIKey) != "",
		"api_key_from_env":   row != nil && row.APIKeyFromEnv,
		"attribution":        services.DatasheetAttributionText(),
		"terms_url":          "https://www.datasheets.com/terms",
	}
	if row != nil && row.ID > 0 {
		data["setting"] = row.ToResponse()
	} else {
		data["setting"] = (&models.DatasheetSetting{
			PerMinuteLimit:   settings.PerMinuteLimit,
			PerHourLimit:     settings.PerHourLimit,
			MonthlyLimit:     settings.MonthlyLimit,
			AutoStopPercent:  settings.AutoStopPercent,
			CacheTTLDays:     settings.CacheTTLDays,
			DefaultPageLimit: settings.DefaultPageLimit,
		}).ToResponse()
	}
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "Datasheets.com settings", Data: data})
}

type datasheetSettingsRequest struct {
	Enabled *bool `json:"enabled"`

	// APIKey is write-only: sending it replaces the stored key, leaving it empty
	// keeps the current one.
	APIKey      string `json:"api_key"`
	ClearAPIKey bool   `json:"clear_api_key"`

	PerMinuteLimit   *int `json:"per_minute_limit"`
	PerHourLimit     *int `json:"per_hour_limit"`
	MonthlyLimit     *int `json:"monthly_limit"`
	AutoStopPercent  *int `json:"auto_stop_percent"`
	CacheTTLDays     *int `json:"cache_ttl_days"`
	DefaultPageLimit *int `json:"default_page_limit"`

	// ResetUsage zeroes the current month counter (the provider resets the
	// account quota on its own schedule, not ours).
	ResetUsage bool `json:"reset_usage"`
}

// UpdateSettings persists the configuration. The key is encrypted with the same
// SETTINGS_ENCRYPTION_KEY as every other stored secret.
func (dc *DatasheetController) UpdateSettings(c *gin.Context) {
	var req datasheetSettingsRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Invalid settings payload", Error: err.Error()})
		return
	}
	db := config.GetDB()
	if db == nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Database connection failed"})
		return
	}

	var row models.DatasheetSetting
	err := db.Order("id ASC").First(&row).Error
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to load the Datasheets.com settings", Error: err.Error()})
		return
	}
	if errors.Is(err, gorm.ErrRecordNotFound) {
		row = models.DatasheetSetting{
			PerMinuteLimit:   60,
			PerHourLimit:     500,
			MonthlyLimit:     5000,
			AutoStopPercent:  90,
			CacheTTLDays:     90,
			DefaultPageLimit: 10,
		}
	}

	if req.Enabled != nil {
		row.Enabled = *req.Enabled
	}
	if key := strings.TrimSpace(req.APIKey); key != "" {
		encrypted, encErr := utils.EncryptSecret(key)
		if encErr != nil {
			c.JSON(http.StatusBadRequest, models.APIResponse{
				Success: false,
				Message: "The API key could not be encrypted. Check SETTINGS_ENCRYPTION_KEY on the backend.",
				Error:   encErr.Error(),
			})
			return
		}
		row.APIKeyEnc = encrypted
		row.APIKeyFromEnv = false
	}
	if req.ClearAPIKey {
		row.APIKeyEnc = ""
		row.APIKeyFromEnv = false
	}
	if req.PerMinuteLimit != nil {
		if *req.PerMinuteLimit < 1 || *req.PerMinuteLimit > 6000 {
			c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "per_minute_limit must be between 1 and 6000"})
			return
		}
		row.PerMinuteLimit = *req.PerMinuteLimit
	}
	if req.PerHourLimit != nil {
		if *req.PerHourLimit < 1 || *req.PerHourLimit > 100000 {
			c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "per_hour_limit must be between 1 and 100000"})
			return
		}
		row.PerHourLimit = *req.PerHourLimit
	}
	if req.MonthlyLimit != nil {
		if *req.MonthlyLimit < 1 || *req.MonthlyLimit > 1000000 {
			c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "monthly_limit must be between 1 and 1000000"})
			return
		}
		row.MonthlyLimit = *req.MonthlyLimit
	}
	if req.AutoStopPercent != nil {
		if *req.AutoStopPercent < 1 || *req.AutoStopPercent > 100 {
			c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "auto_stop_percent must be between 1 and 100"})
			return
		}
		row.AutoStopPercent = *req.AutoStopPercent
	}
	if req.CacheTTLDays != nil {
		if *req.CacheTTLDays < 0 || *req.CacheTTLDays > 3650 {
			c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "cache_ttl_days must be between 0 and 3650"})
			return
		}
		row.CacheTTLDays = *req.CacheTTLDays
	}
	if req.DefaultPageLimit != nil {
		if *req.DefaultPageLimit < 1 || *req.DefaultPageLimit > 10 {
			c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "default_page_limit must be between 1 and 10 (provider maximum)"})
			return
		}
		row.DefaultPageLimit = *req.DefaultPageLimit
	}
	if req.ResetUsage {
		row.MonthlyUsed = 0
		row.QuotaMonth = ""
	}

	if err := db.Save(&row).Error; err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to save the Datasheets.com settings", Error: err.Error()})
		return
	}
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "Datasheets.com settings saved", Data: row.ToResponse()})
}

// TestKey performs one real lookup to prove the key works. It costs one
// provider call and deliberately bypasses the cache.
func (dc *DatasheetController) TestKey(c *gin.Context) {
	query := strings.TrimSpace(c.Query("q"))
	if query == "" {
		query = "BAV99"
	}
	ctx := services.WithManualDatasheetLookup(c.Request.Context())
	lookup, err := services.LookupDatasheetPart(ctx, config.GetDB(), query, 1, 1, true)
	if err != nil {
		c.JSON(http.StatusBadGateway, models.APIResponse{Success: false, Message: "Datasheets.com rejected the request", Error: err.Error()})
		return
	}
	sample := ""
	if len(lookup.Records) > 0 {
		sample = lookup.Records[0].MPN
	}
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "Datasheets.com API key works", Data: gin.H{
		"query":           lookup.Query,
		"count":           lookup.Count,
		"sample_mpn":      sample,
		"quota_remaining": lookup.QuotaRemaining,
		"quota_limit":     lookup.QuotaLimit,
	}})
}

// Search is the endpoint the admin lookup panel calls: it returns the provider
// records for one part number, marks which ones match exactly, and suggests the
// catalogue fields that could be copied.
func (dc *DatasheetController) Search(c *gin.Context) {
	var payload struct {
		Q         string `json:"q"`
		Query     string `json:"query"`
		MPN       string `json:"mpn"`
		Page      int    `json:"page"`
		Limit     int    `json:"limit"`
		Refresh   bool   `json:"refresh"`
		ProductID uint   `json:"product_id"`
	}
	_ = c.ShouldBindJSON(&payload)

	query := firstNonEmptyString(payload.Q, payload.Query, payload.MPN)
	if query == "" {
		query = strings.TrimSpace(c.Query("q"))
	}
	page, limit := payload.Page, payload.Limit
	if page == 0 && limit == 0 {
		parsedPage, parsedLimit := services.ParseDatasheetPageQuery(c.Query("page"), c.Query("limit"))
		page, limit = parsedPage, parsedLimit
	}
	refresh := payload.Refresh || c.Query("refresh") == "1" || c.Query("refresh") == "true"
	if query == "" {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "A part number (q) is required"})
		return
	}

	// When the panel was opened from a product, echo the product's identifiers
	// so the UI can offer its model/part number as the default query.
	var product *models.Product
	if payload.ProductID > 0 {
		var found models.Product
		if err := config.GetDB().First(&found, payload.ProductID).Error; err == nil {
			product = &found
		}
	}

	ctx := services.WithManualDatasheetLookup(c.Request.Context())
	lookup, err := services.LookupDatasheetPart(ctx, config.GetDB(), query, page, limit, refresh)
	if err != nil {
		status := http.StatusBadGateway
		var waiting *services.ErrDatasheetQuotaWaiting
		if errors.As(err, &waiting) {
			status = http.StatusTooManyRequests
		} else if errors.Is(err, services.ErrDatasheetNotConfigured) {
			status = http.StatusPreconditionFailed
		}
		c.JSON(status, models.APIResponse{Success: false, Message: "Datasheets.com lookup failed", Error: err.Error()})
		return
	}

	c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "Datasheets.com lookup", Data: gin.H{
		"lookup":      lookup,
		"product":     datasheetProductContext(product),
		"suggestions": datasheetSuggestions(lookup),
		"attribution": services.DatasheetAttributionText(),
	}})
}

// ToDraft stores the exact-match record of a lookup as a ProductSpecDraft, so
// the existing review/approve endpoints apply the values. Nothing is written to
// the product here.
func (dc *DatasheetController) ToDraft(c *gin.Context) {
	var payload struct {
		ProductID uint                    `json:"product_id"`
		MPN       string                  `json:"mpn"`
		Query     string                  `json:"q"`
		Specs     []services.DatasheetSpec `json:"specs"`
	}
	if err := c.ShouldBindJSON(&payload); err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Invalid request data", Error: err.Error()})
		return
	}
	query := firstNonEmptyString(payload.Query, payload.MPN)
	if query == "" {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "A part number is required"})
		return
	}

	db := config.GetDB()
	var product *models.Product
	if payload.ProductID > 0 {
		var found models.Product
		if err := db.First(&found, payload.ProductID).Error; err != nil {
			c.JSON(http.StatusNotFound, models.APIResponse{Success: false, Message: "Product not found"})
			return
		}
		product = &found
	}

	// Cached lookups are served from the database, so building a draft twice
	// costs nothing the second time.
	ctx := services.WithManualDatasheetLookup(c.Request.Context())
	lookup, err := services.LookupDatasheetPart(ctx, db, query, 1, 10, false)
	if err != nil {
		c.JSON(http.StatusBadGateway, models.APIResponse{Success: false, Message: "Datasheets.com lookup failed", Error: err.Error()})
		return
	}
	record, ok := services.DatasheetExactRecord(lookup, payload.MPN)
	if !ok {
		c.JSON(http.StatusBadRequest, models.APIResponse{
			Success: false,
			Message: "Datasheets.com has no record whose part number matches exactly, so its values cannot be proposed from here",
		})
		return
	}
	candidates := services.DatasheetLookupToCandidates(record)
	if len(payload.Specs) > 0 {
		candidates = services.DatasheetFilterCandidates(candidates, payload.Specs)
	}
	if len(candidates) == 0 {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "This Datasheets.com record has no parameters to propose"})
		return
	}

	draft, err := services.StoreDatasheetSpecDraft(db, services.DatasheetDraftInput{
		Product:    product,
		Query:      query,
		Record:     record,
		Candidates: candidates,
		UserID:     currentUserID(c),
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to create the specification draft", Error: err.Error()})
		return
	}
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "Specification draft created for review", Data: draft})
}

// ListCache shows what has already been looked up. It doubles as an audit trail
// of what the provider answered, without spending any quota.
func (dc *DatasheetController) ListCache(c *gin.Context) {
	db := config.GetDB()
	query := db.Model(&models.DatasheetLookupCache{})
	if search := strings.TrimSpace(c.Query("search")); search != "" {
		like := "%" + search + "%"
		query = query.Where("mpn LIKE ? OR query_key LIKE ?", like, like)
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to count cached lookups", Error: err.Error()})
		return
	}
	page, pageSize := 1, 30
	if parsed, err := strconv.Atoi(strings.TrimSpace(c.DefaultQuery("page", "1"))); err == nil && parsed > 0 {
		page = parsed
	}
	if parsed, err := strconv.Atoi(strings.TrimSpace(c.DefaultQuery("page_size", "30"))); err == nil && parsed > 0 && parsed <= 200 {
		pageSize = parsed
	}
	var rows []models.DatasheetLookupCache
	if err := query.Order("fetched_at DESC").Offset((page - 1) * pageSize).Limit(pageSize).Find(&rows).Error; err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to load cached lookups", Error: err.Error()})
		return
	}
	items := make([]gin.H, 0, len(rows))
	for _, row := range rows {
		items = append(items, gin.H{
			"id":           row.ID,
			"mpn":          row.MPN,
			"query_key":    row.QueryKey,
			"result_count": row.ResultCount,
			"match_count":  row.MatchCount,
			"fetched_at":   row.FetchedAt,
			"expires_at":   row.ExpiresAt,
			"hit_count":    row.HitCount,
			"last_hit_at":  row.LastHitAt,
		})
	}
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "Cached Datasheets.com lookups", Data: gin.H{
		"items":       items,
		"total":       total,
		"page":        page,
		"page_size":   pageSize,
		"total_pages": (total + int64(pageSize) - 1) / int64(pageSize),
	}})
}

func firstNonEmptyString(values ...string) string {
	for _, value := range values {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			return trimmed
		}
	}
	return ""
}

// datasheetProductContext tells the UI which identifiers the product already
// has, so the panel can point at the right lookup.
func datasheetProductContext(product *models.Product) gin.H {
	if product == nil {
		return nil
	}
	specs := strings.TrimSpace(product.TechnicalSpecs)
	return gin.H{
		"id":            product.ID,
		"sku":           product.SKU,
		"name":          product.Name,
		"brand":         product.Brand,
		"model":         product.Model,
		"part_number":   product.PartNumber,
		"datasheet_url": product.DatasheetURL,
		"has_specs":     specs != "" && specs != "{}" && specs != "null",
	}
}

// datasheetSuggestions collects the copyable fields of the best exact match.
func datasheetSuggestions(lookup *services.DatasheetLookup) gin.H {
	record, ok := services.DatasheetBestExactRecord(lookup)
	if !ok {
		return gin.H{"has_exact_match": false}
	}
	return gin.H{
		"has_exact_match": true,
		"mpn":             record.MPN,
		"manufacturer":    record.Manufacturer,
		"fields":          services.DatasheetSuggestedProductFields(record),
		"spec_count":      len(record.Specs),
		"datasheet_url":   record.DatasheetURL,
		"record_url":      record.URL,
	}
}
