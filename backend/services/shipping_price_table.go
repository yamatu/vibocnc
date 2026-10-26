package services

import (
	"crypto/sha1"
	"encoding/hex"
	"errors"
	"fmt"
	"sort"
	"strings"

	"fanuc-backend/models"

	"gorm.io/gorm"
)

// A country template is either one open-ended per-kg bracket, or a carrier-style
// price table: fixed fees per weight step below 21kg (min_kg == max_kg) plus
// per-kg bands for heavier parcels. These types expose that table to the admin UI.

type ShippingFixedFee struct {
	WeightKg float64 `json:"weight_kg"`
	Fee      float64 `json:"fee"`
}

type ShippingPerKgBand struct {
	MinKg     float64 `json:"min_kg"`
	MaxKg     float64 `json:"max_kg"` // 0 = no upper limit
	RatePerKg float64 `json:"rate_per_kg"`
}

type ShippingSurchargeRule struct {
	QuoteAmount   float64 `json:"quote_amount"`
	AdditionalFee float64 `json:"additional_fee"`
}

type ShippingPriceTable struct {
	Currency   string                  `json:"currency"`
	Fixed      []ShippingFixedFee      `json:"fixed"`
	PerKg      []ShippingPerKgBand     `json:"per_kg"`
	Surcharges []ShippingSurchargeRule `json:"surcharges"`
}

// ShippingPriceSummary is the one-line view of a template used by the admin list.
type ShippingPriceSummary struct {
	FixedCount    int     `json:"fixed_count"`
	FixedMinKg    float64 `json:"fixed_min_kg"`
	FixedMaxKg    float64 `json:"fixed_max_kg"`
	FeeFrom       float64 `json:"fee_from"`
	FeeTo         float64 `json:"fee_to"`
	OverRatePerKg float64 `json:"over_rate_per_kg"`
	PerKgBands    int     `json:"per_kg_bands"`
	// PriceSignature is identical for countries sharing exactly the same table
	// (for an imported carrier rate card: the same zone).
	PriceSignature string `json:"price_signature"`
}

func BuildShippingPriceTable(currency string, brackets []models.ShippingWeightBracket, surcharges []models.ShippingQuoteSurcharge) ShippingPriceTable {
	t := ShippingPriceTable{Currency: strings.TrimSpace(currency), Fixed: []ShippingFixedFee{}, PerKg: []ShippingPerKgBand{}, Surcharges: []ShippingSurchargeRule{}}
	if t.Currency == "" {
		t.Currency = "USD"
	}
	for _, b := range brackets {
		if round3(b.MinKg) == round3(b.MaxKg) && b.MinKg > 0 {
			t.Fixed = append(t.Fixed, ShippingFixedFee{WeightKg: round3(b.MinKg), Fee: round2(b.RatePerKg)})
		} else {
			t.PerKg = append(t.PerKg, ShippingPerKgBand{MinKg: round3(b.MinKg), MaxKg: round3(b.MaxKg), RatePerKg: round3(b.RatePerKg)})
		}
	}
	for _, s := range surcharges {
		t.Surcharges = append(t.Surcharges, ShippingSurchargeRule{QuoteAmount: round2(s.QuoteAmount), AdditionalFee: round2(s.AdditionalFee)})
	}
	sort.Slice(t.Fixed, func(i, j int) bool { return t.Fixed[i].WeightKg < t.Fixed[j].WeightKg })
	sort.Slice(t.PerKg, func(i, j int) bool { return t.PerKg[i].MinKg < t.PerKg[j].MinKg })
	sort.Slice(t.Surcharges, func(i, j int) bool { return t.Surcharges[i].QuoteAmount < t.Surcharges[j].QuoteAmount })
	return t
}

func (t ShippingPriceTable) Summary() ShippingPriceSummary {
	s := ShippingPriceSummary{FixedCount: len(t.Fixed), PerKgBands: len(t.PerKg)}
	if len(t.Fixed) > 0 {
		s.FixedMinKg, s.FeeFrom = t.Fixed[0].WeightKg, t.Fixed[0].Fee
		last := t.Fixed[len(t.Fixed)-1]
		s.FixedMaxKg, s.FeeTo = last.WeightKg, last.Fee
	}
	for _, b := range t.PerKg {
		if b.MaxKg <= 0 || b.MinKg >= 21 {
			s.OverRatePerKg = b.RatePerKg
		}
	}
	var sb strings.Builder
	sb.WriteString(strings.ToUpper(t.Currency))
	for _, f := range t.Fixed {
		fmt.Fprintf(&sb, "|f%.3f:%.2f", f.WeightKg, f.Fee)
	}
	for _, b := range t.PerKg {
		fmt.Fprintf(&sb, "|k%.3f-%.3f:%.3f", b.MinKg, b.MaxKg, b.RatePerKg)
	}
	for _, r := range t.Surcharges {
		fmt.Fprintf(&sb, "|s%.2f:%.2f", r.QuoteAmount, r.AdditionalFee)
	}
	sum := sha1.Sum([]byte(sb.String()))
	s.PriceSignature = hex.EncodeToString(sum[:])[:10]
	return s
}

// Validate normalizes the table and rejects values the quote engine cannot use.
func (t *ShippingPriceTable) Validate() error {
	t.Currency = normalizePerKgCurrency(t.Currency)
	if len(t.Fixed) == 0 && len(t.PerKg) == 0 {
		return errors.New("price table is empty")
	}
	seen := map[float64]bool{}
	for i, f := range t.Fixed {
		w := round3(f.WeightKg)
		if w <= 0 || w >= 21 {
			return fmt.Errorf("fixed fee row %d: weight must be between 0 and 21kg", i+1)
		}
		if f.Fee <= 0 {
			return fmt.Errorf("fixed fee for %.3gkg must be greater than 0", w)
		}
		if seen[w] {
			return fmt.Errorf("duplicate weight %.3gkg", w)
		}
		seen[w] = true
		t.Fixed[i] = ShippingFixedFee{WeightKg: w, Fee: round2(f.Fee)}
	}
	for i, b := range t.PerKg {
		if b.MinKg < 0 || (b.MaxKg > 0 && b.MaxKg < b.MinKg) {
			return fmt.Errorf("per-kg band %d: invalid range", i+1)
		}
		if b.RatePerKg <= 0 {
			return fmt.Errorf("per-kg band %d: rate must be greater than 0", i+1)
		}
		t.PerKg[i] = ShippingPerKgBand{MinKg: round3(b.MinKg), MaxKg: round3(b.MaxKg), RatePerKg: round3(b.RatePerKg)}
	}
	for i, r := range t.Surcharges {
		if r.QuoteAmount < 0 || r.AdditionalFee < 0 {
			return fmt.Errorf("surcharge row %d: values cannot be negative", i+1)
		}
	}
	return nil
}

// LoadCountryPriceTable returns the template and its table, or gorm.ErrRecordNotFound.
func LoadCountryPriceTable(db *gorm.DB, countryCode string) (models.ShippingTemplate, ShippingPriceTable, error) {
	cc := ResolveCountryCode(countryCode)
	var tpl models.ShippingTemplate
	if cc == "" {
		return tpl, ShippingPriceTable{}, gorm.ErrRecordNotFound
	}
	if err := db.Preload("WeightBrackets").Preload("QuoteSurcharges").Where("country_code = ?", cc).First(&tpl).Error; err != nil {
		return tpl, ShippingPriceTable{}, err
	}
	return tpl, BuildShippingPriceTable(tpl.Currency, tpl.WeightBrackets, tpl.QuoteSurcharges), nil
}

// ReplaceCountryPriceTables writes the same table to every listed country,
// creating templates where missing. keepSurcharges leaves each country's own
// surcharge rules untouched (used when the editor did not send any).
func ReplaceCountryPriceTables(db *gorm.DB, countryCodes []string, table ShippingPriceTable, keepSurcharges bool) ([]string, error) {
	if err := table.Validate(); err != nil {
		return nil, err
	}
	codes := make([]string, 0, len(countryCodes))
	seen := map[string]bool{}
	for _, raw := range countryCodes {
		cc := ResolveCountryCode(raw)
		if cc == "" {
			return nil, fmt.Errorf("unknown country code %q", raw)
		}
		if !seen[cc] {
			seen[cc] = true
			codes = append(codes, cc)
		}
	}
	if len(codes) == 0 {
		return nil, errors.New("no country selected")
	}
	err := db.Transaction(func(tx *gorm.DB) error {
		for _, cc := range codes {
			var tpl models.ShippingTemplate
			e := tx.Where("country_code = ?", cc).First(&tpl).Error
			switch {
			case errors.Is(e, gorm.ErrRecordNotFound):
				tpl = models.ShippingTemplate{CountryCode: cc, CountryName: EnglishCountryName(cc, ""), Currency: table.Currency, IsActive: true}
				if err := tx.Create(&tpl).Error; err != nil {
					return err
				}
			case e != nil:
				return e
			default:
				if err := tx.Model(&tpl).Updates(map[string]any{"currency": table.Currency, "is_active": true, "country_name": EnglishCountryName(cc, tpl.CountryName)}).Error; err != nil {
					return err
				}
			}
			if err := tx.Where("template_id = ?", tpl.ID).Delete(&models.ShippingWeightBracket{}).Error; err != nil {
				return err
			}
			rows := make([]models.ShippingWeightBracket, 0, len(table.Fixed)+len(table.PerKg))
			for _, f := range table.Fixed {
				rows = append(rows, models.ShippingWeightBracket{TemplateID: tpl.ID, MinKg: f.WeightKg, MaxKg: f.WeightKg, RatePerKg: f.Fee})
			}
			for _, b := range table.PerKg {
				rows = append(rows, models.ShippingWeightBracket{TemplateID: tpl.ID, MinKg: b.MinKg, MaxKg: b.MaxKg, RatePerKg: b.RatePerKg})
			}
			if err := tx.Create(&rows).Error; err != nil {
				return err
			}
			if keepSurcharges {
				continue
			}
			if err := tx.Where("template_id = ?", tpl.ID).Delete(&models.ShippingQuoteSurcharge{}).Error; err != nil {
				return err
			}
			for _, r := range table.Surcharges {
				if err := tx.Create(&models.ShippingQuoteSurcharge{TemplateID: tpl.ID, QuoteAmount: r.QuoteAmount, AdditionalFee: r.AdditionalFee}).Error; err != nil {
					return err
				}
			}
		}
		return nil
	})
	return codes, err
}
