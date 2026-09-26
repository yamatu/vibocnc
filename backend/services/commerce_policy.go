package services

import (
	"math"
	"regexp"
	"strings"
	"sync"
	"time"

	"fanuc-backend/config"
	"fanuc-backend/models"

	"gorm.io/gorm"
)

// The storefront commercial promise (shipping time, warranty, return window)
// lives in a single admin-editable row. It is read by the public storefront and
// by every generated content skeleton, which is why the accessor lives in
// `services` instead of a controller: content generation must never hard-code
// "12 months" or "3-7 days" again.
var (
	commercePolicyCountryPattern = regexp.MustCompile(`^[A-Z]{2}$`)
	commercePolicyCacheTTL       = 30 * time.Second
	commercePolicyCache          = struct {
		mu    sync.RWMutex
		value models.CommercePolicySetting
		at    time.Time
		valid bool
	}{}
)

// GetCommercePolicy returns the singleton settings row, creating it with seeded
// defaults when missing. A nil database (unit tests, CLI helpers) falls back to
// the defaults instead of failing.
func GetCommercePolicy(db *gorm.DB) (models.CommercePolicySetting, error) {
	if db == nil {
		return models.DefaultCommercePolicy(), nil
	}

	commercePolicyCache.mu.RLock()
	if commercePolicyCache.valid && time.Since(commercePolicyCache.at) < commercePolicyCacheTTL {
		cached := commercePolicyCache.value
		commercePolicyCache.mu.RUnlock()
		return cached, nil
	}
	commercePolicyCache.mu.RUnlock()

	var setting models.CommercePolicySetting
	err := db.First(&setting, 1).Error
	if err != nil {
		if err != gorm.ErrRecordNotFound {
			return models.DefaultCommercePolicy(), err
		}
		setting = models.DefaultCommercePolicy()
		if createErr := db.Create(&setting).Error; createErr != nil {
			// A concurrent request may have created the row; re-read once.
			if readErr := db.First(&setting, 1).Error; readErr != nil {
				return models.DefaultCommercePolicy(), createErr
			}
		}
	}

	setting = NormalizeCommercePolicy(setting)
	commercePolicyCache.mu.Lock()
	commercePolicyCache.value = setting
	commercePolicyCache.at = time.Now()
	commercePolicyCache.valid = true
	commercePolicyCache.mu.Unlock()
	return setting, nil
}

// CurrentCommercePolicy is the convenience accessor used by generators that do
// not take a database handle. It never returns an error: on failure the seeded
// defaults are used so content generation keeps working.
func CurrentCommercePolicy() models.CommercePolicySetting {
	setting, err := GetCommercePolicy(config.GetDB())
	if err != nil {
		return models.DefaultCommercePolicy()
	}
	return setting
}

// InvalidateCommercePolicyCache forces the next read to hit the database. Called
// after every successful write so admin edits appear immediately.
func InvalidateCommercePolicyCache() {
	commercePolicyCache.mu.Lock()
	commercePolicyCache.valid = false
	commercePolicyCache.mu.Unlock()
}

// NormalizeCommercePolicy clamps and fills every field so the storefront and the
// schema.org payload can never receive an empty or out-of-range promise.
func NormalizeCommercePolicy(setting models.CommercePolicySetting) models.CommercePolicySetting {
	defaults := models.DefaultCommercePolicy()

	setting.ShippingHandlingTimeText = limitRuneCount(strings.TrimSpace(setting.ShippingHandlingTimeText), 80)
	if setting.ShippingHandlingTimeText == "" {
		setting.ShippingHandlingTimeText = defaults.ShippingHandlingTimeText
	}
	setting.ShippingHandlingDaysMin = clampPolicyDays(setting.ShippingHandlingDaysMin, 1, 365, defaults.ShippingHandlingDaysMin)
	setting.ShippingHandlingDaysMax = clampPolicyDays(setting.ShippingHandlingDaysMax, setting.ShippingHandlingDaysMin, 365, defaults.ShippingHandlingDaysMax)
	if setting.ShippingHandlingDaysMax < setting.ShippingHandlingDaysMin {
		setting.ShippingHandlingDaysMax = setting.ShippingHandlingDaysMin
	}

	setting.ShippingTransitTimeText = limitRuneCount(strings.TrimSpace(setting.ShippingTransitTimeText), 80)
	if setting.ShippingTransitTimeText == "" {
		setting.ShippingTransitTimeText = defaults.ShippingTransitTimeText
	}
	setting.ShippingTransitDaysMin = clampPolicyDays(setting.ShippingTransitDaysMin, 1, 365, defaults.ShippingTransitDaysMin)
	setting.ShippingTransitDaysMax = clampPolicyDays(setting.ShippingTransitDaysMax, setting.ShippingTransitDaysMin, 365, defaults.ShippingTransitDaysMax)
	if setting.ShippingTransitDaysMax < setting.ShippingTransitDaysMin {
		setting.ShippingTransitDaysMax = setting.ShippingTransitDaysMin
	}

	setting.ShippingCarriers = limitRuneCount(strings.TrimSpace(setting.ShippingCarriers), 255)
	if setting.ShippingCarriers == "" {
		setting.ShippingCarriers = defaults.ShippingCarriers
	}

	setting.ShippingDestinationCountries = NormalizeCommercePolicyCountries(setting.ShippingDestinationCountries)
	if setting.ShippingDestinationCountries == "" {
		setting.ShippingDestinationCountries = defaults.ShippingDestinationCountries
	}

	if setting.ShippingRateAmount < 0 {
		setting.ShippingRateAmount = 0
	}
	setting.ShippingCurrency = strings.ToUpper(limitRuneCount(strings.TrimSpace(setting.ShippingCurrency), 8))
	if setting.ShippingCurrency == "" {
		setting.ShippingCurrency = defaults.ShippingCurrency
	}
	setting.ShippingNotes = strings.TrimSpace(setting.ShippingNotes)

	setting.DefaultWarrantyPeriod = limitRuneCount(strings.TrimSpace(setting.DefaultWarrantyPeriod), 50)
	if setting.DefaultWarrantyPeriod == "" {
		setting.DefaultWarrantyPeriod = defaults.DefaultWarrantyPeriod
	}
	setting.DefaultLeadTime = limitRuneCount(strings.TrimSpace(setting.DefaultLeadTime), 50)
	if setting.DefaultLeadTime == "" {
		setting.DefaultLeadTime = defaults.DefaultLeadTime
	}

	// merchantReturnDays is published to schema.org consumers, which cap a
	// finite return window at one year.
	setting.ReturnWindowDays = clampPolicyDays(setting.ReturnWindowDays, 1, 365, defaults.ReturnWindowDays)
	setting.ReturnWindowText = limitRuneCount(strings.TrimSpace(setting.ReturnWindowText), 80)
	if setting.ReturnWindowText == "" {
		setting.ReturnWindowText = defaults.ReturnWindowText
	}

	switch strings.ToLower(strings.TrimSpace(setting.ReturnShippingPayer)) {
	case models.ReturnShippingPayerCustomer:
		setting.ReturnShippingPayer = models.ReturnShippingPayerCustomer
	case models.ReturnShippingPayerMerchant:
		setting.ReturnShippingPayer = models.ReturnShippingPayerMerchant
	default:
		setting.ReturnShippingPayer = models.ReturnShippingPayerShared
	}

	country := strings.ToUpper(strings.TrimSpace(setting.ReturnPolicyCountry))
	if !commercePolicyCountryPattern.MatchString(country) {
		country = defaults.ReturnPolicyCountry
	}
	setting.ReturnPolicyCountry = country
	setting.ReturnPolicyNotes = strings.TrimSpace(setting.ReturnPolicyNotes)

	// Market-price synchronization is opt-in and only produces suggestions until
	// an administrator explicitly applies selected rows. Clamp every numeric
	// guard here so a malformed admin payload cannot disable its safety limits.
	if math.IsNaN(setting.PriceSyncFactor) || math.IsInf(setting.PriceSyncFactor, 0) || setting.PriceSyncFactor < 0.1 || setting.PriceSyncFactor > 5 {
		setting.PriceSyncFactor = defaults.PriceSyncFactor
	}
	if setting.PriceSyncMinSamples < 1 || setting.PriceSyncMinSamples > 100 {
		setting.PriceSyncMinSamples = defaults.PriceSyncMinSamples
	}
	if math.IsNaN(setting.PriceSyncMaxDeltaPct) || math.IsInf(setting.PriceSyncMaxDeltaPct, 0) || setting.PriceSyncMaxDeltaPct < 1 || setting.PriceSyncMaxDeltaPct > 1000 {
		setting.PriceSyncMaxDeltaPct = defaults.PriceSyncMaxDeltaPct
	}
	if math.IsNaN(setting.PriceSyncRoundTo) || math.IsInf(setting.PriceSyncRoundTo, 0) || setting.PriceSyncRoundTo < 0 || setting.PriceSyncRoundTo > 10000 {
		setting.PriceSyncRoundTo = defaults.PriceSyncRoundTo
	}

	return setting
}

func clampPolicyDays(value int, min int, max int, fallback int) int {
	if value >= min && value <= max {
		return value
	}
	if fallback < min {
		return min
	}
	if fallback > max {
		return max
	}
	return fallback
}

// NormalizeCommercePolicyCountries keeps comma separated ISO-3166 alpha-2 codes
// plus the special value GLOBAL (worldwide coverage).
func NormalizeCommercePolicyCountries(value string) string {
	parts := strings.FieldsFunc(value, func(r rune) bool {
		return r == ',' || r == ';' || r == '\n' || r == '\r' || r == '\t'
	})
	out := make([]string, 0, len(parts))
	seen := map[string]struct{}{}
	for _, part := range parts {
		code := strings.ToUpper(strings.TrimSpace(part))
		if code == "" {
			continue
		}
		if code != "GLOBAL" && !commercePolicyCountryPattern.MatchString(code) {
			continue
		}
		if _, ok := seen[code]; ok {
			continue
		}
		seen[code] = struct{}{}
		out = append(out, code)
	}
	return strings.Join(out, ",")
}

// CommercePolicyCountryList returns the destination codes. GLOBAL (worldwide
// coverage) collapses to an empty list, which every consumer reads as "no country
// restriction".
func CommercePolicyCountryList(setting models.CommercePolicySetting) []string {
	value := strings.ToUpper(strings.TrimSpace(setting.ShippingDestinationCountries))
	if value == "" || value == "GLOBAL" {
		return []string{}
	}
	parts := strings.Split(value, ",")
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		code := strings.TrimSpace(part)
		if code == "" {
			continue
		}
		// A single worldwide entry overrides any country list.
		if code == "GLOBAL" {
			return []string{}
		}
		out = append(out, code)
	}
	return out
}

// CommercePolicyCarrierList returns the advertised carriers.
func CommercePolicyCarrierList(setting models.CommercePolicySetting) []string {
	parts := strings.FieldsFunc(setting.ShippingCarriers, func(r rune) bool {
		return r == ',' || r == ';' || r == '/'
	})
	out := make([]string, 0, len(parts))
	seen := map[string]struct{}{}
	for _, part := range parts {
		name := strings.TrimSpace(part)
		if name == "" {
			continue
		}
		key := strings.ToLower(name)
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		out = append(out, name)
	}
	if len(out) == 0 {
		return []string{"DHL", "FedEx", "UPS"}
	}
	return out
}

// CommercePolicyShipsWorldwide reports whether the policy covers every country.
// Consumers use it to choose between "worldwide" and an explicit country list.
func CommercePolicyShipsWorldwide(setting models.CommercePolicySetting) bool {
	return len(CommercePolicyCountryList(setting)) == 0
}

// CommercePolicyWarrantyText renders the default warranty promise, e.g.
// "12 months". Empty policies fall back to the shipped product default.
func CommercePolicyWarrantyText(setting models.CommercePolicySetting) string {
	if value := strings.TrimSpace(setting.DefaultWarrantyPeriod); value != "" {
		return value
	}
	return models.DefaultCommercePolicy().DefaultWarrantyPeriod
}

// CommercePolicyLeadTimeText renders the default lead time, e.g. "4-5 DAYS".
func CommercePolicyLeadTimeText(setting models.CommercePolicySetting) string {
	if value := strings.TrimSpace(setting.DefaultLeadTime); value != "" {
		return value
	}
	return models.DefaultCommercePolicy().DefaultLeadTime
}

// CommercePolicyReturnShippingText renders the return-freight promise for
// customer-facing copy.
func CommercePolicyReturnShippingText(setting models.CommercePolicySetting) string {
	switch setting.ReturnShippingPayer {
	case models.ReturnShippingPayerCustomer:
		return "return shipping is arranged and paid by the buyer"
	case models.ReturnShippingPayerMerchant:
		return "return shipping is covered by Vibocnc"
	default:
		return "return shipping costs are shared between buyer and Vibocnc"
	}
}

func limitRuneCount(value string, max int) string {
	if max <= 0 {
		return value
	}
	runes := []rune(value)
	if len(runes) <= max {
		return value
	}
	return strings.TrimSpace(string(runes[:max]))
}
