package services

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"math"
	"sort"
	"strconv"
	"strings"

	"fanuc-backend/models"

	"github.com/xuri/excelize/v2"
	"gorm.io/gorm"
)

type ShippingCountryPublic struct {
	CountryCode string `json:"country_code"`
	CountryName string `json:"country_name"`
	Currency    string `json:"currency"`
}

type ShippingQuoteResult struct {
	CountryCode   string  `json:"country_code"`
	Currency      string  `json:"currency"`
	WeightKg      float64 `json:"weight_kg"`
	BillingWeight float64 `json:"billing_weight_kg"`
	RatePerKg     float64 `json:"rate_per_kg"`
	BaseQuote     float64 `json:"base_quote"`
	AdditionalFee float64 `json:"additional_fee"`
	ShippingFee   float64 `json:"shipping_fee"`
	Source        string  `json:"source,omitempty"`
	Carrier       string  `json:"carrier,omitempty"`
	ServiceCode   string  `json:"service_code,omitempty"`
}

func NormalizeCountryCode(code string) string {
	if resolved := ResolveCountryCode(code); resolved != "" {
		return resolved
	}
	c := strings.ToUpper(strings.TrimSpace(code))
	if !isASCII(c) {
		return ""
	}
	if len(c) > 2 {
		c = c[:2]
	}
	return c
}

func ListActiveShippingCountries(db *gorm.DB) ([]ShippingCountryPublic, error) {
	if db == nil {
		return nil, errors.New("db is nil")
	}

	// Check if whitelist is enabled (has any entries)
	var whitelistCount int64
	db.Model(&models.ShippingAllowedCountry{}).Count(&whitelistCount)

	var tpls []models.ShippingTemplate
	if err := db.Where("is_active = ?", true).Order("country_name ASC").Find(&tpls).Error; err != nil {
		return nil, err
	}

	// Build whitelist set if enabled
	var whitelist map[string]bool
	if whitelistCount > 0 {
		var allowed []models.ShippingAllowedCountry
		db.Order("sort_order ASC").Find(&allowed)
		whitelist = make(map[string]bool, len(allowed))
		for _, a := range allowed {
			whitelist[a.CountryCode] = true
		}
	}

	out := make([]ShippingCountryPublic, 0, len(tpls))
	for _, t := range tpls {
		// If whitelist is enabled, skip countries not in whitelist
		if whitelist != nil && !whitelist[t.CountryCode] {
			continue
		}
		cur := strings.TrimSpace(t.Currency)
		if cur == "" {
			cur = "USD"
		}
		out = append(out, ShippingCountryPublic{CountryCode: t.CountryCode, CountryName: t.CountryName, Currency: cur})
	}
	return out, nil
}

func CalculateShippingQuote(db *gorm.DB, countryCode string, weightKg float64) (ShippingQuoteResult, error) {
	if db == nil {
		return ShippingQuoteResult{}, errors.New("db is nil")
	}
	cc := NormalizeCountryCode(countryCode)
	if cc == "" {
		return ShippingQuoteResult{}, errors.New("country_code is empty")
	}
	if weightKg < 0 {
		weightKg = 0
	}
	if weightKg == 0 {
		return ShippingQuoteResult{CountryCode: cc, Currency: "USD", WeightKg: 0, BillingWeight: 0, RatePerKg: 0, BaseQuote: 0, AdditionalFee: 0, ShippingFee: 0, Source: "default"}, nil
	}

	var tpl models.ShippingTemplate
	if err := db.Where("country_code = ? AND is_active = ?", cc, true).First(&tpl).Error; err != nil {
		return ShippingQuoteResult{}, err
	}
	cur := strings.TrimSpace(tpl.Currency)
	if cur == "" {
		cur = "USD"
	}

	// Load brackets
	var brackets []models.ShippingWeightBracket
	if err := db.Where("template_id = ?", tpl.ID).Order("min_kg ASC, max_kg ASC").Find(&brackets).Error; err != nil {
		return ShippingQuoteResult{}, err
	}
	if len(brackets) == 0 {
		return ShippingQuoteResult{}, errors.New("no weight brackets configured")
	}

	// Billing weight rules:
	// - For weight < 21kg:
	//   - If the template provides fixed-fee rows (min=max) under 21kg, round up to the nearest available row
	//     (supports 0.5kg steps like 15.6 -> 16.0 or 15.6 -> 16.5 depending on the sheet).
	//   - Otherwise, round up to the next whole kg (15.6 -> 16)
	// - For weight >= 21kg: use the actual weight
	billingWeightKg := weightKg
	if weightKg > 0 && weightKg < 21 {
		fixed := make([]float64, 0)
		seen := map[float64]bool{}
		for _, b := range brackets {
			if round3(b.MinKg) == round3(b.MaxKg) && b.MinKg > 0 && b.MinKg < 21 {
				w := round3(b.MinKg)
				if !seen[w] {
					seen[w] = true
					fixed = append(fixed, w)
				}
			}
		}
		if len(fixed) > 0 {
			sort.Float64s(fixed)
			want := round3(weightKg)
			picked := 0.0
			for _, w := range fixed {
				if w >= want {
					picked = w
					break
				}
			}
			if picked > 0 {
				billingWeightKg = picked
			} else {
				billingWeightKg = math.Ceil(weightKg)
				if billingWeightKg < 1 {
					billingWeightKg = 1
				}
			}
		} else {
			billingWeightKg = math.Ceil(weightKg)
			if billingWeightKg < 1 {
				billingWeightKg = 1
			}
		}
	}

	// < 21kg prefers fixed-fee rows: min_kg == max_kg == billed integer kg
	ratePerKg := 0.0
	baseQuote := 0.0
	if billingWeightKg > 0 && billingWeightKg < 21 {
		fixedFound := false
		for _, b := range brackets {
			if round3(b.MinKg) == round3(billingWeightKg) && round3(b.MaxKg) == round3(billingWeightKg) {
				baseQuote = round2(b.RatePerKg)
				fixedFound = true
				break
			}
		}
		if !fixedFound {
			// fallback: use per-kg brackets if the sheet didn't provide fixed fees
			r, err := matchRatePerKg(brackets, billingWeightKg)
			if err != nil {
				return ShippingQuoteResult{}, err
			}
			ratePerKg = r
			baseQuote = round2(billingWeightKg * ratePerKg)
		}
	} else {
		r, err := matchRatePerKg(brackets, billingWeightKg)
		if err != nil {
			return ShippingQuoteResult{}, err
		}
		ratePerKg = r
		baseQuote = round2(billingWeightKg * ratePerKg)
	}

	// Load surcharge rules (optional)
	var sur []models.ShippingQuoteSurcharge
	_ = db.Where("template_id = ?", tpl.ID).Order("quote_amount ASC").Find(&sur).Error
	extra := matchAdditionalFee(sur, baseQuote)
	shippingFee := round2(baseQuote + extra)

	return ShippingQuoteResult{
		CountryCode:   cc,
		Currency:      cur,
		WeightKg:      round3(weightKg),
		BillingWeight: round3(billingWeightKg),
		RatePerKg:     round3(ratePerKg),
		BaseQuote:     baseQuote,
		AdditionalFee: round2(extra),
		ShippingFee:   shippingFee,
		Source:        "default",
	}, nil
}

func matchRatePerKg(brackets []models.ShippingWeightBracket, weightKg float64) (float64, error) {
	// Pick the first matching bracket, preferring the most specific (largest min).
	// max_kg <= 0 is treated as no upper limit.
	if len(brackets) == 0 {
		return 0, errors.New("no weight brackets configured")
	}

	// Make sure input is sorted (DB query should already be ordered).
	sort.SliceStable(brackets, func(i, j int) bool {
		if brackets[i].MinKg != brackets[j].MinKg {
			return brackets[i].MinKg < brackets[j].MinKg
		}
		return brackets[i].MaxKg < brackets[j].MaxKg
	})

	var candidates []models.ShippingWeightBracket
	for _, b := range brackets {
		min := b.MinKg
		max := b.MaxKg
		if max <= 0 {
			if weightKg >= min {
				candidates = append(candidates, b)
			}
			continue
		}
		if weightKg >= min && weightKg <= max {
			candidates = append(candidates, b)
		}
	}
	if len(candidates) == 0 {
		first := brackets[0]
		// If below min of all, use the first bracket.
		if weightKg < first.MinKg {
			if first.MinKg > 0 {
				return 0, fmt.Errorf("no matching weight bracket for %.3fkg (min configured %.3fkg)", weightKg, first.MinKg)
			}
			return first.RatePerKg, nil
		}
		// If above max of all, use the last bracket.
		last := brackets[len(brackets)-1]
		if last.MaxKg <= 0 || weightKg > last.MaxKg {
			return last.RatePerKg, nil
		}
		return 0, fmt.Errorf("no matching weight bracket for %.3fkg", weightKg)
	}

	sort.SliceStable(candidates, func(i, j int) bool {
		// higher min first
		if candidates[i].MinKg != candidates[j].MinKg {
			return candidates[i].MinKg > candidates[j].MinKg
		}
		// smaller max first (treat max<=0 as +inf)
		iMax := candidates[i].MaxKg
		jMax := candidates[j].MaxKg
		if iMax <= 0 {
			iMax = math.MaxFloat64
		}
		if jMax <= 0 {
			jMax = math.MaxFloat64
		}
		return iMax < jMax
	})
	return candidates[0].RatePerKg, nil
}

func matchAdditionalFee(surcharges []models.ShippingQuoteSurcharge, baseQuote float64) float64 {
	if len(surcharges) == 0 {
		return 0
	}
	// Choose the smallest quote_amount >= baseQuote.
	// If multiple rows have the same quote_amount, choose the highest additional fee.
	minQuote := math.MaxFloat64
	fee := 0.0
	found := false
	for _, s := range surcharges {
		if s.QuoteAmount >= baseQuote {
			if s.QuoteAmount < minQuote {
				minQuote = s.QuoteAmount
				fee = s.AdditionalFee
				found = true
			} else if s.QuoteAmount == minQuote && s.AdditionalFee > fee {
				fee = s.AdditionalFee
				found = true
			}
		}
	}
	if found {
		return fee
	}
	// else: use the largest quote_amount, also resolving duplicates by max fee
	maxQuote := -1.0
	fee = 0.0
	for _, s := range surcharges {
		if s.QuoteAmount > maxQuote {
			maxQuote = s.QuoteAmount
			fee = s.AdditionalFee
		} else if s.QuoteAmount == maxQuote && s.AdditionalFee > fee {
			fee = s.AdditionalFee
		}
	}
	return fee
}

func round2(v float64) float64 { return math.Round(v*100) / 100 }
func round3(v float64) float64 { return math.Round(v*1000) / 1000 }

// IsFreeShippingCountry returns true if the country has free shipping enabled.
func IsFreeShippingCountry(db *gorm.DB, countryCode string) bool {
	if db == nil {
		return false
	}
	cc := NormalizeCountryCode(countryCode)
	if cc == "" {
		return false
	}
	var setting models.ShippingFreeSetting
	if err := db.Where("country_code = ? AND free_shipping_enabled = ?", cc, true).First(&setting).Error; err != nil {
		return false
	}
	return true
}

// XLSX

func GenerateShippingTemplateXLSX_USSample() ([]byte, error) {
	// Optimized 2-sheet template for many countries:
	// - Sheet1: <21kg fixed shipping fee table (weight rows + country columns)
	// - Sheet2: >=21kg brackets (country + range + rate_per_kg)
	f := excelize.NewFile()

	// Sheet1 (<21kg)
	s1 := "Under21Kg"
	f.SetSheetName("Sheet1", s1)
	_ = f.SetCellValue(s1, "A1", "重量(kg)")
	countries := []string{"US", "CN"}
	for i, cc := range countries {
		cell, _ := excelize.CoordinatesToCellName(2+i, 1)
		_ = f.SetCellValue(s1, cell, cc)
	}

	// sample weights 1..20
	for w := 1; w <= 20; w++ {
		row := w + 1
		_ = f.SetCellValue(s1, fmt.Sprintf("A%d", row), w)
		// sample values
		if w == 16 {
			_ = f.SetCellValue(s1, fmt.Sprintf("B%d", row), 34)
			_ = f.SetCellValue(s1, fmt.Sprintf("C%d", row), 20)
		}
	}

	// Sheet2 (>=21kg)
	s2 := "Over21Kg"
	idx, _ := f.NewSheet(s2)
	f.SetActiveSheet(idx)
	_ = f.SetCellValue(s2, "A1", "国家代码")
	_ = f.SetCellValue(s2, "B1", "重量区间(kg)")
	_ = f.SetCellValue(s2, "C1", "每公斤价格")
	_ = f.SetCellValue(s2, "A2", "US")
	_ = f.SetCellValue(s2, "B2", "21.0 - 44.0")
	_ = f.SetCellValue(s2, "C2", 10)
	_ = f.SetCellValue(s2, "A3", "US")
	_ = f.SetCellValue(s2, "B3", "71.0 - 99.0")
	_ = f.SetCellValue(s2, "C3", 9)

	// Optional (compatible): QuoteSurcharge sheet can still be used if needed.

	// Style
	for _, sh := range []string{s1, s2} {
		_ = f.SetPanes(sh, &excelize.Panes{Freeze: true, Split: true, YSplit: 1, ActivePane: "bottomLeft"})
		headerStyle, _ := f.NewStyle(&excelize.Style{Font: &excelize.Font{Bold: true}, Fill: excelize.Fill{Type: "pattern", Color: []string{"#F3F4F6"}, Pattern: 1}})
		endCol := "C"
		if sh == s1 {
			lastCol, _ := excelize.ColumnNumberToName(1 + 1 + len(countries))
			endCol = lastCol
		}
		_ = f.SetCellStyle(sh, "A1", endCol+"1", headerStyle)
	}
	_ = f.SetColWidth(s1, "A", "A", 12)
	if len(countries) > 0 {
		lastCol, _ := excelize.ColumnNumberToName(1 + 1 + len(countries))
		_ = f.SetColWidth(s1, "B", lastCol, 12)
	}
	_ = f.SetColWidth(s2, "A", "A", 12)
	_ = f.SetColWidth(s2, "B", "B", 18)
	_ = f.SetColWidth(s2, "C", "C", 12)

	buf, err := f.WriteToBuffer()
	if err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

type ShippingTemplateImportResult struct {
	Countries int      `json:"countries"`
	Created   int      `json:"created"`
	Updated   int      `json:"updated"`
	Deleted   int      `json:"deleted"`
	Failed    int      `json:"failed"`
	Errors    []string `json:"errors"`
}

// ImportShippingTemplatesFromXLSX imports both sheets and upserts templates and rules.
// If replace=true, existing rules for affected countries are deleted before insert.
func ImportShippingTemplatesFromXLSX(ctx context.Context, db *gorm.DB, r io.Reader, replace bool) (ShippingTemplateImportResult, error) {
	if db == nil {
		return ShippingTemplateImportResult{}, errors.New("db is nil")
	}
	b, err := io.ReadAll(r)
	if err != nil {
		return ShippingTemplateImportResult{}, err
	}
	f, err := excelize.OpenReader(bytes.NewReader(b))
	if err != nil {
		return ShippingTemplateImportResult{}, err
	}
	defer func() { _ = f.Close() }()

	quotes, qErrs := parseQuoteSheet(f)

	weights := []weightRow{}
	wErrs := []string{}

	// New preferred format: Under21Kg + Over21Kg
	if hasSheet(f, "Under21Kg") {
		w, errs := parseUnder21MatrixSheet(f, "Under21Kg")
		weights = append(weights, w...)
		wErrs = append(wErrs, errs...)
	}
	if hasSheet(f, "Over21Kg") {
		w, errs := parseOver21BracketSheet(f, "Over21Kg")
		weights = append(weights, w...)
		wErrs = append(wErrs, errs...)
	}

	perKgFound := false
	if len(weights) == 0 && len(wErrs) == 0 {
		w, errs, found := parsePerKgSheets(f)
		if found {
			perKgFound = true
			weights = append(weights, w...)
			wErrs = append(wErrs, errs...)
			if len(w) == 0 && len(errs) == 0 {
				wErrs = append(wErrs, "未找到任何已填写的每公斤运费（Rate per kg 列为空）")
			}
		}
	}

	// Backward compatibility: old WeightKg sheet
	if !perKgFound && len(weights) == 0 && len(wErrs) == 0 {
		w, errs := parseWeightSheet(f)
		if len(errs) == 1 && strings.Contains(strings.ToLower(errs[0]), "missing sheet: weightkg") {
			// Backward compatibility: single-sheet legacy
			w, errs = parseSingleSheetWeights(f)
			// single-sheet legacy doesn't include quote surcharge in that layout
			// (keep quotes if user provided QuoteSurcharge sheet anyway)
		}
		weights = append(weights, w...)
		wErrs = append(wErrs, errs...)
	}

	res := ShippingTemplateImportResult{Errors: []string{}}
	res.Errors = append(res.Errors, qErrs...)
	res.Errors = append(res.Errors, wErrs...)
	if len(res.Errors) > 0 {
		res.Failed = len(res.Errors)
		return res, fmt.Errorf("xlsx parse errors")
	}

	// Collect affected countries
	affected := map[string]struct{}{}
	for _, q := range quotes {
		affected[q.CountryCode] = struct{}{}
	}
	for _, w := range weights {
		affected[w.CountryCode] = struct{}{}
	}
	res.Countries = len(affected)

	err = db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// Upsert templates
		for cc := range affected {
			name := cc
			cur := "USD"
			if n, ok := pickCountryName(cc, quotes, weights); ok {
				name = n
			}
			name = EnglishCountryName(cc, name)
			if c, ok := pickCurrency(cc, quotes, weights); ok {
				cur = c
			}
			var tpl models.ShippingTemplate
			if e := tx.Where("country_code = ?", cc).First(&tpl).Error; e == nil {
				tpl.CountryName = name
				tpl.Currency = cur
				tpl.IsActive = true
				if e2 := tx.Save(&tpl).Error; e2 != nil {
					return e2
				}
				res.Updated++
			} else if errors.Is(e, gorm.ErrRecordNotFound) {
				tpl = models.ShippingTemplate{CountryCode: cc, CountryName: name, Currency: cur, IsActive: true}
				if e2 := tx.Create(&tpl).Error; e2 != nil {
					return e2
				}
				res.Created++
			} else {
				return e
			}
		}

		// Replace rules if requested
		if replace {
			for cc := range affected {
				var tpl models.ShippingTemplate
				if e := tx.Where("country_code = ?", cc).First(&tpl).Error; e != nil {
					return e
				}
				if e := tx.Where("template_id = ?", tpl.ID).Delete(&models.ShippingWeightBracket{}).Error; e != nil {
					return e
				}
				if e := tx.Where("template_id = ?", tpl.ID).Delete(&models.ShippingQuoteSurcharge{}).Error; e != nil {
					return e
				}
				res.Deleted++
			}
		}

		// Insert/upsert rules
		for _, w := range weights {
			var tpl models.ShippingTemplate
			if e := tx.Where("country_code = ?", w.CountryCode).First(&tpl).Error; e != nil {
				return e
			}
			// upsert by (template_id, min,max)
			var ex models.ShippingWeightBracket
			e := tx.Where("template_id = ? AND min_kg = ? AND max_kg = ?", tpl.ID, w.MinKg, w.MaxKg).First(&ex).Error
			if e == nil {
				ex.RatePerKg = w.RatePerKg
				_ = tx.Save(&ex).Error
				continue
			}
			if e != nil && !errors.Is(e, gorm.ErrRecordNotFound) {
				return e
			}
			_ = tx.Create(&models.ShippingWeightBracket{TemplateID: tpl.ID, MinKg: w.MinKg, MaxKg: w.MaxKg, RatePerKg: w.RatePerKg}).Error
		}
		for _, q := range quotes {
			var tpl models.ShippingTemplate
			if e := tx.Where("country_code = ?", q.CountryCode).First(&tpl).Error; e != nil {
				return e
			}
			var ex models.ShippingQuoteSurcharge
			e := tx.Where("template_id = ? AND quote_amount = ?", tpl.ID, q.QuoteAmount).First(&ex).Error
			if e == nil {
				ex.AdditionalFee = q.AdditionalFee
				_ = tx.Save(&ex).Error
				continue
			}
			if e != nil && !errors.Is(e, gorm.ErrRecordNotFound) {
				return e
			}
			_ = tx.Create(&models.ShippingQuoteSurcharge{TemplateID: tpl.ID, QuoteAmount: q.QuoteAmount, AdditionalFee: q.AdditionalFee}).Error
		}

		return nil
	})
	if err != nil {
		return res, err
	}
	return res, nil
}

type quoteRow struct {
	CountryCode   string
	CountryName   string
	QuoteAmount   float64
	AdditionalFee float64
	Currency      string
}

type weightRow struct {
	CountryCode string
	CountryName string
	MinKg       float64
	MaxKg       float64
	RatePerKg   float64
	Currency    string
}

func parseMoney(s string) (float64, error) {
	s = strings.TrimSpace(s)
	s = strings.ReplaceAll(s, "$", "")
	s = strings.ReplaceAll(s, ",", "")
	if s == "" {
		return 0, nil
	}
	return strconv.ParseFloat(s, 64)
}

func parseFloat(s string) (float64, error) {
	s = strings.TrimSpace(s)
	s = strings.ReplaceAll(s, ",", "")
	if s == "" {
		return 0, nil
	}
	return strconv.ParseFloat(s, 64)
}

func parseQuoteSheet(f *excelize.File) ([]quoteRow, []string) {
	name := "QuoteSurcharge"
	idx, err := f.GetSheetIndex(name)
	if err != nil || idx == -1 {
		// ok: optional
		return []quoteRow{}, nil
	}
	rows, err := f.GetRows(name)
	if err != nil {
		return nil, []string{err.Error()}
	}
	if len(rows) <= 1 {
		return []quoteRow{}, nil
	}
	head := rows[0]
	colCode, colName, colQuote, colFee, colCur := 0, 1, 2, 3, 4
	for i, h := range head {
		k := strings.ToLower(strings.TrimSpace(h))
		k = strings.ReplaceAll(k, " ", "")
		switch {
		case strings.Contains(k, "countrycode") || k == "code":
			colCode = i
		case strings.Contains(k, "countryname") || k == "name":
			colName = i
		case strings.Contains(k, "quote"):
			colQuote = i
		case strings.Contains(k, "additional") || strings.Contains(k, "fee") || strings.Contains(k, "surcharge"):
			colFee = i
		case strings.Contains(k, "currency") || k == "cur":
			colCur = i
		}
	}

	errs := []string{}
	out := make([]quoteRow, 0)
	for i := 1; i < len(rows); i++ {
		r := rows[i]
		get := func(idx int) string {
			if idx < 0 || idx >= len(r) {
				return ""
			}
			return r[idx]
		}
		cc := NormalizeCountryCode(get(colCode))
		if cc == "" {
			continue
		}
		q, e := parseMoney(get(colQuote))
		if e != nil {
			errs = append(errs, fmt.Sprintf("%s row %d: invalid quote: %v", name, i+1, e))
			continue
		}
		fee, e := parseMoney(get(colFee))
		if e != nil {
			errs = append(errs, fmt.Sprintf("%s row %d: invalid additional fee: %v", name, i+1, e))
			continue
		}
		cn := strings.TrimSpace(get(colName))
		cur := strings.ToUpper(strings.TrimSpace(get(colCur)))
		if cur == "" {
			cur = "USD"
		}
		if q <= 0 {
			continue
		}
		out = append(out, quoteRow{CountryCode: cc, CountryName: cn, QuoteAmount: round2(q), AdditionalFee: round2(fee), Currency: cur})
	}
	return out, errs
}

func parseWeightSheet(f *excelize.File) ([]weightRow, []string) {
	name := "WeightKg"
	idx, err := f.GetSheetIndex(name)
	if err != nil || idx == -1 {
		return nil, []string{"missing sheet: WeightKg"}
	}
	rows, err := f.GetRows(name)
	if err != nil {
		return nil, []string{err.Error()}
	}
	if len(rows) <= 1 {
		return nil, []string{"WeightKg sheet has no data"}
	}
	head := rows[0]
	colCode, colName, colMin, colMax, colRate, colCur := 0, 1, 2, 3, 4, 5
	for i, h := range head {
		k := strings.ToLower(strings.TrimSpace(h))
		k = strings.ReplaceAll(k, " ", "")
		switch {
		case strings.Contains(k, "countrycode") || k == "code":
			colCode = i
		case strings.Contains(k, "countryname") || k == "name":
			colName = i
		case strings.Contains(k, "minkg") || strings.Contains(k, "min"):
			colMin = i
		case strings.Contains(k, "maxkg") || strings.Contains(k, "max"):
			colMax = i
		case strings.Contains(k, "rate"):
			colRate = i
		case strings.Contains(k, "currency") || k == "cur":
			colCur = i
		}
	}

	errs := []string{}
	out := make([]weightRow, 0)
	for i := 1; i < len(rows); i++ {
		r := rows[i]
		get := func(idx int) string {
			if idx < 0 || idx >= len(r) {
				return ""
			}
			return r[idx]
		}
		cc := NormalizeCountryCode(get(colCode))
		if cc == "" {
			continue
		}
		minV, maxV, e := parseMinMaxKg(get(colMin), get(colMax))
		if e != nil {
			errs = append(errs, fmt.Sprintf("%s row %d: invalid kg range: %v", name, i+1, e))
			continue
		}
		rate, e := parseMoney(get(colRate))
		if e != nil {
			errs = append(errs, fmt.Sprintf("%s row %d: invalid rate: %v", name, i+1, e))
			continue
		}
		cn := strings.TrimSpace(get(colName))
		cur := strings.ToUpper(strings.TrimSpace(get(colCur)))
		if cur == "" {
			cur = "USD"
		}
		if minV == 0 && maxV == 0 {
			continue
		}
		out = append(out, weightRow{CountryCode: cc, CountryName: cn, MinKg: round3(minV), MaxKg: round3(maxV), RatePerKg: round3(rate), Currency: cur})
	}
	return out, errs
}

type countryGroup struct {
	CountryCode string
	WeightCol   int
	PriceCol    int
}

func hasSheet(f *excelize.File, name string) bool {
	idx, err := f.GetSheetIndex(name)
	return err == nil && idx != -1
}

func extractCountryCode(s string) string {
	s = strings.TrimSpace(s)
	if resolved := ResolveCountryCode(s); resolved != "" {
		return resolved
	}
	if len(s) == 2 && s == strings.ToUpper(s) {
		return NormalizeCountryCode(s)
	}
	// try tokens
	for _, tok := range strings.FieldsFunc(s, func(r rune) bool {
		return !(r >= 'A' && r <= 'Z') && !(r >= 'a' && r <= 'z')
	}) {
		if len(tok) == 2 && tok == strings.ToUpper(tok) {
			return NormalizeCountryCode(tok)
		}
	}
	return ""
}

// Under21Kg sheet: matrix format
// A1=Weight header, B1..=Country codes; rows: weight 0.5..20 (0.5kg or 1kg steps), each cell is final shipping fee.
func parseUnder21MatrixSheet(f *excelize.File, name string) ([]weightRow, []string) {
	rows, err := f.GetRows(name)
	if err != nil {
		return nil, []string{err.Error()}
	}
	if len(rows) <= 1 {
		return nil, []string{fmt.Sprintf("%s sheet has no data", name)}
	}
	head := rows[0]
	if len(head) < 2 {
		return nil, []string{fmt.Sprintf("%s header is too short", name)}
	}

	countryCols := []struct {
		cc  string
		col int
	}{}
	for i := 1; i < len(head); i++ {
		cc := extractCountryCode(head[i])
		if cc == "" {
			continue
		}
		countryCols = append(countryCols, struct {
			cc  string
			col int
		}{cc: cc, col: i})
	}
	if len(countryCols) == 0 {
		return nil, []string{fmt.Sprintf("%s: no country columns detected", name)}
	}

	get := func(r []string, idx int) string {
		if idx < 0 || idx >= len(r) {
			return ""
		}
		return r[idx]
	}

	errStrs := []string{}
	out := make([]weightRow, 0)
	for i := 1; i < len(rows); i++ {
		r := rows[i]
		wStr := strings.TrimSpace(get(r, 0))
		if wStr == "" {
			continue
		}
		w, e := parseFloat(wStr)
		if e != nil {
			errStrs = append(errStrs, fmt.Sprintf("%s row %d: invalid weight: %v", name, i+1, e))
			continue
		}
		if w <= 0 || w >= 21 {
			continue
		}
		// Carrier rate cards step in 0.5kg (0.5, 1.0, 1.5 ...); integer sheets are unchanged.
		w = math.Round(w*2) / 2
		for _, cc := range countryCols {
			feeStr := strings.TrimSpace(get(r, cc.col))
			if feeStr == "" {
				continue
			}
			fee, e := parseMoney(feeStr)
			if e != nil {
				errStrs = append(errStrs, fmt.Sprintf("%s row %d: invalid fee for %s: %v", name, i+1, cc.cc, e))
				continue
			}
			if fee <= 0 {
				continue
			}
			out = append(out, weightRow{CountryCode: cc.cc, CountryName: cc.cc, MinKg: round3(w), MaxKg: round3(w), RatePerKg: round3(fee), Currency: "USD"})
		}
	}
	return out, errStrs
}

// Over21Kg sheet: list format
// - Either 3 columns: country_code | "21.0 - 44.0" | rate_per_kg
// - Or 4 columns: country_code | min_kg | max_kg | rate_per_kg
func parseOver21BracketSheet(f *excelize.File, name string) ([]weightRow, []string) {
	rows, err := f.GetRows(name)
	if err != nil {
		return nil, []string{err.Error()}
	}
	if len(rows) <= 1 {
		return nil, []string{fmt.Sprintf("%s sheet has no data", name)}
	}

	head := rows[0]
	// basic header mapping
	colCode, colRange, colMin, colMax, colRate := 0, 1, -1, -1, 2
	for i, h := range head {
		k := strings.ToLower(strings.TrimSpace(h))
		k = strings.ReplaceAll(k, " ", "")
		switch {
		case strings.Contains(k, "country") || strings.Contains(k, "国家") || k == "code":
			colCode = i
		case strings.Contains(k, "range") || strings.Contains(k, "区间"):
			colRange = i
		case strings.Contains(k, "minkg") || strings.Contains(k, "min"):
			colMin = i
		case strings.Contains(k, "maxkg") || strings.Contains(k, "max"):
			colMax = i
		case strings.Contains(k, "rate") || strings.Contains(k, "价格") || strings.Contains(k, "fee"):
			colRate = i
		}
	}

	get := func(r []string, idx int) string {
		if idx < 0 || idx >= len(r) {
			return ""
		}
		return r[idx]
	}

	errStrs := []string{}
	out := make([]weightRow, 0)
	for i := 1; i < len(rows); i++ {
		r := rows[i]
		cc := NormalizeCountryCode(get(r, colCode))
		if cc == "" {
			continue
		}

		var minV, maxV float64
		var e error
		if colMin >= 0 && colMax >= 0 {
			minV, maxV, e = parseMinMaxKg(get(r, colMin), get(r, colMax))
		} else {
			minV, maxV, e = parseMinMaxKg(get(r, colRange), "")
		}
		if e != nil {
			errStrs = append(errStrs, fmt.Sprintf("%s row %d: invalid range for %s: %v", name, i+1, cc, e))
			continue
		}
		if minV < 21 {
			// keep this sheet for >=21kg
			continue
		}
		rate, e := parseMoney(get(r, colRate))
		if e != nil {
			errStrs = append(errStrs, fmt.Sprintf("%s row %d: invalid rate for %s: %v", name, i+1, cc, e))
			continue
		}
		if rate <= 0 {
			continue
		}
		out = append(out, weightRow{CountryCode: cc, CountryName: cc, MinKg: round3(minV), MaxKg: round3(maxV), RatePerKg: round3(rate), Currency: "USD"})
	}
	return out, errStrs
}

func parseSingleSheetWeights(f *excelize.File) ([]weightRow, []string) {
	sheet := f.GetSheetName(0)
	if strings.TrimSpace(sheet) == "" {
		sheet = "Sheet1"
	}
	rows, err := f.GetRows(sheet)
	if err != nil {
		return nil, []string{err.Error()}
	}
	if len(rows) <= 1 {
		return nil, []string{"single-sheet template has no data"}
	}

	head := rows[0]
	groups := detectCountryGroups(head)
	if len(groups) == 0 {
		return nil, []string{"single-sheet template: failed to detect country columns"}
	}

	errStrs := []string{}
	out := make([]weightRow, 0)

	get := func(r []string, idx int) string {
		if idx < 0 || idx >= len(r) {
			return ""
		}
		return r[idx]
	}

	// Detect where the >=21kg table starts (first row like: US | 21.0 - 44.0 | 10)
	bracketStart := len(rows)
	for i := 1; i < len(rows); i++ {
		r := rows[i]
		if len(r) < 3 {
			continue
		}
		cc := NormalizeCountryCode(strings.TrimSpace(r[0]))
		if cc == "" {
			continue
		}
		rng := strings.TrimSpace(r[1])
		if rng == "" {
			continue
		}
		if !strings.Contains(rng, "-") && !strings.Contains(rng, "—") && !strings.Contains(rng, "–") {
			continue
		}
		if _, err := parseMoney(strings.TrimSpace(r[2])); err != nil {
			continue
		}
		bracketStart = i
		break
	}

	// Section A: <21kg fixed fees (weight -> fee)
	for i := 1; i < bracketStart; i++ {
		r := rows[i]
		for _, g := range groups {
			wStr := strings.TrimSpace(get(r, g.WeightCol))
			pStr := strings.TrimSpace(get(r, g.PriceCol))
			if wStr == "" && pStr == "" {
				continue
			}
			w, e := parseFloat(wStr)
			if e != nil {
				errStrs = append(errStrs, fmt.Sprintf("%s row %d: invalid weight for %s: %v", sheet, i+1, g.CountryCode, e))
				continue
			}
			fee, e := parseMoney(pStr)
			if e != nil {
				errStrs = append(errStrs, fmt.Sprintf("%s row %d: invalid fee for %s: %v", sheet, i+1, g.CountryCode, e))
				continue
			}
			if w <= 0 || w >= 21 {
				continue
			}
			cc := NormalizeCountryCode(g.CountryCode)
			out = append(out, weightRow{CountryCode: cc, CountryName: cc, MinKg: round3(w), MaxKg: round3(w), RatePerKg: round3(fee), Currency: "USD"})
		}
	}

	// Section B: >=21kg brackets (country_code, "21.0 - 44.0", price_per_kg)
	for i := bracketStart; i < len(rows); i++ {
		r := rows[i]
		if len(r) < 3 {
			continue
		}
		cc := NormalizeCountryCode(strings.TrimSpace(r[0]))
		if cc == "" {
			continue
		}
		rng := strings.TrimSpace(r[1])
		if rng == "" {
			continue
		}
		if !strings.Contains(rng, "-") && !strings.Contains(rng, "—") && !strings.Contains(rng, "–") {
			continue
		}
		minV, maxV, e := parseMinMaxKg(rng, "")
		if e != nil {
			errStrs = append(errStrs, fmt.Sprintf("%s row %d: invalid range for %s: %v", sheet, i+1, cc, e))
			continue
		}
		rate, e := parseMoney(strings.TrimSpace(r[2]))
		if e != nil {
			errStrs = append(errStrs, fmt.Sprintf("%s row %d: invalid price for %s: %v", sheet, i+1, cc, e))
			continue
		}
		if minV == 0 && maxV == 0 {
			continue
		}
		out = append(out, weightRow{CountryCode: cc, CountryName: cc, MinKg: round3(minV), MaxKg: round3(maxV), RatePerKg: round3(rate), Currency: "USD"})
	}

	return out, errStrs
}

func detectCountryGroups(head []string) []countryGroup {
	weightKW := func(s string) bool {
		s = strings.ToLower(s)
		return strings.Contains(s, "weight") || strings.Contains(s, "kg") || strings.Contains(s, "重量")
	}
	priceKW := func(s string) bool {
		s = strings.ToLower(s)
		return strings.Contains(s, "price") || strings.Contains(s, "fee") || strings.Contains(s, "运费") || strings.Contains(s, "价格")
	}

	groups := []countryGroup{}

	// Prefer 3-column groups: [US][weight][price][CN][weight][price]...
	for i := 0; i < len(head); {
		cell := strings.TrimSpace(head[i])
		if len(cell) == 2 && cell == strings.ToUpper(cell) {
			cc := NormalizeCountryCode(cell)
			if cc != "" && i+2 < len(head) && weightKW(head[i+1]) && priceKW(head[i+2]) {
				groups = append(groups, countryGroup{CountryCode: cc, WeightCol: i + 1, PriceCol: i + 2})
				i += 3
				continue
			}
		}
		i++
	}
	if len(groups) > 0 {
		return groups
	}

	// Fallback: 2-column groups where each header contains the country code.
	for i := 0; i < len(head); i++ {
		h := strings.TrimSpace(head[i])
		cc := ""
		for _, token := range strings.FieldsFunc(h, func(r rune) bool { return r == ' ' || r == '_' || r == '-' || r == '/' }) {
			if len(token) == 2 && token == strings.ToUpper(token) {
				cc = NormalizeCountryCode(token)
				break
			}
		}
		if cc == "" {
			continue
		}
		if weightKW(h) {
			// find the nearest price column for the same cc
			for j := i + 1; j < len(head) && j <= i+2; j++ {
				h2 := strings.TrimSpace(head[j])
				if strings.Contains(strings.ToUpper(h2), cc) && priceKW(h2) {
					groups = append(groups, countryGroup{CountryCode: cc, WeightCol: i, PriceCol: j})
					break
				}
			}
		}
	}

	return groups
}

func parseMinMaxKg(minCell string, maxCell string) (float64, float64, error) {
	minCell = strings.TrimSpace(minCell)
	maxCell = strings.TrimSpace(maxCell)

	// Support user-friendly range input like: "21.0 - 44.0" (either column).
	parseRange := func(s string) (float64, float64, bool, error) {
		s = strings.TrimSpace(s)
		if s == "" {
			return 0, 0, false, nil
		}
		// Normalize dashes
		s = strings.ReplaceAll(s, "—", "-")
		s = strings.ReplaceAll(s, "–", "-")
		if !strings.Contains(s, "-") {
			return 0, 0, false, nil
		}
		parts := strings.Split(s, "-")
		if len(parts) < 2 {
			return 0, 0, false, fmt.Errorf("invalid range")
		}
		left := strings.TrimSpace(parts[0])
		right := strings.TrimSpace(parts[1])
		minV, err := parseFloat(left)
		if err != nil {
			return 0, 0, false, err
		}
		maxV, err := parseFloat(right)
		if err != nil {
			return 0, 0, false, err
		}
		return minV, maxV, true, nil
	}

	if minV, maxV, ok, err := parseRange(minCell); err != nil {
		return 0, 0, err
	} else if ok {
		if minV < 0 {
			minV = 0
		}
		if maxV != 0 && maxV < minV {
			return 0, 0, fmt.Errorf("max < min")
		}
		return minV, maxV, nil
	}
	if minV, maxV, ok, err := parseRange(maxCell); err != nil {
		return 0, 0, err
	} else if ok {
		if minV < 0 {
			minV = 0
		}
		if maxV != 0 && maxV < minV {
			return 0, 0, fmt.Errorf("max < min")
		}
		return minV, maxV, nil
	}

	minV, err := parseFloat(minCell)
	if err != nil {
		return 0, 0, err
	}
	maxV, err := parseFloat(maxCell)
	if err != nil {
		return 0, 0, err
	}
	if minV < 0 {
		minV = 0
	}
	// max==0 means infinity
	if maxV != 0 && maxV < minV {
		return 0, 0, fmt.Errorf("max < min")
	}
	return minV, maxV, nil
}

func pickCountryName(cc string, quotes []quoteRow, weights []weightRow) (string, bool) {
	for _, w := range weights {
		if w.CountryCode == cc && strings.TrimSpace(w.CountryName) != "" {
			return w.CountryName, true
		}
	}
	for _, q := range quotes {
		if q.CountryCode == cc && strings.TrimSpace(q.CountryName) != "" {
			return q.CountryName, true
		}
	}
	return "", false
}

func pickCurrency(cc string, quotes []quoteRow, weights []weightRow) (string, bool) {
	for _, w := range weights {
		if w.CountryCode == cc && strings.TrimSpace(w.Currency) != "" {
			return w.Currency, true
		}
	}
	for _, q := range quotes {
		if q.CountryCode == cc && strings.TrimSpace(q.Currency) != "" {
			return q.Currency, true
		}
	}
	return "", false
}
