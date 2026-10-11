package controllers

import (
	"errors"
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"strings"

	"fanuc-backend/config"
	"fanuc-backend/models"
	"fanuc-backend/services"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// ShippingRateController manages template-based shipping.
// Paths kept as /shipping-rates for backwards compatibility.
type ShippingRateController struct{}

// Public: GET /api/v1/public/shipping/countries
func (sc *ShippingRateController) PublicCountries(c *gin.Context) {
	db := config.GetDB()
	carrier := strings.TrimSpace(c.Query("carrier"))
	serviceCode := strings.TrimSpace(c.Query("service"))
	mergeCountries := func(a []services.ShippingCountryPublic, b []services.ShippingCountryPublic) []services.ShippingCountryPublic {
		m := map[string]services.ShippingCountryPublic{}
		for _, it := range a {
			m[strings.ToUpper(it.CountryCode)] = it
		}
		for _, it := range b {
			m[strings.ToUpper(it.CountryCode)] = it
		}
		out := make([]services.ShippingCountryPublic, 0, len(m))
		for _, v := range m {
			out = append(out, v)
		}
		sort.SliceStable(out, func(i, j int) bool {
			return strings.ToLower(out[i].CountryName) < strings.ToLower(out[j].CountryName)
		})
		return out
	}

	var (
		list []services.ShippingCountryPublic
		err  error
	)
	if carrier != "" {
		// Carrier mode: return union of (carrier templates) and (default country templates).
		carrierList, e := services.ListActiveCarrierShippingCountries(db, carrier, serviceCode)
		if e != nil {
			err = e
		} else {
			defaultList, e2 := services.ListActiveShippingCountries(db)
			if e2 != nil {
				err = e2
			} else {
				list = mergeCountries(defaultList, carrierList)
			}
		}
	} else {
		// No carrier selected (checkout/public default): still include countries that only
		// have carrier templates, otherwise whitelist countries can appear "missing".
		defaultList, e1 := services.ListActiveShippingCountries(db)
		if e1 != nil {
			err = e1
		} else {
			carrierList, e2 := services.ListActiveCarrierShippingCountries(db, "", "")
			if e2 != nil {
				err = e2
			} else {
				list = mergeCountries(defaultList, carrierList)
			}
		}
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to fetch countries", Error: err.Error()})
		return
	}
	list = mergeCountries(list, freeShippingPublicCountries(db))
	for i := range list {
		list[i].CountryName = services.EnglishCountryName(list[i].CountryCode, list[i].CountryName)
	}
	sort.SliceStable(list, func(i, j int) bool {
		return strings.ToLower(list[i].CountryName) < strings.ToLower(list[j].CountryName)
	})
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "OK", Data: list})
}

// freeShippingPublicCountries makes free-shipping countries selectable even without a rate
// template, still honouring the selling-country whitelist when one is configured.
func freeShippingPublicCountries(db *gorm.DB) []services.ShippingCountryPublic {
	var free []models.ShippingFreeSetting
	if err := db.Where("free_shipping_enabled = ?", true).Find(&free).Error; err != nil || len(free) == 0 {
		return nil
	}
	var allowed []models.ShippingAllowedCountry
	db.Find(&allowed)
	whitelist := map[string]bool{}
	for _, a := range allowed {
		whitelist[a.CountryCode] = true
	}
	out := make([]services.ShippingCountryPublic, 0, len(free))
	for _, f := range free {
		if len(whitelist) > 0 && !whitelist[f.CountryCode] {
			continue
		}
		out = append(out, services.ShippingCountryPublic{
			CountryCode: f.CountryCode,
			CountryName: services.EnglishCountryName(f.CountryCode, f.CountryName),
			Currency:    "USD",
		})
	}
	return out
}

// Public: GET /api/v1/public/shipping/quote?country=US&weight_kg=12.3
func (sc *ShippingRateController) PublicQuote(c *gin.Context) {
	carrier := strings.TrimSpace(c.Query("carrier"))
	serviceCode := strings.TrimSpace(c.Query("service"))
	cc := strings.TrimSpace(c.Query("country"))
	if cc == "" {
		cc = strings.TrimSpace(c.Query("country_code"))
	}
	if cc == "" {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Missing country", Error: "missing_country"})
		return
	}
	wStr := strings.TrimSpace(c.Query("weight_kg"))
	if wStr == "" {
		wStr = strings.TrimSpace(c.Query("weight"))
	}
	weight := 0.0
	if wStr != "" {
		v, err := strconv.ParseFloat(strings.ReplaceAll(wStr, ",", ""), 64)
		if err != nil {
			c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Invalid weight", Error: err.Error()})
			return
		}
		weight = v
	}
	db := config.GetDB()
	if services.IsFreeShippingCountry(db, cc) {
		c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "OK", Data: services.ShippingQuoteResult{
			CountryCode:   services.NormalizeCountryCode(cc),
			Currency:      "USD",
			WeightKg:      weight,
			BillingWeight: weight,
			Source:        "free_shipping",
		}})
		return
	}
	var (
		q   services.ShippingQuoteResult
		err error
	)
	if carrier != "" {
		q, err = services.CalculateCarrierShippingQuote(db, carrier, serviceCode, cc, weight)
		if errors.Is(err, gorm.ErrRecordNotFound) {
			// Carrier template missing for this country; fall back to default country template.
			q, err = services.CalculateShippingQuote(db, cc, weight)
			if err == nil {
				q.Source = "default_fallback"
				q.Carrier = services.NormalizeCarrier(carrier)
				q.ServiceCode = services.NormalizeServiceCode(serviceCode)
			}
		}
	} else {
		q, err = services.CalculateShippingQuote(db, cc, weight)
		if errors.Is(err, gorm.ErrRecordNotFound) {
			// Checkout/public default flow: if default template is missing, try any carrier template.
			type pair struct {
				Carrier     string
				ServiceCode string
			}
			var pairs []pair
			qe := db.Model(&models.ShippingCarrierTemplate{}).
				Select("carrier, service_code").
				Where("country_code = ? AND is_active = ?", services.NormalizeCountryCode(cc), true).
				Group("carrier, service_code").
				Order("CASE WHEN carrier = 'FEDEX' THEN 0 WHEN carrier = 'DHL' THEN 1 ELSE 9 END, carrier ASC, service_code ASC").
				Scan(&pairs).Error
			if qe == nil && len(pairs) > 0 {
				q, err = services.CalculateCarrierShippingQuote(db, pairs[0].Carrier, pairs[0].ServiceCode, cc, weight)
				if err == nil {
					q.Source = "carrier_fallback"
				}
			} else if qe != nil {
				err = qe
			}
		}
	}
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, models.APIResponse{Success: false, Message: "Shipping template not found", Error: "not_found"})
			return
		}
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Failed to calculate shipping", Error: err.Error()})
		return
	}
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "OK", Data: q})
}

// Admin: GET /api/v1/admin/shipping-rates
func (sc *ShippingRateController) AdminList(c *gin.Context) {
	db := config.GetDB()
	q := strings.TrimSpace(c.Query("q"))
	typeParam := strings.ToLower(strings.TrimSpace(c.Query("type")))
	if typeParam == "carrier" {
		carrier := services.NormalizeCarrier(c.Query("carrier"))
		serviceCode := services.NormalizeServiceCode(c.Query("service"))

		query := db.Model(&models.ShippingCarrierTemplate{})
		if carrier != "" {
			query = query.Where("carrier = ?", carrier)
		}
		if serviceCode != "" {
			query = query.Where("service_code = ?", serviceCode)
		}
		if q != "" {
			like := "%" + q + "%"
			query = query.Where("country_code LIKE ? OR country_name LIKE ?", like, like)
		}

		var tpls []models.ShippingCarrierTemplate
		if err := query.Order("carrier ASC, service_code ASC, country_name ASC").Find(&tpls).Error; err != nil {
			c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to list templates", Error: err.Error()})
			return
		}

		out := make([]gin.H, 0, len(tpls))
		for _, t := range tpls {
			var wc int64
			var qc int64
			db.Model(&models.ShippingCarrierWeightBracket{}).Where("template_id = ?", t.ID).Count(&wc)
			db.Model(&models.ShippingCarrierQuoteSurcharge{}).Where("template_id = ?", t.ID).Count(&qc)
			out = append(out, gin.H{
				"id":               t.ID,
				"carrier":          t.Carrier,
				"service_code":     t.ServiceCode,
				"country_code":     t.CountryCode,
				"country_name":     t.CountryName,
				"currency":         t.Currency,
				"is_active":        t.IsActive,
				"weight_brackets":  wc,
				"quote_surcharges": qc,
				"created_at":       t.CreatedAt,
				"updated_at":       t.UpdatedAt,
			})
		}
		c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "OK", Data: out})
		return
	}

	query := db.Model(&models.ShippingTemplate{})
	if q != "" {
		like := "%" + q + "%"
		query = query.Where("country_code LIKE ? OR country_name LIKE ?", like, like)
	}

	var tpls []models.ShippingTemplate
	if err := query.Preload("WeightBrackets").Preload("QuoteSurcharges").Find(&tpls).Error; err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to list templates", Error: err.Error()})
		return
	}

	out := make([]gin.H, 0, len(tpls))
	for _, t := range tpls {
		item := gin.H{
			"id":               t.ID,
			"country_code":     t.CountryCode,
			"country_name":     services.EnglishCountryName(t.CountryCode, t.CountryName),
			"currency":         t.Currency,
			"is_active":        t.IsActive,
			"weight_brackets":  len(t.WeightBrackets),
			"quote_surcharges": len(t.QuoteSurcharges),
			"pricing_mode":     "brackets",
			"created_at":       t.CreatedAt,
			"updated_at":       t.UpdatedAt,
		}
		if rate, ok := services.PerKgRateFor(t.WeightBrackets); ok && len(t.QuoteSurcharges) == 0 {
			item["pricing_mode"] = "per_kg"
			item["rate_per_kg"] = rate
		}
		out = append(out, item)
	}
	sort.SliceStable(out, func(i, j int) bool {
		return strings.ToLower(out[i]["country_name"].(string)) < strings.ToLower(out[j]["country_name"].(string))
	})

	c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "OK", Data: out})
}

// Admin: GET /api/v1/admin/shipping-rates/world-countries
func (sc *ShippingRateController) WorldCountries(c *gin.Context) {
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "OK", Data: services.WorldCountryList()})
}

type upsertCountryRateReq struct {
	RatePerKg float64 `json:"rate_per_kg"`
	Currency  string  `json:"currency"`
}

// Admin: PUT /api/v1/admin/shipping-rates/country/:code
func (sc *ShippingRateController) UpsertCountryRate(c *gin.Context) {
	var req upsertCountryRateReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Invalid request", Error: err.Error()})
		return
	}
	tpl, err := services.UpsertCountryPerKgRate(config.GetDB(), c.Param("code"), req.RatePerKg, req.Currency)
	if err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: err.Error(), Error: err.Error()})
		return
	}
	_ = services.ClearRedisByPrefixes(c.Request.Context(), "cache:public:shipping_countries:")
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "Saved", Data: tpl})
}

// Admin: GET /api/v1/admin/shipping-rates/import/template
func (sc *ShippingRateController) DownloadTemplate(c *gin.Context) {
	typeParam := strings.ToLower(strings.TrimSpace(c.Query("type")))
	carrier := strings.TrimSpace(c.Query("carrier"))
	serviceCode := strings.TrimSpace(c.Query("service"))
	currency := strings.TrimSpace(c.Query("currency"))
	var (
		b   []byte
		err error
	)
	filename := "shipping-rate-per-kg.xlsx"
	switch typeParam {
	case "carrier-zone":
		b, err = services.GenerateCarrierZoneTemplateXLSX(services.CarrierZoneImportOptions{Carrier: carrier, ServiceCode: serviceCode, Currency: currency})
	case "country-advanced":
		b, err = services.GenerateShippingTemplateXLSX_USSample()
		filename = "shipping-template-advanced.xlsx"
	default:
		b, err = services.GenerateShippingPerKgTemplateXLSX(config.GetDB())
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to generate template", Error: err.Error()})
		return
	}
	if typeParam == "carrier-zone" {
		cc := services.NormalizeCarrier(carrier)
		ss := services.NormalizeServiceCode(serviceCode)
		if cc != "" {
			filename = "shipping-" + strings.ToLower(cc)
			if ss != "" {
				filename += "-" + strings.ToLower(ss)
			}
			filename += "-zone-template.xlsx"
		} else {
			filename = "shipping-carrier-zone-template.xlsx"
		}
	}
	c.Header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
	c.Header("Content-Disposition", fmt.Sprintf("attachment; filename=\"%s\"", filename))
	c.Data(http.StatusOK, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", b)
}

// Admin: POST /api/v1/admin/shipping-rates/import/xlsx?replace=1
func (sc *ShippingRateController) ImportXLSX(c *gin.Context) {
	replace := strings.TrimSpace(c.Query("replace")) == "1" || strings.ToLower(strings.TrimSpace(c.Query("replace"))) == "true"
	typeParam := strings.ToLower(strings.TrimSpace(c.Query("type")))
	carrier := strings.TrimSpace(c.Query("carrier"))
	serviceCode := strings.TrimSpace(c.Query("service"))
	currency := strings.TrimSpace(c.Query("currency"))

	file, err := c.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Missing file", Error: err.Error()})
		return
	}
	src, err := file.Open()
	if err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Failed to read file", Error: err.Error()})
		return
	}
	defer src.Close()

	db := config.GetDB()
	var (
		res services.ShippingTemplateImportResult
	)
	if typeParam == "carrier-zone" {
		res, err = services.ImportCarrierZoneTemplatesFromXLSX(c.Request.Context(), db, src, replace, services.CarrierZoneImportOptions{Carrier: carrier, ServiceCode: serviceCode, Currency: currency})
	} else {
		res, err = services.ImportShippingTemplatesFromXLSX(c.Request.Context(), db, src, replace)
	}
	if err != nil {
		msg := "Import failed"
		if len(res.Errors) > 0 {
			// surface the first few errors to the UI
			max := 3
			if len(res.Errors) < max {
				max = len(res.Errors)
			}
			msg = msg + ": " + strings.Join(res.Errors[:max], "; ")
		}
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: msg, Error: err.Error(), Data: res})
		return
	}
	// Shipping countries endpoint is cached; clear it so whitelist/template changes show immediately.
	_ = services.ClearRedisByPrefixes(c.Request.Context(), "cache:public:shipping_countries:")
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "Import completed", Data: res})
}

type bulkDeleteShippingReq struct {
	All          bool     `json:"all"`
	CountryCodes []string `json:"country_codes"`
}

// Admin: POST /api/v1/admin/shipping-rates/bulk-delete
func (sc *ShippingRateController) BulkDelete(c *gin.Context) {
	typeParam := strings.ToLower(strings.TrimSpace(c.Query("type")))
	carrier := services.NormalizeCarrier(c.Query("carrier"))
	serviceCode := services.NormalizeServiceCode(c.Query("service"))
	if typeParam == "carrier" {
		var req bulkDeleteShippingReq
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Invalid request", Error: err.Error()})
			return
		}
		if carrier == "" {
			c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Missing carrier", Error: "missing_carrier"})
			return
		}
		db := config.GetDB()

		q := db.Model(&models.ShippingCarrierTemplate{}).Where("carrier = ?", carrier)
		if serviceCode != "" {
			q = q.Where("service_code = ?", serviceCode)
		}

		var templates []models.ShippingCarrierTemplate
		if req.All {
			if err := q.Find(&templates).Error; err != nil {
				c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to load templates", Error: err.Error()})
				return
			}
		} else {
			codes := make([]string, 0, len(req.CountryCodes))
			for _, c0 := range req.CountryCodes {
				cc := services.NormalizeCountryCode(c0)
				if cc != "" {
					codes = append(codes, cc)
				}
			}
			if len(codes) == 0 {
				c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "No country codes provided", Error: "missing_country_codes"})
				return
			}
			if err := q.Where("country_code IN ?", codes).Find(&templates).Error; err != nil {
				c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to load templates", Error: err.Error()})
				return
			}
		}

		deleted := 0
		err := db.Transaction(func(tx *gorm.DB) error {
			for _, t := range templates {
				_ = tx.Where("template_id = ?", t.ID).Delete(&models.ShippingCarrierWeightBracket{}).Error
				_ = tx.Where("template_id = ?", t.ID).Delete(&models.ShippingCarrierQuoteSurcharge{}).Error
				if e := tx.Delete(&models.ShippingCarrierTemplate{}, t.ID).Error; e != nil {
					return e
				}
				deleted++
			}
			return nil
		})
		if err != nil {
			c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to delete", Error: err.Error()})
			return
		}
		_ = services.ClearRedisByPrefixes(c.Request.Context(), "cache:public:shipping_countries:")
		c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "Deleted", Data: gin.H{"deleted": deleted}})
		return
	}

	var req bulkDeleteShippingReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Invalid request", Error: err.Error()})
		return
	}
	db := config.GetDB()

	var templates []models.ShippingTemplate
	if req.All {
		if err := db.Find(&templates).Error; err != nil {
			c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to load templates", Error: err.Error()})
			return
		}
	} else {
		codes := make([]string, 0, len(req.CountryCodes))
		for _, c0 := range req.CountryCodes {
			cc := services.NormalizeCountryCode(c0)
			if cc != "" {
				codes = append(codes, cc)
			}
		}
		if len(codes) == 0 {
			c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "No country codes provided", Error: "missing_country_codes"})
			return
		}
		if err := db.Where("country_code IN ?", codes).Find(&templates).Error; err != nil {
			c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to load templates", Error: err.Error()})
			return
		}
	}

	deleted := 0
	err := db.Transaction(func(tx *gorm.DB) error {
		for _, t := range templates {
			_ = tx.Where("template_id = ?", t.ID).Delete(&models.ShippingWeightBracket{}).Error
			_ = tx.Where("template_id = ?", t.ID).Delete(&models.ShippingQuoteSurcharge{}).Error
			if e := tx.Delete(&models.ShippingTemplate{}, t.ID).Error; e != nil {
				return e
			}
			deleted++
		}
		return nil
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to delete", Error: err.Error()})
		return
	}

	_ = services.ClearRedisByPrefixes(c.Request.Context(), "cache:public:shipping_countries:")
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "Deleted", Data: gin.H{"deleted": deleted}})
}

// ========== Allowed Countries Whitelist ==========

type allowedCountryReq struct {
	CountryCode string `json:"country_code" binding:"required"`
	CountryName string `json:"country_name"`
	SortOrder   int    `json:"sort_order"`
}

// Admin: GET /api/v1/admin/shipping-rates/allowed-countries
func (sc *ShippingRateController) ListAllowedCountries(c *gin.Context) {
	db := config.GetDB()
	var list []models.ShippingAllowedCountry
	if err := db.Order("sort_order ASC, country_name ASC").Find(&list).Error; err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to list allowed countries", Error: err.Error()})
		return
	}
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "OK", Data: list})
}

// Admin: POST /api/v1/admin/shipping-rates/allowed-countries
func (sc *ShippingRateController) AddAllowedCountry(c *gin.Context) {
	var req allowedCountryReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Invalid request", Error: err.Error()})
		return
	}
	cc := services.NormalizeCountryCode(req.CountryCode)
	if cc == "" {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Invalid country code", Error: "invalid_country_code"})
		return
	}
	name := strings.TrimSpace(req.CountryName)
	if name == "" {
		name = cc
	}

	db := config.GetDB()
	var existing models.ShippingAllowedCountry
	if err := db.Where("country_code = ?", cc).First(&existing).Error; err == nil {
		c.JSON(http.StatusConflict, models.APIResponse{Success: false, Message: "Country already in whitelist", Error: "already_exists"})
		return
	}

	entry := models.ShippingAllowedCountry{
		CountryCode: cc,
		CountryName: name,
		SortOrder:   req.SortOrder,
	}
	if err := db.Create(&entry).Error; err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to add country", Error: err.Error()})
		return
	}
	_ = services.ClearRedisByPrefixes(c.Request.Context(), "cache:public:shipping_countries:")
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "Country added to whitelist", Data: entry})
}

// Admin: DELETE /api/v1/admin/shipping-rates/allowed-countries/:code
func (sc *ShippingRateController) RemoveAllowedCountry(c *gin.Context) {
	cc := services.NormalizeCountryCode(c.Param("code"))
	if cc == "" {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Invalid country code", Error: "invalid_country_code"})
		return
	}
	db := config.GetDB()
	result := db.Where("country_code = ?", cc).Delete(&models.ShippingAllowedCountry{})
	if result.Error != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to remove country", Error: result.Error.Error()})
		return
	}
	if result.RowsAffected == 0 {
		c.JSON(http.StatusNotFound, models.APIResponse{Success: false, Message: "Country not found in whitelist", Error: "not_found"})
		return
	}
	_ = services.ClearRedisByPrefixes(c.Request.Context(), "cache:public:shipping_countries:")
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "Country removed from whitelist"})
}

type bulkAllowedCountriesReq struct {
	Countries []allowedCountryReq `json:"countries"`
}

// Admin: POST /api/v1/admin/shipping-rates/allowed-countries/bulk
func (sc *ShippingRateController) BulkSetAllowedCountries(c *gin.Context) {
	var req bulkAllowedCountriesReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Invalid request", Error: err.Error()})
		return
	}

	db := config.GetDB()
	err := db.Transaction(func(tx *gorm.DB) error {
		// Clear existing
		if e := tx.Where("1=1").Delete(&models.ShippingAllowedCountry{}).Error; e != nil {
			return e
		}
		// Insert new
		for i, r := range req.Countries {
			cc := services.NormalizeCountryCode(r.CountryCode)
			if cc == "" {
				continue
			}
			name := services.EnglishCountryName(cc, r.CountryName)
			entry := models.ShippingAllowedCountry{
				CountryCode: cc,
				CountryName: name,
				SortOrder:   i,
			}
			if e := tx.Create(&entry).Error; e != nil {
				return e
			}
		}
		return nil
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to update whitelist", Error: err.Error()})
		return
	}
	_ = services.ClearRedisByPrefixes(c.Request.Context(), "cache:public:shipping_countries:")
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "Whitelist updated", Data: gin.H{"count": len(req.Countries)}})
}

// ========== Free Shipping Settings ==========

type freeShippingCountryReq struct {
	CountryCode         string `json:"country_code" binding:"required"`
	CountryName         string `json:"country_name"`
	FreeShippingEnabled bool   `json:"free_shipping_enabled"`
}

type bulkFreeShippingReq struct {
	Countries []freeShippingCountryReq `json:"countries" binding:"required"`
}

// Admin: GET /api/v1/admin/shipping-rates/free-shipping
func (sc *ShippingRateController) GetFreeShippingCountries(c *gin.Context) {
	db := config.GetDB()
	var list []models.ShippingFreeSetting
	if err := db.Order("country_name ASC").Find(&list).Error; err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to fetch free shipping settings", Error: err.Error()})
		return
	}
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "OK", Data: list})
}

// Admin: POST /api/v1/admin/shipping-rates/free-shipping
func (sc *ShippingRateController) SetFreeShippingCountries(c *gin.Context) {
	var req bulkFreeShippingReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Invalid request", Error: err.Error()})
		return
	}
	db := config.GetDB()
	err := db.Transaction(func(tx *gorm.DB) error {
		// Clear existing
		if e := tx.Where("1=1").Delete(&models.ShippingFreeSetting{}).Error; e != nil {
			return e
		}
		// Insert new
		for _, r := range req.Countries {
			cc := services.NormalizeCountryCode(r.CountryCode)
			if cc == "" {
				continue
			}
			name := services.EnglishCountryName(cc, r.CountryName)
			entry := models.ShippingFreeSetting{
				CountryCode:         cc,
				CountryName:         name,
				FreeShippingEnabled: r.FreeShippingEnabled,
			}
			if e := tx.Create(&entry).Error; e != nil {
				return e
			}
		}
		return nil
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to update free shipping settings", Error: err.Error()})
		return
	}
	_ = services.ClearRedisByPrefixes(c.Request.Context(), "cache:public:shipping_countries:")
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "Free shipping settings updated", Data: gin.H{"count": len(req.Countries)}})
}

// Public: GET /api/v1/public/shipping/free-countries
func (sc *ShippingRateController) PublicFreeShippingCountries(c *gin.Context) {
	db := config.GetDB()
	var list []models.ShippingFreeSetting
	if err := db.Where("free_shipping_enabled = ?", true).Order("country_name ASC").Find(&list).Error; err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to fetch free shipping countries", Error: err.Error()})
		return
	}
	// Return minimal public info
	type publicEntry struct {
		CountryCode string `json:"country_code"`
		CountryName string `json:"country_name"`
	}
	out := make([]publicEntry, 0, len(list))
	for _, s := range list {
		out = append(out, publicEntry{CountryCode: s.CountryCode, CountryName: services.EnglishCountryName(s.CountryCode, s.CountryName)})
	}
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "OK", Data: out})
}
