package controllers

import (
	"fanuc-backend/config"
	"fanuc-backend/models"
	"fanuc-backend/services"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// AnalyticsController provides admin endpoints for visitor analytics.
type AnalyticsController struct{}

// ---------------------------------------------------------------------------
// GET /admin/analytics/overview?start=&end=
// ---------------------------------------------------------------------------

type analyticsOverviewResponse struct {
	TotalVisitors   int64   `json:"total_visitors"`
	UniqueIPs       int64   `json:"unique_ips"`
	TotalBots       int64   `json:"total_bots"`
	BotPercentage   float64 `json:"bot_percentage"`
	TopCountry      string  `json:"top_country"`
	TopCountryCount int64   `json:"top_country_count"`
}

func (ac *AnalyticsController) GetOverview(c *gin.Context) {
	db := config.GetDB()
	if db == nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Database not initialized"})
		return
	}

	start, end := parseDateRange(c)
	q := db.Model(&models.VisitorLog{})
	if start != nil {
		q = q.Where("created_at >= ?", *start)
	}
	if end != nil {
		q = q.Where("created_at <= ?", *end)
	}

	var total int64
	q.Count(&total)

	var uniqueIPs int64
	q.Distinct("ip_address").Count(&uniqueIPs)

	var totalBots int64
	q.Where("is_bot = ?", true).Count(&totalBots)

	var botPct float64
	if total > 0 {
		botPct = float64(totalBots) / float64(total) * 100
	}

	// Top country (excluding bots)
	type countryRow struct {
		CountryCode string `json:"country_code"`
		Cnt         int64  `json:"cnt"`
	}
	var topCountry countryRow
	subQ := db.Model(&models.VisitorLog{}).Where("is_bot = ?", false)
	if start != nil {
		subQ = subQ.Where("created_at >= ?", *start)
	}
	if end != nil {
		subQ = subQ.Where("created_at <= ?", *end)
	}
	subQ.Select("country_code, COUNT(*) as cnt").
		Where("country_code != ''").
		Group("country_code").
		Order("cnt DESC").
		Limit(1).
		Scan(&topCountry)

	resp := analyticsOverviewResponse{
		TotalVisitors:   total,
		UniqueIPs:       uniqueIPs,
		TotalBots:       totalBots,
		BotPercentage:   botPct,
		TopCountry:      topCountry.CountryCode,
		TopCountryCount: topCountry.Cnt,
	}
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "OK", Data: resp})
}

// ---------------------------------------------------------------------------
// GET /admin/analytics/visitors?page=&page_size=&start=&end=&country=&is_bot=&ip=
// ---------------------------------------------------------------------------

func (ac *AnalyticsController) GetVisitors(c *gin.Context) {
	db := config.GetDB()
	if db == nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Database not initialized"})
		return
	}

	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 20
	}

	start, end := parseDateRange(c)
	q := db.Model(&models.VisitorLog{})
	if start != nil {
		q = q.Where("created_at >= ?", *start)
	}
	if end != nil {
		q = q.Where("created_at <= ?", *end)
	}
	if country := c.Query("country"); country != "" {
		q = q.Where("country_code = ?", country)
	}
	if isBot := c.Query("is_bot"); isBot != "" {
		q = q.Where("is_bot = ?", isBot == "true" || isBot == "1")
	}
	if ip := c.Query("ip"); ip != "" {
		q = q.Where("ip_address LIKE ?", "%"+ip+"%")
	}

	var total int64
	q.Count(&total)

	var logs []models.VisitorLog
	q.Order("created_at DESC").
		Offset((page - 1) * pageSize).
		Limit(pageSize).
		Find(&logs)

	totalPages := int(total) / pageSize
	if int(total)%pageSize > 0 {
		totalPages++
	}

	c.JSON(http.StatusOK, models.APIResponse{
		Success: true,
		Message: "OK",
		Data: gin.H{
			"data":        logs,
			"page":        page,
			"page_size":   pageSize,
			"total":       total,
			"total_pages": totalPages,
		},
	})
}

// ---------------------------------------------------------------------------
// GET /admin/analytics/countries?start=&end=&is_bot=false
// ---------------------------------------------------------------------------

type countryData struct {
	Country     string `json:"country"`
	CountryCode string `json:"country_code"`
	Count       int64  `json:"count"`
}

func (ac *AnalyticsController) GetCountries(c *gin.Context) {
	db := config.GetDB()
	if db == nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Database not initialized"})
		return
	}

	start, end := parseDateRange(c)
	q := db.Model(&models.VisitorLog{}).Where("country_code != ''")
	if start != nil {
		q = q.Where("created_at >= ?", *start)
	}
	if end != nil {
		q = q.Where("created_at <= ?", *end)
	}
	// Default: exclude bots
	isBot := c.DefaultQuery("is_bot", "false")
	if isBot == "false" || isBot == "0" {
		q = q.Where("is_bot = ?", false)
	}

	var countries []countryData
	q.Select("country, country_code, COUNT(*) as count").
		Group("country, country_code").
		Order("count DESC").
		Find(&countries)

	c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "OK", Data: countries})
}

// ---------------------------------------------------------------------------
// GET /admin/analytics/pages?start=&end=&limit=20
// ---------------------------------------------------------------------------

type pageData struct {
	Path  string `json:"path"`
	Count int64  `json:"count"`
}

func (ac *AnalyticsController) GetPages(c *gin.Context) {
	db := config.GetDB()
	if db == nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Database not initialized"})
		return
	}

	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "20"))
	if limit < 1 || limit > 100 {
		limit = 20
	}

	start, end := parseDateRange(c)
	q := db.Model(&models.VisitorLog{}).Where("is_bot = ?", false)
	if start != nil {
		q = q.Where("created_at >= ?", *start)
	}
	if end != nil {
		q = q.Where("created_at <= ?", *end)
	}

	var pages []pageData
	q.Select("path, COUNT(*) as count").
		Group("path").
		Order("count DESC").
		Limit(limit).
		Find(&pages)

	c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "OK", Data: pages})
}

// ---------------------------------------------------------------------------
// GET /admin/analytics/trends?start=&end=
// ---------------------------------------------------------------------------

type trendData struct {
	Date      string `json:"date"`
	Total     int64  `json:"total"`
	UniqueIPs int64  `json:"unique_ips"`
	Bots      int64  `json:"bots"`
}

func (ac *AnalyticsController) GetTrends(c *gin.Context) {
	db := config.GetDB()
	if db == nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Database not initialized"})
		return
	}

	start, end := parseDateRange(c)
	q := db.Model(&models.VisitorLog{})
	if start != nil {
		q = q.Where("created_at >= ?", *start)
	}
	if end != nil {
		q = q.Where("created_at <= ?", *end)
	}

	var trends []trendData
	q.Select("DATE(created_at) as date, COUNT(*) as total, COUNT(DISTINCT ip_address) as unique_ips, SUM(CASE WHEN is_bot = 1 THEN 1 ELSE 0 END) as bots").
		Group("DATE(created_at)").
		Order("date ASC").
		Find(&trends)

	c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "OK", Data: trends})
}

// ---------------------------------------------------------------------------
// GET /admin/analytics/settings
// ---------------------------------------------------------------------------

func (ac *AnalyticsController) GetSettings(c *gin.Context) {
	db := config.GetDB()
	if db == nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Database not initialized"})
		return
	}

	s, err := services.GetOrCreateAnalyticsSetting(db)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to load settings", Error: err.Error()})
		return
	}
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "OK", Data: s})
}

// ---------------------------------------------------------------------------
// PUT /admin/analytics/settings
// ---------------------------------------------------------------------------

type updateAnalyticsSettingsRequest struct {
	RetentionDays       *int    `json:"retention_days"`
	AutoCleanupEnabled  *bool   `json:"auto_cleanup_enabled"`
	TrackingEnabled     *bool   `json:"tracking_enabled"`
	TrackingCodeEnabled *bool   `json:"tracking_code_enabled"`
	TrackingCode        *string `json:"tracking_code"`
}

// GetTrackingCode exposes only the explicitly enabled public tracking snippet.
// The rest of the analytics settings remain admin-only.
func (ac *AnalyticsController) GetTrackingCode(c *gin.Context) {
	db := config.GetDB()
	if db == nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Database not initialized"})
		return
	}
	s, err := services.GetOrCreateAnalyticsSetting(db)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to load tracking code", Error: err.Error()})
		return
	}
	code := ""
	if s.TrackingCodeEnabled {
		code = strings.TrimSpace(s.TrackingCode)
	}
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "OK", Data: gin.H{"enabled": code != "", "code": code}})
}

func (ac *AnalyticsController) UpdateSettings(c *gin.Context) {
	db := config.GetDB()
	if db == nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Database not initialized"})
		return
	}

	var req updateAnalyticsSettingsRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Invalid request", Error: err.Error()})
		return
	}

	s, err := services.GetOrCreateAnalyticsSetting(db)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to load settings", Error: err.Error()})
		return
	}

	updates := map[string]interface{}{}
	if req.RetentionDays != nil {
		updates["retention_days"] = *req.RetentionDays
	}
	if req.AutoCleanupEnabled != nil {
		updates["auto_cleanup_enabled"] = *req.AutoCleanupEnabled
	}
	if req.TrackingEnabled != nil {
		updates["tracking_enabled"] = *req.TrackingEnabled
	}
	if req.TrackingCodeEnabled != nil {
		updates["tracking_code_enabled"] = *req.TrackingCodeEnabled
	}
	if req.TrackingCode != nil {
		updates["tracking_code"] = strings.TrimSpace(*req.TrackingCode)
	}

	if len(updates) > 0 {
		if err := db.Model(s).Updates(updates).Error; err != nil {
			c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to update settings", Error: err.Error()})
			return
		}
	}

	// Reload
	s, _ = services.GetOrCreateAnalyticsSetting(db)
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "Settings updated", Data: s})
}

// ---------------------------------------------------------------------------
// DELETE /admin/analytics/cleanup?before=2024-06-01
// ---------------------------------------------------------------------------

func (ac *AnalyticsController) ManualCleanup(c *gin.Context) {
	db := config.GetDB()
	if db == nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Database not initialized"})
		return
	}

	beforeStr := c.Query("before")
	if beforeStr == "" {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Missing 'before' date parameter (YYYY-MM-DD)"})
		return
	}
	before, err := time.Parse("2006-01-02", beforeStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Invalid date format, use YYYY-MM-DD", Error: err.Error()})
		return
	}

	result := db.Where("created_at < ?", before).Delete(&models.VisitorLog{})
	if result.Error != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to delete records", Error: result.Error.Error()})
		return
	}

	c.JSON(http.StatusOK, models.APIResponse{
		Success: true,
		Message: "Cleanup completed",
		Data: gin.H{
			"deleted_count": result.RowsAffected,
			"before":        beforeStr,
		},
	})
}

// ---------------------------------------------------------------------------
// GET /admin/analytics/country-visitors?country=US&start=&end=&page=&page_size=
// Returns visitor IPs for a specific country (click-through from map)
// ---------------------------------------------------------------------------

type countryVisitorRow struct {
	IPAddress  string `json:"ip_address"`
	City       string `json:"city"`
	Region     string `json:"region"`
	VisitCount int64  `json:"visit_count"`
	LastVisit  string `json:"last_visit"`
}

func (ac *AnalyticsController) GetCountryVisitors(c *gin.Context) {
	db := config.GetDB()
	if db == nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Database not initialized"})
		return
	}

	country := c.Query("country")
	if country == "" {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Missing 'country' parameter"})
		return
	}

	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 20
	}

	start, end := parseDateRange(c)
	q := db.Model(&models.VisitorLog{}).Where("country_code = ? AND is_bot = ?", country, false)
	if start != nil {
		q = q.Where("created_at >= ?", *start)
	}
	if end != nil {
		q = q.Where("created_at <= ?", *end)
	}

	// Count distinct IPs for pagination
	var totalDistinct int64
	db.Raw("SELECT COUNT(DISTINCT ip_address) FROM visitor_logs WHERE country_code = ? AND is_bot = ?"+
		dateWhereSuffix(start, end), country, false).Scan(&totalDistinct)

	var rows []countryVisitorRow
	q.Select("ip_address, city, region, COUNT(*) as visit_count, MAX(created_at) as last_visit").
		Group("ip_address, city, region").
		Order("visit_count DESC").
		Offset((page - 1) * pageSize).
		Limit(pageSize).
		Find(&rows)

	totalPages := int(totalDistinct) / pageSize
	if int(totalDistinct)%pageSize > 0 {
		totalPages++
	}

	c.JSON(http.StatusOK, models.APIResponse{
		Success: true,
		Message: "OK",
		Data: gin.H{
			"country":     country,
			"data":        rows,
			"page":        page,
			"page_size":   pageSize,
			"total":       totalDistinct,
			"total_pages": totalPages,
		},
	})
}

// ---------------------------------------------------------------------------
// GET /admin/analytics/product-skus?start=&end=&country=&limit=20
// Returns hot product SKUs extracted from /products/<sku> paths, grouped by
// visit count. Optionally filter by country to see which SKUs each country likes.
// ---------------------------------------------------------------------------

type productSKUData struct {
	SKU        string `json:"sku"`
	Path       string `json:"path"`
	Count      int64  `json:"count"`
	UniqueIPs  int64  `json:"unique_ips"`
	TopCountry string `json:"top_country"`
}

type productVisitRow struct {
	Path        string `json:"path"`
	Referer     string `json:"referer"`
	IPAddress   string `json:"ip_address"`
	Country     string `json:"country"`
	CountryCode string `json:"country_code"`
}

func (ac *AnalyticsController) GetProductSKUs(c *gin.Context) {
	db := config.GetDB()
	if db == nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Database not initialized"})
		return
	}

	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "20"))
	if limit < 1 || limit > 100 {
		limit = 20
	}

	start, end := parseDateRange(c)
	q := db.Model(&models.VisitorLog{}).
		Where("is_bot = ?", false).
		Where("(path LIKE ? OR path LIKE ? OR referer LIKE ?)", "/products/%", "/api/v1/public/products%", "%/products/%")
	if start != nil {
		q = q.Where("created_at >= ?", *start)
	}
	if end != nil {
		q = q.Where("created_at <= ?", *end)
	}
	if country := c.Query("country"); country != "" {
		q = q.Where("country_code = ?", strings.ToUpper(strings.TrimSpace(country)))
	}

	resolver, err := loadProductSKUResolver(db)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to build SKU resolver", Error: err.Error()})
		return
	}

	var logs []productVisitRow
	if err := q.Select("path, referer, ip_address, country, country_code").Find(&logs).Error; err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to fetch product logs", Error: err.Error()})
		return
	}

	type skuAgg struct {
		Count        int64
		UniqueIPs    map[string]struct{}
		CountryCount map[string]int64
	}
	aggBySKU := make(map[string]*skuAgg)

	for _, row := range logs {
		sku := resolveSKUFromVisitorLog(row.Path, row.Referer, resolver)
		if sku == "" {
			continue
		}

		agg, ok := aggBySKU[sku]
		if !ok {
			agg = &skuAgg{
				UniqueIPs:    map[string]struct{}{},
				CountryCount: map[string]int64{},
			}
			aggBySKU[sku] = agg
		}
		agg.Count++
		if row.IPAddress != "" {
			agg.UniqueIPs[row.IPAddress] = struct{}{}
		}
		if row.CountryCode != "" {
			cc := strings.ToUpper(strings.TrimSpace(row.CountryCode))
			agg.CountryCount[cc]++
		}
	}

	result := make([]productSKUData, 0, len(aggBySKU))
	for sku, agg := range aggBySKU {
		topCountry := ""
		var topCountryCount int64
		for countryCode, count := range agg.CountryCount {
			if count > topCountryCount {
				topCountryCount = count
				topCountry = countryCode
			}
		}
		result = append(result, productSKUData{
			SKU:        sku,
			Path:       "/products/" + normalizeProductPathID(sku),
			Count:      agg.Count,
			UniqueIPs:  int64(len(agg.UniqueIPs)),
			TopCountry: topCountry,
		})
	}

	sort.Slice(result, func(i, j int) bool {
		if result[i].Count == result[j].Count {
			if result[i].UniqueIPs == result[j].UniqueIPs {
				return result[i].SKU < result[j].SKU
			}
			return result[i].UniqueIPs > result[j].UniqueIPs
		}
		return result[i].Count > result[j].Count
	})
	if len(result) > limit {
		result = result[:limit]
	}

	c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "OK", Data: result})
}

// ---------------------------------------------------------------------------
// GET /admin/analytics/country-skus?start=&end=&limit=10
// Returns top countries with their favorite SKUs
// ---------------------------------------------------------------------------

type countrySKUData struct {
	CountryCode string   `json:"country_code"`
	Country     string   `json:"country"`
	TotalViews  int64    `json:"total_views"`
	TopSKUs     []skuHit `json:"top_skus"`
}

type skuHit struct {
	SKU   string `json:"sku"`
	Path  string `json:"path"`
	Count int64  `json:"count"`
}

func (ac *AnalyticsController) GetCountrySKUs(c *gin.Context) {
	db := config.GetDB()
	if db == nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Database not initialized"})
		return
	}

	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "10"))
	if limit < 1 || limit > 50 {
		limit = 10
	}

	start, end := parseDateRange(c)
	q := db.Model(&models.VisitorLog{}).
		Where("is_bot = ? AND country_code != ''", false).
		Where("(path LIKE ? OR path LIKE ? OR referer LIKE ?)", "/products/%", "/api/v1/public/products%", "%/products/%")
	if start != nil {
		q = q.Where("created_at >= ?", *start)
	}
	if end != nil {
		q = q.Where("created_at <= ?", *end)
	}

	resolver, err := loadProductSKUResolver(db)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to build SKU resolver", Error: err.Error()})
		return
	}

	var logs []productVisitRow
	if err := q.Select("path, referer, country, country_code").Find(&logs).Error; err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to fetch product logs", Error: err.Error()})
		return
	}

	type countryAgg struct {
		Country   string
		Total     int64
		SKUCounts map[string]int64
	}
	aggByCountry := make(map[string]*countryAgg)

	for _, row := range logs {
		sku := resolveSKUFromVisitorLog(row.Path, row.Referer, resolver)
		if sku == "" {
			continue
		}

		countryCode := strings.ToUpper(strings.TrimSpace(row.CountryCode))
		if countryCode == "" {
			continue
		}
		agg, ok := aggByCountry[countryCode]
		if !ok {
			agg = &countryAgg{Country: row.Country, SKUCounts: map[string]int64{}}
			aggByCountry[countryCode] = agg
		}
		if agg.Country == "" && row.Country != "" {
			agg.Country = row.Country
		}
		agg.Total++
		agg.SKUCounts[sku]++
	}

	type countryItem struct {
		CountryCode string
		Agg         *countryAgg
	}
	countries := make([]countryItem, 0, len(aggByCountry))
	for code, agg := range aggByCountry {
		countries = append(countries, countryItem{CountryCode: code, Agg: agg})
	}
	sort.Slice(countries, func(i, j int) bool {
		if countries[i].Agg.Total == countries[j].Agg.Total {
			return countries[i].CountryCode < countries[j].CountryCode
		}
		return countries[i].Agg.Total > countries[j].Agg.Total
	})
	if len(countries) > limit {
		countries = countries[:limit]
	}

	result := make([]countrySKUData, 0, len(countries))
	for _, item := range countries {
		type skuItem struct {
			SKU   string
			Count int64
		}
		skuItems := make([]skuItem, 0, len(item.Agg.SKUCounts))
		for sku, count := range item.Agg.SKUCounts {
			skuItems = append(skuItems, skuItem{SKU: sku, Count: count})
		}
		sort.Slice(skuItems, func(i, j int) bool {
			if skuItems[i].Count == skuItems[j].Count {
				return skuItems[i].SKU < skuItems[j].SKU
			}
			return skuItems[i].Count > skuItems[j].Count
		})
		if len(skuItems) > 5 {
			skuItems = skuItems[:5]
		}

		topSKUs := make([]skuHit, 0, len(skuItems))
		for _, skuItem := range skuItems {
			topSKUs = append(topSKUs, skuHit{
				SKU:   skuItem.SKU,
				Path:  "/products/" + normalizeProductPathID(skuItem.SKU),
				Count: skuItem.Count,
			})
		}

		countryName := strings.TrimSpace(item.Agg.Country)
		if countryName == "" {
			countryName = item.CountryCode
		}

		result = append(result, countrySKUData{
			CountryCode: item.CountryCode,
			Country:     countryName,
			TotalViews:  item.Agg.Total,
			TopSKUs:     topSKUs,
		})
	}

	c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "OK", Data: result})
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type productSKUResolver struct {
	byPathID      map[string]string
	bySlug        map[string]string
	sortedPathIDs []string
}

func loadProductSKUResolver(db *gorm.DB) (*productSKUResolver, error) {
	type productRef struct {
		SKU  string `json:"sku"`
		Slug string `json:"slug"`
	}

	var refs []productRef
	if err := db.Model(&models.Product{}).Select("sku, slug").Find(&refs).Error; err != nil {
		return nil, err
	}

	resolver := &productSKUResolver{
		byPathID:      make(map[string]string, len(refs)),
		bySlug:        make(map[string]string, len(refs)),
		sortedPathIDs: make([]string, 0, len(refs)),
	}
	seenPathID := make(map[string]struct{}, len(refs))

	for _, ref := range refs {
		sku := strings.ToUpper(strings.TrimSpace(ref.SKU))
		if sku == "" {
			continue
		}

		pathID := normalizeProductPathID(sku)
		if pathID != "" {
			if _, exists := resolver.byPathID[pathID]; !exists {
				resolver.byPathID[pathID] = sku
			}
			if _, exists := seenPathID[pathID]; !exists {
				seenPathID[pathID] = struct{}{}
				resolver.sortedPathIDs = append(resolver.sortedPathIDs, pathID)
			}
		}

		slugKey := strings.ToLower(strings.TrimSpace(ref.Slug))
		if slugKey != "" {
			if _, exists := resolver.bySlug[slugKey]; !exists {
				resolver.bySlug[slugKey] = sku
			}
		}
	}

	sort.Slice(resolver.sortedPathIDs, func(i, j int) bool {
		if len(resolver.sortedPathIDs[i]) == len(resolver.sortedPathIDs[j]) {
			return resolver.sortedPathIDs[i] < resolver.sortedPathIDs[j]
		}
		return len(resolver.sortedPathIDs[i]) > len(resolver.sortedPathIDs[j])
	})

	return resolver, nil
}

func normalizeProductPathID(value string) string {
	s := strings.TrimSpace(value)
	if s == "" {
		return ""
	}
	s = strings.ReplaceAll(s, "\\", "-")
	s = strings.ReplaceAll(s, "/", "-")
	if strings.ContainsAny(s, " \t\n\r") {
		s = strings.Join(strings.Fields(s), "-")
	}
	s = strings.Trim(s, "-")
	return strings.ToUpper(s)
}

func (r *productSKUResolver) resolve(candidate string) string {
	if r == nil {
		return ""
	}

	pathID := normalizeProductPathID(candidate)
	if pathID == "" {
		return ""
	}

	if sku, ok := r.byPathID[pathID]; ok {
		return sku
	}

	if strings.HasPrefix(pathID, "FANUC-") {
		trimmed := strings.TrimPrefix(pathID, "FANUC-")
		if sku, ok := r.byPathID[trimmed]; ok {
			return sku
		}
		pathID = trimmed
	}

	for _, knownPathID := range r.sortedPathIDs {
		if strings.HasPrefix(pathID, knownPathID+"-") {
			return r.byPathID[knownPathID]
		}
	}

	slugKey := strings.ToLower(strings.Trim(strings.TrimSpace(candidate), "/"))
	if slugKey != "" {
		if sku, ok := r.bySlug[slugKey]; ok {
			return sku
		}
	}

	return ""
}

func resolveSKUFromVisitorLog(pathValue, referer string, resolver *productSKUResolver) string {
	candidates := []string{
		extractProductTokenFromURLLike(pathValue),
		extractProductTokenFromURLLike(referer),
	}

	for _, candidate := range candidates {
		if candidate == "" {
			continue
		}
		if sku := resolver.resolve(candidate); sku != "" {
			return sku
		}
	}

	if sku := extractSKUFromPath(pathValue); sku != "" {
		return sku
	}
	if sku := extractSKUFromPath(referer); sku != "" {
		return sku
	}

	return ""
}

func extractProductTokenFromURLLike(raw string) string {
	pathValue, query := parseURLLike(raw)
	if pathValue == "" {
		return ""
	}

	cleanPath := strings.TrimSpace(pathValue)
	cleanPath = strings.TrimSuffix(cleanPath, "/")

	extractSegment := func(prefix string) string {
		segment := strings.TrimPrefix(cleanPath, prefix)
		segment = strings.Trim(segment, "/")
		if idx := strings.Index(segment, "/"); idx >= 0 {
			segment = segment[:idx]
		}
		if decoded, err := url.PathUnescape(segment); err == nil {
			segment = decoded
		}
		return strings.TrimSpace(segment)
	}

	if strings.HasPrefix(cleanPath, "/products/") {
		return extractSegment("/products/")
	}

	if strings.HasPrefix(cleanPath, "/api/v1/public/products/sku/") {
		return extractSegment("/api/v1/public/products/sku/")
	}

	if cleanPath == "/api/v1/public/products/sku" {
		return strings.TrimSpace(query.Get("sku"))
	}

	if cleanPath == "/api/v1/public/products" || strings.HasPrefix(cleanPath, "/api/v1/public/products/") {
		if sku := strings.TrimSpace(query.Get("sku")); sku != "" {
			return sku
		}
		if search := strings.TrimSpace(query.Get("search")); looksLikeSKUQuery(search) {
			return search
		}
	}

	return ""
}

func looksLikeSKUQuery(value string) bool {
	v := strings.TrimSpace(value)
	if len(v) < 4 || len(v) > 120 {
		return false
	}

	hasLetter := false
	hasDigit := false
	for _, ch := range v {
		switch {
		case ch >= 'a' && ch <= 'z', ch >= 'A' && ch <= 'Z':
			hasLetter = true
		case ch >= '0' && ch <= '9':
			hasDigit = true
		case ch == '-', ch == '_', ch == '/', ch == '\\', ch == '.', ch == ' ':
			// allowed SKU separators
		default:
			return false
		}
	}
	return hasLetter && hasDigit
}

func parseURLLike(raw string) (string, url.Values) {
	v := strings.TrimSpace(raw)
	if v == "" {
		return "", url.Values{}
	}

	if u, err := url.Parse(v); err == nil {
		return u.Path, u.Query()
	}

	pathValue := v
	queryValue := ""
	if idx := strings.Index(pathValue, "?"); idx >= 0 {
		queryValue = pathValue[idx+1:]
		pathValue = pathValue[:idx]
	}
	parsedQuery, _ := url.ParseQuery(queryValue)
	return pathValue, parsedQuery
}

func parseDateRange(c *gin.Context) (*time.Time, *time.Time) {
	var start, end *time.Time
	if s := c.Query("start"); s != "" {
		if t, err := time.Parse("2006-01-02", s); err == nil {
			start = &t
		}
	}
	if e := c.Query("end"); e != "" {
		if t, err := time.Parse("2006-01-02", e); err == nil {
			// End of day
			eod := t.Add(24*time.Hour - time.Second)
			end = &eod
		}
	}
	return start, end
}

// extractSKUFromPath converts "/products/a16b-3200-0100" to "A16B-3200-0100".
func extractSKUFromPath(p string) string {
	pathValue, _ := parseURLLike(p)
	if !strings.HasPrefix(pathValue, "/products/") {
		return ""
	}
	p = strings.TrimPrefix(pathValue, "/products/")
	p = strings.Trim(p, "/")
	if p == "" || strings.Contains(p, "/") {
		return ""
	}
	if decoded, err := url.PathUnescape(p); err == nil {
		p = decoded
	}
	return strings.ToUpper(p)
}

// dateWhereSuffix builds a raw SQL suffix for date filters (used by raw queries).
func dateWhereSuffix(start, end *time.Time) string {
	s := ""
	if start != nil {
		s += " AND created_at >= '" + start.Format("2006-01-02 15:04:05") + "'"
	}
	if end != nil {
		s += " AND created_at <= '" + end.Format("2006-01-02 15:04:05") + "'"
	}
	return s
}
