package controllers

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"encoding/xml"
	"errors"
	"fmt"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"fanuc-backend/config"
	"fanuc-backend/models"
	"fanuc-backend/services"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// DefaultShippingItemWeightKg is the fallback billable weight per item when a
// product record does not specify a weight. Shared by CreateOrder, storefront
// checkout, Product JSON-LD shippingDetails and the Google Merchant Center feed
// so shipping quotes never diverge between landing pages and checkout.
const DefaultShippingItemWeightKg = 0.5

// DefaultMerchantTargetCountries are the primary destination markets published
// in Product JSON-LD OfferShippingDetails and the Google Merchant Center feed.
var DefaultMerchantTargetCountries = []string{"US", "CA", "GB", "DE", "FR", "AU", "JP"}

const (
	merchantFeedMaxPrice         = 100000.0
	merchantFeedMinImagePixels   = 250
	merchantFeedMaxImageBytes    = 16 * 1024 * 1024
	merchantFeedMaxSharedImgUses = 20
	merchantFeedCacheTTL         = 30 * time.Minute
	merchantFeedCachePrefix      = "cache:public:merchant_feed:"
	merchantKnownGenericImg      = "b0cadea5e8826d5b60e4c14c9ca655ad8253598dd34cc9c754f47009577fcdda"
)

var (
	merchantHTMLTagRe     = regexp.MustCompile(`<[^>]*>`)
	merchantMultiSpaceRe  = regexp.MustCompile(`\s+`)
	merchantModelNoteRe   = regexp.MustCompile(`(?i)\(\s*(?:model|series|ref)[^)]*\)`)
	merchantTrailingSepRe = regexp.MustCompile(`[\s|,:;\-–—]+$`)
	merchantLeadWeekRe    = regexp.MustCompile(`(?i)(\d+)\s*(?:-\s*(\d+))?\s*(?:weeks?|wks?)\b`)
	merchantLeadDayRe     = regexp.MustCompile(`(?i)(\d+)\s*(?:-\s*(\d+))?\s*(?:days?|d)\b`)
)

type MerchantFeedController struct{}

type MerchantShippingQuoteItem struct {
	CountryCode     string  `json:"country_code"`
	Currency        string  `json:"currency"`
	ShippingFee     float64 `json:"shipping_fee"`
	IsFree          bool    `json:"is_free"`
	HandlingDaysMin int     `json:"handling_days_min"`
	HandlingDaysMax int     `json:"handling_days_max"`
	TransitDaysMin  int     `json:"transit_days_min"`
	TransitDaysMax  int     `json:"transit_days_max"`
	Service         string  `json:"service"`
}

type merchantPolicyTiming struct {
	HandlingMin int
	HandlingMax int
	TransitMin  int
	TransitMax  int
	ReturnDays  int
}

func resolveMerchantPolicyTiming() merchantPolicyTiming {
	p := services.CurrentCommercePolicy()
	hMin := p.ShippingHandlingDaysMin
	hMax := p.ShippingHandlingDaysMax
	if hMin <= 0 {
		hMin = 1
	}
	if hMax < hMin {
		hMax = hMin + 1
	}
	tMin := p.ShippingTransitDaysMin
	tMax := p.ShippingTransitDaysMax
	if tMin <= 0 {
		tMin = 4
	}
	if tMax < tMin {
		tMax = tMin + 1
	}
	rDays := p.ReturnWindowDays
	if rDays <= 0 {
		rDays = 30
	}
	return merchantPolicyTiming{
		HandlingMin: hMin,
		HandlingMax: hMax,
		TransitMin:  tMin,
		TransitMax:  tMax,
		ReturnDays:  rDays,
	}
}

func resolveDefaultMerchantBaseURL() string {
	if v := strings.TrimSpace(os.Getenv("SITE_URL")); v != "" {
		return strings.TrimRight(v, "/")
	}
	return "https://vibocnc.com"
}

func sanitizeMerchantBaseURL(raw string) string {
	v := strings.TrimSpace(raw)
	if v == "" {
		return resolveDefaultMerchantBaseURL()
	}
	if !strings.HasPrefix(v, "https://") && !strings.HasPrefix(v, "http://") {
		return resolveDefaultMerchantBaseURL()
	}
	return strings.TrimRight(v, "/")
}

func calculateCountryShippingForWeight(db *gorm.DB, countryCode string, weightKg float64) (float64, string, bool, error) {
	cc := services.NormalizeCountryCode(countryCode)
	if cc == "" {
		return 0, "USD", false, errors.New("empty country code")
	}
	if weightKg <= 0 {
		weightKg = DefaultShippingItemWeightKg
	}
	if services.IsFreeShippingCountry(db, cc) {
		return 0, "USD", true, nil
	}
	q, err := services.CalculateShippingQuote(db, cc, weightKg)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		type pair struct {
			Carrier     string
			ServiceCode string
		}
		var pairs []pair
		qe := db.Model(&models.ShippingCarrierTemplate{}).
			Select("carrier, service_code").
			Where("country_code = ? AND is_active = ?", cc, true).
			Group("carrier, service_code").
			Order("CASE WHEN carrier = 'FEDEX' THEN 0 WHEN carrier = 'DHL' THEN 1 ELSE 9 END, carrier ASC, service_code ASC").
			Scan(&pairs).Error
		if qe == nil && len(pairs) > 0 {
			q, err = services.CalculateCarrierShippingQuote(db, pairs[0].Carrier, pairs[0].ServiceCode, cc, weightKg)
		}
	}
	if err != nil {
		return 0, "USD", false, err
	}
	cur := strings.TrimSpace(q.Currency)
	if cur == "" {
		cur = "USD"
	}
	return math.Round(q.ShippingFee*100) / 100, cur, false, nil
}

// Public: GET /api/v1/public/shipping/merchant-quotes?weight_kg=10&countries=US,CA,GB,DE,FR,AU,JP
// Returns accurate per-country shipping rates matching checkout for Product JSON-LD.
func (mc *MerchantFeedController) GetMerchantShippingQuotes(c *gin.Context) {
	db := config.GetDB()
	if db == nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Database unavailable"})
		return
	}

	weight := DefaultShippingItemWeightKg
	if wStr := strings.TrimSpace(c.Query("weight_kg")); wStr != "" {
		if v, err := strconv.ParseFloat(strings.ReplaceAll(wStr, ",", ""), 64); err == nil && v > 0 {
			weight = math.Round(v*100) / 100
		}
	}

	countries := DefaultMerchantTargetCountries
	if rawCountries := strings.TrimSpace(c.Query("countries")); rawCountries != "" {
		parts := strings.Split(rawCountries, ",")
		parsed := make([]string, 0, len(parts))
		seen := map[string]bool{}
		for _, p := range parts {
			cc := services.NormalizeCountryCode(p)
			if len(cc) == 2 && !seen[cc] {
				seen[cc] = true
				parsed = append(parsed, cc)
			}
		}
		if len(parsed) > 0 {
			countries = parsed
		}
	}

	var allowed []models.ShippingAllowedCountry
	_ = db.Find(&allowed).Error
	whitelist := map[string]bool{}
	for _, a := range allowed {
		whitelist[strings.ToUpper(strings.TrimSpace(a.CountryCode))] = true
	}

	timing := resolveMerchantPolicyTiming()
	quotes := make([]MerchantShippingQuoteItem, 0, len(countries))
	for _, cc := range countries {
		if len(whitelist) > 0 && !whitelist[cc] {
			continue
		}
		fee, cur, isFree, err := calculateCountryShippingForWeight(db, cc, weight)
		if err != nil {
			continue
		}
		quotes = append(quotes, MerchantShippingQuoteItem{
			CountryCode:     cc,
			Currency:        cur,
			ShippingFee:     fee,
			IsFree:          isFree,
			HandlingDaysMin: timing.HandlingMin,
			HandlingDaysMax: timing.HandlingMax,
			TransitDaysMin:  timing.TransitMin,
			TransitDaysMax:  timing.TransitMax,
			Service:         "Express International (DHL/FedEx/UPS)",
		})
	}

	c.JSON(http.StatusOK, models.APIResponse{
		Success: true,
		Message: "OK",
		Data: gin.H{
			"weight_kg":   weight,
			"return_days": timing.ReturnDays,
			"quotes":      quotes,
		},
	})
}

func merchantStripText(raw string) string {
	s := merchantHTMLTagRe.ReplaceAllString(raw, " ")
	s = merchantModelNoteRe.ReplaceAllString(s, "")
	s = merchantMultiSpaceRe.ReplaceAllString(s, " ")
	return strings.TrimSpace(s)
}

func merchantTrimLen(s string, maxLen int) string {
	runes := []rune(strings.TrimSpace(s))
	if len(runes) <= maxLen {
		return strings.TrimSpace(s)
	}
	cut := string(runes[:maxLen])
	if idx := strings.LastIndex(cut, " "); idx > maxLen/2 {
		cut = cut[:idx]
	}
	return strings.TrimSpace(merchantTrailingSepRe.ReplaceAllString(cut, ""))
}

func isSuspiciousMerchantImage(rawURL string) bool {
	u := strings.ToLower(strings.TrimSpace(rawURL))
	if u == "" {
		return true
	}
	if strings.Contains(u, "default-image") ||
		strings.Contains(u, "placeholder") ||
		strings.Contains(u, merchantKnownGenericImg) ||
		strings.HasSuffix(u, ".svg") {
		return true
	}
	return false
}

func resolveLocalUploadFile(rawURL string) string {
	u := strings.TrimSpace(rawURL)
	if idx := strings.IndexAny(u, "?#"); idx >= 0 {
		u = u[:idx]
	}
	if !strings.HasPrefix(u, "/uploads/") {
		return ""
	}
	rel := strings.TrimPrefix(u, "/")
	if _, err := os.Stat(rel); err == nil {
		return rel
	}
	abs := filepath.Join("/app", rel)
	if _, err := os.Stat(abs); err == nil {
		return abs
	}
	return ""
}

func isValidMerchantImageOnDisk(rawURL string, cache map[string]bool) bool {
	if ok, seen := cache[rawURL]; seen {
		return ok
	}
	if isSuspiciousMerchantImage(rawURL) {
		cache[rawURL] = false
		return false
	}
	if strings.HasPrefix(rawURL, "http://") || strings.HasPrefix(rawURL, "https://") {
		cache[rawURL] = true
		return true
	}
	fp := resolveLocalUploadFile(rawURL)
	if fp == "" {
		cache[rawURL] = false
		return false
	}
	st, err := os.Stat(fp)
	if err != nil || st.IsDir() || st.Size() <= 0 || st.Size() > merchantFeedMaxImageBytes {
		cache[rawURL] = false
		return false
	}
	f, err := os.Open(fp)
	if err != nil {
		cache[rawURL] = false
		return false
	}
	cfg, _, err := image.DecodeConfig(f)
	_ = f.Close()
	ok := err == nil && cfg.Width >= merchantFeedMinImagePixels && cfg.Height >= merchantFeedMinImagePixels
	cache[rawURL] = ok
	return ok
}

func merchantAbsoluteURL(baseURL, rawURL string) string {
	u := strings.TrimSpace(rawURL)
	if strings.HasPrefix(u, "https://") || strings.HasPrefix(u, "http://") {
		return u
	}
	if !strings.HasPrefix(u, "/") {
		u = "/" + u
	}
	return strings.TrimRight(baseURL, "/") + u
}

func merchantEscapeXML(s string) string {
	var buf bytes.Buffer
	_ = xml.EscapeText(&buf, []byte(s))
	return buf.String()
}


const (
	merchantSitePartition = "vibocnc"
	merchantFeedVersion   = "v2-b1-avail"
)

// classifyMerchantFeedSite deterministically assigns every eligible product to
// exactly one storefront ("vcocnc" or "vibocnc") so the two Google Merchant
// Center feeds maintain strictly 0 SKU overlap now and as new photographed
// products are added across brands (Strategy B1).
func classifyMerchantFeedSite(brand, catSlug, productType, name, sku string) string {
	b := strings.ToLower(strings.TrimSpace(brand))
	slug := strings.ToLower(strings.TrimSpace(catSlug))
	pt := strings.ToLower(strings.TrimSpace(productType))
	nm := strings.ToLower(strings.TrimSpace(name))
	upSKU := strings.ToUpper(strings.TrimSpace(sku))

	// 1. FANUC: strict subsystem split between Drive/Motor/Power (vcocnc)
	// and PCB/Control Board/I/O/HMI/System (vibocnc).
	if b == "fanuc" || strings.HasPrefix(slug, "fanuc") || strings.HasPrefix(pt, "fanuc") {
		catContext := slug + " " + pt
		for _, kw := range []string{
			"pcb", "control-board", "control board", "i-o-module", "i/o",
			"display", "monitor", "operator-panel", "operator panel", "mdi",
			"plc-module", "plc module", "memory", "backplane", "keyboard",
			"keypad", "communication", "usb-interface", "software", "manual",
		} {
			if strings.Contains(catContext, kw) {
				return "vibocnc"
			}
		}
		for _, kw := range []string{
			"servo-amplifier", "servo amplifier",
			"spindle-amplifier", "spindle amplifier",
			"servo-motor", "servo motor",
			"spindle-motor", "spindle motor",
			"power-supply", "power supply",
			"encoder", "reactor", "transformer", "brake", "fan-unit", "cooling",
		} {
			if strings.Contains(catContext, kw) {
				return "vcocnc"
			}
		}
		if strings.HasPrefix(upSKU, "A06B-") || strings.HasPrefix(upSKU, "A14B-") || strings.HasPrefix(upSKU, "A76L-") {
			return "vcocnc"
		}
		if strings.Contains(nm, "servo amplifier") || strings.Contains(nm, "spindle amplifier") ||
			strings.Contains(nm, "servo motor") || strings.Contains(nm, "spindle motor") ||
			strings.Contains(nm, "power supply") {
			return "vcocnc"
		}
		return "vibocnc"
	}

	// 2. Non-FANUC brand-level partition (immune to cross-DB category_id diffs).
	brandKey := b
	if brandKey == "" || brandKey == "industrial automation" {
		if idx := strings.Index(pt, ">"); idx > 0 {
			brandKey = strings.ToLower(strings.TrimSpace(pt[:idx]))
		} else {
			brandKey = pt
		}
	}

	switch brandKey {
	case "ab", "ge", "apc", "ifm", "tdk":
		return "vibocnc"
	case "weg", "invt", "teco":
		return "vcocnc"
	}
	if strings.HasPrefix(brandKey, "apc ") || strings.HasPrefix(brandKey, "ifm ") || strings.HasPrefix(brandKey, "tdk ") {
		return "vibocnc"
	}
	if strings.HasPrefix(brandKey, "weg ") || strings.HasPrefix(brandKey, "invt ") || strings.HasPrefix(brandKey, "teco ") {
		return "vcocnc"
	}

	// Automation / PLC / Sensor / Control brands -> vibocnc
	for _, vb := range []string{
		"siemens", "abb", "schneider", "sick",
		"allen-bradley", "rockwell", "omron", "keyence", "festo",
		"honeywell", "general electric", "balluff", "phoenix contact",
		"turck", "pepperl", "eaton", "cutler-hammer", "beckhoff", "b&r",
		"pilz", "emerson", "foxboro", "yokogawa", "endress", "leuze",
		"pro-face", "weintek", "weidm", "wika", "idec", "red lion",
		"azbil", "carel", "fluke", "amprobe", "hakko", "hitech",
		"patlite", "qlight", "schaffner", "molex", "amphenol",
		"hirose", "westermo", "m-system",
	} {
		if strings.Contains(brandKey, vb) {
			return "vibocnc"
		}
	}

	// CNC Drive / Motion / Motor brands -> vcocnc
	for _, cb := range []string{
		"mitsubishi", "yaskawa", "okuma", "heidenhain", "kollmorgen",
		"sanyo denki", "tamagawa", "lenze", "control techniques", "bosch rexroth",
		"rexroth", "oriental motor", "fuji electric", "delta", "danfoss",
		"vacon", "toshiba", "hitachi", "ls mecapion",
		"berger lahr", "sanken", "apex dynamics", "moons",
		"ebm-papst", "fandis", "parker hannifin", "vickers", "tolomatic",
		"nemicon", "raytools",
	} {
		if strings.Contains(brandKey, cb) {
			return "vcocnc"
		}
	}

	if strings.Contains(brandKey, "motor") || strings.Contains(brandKey, "drive") || strings.Contains(brandKey, "servo") {
		return "vcocnc"
	}
	return "vibocnc"
}

func merchantLeafCategory(productType, brand string) string {
	leaf := strings.TrimSpace(productType)
	if idx := strings.LastIndex(leaf, ">"); idx >= 0 {
		leaf = strings.TrimSpace(leaf[idx+1:])
	}
	b := strings.TrimSpace(brand)
	if b != "" && len(leaf) > len(b)+1 && strings.EqualFold(leaf[:len(b)], b) && leaf[len(b)] == ' ' {
		leaf = strings.TrimSpace(leaf[len(b)+1:])
	}
	if leaf == "" {
		return "Industrial Spare Part"
	}
	return leaf
}

func merchantConditionLabel(cond string) string {
	switch strings.ToLower(strings.TrimSpace(cond)) {
	case "refurbished":
		return "Refurbished"
	case "used":
		return "Used"
	default:
		return "New"
	}
}

func stripBrandAndSKUFromName(rawName, brand, sku string) string {
	s := merchantStripText(rawName)
	if brand != "" {
		reB := regexp.MustCompile(`(?i)\b` + regexp.QuoteMeta(brand) + `\b`)
		s = reB.ReplaceAllString(s, " ")
	}
	if sku != "" {
		reS := regexp.MustCompile(`(?i)` + regexp.QuoteMeta(sku))
		s = reS.ReplaceAllString(s, " ")
	}
	s = merchantMultiSpaceRe.ReplaceAllString(s, " ")
	s = strings.Trim(s, " -–—|:/,.")
	return strings.TrimSpace(s)
}

var vibocncFeedNoiseSentenceRe = regexp.MustCompile(`(?i)\b(?:fast shipping|request a quote|contact us|get the|buy now|warranty[^.]*\.?|3-4 days[^.]*\.?)\b[^.]*\.?`)

func buildVibocncFeedRole(leafCat, rawName, brand, sku string) (string, bool) {
	extra := stripBrandAndSKUFromName(rawName, brand, sku)
	lowExtra := strings.ToLower(extra)
	lc := strings.ToLower(strings.TrimSpace(leafCat))

	isGenericExtra := extra == "" ||
		lowExtra == "pcb board" ||
		lowExtra == "pcb / control board" ||
		lowExtra == "pcb control board" ||
		lowExtra == "pcb control board for cnc systems" ||
		lowExtra == "i/o module" ||
		lowExtra == "display / monitor" ||
		lowExtra == "operator panel / mdi" ||
		lowExtra == "operator panel & mdi" ||
		strings.EqualFold(extra, leafCat)

	if !isGenericExtra && len(extra) >= 10 {
		return extra, true
	}

	switch {
	case strings.Contains(lc, "pcb") || strings.Contains(lc, "control board"):
		return "PCB Control Board", false
	case strings.Contains(lc, "i/o"):
		return "I/O Interface Module", false
	case strings.Contains(lc, "display") || strings.Contains(lc, "monitor"):
		return "CNC Display Monitor", false
	case strings.Contains(lc, "operator panel") || strings.Contains(lc, "mdi"):
		return "Operator Panel & MDI Unit", false
	case strings.Contains(lc, "plc"):
		return "PLC Control Module", false
	default:
		return leafCat, false
	}
}

func cleanVibocncTechnicalSnippet(rawMeta, sku string) string {
	s := merchantStripText(rawMeta)
	if s == "" || !strings.Contains(strings.ToLower(s), strings.ToLower(sku)) {
		return ""
	}
	if strings.Contains(strings.ToLower(s), "verify ") || strings.Contains(strings.ToLower(s), "confirm the original") {
		return ""
	}
	s = vibocncFeedNoiseSentenceRe.ReplaceAllString(s, " ")
	s = merchantMultiSpaceRe.ReplaceAllString(s, " ")
	s = strings.TrimSpace(strings.Trim(s, " .,-;:"))
	if len(s) < 35 || len(s) > 220 {
		return ""
	}
	low := strings.ToLower(s)
	if strings.Contains(low, "cnc machine systems to ensure dependable") {
		return ""
	}
	return s + "."
}

func buildVibocncMerchantCopy(brand, sku, mpn, rawName, rawMeta, leafCat, condition, warranty string, weightKg float64, timing merchantPolicyTiming) (string, string) {
	role, hasCustomRole := buildVibocncFeedRole(leafCat, rawName, brand, sku)
	condLabel := merchantConditionLabel(condition)

	var title string
	if hasCustomRole {
		if strings.Contains(strings.ToLower(role), " for ") {
			title = fmt.Sprintf("%s %s %s", sku, brand, role)
		} else {
			title = fmt.Sprintf("%s %s %s - Automation MRO Component", sku, brand, role)
		}
	} else {
		lc := strings.ToLower(role)
		switch {
		case strings.Contains(lc, "pcb control board"):
			title = fmt.Sprintf("%s %s PCB Control Board for CNC Control Systems", sku, brand)
		case strings.Contains(lc, "i/o"):
			title = fmt.Sprintf("%s %s I/O Interface Module for Automation Control MRO", sku, brand)
		case strings.Contains(lc, "display"):
			title = fmt.Sprintf("%s %s CNC Display Monitor for Industrial Control MRO", sku, brand)
		case strings.Contains(lc, "operator panel"):
			title = fmt.Sprintf("%s %s Operator Panel & MDI Unit for CNC Systems", sku, brand)
		default:
			title = fmt.Sprintf("%s %s %s for Industrial Automation MRO", sku, brand, role)
		}
	}
	if condLabel != "New" {
		title += " (" + condLabel + ")"
	}
	title = merchantTrimLen(title, 150)

	if warranty == "" {
		warranty = "12 months"
	}
	snippet := cleanVibocncTechnicalSnippet(rawMeta, sku)
	extraPart := ""
	if snippet != "" {
		extraPart = " " + snippet
	}
	desc := fmt.Sprintf(
		"OEM-grade %s %s (MPN: %s) engineered for industrial control cabinets, PLC/CNC controller maintenance, and factory automation MRO programs.%s "+
			"Technical Summary: Manufacturer %s | Part Number %s | Classification %s | Condition %s | Packaged Weight %.2f kg. "+
			"Fulfilled by Vibocnc (industrial automation MRO supplier since 2007) with pre-shipment verification, ESD-safe export packing, "+
			"%d-%d business day handling, %d-%d business day express courier transit, %d-day RMA returns, and %s functional warranty.",
		brand, role, mpn, extraPart,
		brand, mpn, leafCat, condLabel, weightKg,
		timing.HandlingMin, timing.HandlingMax, timing.TransitMin, timing.TransitMax,
		timing.ReturnDays, warranty,
	)
	return title, merchantTrimLen(desc, 4800)
}

// parseMerchantLeadTimeDays extracts an upper-bound lead time in days from
// free-form strings like "3-7 days", "4-5 DAYS", or "1 WEEK" for computing
// Google Merchant Center <g:availability_date> on backorder items.
func parseMerchantLeadTimeDays(raw string, fallback int) int {
	text := strings.ToLower(strings.TrimSpace(raw))
	if text == "" {
		return fallback
	}
	if m := merchantLeadWeekRe.FindStringSubmatch(text); len(m) >= 2 {
		valStr := m[2]
		if valStr == "" {
			valStr = m[1]
		}
		if weeks, err := strconv.Atoi(valStr); err == nil && weeks > 0 {
			days := weeks * 7
			if days > 90 {
				days = 90
			}
			return days
		}
	}
	if m := merchantLeadDayRe.FindStringSubmatch(text); len(m) >= 2 {
		valStr := m[2]
		if valStr == "" {
			valStr = m[1]
		}
		if days, err := strconv.Atoi(valStr); err == nil && days > 0 {
			if days > 90 {
				days = 90
			}
			return days
		}
	}
	return fallback
}

type merchantFeedProductRow struct {
	ID               uint     `gorm:"column:id"`
	SKU              string   `gorm:"column:sku"`
	Name             string   `gorm:"column:name"`
	ShortDescription string   `gorm:"column:short_description"`
	Description      string   `gorm:"column:description"`
	MetaDescription  string   `gorm:"column:meta_description"`
	Price            float64  `gorm:"column:price"`
	StockQuantity    int      `gorm:"column:stock_quantity"`
	LeadTime         string   `gorm:"column:lead_time"`
	Weight           *float64 `gorm:"column:weight"`
	Brand            string   `gorm:"column:brand"`
	PartNumber       string   `gorm:"column:part_number"`
	ConditionType    string   `gorm:"column:condition_type"`
	WarrantyPeriod   string   `gorm:"column:warranty_period"`
	CategoryID       uint     `gorm:"column:category_id"`
	ImageURLs        string   `gorm:"column:image_urls"`
}

// Public: GET /api/v1/public/merchant/feed.xml
// Generates a strict Google Merchant Center RSS 2.0 XML product feed containing
// only purchasable, priced, real-photo products (>=250px, no placeholders) with
// checkout-accurate shipping rates.
func (mc *MerchantFeedController) GetMerchantFeedXML(c *gin.Context) {
	db := config.GetDB()
	if db == nil {
		c.String(http.StatusInternalServerError, "Database unavailable")
		return
	}

	baseURL := sanitizeMerchantBaseURL(c.Query("base_url"))
	targetCountries := DefaultMerchantTargetCountries
	if rawCC := strings.TrimSpace(c.Query("country")); rawCC != "" {
		parts := strings.Split(rawCC, ",")
		parsed := make([]string, 0, len(parts))
		seen := map[string]bool{}
		for _, p := range parts {
			cc := services.NormalizeCountryCode(p)
			if len(cc) == 2 && !seen[cc] {
				seen[cc] = true
				parsed = append(parsed, cc)
			}
		}
		if len(parsed) > 0 {
			targetCountries = parsed
		}
	}

	limit := 50000
	if rawLim := strings.TrimSpace(c.Query("limit")); rawLim != "" {
		if n, err := strconv.Atoi(rawLim); err == nil && n > 0 && n <= 50000 {
			limit = n
		}
	}

	cacheSig := fmt.Sprintf("%s|%s|%s|%s|%d", merchantSitePartition, merchantFeedVersion, baseURL, strings.Join(targetCountries, ","), limit)
	h := sha256.Sum256([]byte(cacheSig))
	redisKey := merchantFeedCachePrefix + hex.EncodeToString(h[:])
	if rdb := config.GetRedis(); rdb != nil {
		ctx, cancel := context.WithTimeout(c.Request.Context(), 300*time.Millisecond)
		raw, err := rdb.Get(ctx, redisKey).Bytes()
		cancel()
		if err == nil && len(raw) > 0 {
			c.Header("X-Cache", "HIT")
			c.Header("X-Merchant-Site-Partition", merchantSitePartition)
			c.Header("Cache-Control", "public, max-age=1800, s-maxage=1800")
			c.Data(http.StatusOK, "application/xml; charset=utf-8", raw)
			return
		}
	}

	var rows []merchantFeedProductRow
	if err := db.Table("products").
		Select("id, sku, name, short_description, description, meta_description, price, stock_quantity, lead_time, weight, brand, part_number, condition_type, warranty_period, category_id, image_urls").
		Where("is_active = 1 AND seo_noindex = 0 AND price > 0 AND price <= ?", merchantFeedMaxPrice).
		Where("image_urls IS NOT NULL AND image_urls != '' AND image_urls != '[]'").
		Where("image_urls NOT LIKE ? AND image_urls NOT LIKE ?", "%"+merchantKnownGenericImg+"%", "%default-image%").
		Order("id ASC").
		Limit(limit).
		Scan(&rows).Error; err != nil {
		c.String(http.StatusInternalServerError, "Failed to query merchant feed products")
		return
	}

	parsedImgs := make([][]string, len(rows))
	imgFreq := make(map[string]int, len(rows))
	for i, r := range rows {
		var urls []string
		if err := json.Unmarshal([]byte(r.ImageURLs), &urls); err == nil {
			clean := make([]string, 0, len(urls))
			seen := map[string]bool{}
			for _, u := range urls {
				u = strings.TrimSpace(u)
				if u == "" || seen[u] || isSuspiciousMerchantImage(u) {
					continue
				}
				seen[u] = true
				clean = append(clean, u)
				imgFreq[u]++
			}
			parsedImgs[i] = clean
		}
	}

	type catRow struct {
		ID       uint   `gorm:"column:id"`
		Slug     string `gorm:"column:slug"`
		Name     string `gorm:"column:name"`
		ParentID *uint  `gorm:"column:parent_id"`
	}
	var catRows []catRow
	_ = db.Table("categories").Select("id, slug, name, parent_id").Scan(&catRows).Error
	catMap := make(map[uint]catRow, len(catRows))
	for _, cr := range catRows {
		catMap[cr.ID] = cr
	}
	buildCategoryTrail := func(catID uint) string {
		parts := make([]string, 0, 4)
		seen := map[uint]bool{}
		cur := catID
		for cur != 0 && !seen[cur] && len(parts) < 5 {
			seen[cur] = true
			cr, ok := catMap[cur]
			if !ok {
				break
			}
			name := strings.TrimSpace(cr.Name)
			if name != "" {
				parts = append(parts, name)
			}
			if cr.ParentID == nil {
				break
			}
			cur = *cr.ParentID
		}
		for i, j := 0, len(parts)-1; i < j; i, j = i+1, j-1 {
			parts[i], parts[j] = parts[j], parts[i]
		}
		if len(parts) == 0 {
			return "Industrial Automation Parts"
		}
		return strings.Join(parts, " > ")
	}

	var allowed []models.ShippingAllowedCountry
	_ = db.Find(&allowed).Error
	whitelist := map[string]bool{}
	for _, a := range allowed {
		whitelist[strings.ToUpper(strings.TrimSpace(a.CountryCode))] = true
	}
	activeCountries := make([]string, 0, len(targetCountries))
	for _, cc := range targetCountries {
		if len(whitelist) > 0 && !whitelist[cc] {
			continue
		}
		activeCountries = append(activeCountries, cc)
	}

	type shipKey struct {
		cc string
		w  int
	}
	type shipVal struct {
		ok  bool
		fee float64
		cur string
	}
	shipCache := make(map[shipKey]shipVal, 128)
	getShip := func(cc string, weightKg float64) (float64, string, bool) {
		k := shipKey{cc: cc, w: int(math.Round(weightKg * 100))}
		if v, exists := shipCache[k]; exists {
			return v.fee, v.cur, v.ok
		}
		fee, cur, _, err := calculateCountryShippingForWeight(db, cc, weightKg)
		if err != nil {
			shipCache[k] = shipVal{ok: false}
			return 0, "USD", false
		}
		shipCache[k] = shipVal{ok: true, fee: fee, cur: cur}
		return fee, cur, true
	}

	timing := resolveMerchantPolicyTiming()
	imgValidCache := make(map[string]bool, len(rows)*2)

	var out bytes.Buffer
	out.Grow(len(rows) * 1200)
	out.WriteString(`<?xml version="1.0" encoding="UTF-8"?>` + "\n")
	out.WriteString(`<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">` + "\n")
	out.WriteString("  <channel>\n")
	out.WriteString("    <title>" + merchantEscapeXML("Vibocnc Industrial Control Boards & Automation Module MRO") + "</title>\n")
	out.WriteString("    <link>" + merchantEscapeXML(baseURL) + "</link>\n")
	out.WriteString("    <description>" + merchantEscapeXML("Industrial PCB control boards, I/O modules, operator panels, HMIs and automation MRO spare components supplied by Vibocnc with 12-month warranty and tracked international delivery.") + "</description>\n")

	nowUTC := time.Now().UTC()
	itemCount := 0
	skippedOtherPartition := 0
	for i, r := range rows {
		sku := strings.TrimSpace(r.SKU)
		if sku == "" {
			continue
		}

		brand := strings.TrimSpace(r.Brand)
		if brand == "" {
			brand = "Industrial Automation"
		}
		catSlug := ""
		if cr, ok := catMap[r.CategoryID]; ok {
			catSlug = strings.TrimSpace(cr.Slug)
		}
		rawTrail := buildCategoryTrail(r.CategoryID)
		if classifyMerchantFeedSite(brand, catSlug, rawTrail, r.Name, sku) != merchantSitePartition {
			skippedOtherPartition++
			continue
		}

		validImgs := make([]string, 0, len(parsedImgs[i]))
		for _, u := range parsedImgs[i] {
			if imgFreq[u] > merchantFeedMaxSharedImgUses {
				continue
			}
			if isValidMerchantImageOnDisk(u, imgValidCache) {
				validImgs = append(validImgs, merchantAbsoluteURL(baseURL, u))
			}
		}
		if len(validImgs) == 0 {
			continue
		}

		mpn := strings.TrimSpace(r.PartNumber)
		if mpn == "" {
			mpn = sku
		}

		availability := "backorder"
		if r.StockQuantity > 0 {
			availability = "in_stock"
		}

		condition := strings.ToLower(strings.TrimSpace(r.ConditionType))
		if condition != "new" && condition != "refurbished" && condition != "used" {
			condition = "new"
		}

		weightKg := DefaultShippingItemWeightKg
		if r.Weight != nil && *r.Weight > 0 {
			weightKg = math.Round(*r.Weight*100) / 100
		}

		link := baseURL + services.BuildProductPublicPath(sku)
		leafCat := merchantLeafCategory(rawTrail, brand)
		title, desc := buildVibocncMerchantCopy(brand, sku, mpn, r.Name, r.MetaDescription, leafCat, condition, strings.TrimSpace(r.WarrantyPeriod), weightKg, timing)
		productType := fmt.Sprintf("Automation Control & MRO > %s > %s", brand, leafCat)

		out.WriteString("    <item>\n")
		out.WriteString("      <g:id>" + merchantEscapeXML(sku) + "</g:id>\n")
		out.WriteString("      <g:title>" + merchantEscapeXML(title) + "</g:title>\n")
		out.WriteString("      <g:description>" + merchantEscapeXML(desc) + "</g:description>\n")
		out.WriteString("      <g:link>" + merchantEscapeXML(link) + "</g:link>\n")
		out.WriteString("      <g:image_link>" + merchantEscapeXML(validImgs[0]) + "</g:image_link>\n")
		for idx := 1; idx < len(validImgs) && idx <= 10; idx++ {
			out.WriteString("      <g:additional_image_link>" + merchantEscapeXML(validImgs[idx]) + "</g:additional_image_link>\n")
		}
		out.WriteString("      <g:availability>" + availability + "</g:availability>\n")
		if availability == "backorder" {
			availDays := parseMerchantLeadTimeDays(r.LeadTime, 7)
			availDate := nowUTC.AddDate(0, 0, availDays).Format("2006-01-02T00:00+0000")
			out.WriteString("      <g:availability_date>" + availDate + "</g:availability_date>\n")
		}
		out.WriteString(fmt.Sprintf("      <g:price>%.2f USD</g:price>\n", r.Price))
		out.WriteString("      <g:brand>" + merchantEscapeXML(brand) + "</g:brand>\n")
		out.WriteString("      <g:mpn>" + merchantEscapeXML(mpn) + "</g:mpn>\n")
		out.WriteString("      <g:identifier_exists>yes</g:identifier_exists>\n")
		out.WriteString("      <g:condition>" + condition + "</g:condition>\n")
		out.WriteString("      <g:google_product_category>Business &amp; Industrial</g:google_product_category>\n")
		out.WriteString("      <g:product_type>" + merchantEscapeXML(productType) + "</g:product_type>\n")
		out.WriteString("      <g:custom_label_0>control-board-mro</g:custom_label_0>\n")
		out.WriteString("      <g:custom_label_1>vibocnc-mro</g:custom_label_1>\n")
		out.WriteString(fmt.Sprintf("      <g:shipping_weight>%.2f kg</g:shipping_weight>\n", weightKg))
		out.WriteString(fmt.Sprintf("      <g:min_handling_time>%d</g:min_handling_time>\n", timing.HandlingMin))
		out.WriteString(fmt.Sprintf("      <g:max_handling_time>%d</g:max_handling_time>\n", timing.HandlingMax))
		for _, cc := range activeCountries {
			fee, cur, ok := getShip(cc, weightKg)
			if !ok {
				continue
			}
			out.WriteString("      <g:shipping>\n")
			out.WriteString("        <g:country>" + cc + "</g:country>\n")
			out.WriteString("        <g:service>Express International</g:service>\n")
			out.WriteString(fmt.Sprintf("        <g:price>%.2f %s</g:price>\n", fee, cur))
			out.WriteString(fmt.Sprintf("        <g:min_handling_time>%d</g:min_handling_time>\n", timing.HandlingMin))
			out.WriteString(fmt.Sprintf("        <g:max_handling_time>%d</g:max_handling_time>\n", timing.HandlingMax))
			out.WriteString(fmt.Sprintf("        <g:min_transit_time>%d</g:min_transit_time>\n", timing.TransitMin))
			out.WriteString(fmt.Sprintf("        <g:max_transit_time>%d</g:max_transit_time>\n", timing.TransitMax))
			out.WriteString("      </g:shipping>\n")
		}
		out.WriteString("    </item>\n")
		itemCount++
	}

	out.WriteString("  </channel>\n")
	out.WriteString("</rss>\n")

	payload := out.Bytes()
	if rdb := config.GetRedis(); rdb != nil && len(payload) > 0 {
		ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
		_ = rdb.Set(ctx, redisKey, payload, merchantFeedCacheTTL).Err()
		cancel()
	}

	c.Header("X-Cache", "MISS")
	c.Header("X-Merchant-Site-Partition", merchantSitePartition)
	c.Header("X-Merchant-Items", strconv.Itoa(itemCount))
	c.Header("X-Merchant-Skipped-Other-Partition", strconv.Itoa(skippedOtherPartition))
	c.Header("Cache-Control", "public, max-age=1800, s-maxage=1800")
	c.Data(http.StatusOK, "application/xml; charset=utf-8", payload)
}
