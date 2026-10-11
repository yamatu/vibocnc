package services

import (
	"context"
	"errors"
	"fmt"
	"io"
	"math"
	"sort"
	"strings"

	"fanuc-backend/models"

	"github.com/xuri/excelize/v2"
	"gorm.io/gorm"
)

type CarrierZoneImportOptions struct {
	Carrier     string
	ServiceCode string
	Currency    string
}

func NormalizeCarrier(s string) string {
	s = strings.TrimSpace(strings.ToUpper(s))
	if s == "" {
		return ""
	}
	// Keep only simple tokens to avoid weird filenames/SQL surprises.
	out := make([]rune, 0, len(s))
	for _, r := range s {
		if (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '_' || r == '-' {
			out = append(out, r)
		}
	}
	return string(out)
}

func NormalizeServiceCode(s string) string {
	s = strings.TrimSpace(strings.ToUpper(s))
	if s == "" {
		return ""
	}
	out := make([]rune, 0, len(s))
	for _, r := range s {
		if (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '_' || r == '-' {
			out = append(out, r)
		}
	}
	return string(out)
}

func ListActiveCarrierShippingCountries(db *gorm.DB, carrier string, serviceCode string) ([]ShippingCountryPublic, error) {
	if db == nil {
		return nil, errors.New("db is nil")
	}
	carrier = NormalizeCarrier(carrier)
	serviceCode = NormalizeServiceCode(serviceCode)

	baseQ := db.Model(&models.ShippingCarrierTemplate{}).Where("is_active = ?", true)
	if carrier != "" {
		baseQ = baseQ.Where("carrier = ?", carrier)
	}

	q := baseQ
	if serviceCode != "" {
		q = q.Where("service_code = ?", serviceCode)
	}

	var tpls []models.ShippingCarrierTemplate
	if err := q.Order("country_name ASC").Find(&tpls).Error; err != nil {
		return nil, err
	}
	if serviceCode != "" && len(tpls) == 0 {
		// ServiceCode is a user-provided hint. If it doesn't match any templates,
		// fall back to all services so the UI still shows available countries.
		if err := baseQ.Order("country_name ASC").Find(&tpls).Error; err != nil {
			return nil, err
		}
	}

	// Check if whitelist is enabled (has any entries)
	var whitelistCount int64
	db.Model(&models.ShippingAllowedCountry{}).Count(&whitelistCount)

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

func CalculateCarrierShippingQuote(db *gorm.DB, carrier string, serviceCode string, countryCode string, weightKg float64) (ShippingQuoteResult, error) {
	if db == nil {
		return ShippingQuoteResult{}, errors.New("db is nil")
	}
	cc := NormalizeCountryCode(countryCode)
	if cc == "" {
		return ShippingQuoteResult{}, errors.New("country_code is empty")
	}
	carrier = NormalizeCarrier(carrier)
	serviceCode = NormalizeServiceCode(serviceCode)
	if carrier == "" {
		return ShippingQuoteResult{}, errors.New("carrier is empty")
	}

	if weightKg < 0 {
		weightKg = 0
	}
	if weightKg == 0 {
		return ShippingQuoteResult{CountryCode: cc, Currency: "USD", WeightKg: 0, BillingWeight: 0, RatePerKg: 0, BaseQuote: 0, AdditionalFee: 0, ShippingFee: 0, Source: "carrier", Carrier: carrier, ServiceCode: serviceCode}, nil
	}

	var tpl models.ShippingCarrierTemplate
	// If serviceCode is provided, try exact match first.
	// If not found (or serviceCode is empty), fall back to any active template for the carrier+country.
	q := db.Where("carrier = ? AND country_code = ? AND is_active = ?", carrier, cc, true)
	if serviceCode != "" {
		qExact := q.Where("service_code = ?", serviceCode)
		if err := qExact.First(&tpl).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				// fallback: any service
				if err2 := q.Order("service_code ASC").First(&tpl).Error; err2 != nil {
					return ShippingQuoteResult{}, err2
				}
			} else {
				return ShippingQuoteResult{}, err
			}
		}
	} else {
		if err := q.Order("service_code ASC").First(&tpl).Error; err != nil {
			return ShippingQuoteResult{}, err
		}
	}
	cur := strings.TrimSpace(tpl.Currency)
	if cur == "" {
		cur = "USD"
	}

	var brackets []models.ShippingCarrierWeightBracket
	if err := db.Where("template_id = ?", tpl.ID).Order("min_kg ASC, max_kg ASC").Find(&brackets).Error; err != nil {
		return ShippingQuoteResult{}, err
	}
	if len(brackets) == 0 {
		return ShippingQuoteResult{}, errors.New("no weight brackets configured")
	}

	billingWeightKg := weightKg
	if weightKg > 0 && weightKg < 21 {
		// If template provides fixed-fee rows (min=max) under 21kg, round up to the nearest available row.
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
			r, err := matchCarrierRatePerKg(brackets, billingWeightKg)
			if err != nil {
				return ShippingQuoteResult{}, err
			}
			ratePerKg = r
			baseQuote = round2(billingWeightKg * ratePerKg)
		}
	} else {
		r, err := matchCarrierRatePerKg(brackets, billingWeightKg)
		if err != nil {
			return ShippingQuoteResult{}, err
		}
		ratePerKg = r
		baseQuote = round2(billingWeightKg * ratePerKg)
	}

	var sur []models.ShippingCarrierQuoteSurcharge
	_ = db.Where("template_id = ?", tpl.ID).Order("quote_amount ASC").Find(&sur).Error
	extra := matchAdditionalFeeCarrier(sur, baseQuote)
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
		Source:        "carrier",
		Carrier:       tpl.Carrier,
		ServiceCode:   tpl.ServiceCode,
	}, nil
}

func matchCarrierRatePerKg(brackets []models.ShippingCarrierWeightBracket, weightKg float64) (float64, error) {
	if len(brackets) == 0 {
		return 0, errors.New("no weight brackets configured")
	}
	sort.SliceStable(brackets, func(i, j int) bool {
		if brackets[i].MinKg != brackets[j].MinKg {
			return brackets[i].MinKg < brackets[j].MinKg
		}
		return brackets[i].MaxKg < brackets[j].MaxKg
	})

	var candidates []models.ShippingCarrierWeightBracket
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
		if weightKg < first.MinKg {
			if first.MinKg > 0 {
				return 0, fmt.Errorf("no matching weight bracket for %.3fkg (min configured %.3fkg)", weightKg, first.MinKg)
			}
			return first.RatePerKg, nil
		}
		last := brackets[len(brackets)-1]
		if last.MaxKg <= 0 || weightKg > last.MaxKg {
			return last.RatePerKg, nil
		}
		return 0, fmt.Errorf("no matching weight bracket for %.3fkg", weightKg)
	}

	sort.SliceStable(candidates, func(i, j int) bool {
		if candidates[i].MinKg != candidates[j].MinKg {
			return candidates[i].MinKg > candidates[j].MinKg
		}
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

func matchAdditionalFeeCarrier(rules []models.ShippingCarrierQuoteSurcharge, quoteAmount float64) float64 {
	if len(rules) == 0 {
		return 0
	}
	sort.SliceStable(rules, func(i, j int) bool { return rules[i].QuoteAmount < rules[j].QuoteAmount })
	fee := 0.0
	for _, r := range rules {
		if quoteAmount >= r.QuoteAmount {
			fee = r.AdditionalFee
		} else {
			break
		}
	}
	return fee
}

// Carrier-zone XLSX template

func GenerateCarrierZoneTemplateXLSX(opts CarrierZoneImportOptions) ([]byte, error) {
	carrier := NormalizeCarrier(opts.Carrier)
	serviceCode := NormalizeServiceCode(opts.ServiceCode)
	currency := strings.TrimSpace(strings.ToUpper(opts.Currency))
	if currency == "" {
		currency = "USD"
	}

	f := excelize.NewFile()
	sMeta := "CarrierMeta"
	f.SetSheetName("Sheet1", sMeta)

	// Meta key/value
	_ = f.SetCellValue(sMeta, "A1", "Carrier")
	_ = f.SetCellValue(sMeta, "B1", carrier)
	_ = f.SetCellValue(sMeta, "A2", "ServiceCode")
	_ = f.SetCellValue(sMeta, "B2", serviceCode)
	_ = f.SetCellValue(sMeta, "A3", "Currency")
	_ = f.SetCellValue(sMeta, "B3", currency)
	_ = f.SetCellValue(sMeta, "A5", "Notes")
	_ = f.SetCellValue(sMeta, "B5", strings.Join([]string{
		"1) Fill CountryZones: ISO2 country_code + zone.",
		"2) Under21Kg_Zones: weights 0.5..20.5 (0.5 step) => FINAL shipping fee for that billed weight.",
		"3) Over21Kg_Zones: >=21kg brackets => FINAL rate per kg.",
		"4) If you are using the provided FedEx workbook (Fedex价格表2025上ebay.xlsx), you can keep its combined sheet \"加过利润的所有运费（含旺季附加费）\" as the rate source and ONLY add CountryZones, then upload.",
		"5) US has zone 1/2 in some sheets; this system is country-level (no ZIP/state). Pick one zone or extend to region logic.",
	}, "\n"))

	// Country-zone map
	sMap := "CountryZones"
	idxMap, _ := f.NewSheet(sMap)
	_ = f.SetCellValue(sMap, "A1", "country_code")
	_ = f.SetCellValue(sMap, "B1", "country_name")
	_ = f.SetCellValue(sMap, "C1", "zone")
	_ = f.SetCellValue(sMap, "D1", "note")

	// 10 example countries (verify zone by your chosen service column)
	examples := [][]string{
		{"US", "United States", "2", "US can be zone 1/2. This example uses zone 2 (\u7f8e\u56fd\u5176\u4ed6\u5730\u533a)."},
		{"CA", "Canada", "N", "Example from FedEx index: Canada -> N"},
		{"AU", "Australia", "U", "Example from FedEx index: Australia -> U"},
		{"GB", "United Kingdom", "K", "Example from FedEx index: United Kingdom -> K"},
		{"DE", "Germany", "K", "Example from FedEx index: Germany -> K"},
		{"FR", "France", "K", "Example from FedEx index: France -> K"},
		{"IT", "Italy", "K", "Example from FedEx index: Italy -> K"},
		{"JP", "Japan", "P", "Example from FedEx index: Japan -> P"},
		{"BR", "Brazil", "G", "Example from FedEx index: Brazil -> G"},
		{"IN", "India", "O", "Example from FedEx index: India -> O"},
	}
	for i, r := range examples {
		row := i + 2
		_ = f.SetCellValue(sMap, fmt.Sprintf("A%d", row), r[0])
		_ = f.SetCellValue(sMap, fmt.Sprintf("B%d", row), r[1])
		_ = f.SetCellValue(sMap, fmt.Sprintf("C%d", row), r[2])
		_ = f.SetCellValue(sMap, fmt.Sprintf("D%d", row), r[3])
	}
	_ = f.SetCellValue(sMap, "A12", "")
	_ = f.SetCellValue(sMap, "B12", "")
	_ = f.SetCellValue(sMap, "C12", "")
	_ = f.SetCellValue(sMap, "D12", "Add more countries below")

	// Under21Kg zone matrix
	sU := "Under21Kg_Zones"
	idxU, _ := f.NewSheet(sU)
	_ = f.SetCellValue(sU, "A1", "weight_kg")
	zones := []string{"1", "2", "A", "B", "D", "E", "F", "G", "H", "K", "M", "N", "O", "P", "Q", "R", "S", "T", "U", "V", "X", "Y", "Z"}
	for i, z := range zones {
		cell, _ := excelize.CoordinatesToCellName(2+i, 1)
		_ = f.SetCellValue(sU, cell, z)
	}
	// Default weights: 0.5..20.5 step 0.5 (matches FedEx sheet)
	row := 2
	for w := 0.5; w <= 20.5+1e-9; w += 0.5 {
		_ = f.SetCellValue(sU, fmt.Sprintf("A%d", row), round3(w))
		row++
	}

	// Over21Kg list
	sO := "Over21Kg_Zones"
	idxO, _ := f.NewSheet(sO)
	_ = f.SetCellValue(sO, "A1", "zone")
	_ = f.SetCellValue(sO, "B1", "weight_range_kg")
	_ = f.SetCellValue(sO, "C1", "rate_per_kg")
	_ = f.SetCellValue(sO, "A2", "1")
	_ = f.SetCellValue(sO, "B2", "21.0 - 44.0")
	_ = f.SetCellValue(sO, "C2", 10)

	// Styles
	for _, sh := range []string{sMeta, sMap, sU, sO} {
		_ = f.SetPanes(sh, &excelize.Panes{Freeze: true, Split: true, YSplit: 1, ActivePane: "bottomLeft"})
	}
	headerStyle, _ := f.NewStyle(&excelize.Style{Font: &excelize.Font{Bold: true}, Fill: excelize.Fill{Type: "pattern", Color: []string{"#F3F4F6"}, Pattern: 1}})
	_ = f.SetCellStyle(sMeta, "A1", "B1", headerStyle)
	_ = f.SetCellStyle(sMap, "A1", "C1", headerStyle)
	lastCol, _ := excelize.ColumnNumberToName(1 + 1 + len(zones))
	_ = f.SetCellStyle(sU, "A1", lastCol+"1", headerStyle)
	_ = f.SetCellStyle(sO, "A1", "C1", headerStyle)

	_ = f.SetColWidth(sMeta, "A", "A", 14)
	_ = f.SetColWidth(sMeta, "B", "B", 80)
	_ = f.SetColWidth(sMap, "A", "A", 14)
	_ = f.SetColWidth(sMap, "B", "B", 28)
	_ = f.SetColWidth(sMap, "C", "C", 10)
	_ = f.SetColWidth(sMap, "D", "D", 48)
	_ = f.SetColWidth(sU, "A", "A", 12)
	_ = f.SetColWidth(sU, "B", lastCol, 10)
	_ = f.SetColWidth(sO, "A", "A", 10)
	_ = f.SetColWidth(sO, "B", "B", 18)
	_ = f.SetColWidth(sO, "C", "C", 12)

	// Make Meta the first active sheet
	_ = idxMap
	_ = idxU
	_ = idxO
	if metaIdx, e := f.GetSheetIndex(sMeta); e == nil {
		f.SetActiveSheet(metaIdx)
	}

	buf, err := f.WriteToBuffer()
	if err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

type zoneRates struct {
	Under21 map[string]map[float64]float64 // zone -> weight -> fee
	Over21  map[string][]models.ShippingCarrierWeightBracket
}

func ImportCarrierZoneTemplatesFromXLSX(ctx context.Context, db *gorm.DB, r io.Reader, replace bool, override CarrierZoneImportOptions) (ShippingTemplateImportResult, error) {
	if db == nil {
		return ShippingTemplateImportResult{}, errors.New("db is nil")
	}
	f, err := excelize.OpenReader(r)
	if err != nil {
		return ShippingTemplateImportResult{}, err
	}
	defer func() { _ = f.Close() }()

	metaCarrier, metaService, metaCurrency := readCarrierMeta(f)
	carrier := NormalizeCarrier(override.Carrier)
	service := NormalizeServiceCode(override.ServiceCode)
	currency := strings.TrimSpace(strings.ToUpper(override.Currency))
	if carrier == "" {
		carrier = NormalizeCarrier(metaCarrier)
	}
	if service == "" {
		service = NormalizeServiceCode(metaService)
	}
	if currency == "" {
		currency = strings.TrimSpace(strings.ToUpper(metaCurrency))
	}
	if currency == "" {
		currency = "USD"
	}
	if carrier == "" {
		return ShippingTemplateImportResult{}, errors.New("missing carrier (set CarrierMeta or pass carrier param)")
	}

	cz, czErrs := parseCountryZonesSheet(f, "CountryZones")
	zr, zrErrs := parseZoneRatesSheets(f, "Under21Kg_Zones", "Over21Kg_Zones")

	res := ShippingTemplateImportResult{Errors: []string{}}
	res.Errors = append(res.Errors, czErrs...)
	res.Errors = append(res.Errors, zrErrs...)
	if len(res.Errors) > 0 {
		res.Failed = len(res.Errors)
		return res, errors.New("invalid xlsx")
	}

	// Upsert per-country templates using zone mapping.
	created := 0
	updated := 0
	failed := 0
	for _, row := range cz {
		select {
		case <-ctx.Done():
			return res, ctx.Err()
		default:
		}

		cc := NormalizeCountryCode(row.CountryCode)
		if cc == "" {
			failed++
			res.Errors = append(res.Errors, "invalid country_code: "+row.CountryCode)
			continue
		}
		zone := strings.TrimSpace(row.Zone)
		if zone == "" {
			failed++
			res.Errors = append(res.Errors, fmt.Sprintf("%s: missing zone", cc))
			continue
		}

		u := zr.Under21[zone]
		o := zr.Over21[zone]
		if len(u) == 0 && len(o) == 0 {
			failed++
			res.Errors = append(res.Errors, fmt.Sprintf("%s: zone %s has no rates", cc, zone))
			continue
		}

		name := EnglishCountryName(cc, row.CountryName)

		err := db.Transaction(func(tx *gorm.DB) error {
			var tpl models.ShippingCarrierTemplate
			e := tx.Where("carrier = ? AND service_code = ? AND country_code = ?", carrier, service, cc).First(&tpl).Error
			if e != nil {
				if !errors.Is(e, gorm.ErrRecordNotFound) {
					return e
				}
				tpl = models.ShippingCarrierTemplate{Carrier: carrier, ServiceCode: service, CountryCode: cc, CountryName: name, Currency: currency, IsActive: true}
				if ce := tx.Create(&tpl).Error; ce != nil {
					return ce
				}
				created++
			} else {
				// Update basic fields
				tpl.CountryName = name
				tpl.Currency = currency
				tpl.IsActive = true
				if ue := tx.Save(&tpl).Error; ue != nil {
					return ue
				}
				updated++
				if replace {
					_ = tx.Where("template_id = ?", tpl.ID).Delete(&models.ShippingCarrierWeightBracket{}).Error
					_ = tx.Where("template_id = ?", tpl.ID).Delete(&models.ShippingCarrierQuoteSurcharge{}).Error
				}
			}

			// Insert brackets
			ins := make([]models.ShippingCarrierWeightBracket, 0)
			for w, fee := range u {
				if fee <= 0 {
					continue
				}
				ins = append(ins, models.ShippingCarrierWeightBracket{TemplateID: tpl.ID, MinKg: round3(w), MaxKg: round3(w), RatePerKg: round3(fee)})
			}
			for _, b := range o {
				if b.RatePerKg <= 0 {
					continue
				}
				ins = append(ins, models.ShippingCarrierWeightBracket{TemplateID: tpl.ID, MinKg: round3(b.MinKg), MaxKg: round3(b.MaxKg), RatePerKg: round3(b.RatePerKg)})
			}
			if len(ins) > 0 {
				if ie := tx.Create(&ins).Error; ie != nil {
					return ie
				}
			}
			return nil
		})
		if err != nil {
			failed++
			res.Errors = append(res.Errors, fmt.Sprintf("%s: %v", cc, err))
		}
	}

	res.Countries = len(cz)
	res.Created = created
	res.Updated = updated
	res.Failed = failed
	return res, nil
}

type countryZoneRow struct {
	CountryCode string
	CountryName string
	Zone        string
}

func readCarrierMeta(f *excelize.File) (carrier string, service string, currency string) {
	rows, err := f.GetRows("CarrierMeta")
	if err != nil {
		return "", "", ""
	}
	for _, r := range rows {
		if len(r) < 2 {
			continue
		}
		k := strings.TrimSpace(r[0])
		v := strings.TrimSpace(r[1])
		switch strings.ToLower(k) {
		case "carrier":
			carrier = v
		case "servicecode", "service", "service_code":
			service = v
		case "currency":
			currency = v
		}
	}
	return carrier, service, currency
}

func parseCountryZonesSheet(f *excelize.File, name string) ([]countryZoneRow, []string) {
	rows, err := f.GetRows(name)
	if err != nil {
		return nil, []string{err.Error()}
	}
	if len(rows) <= 1 {
		return nil, []string{"CountryZones sheet has no data (expected columns: country_code, country_name, zone)"}
	}

	head := rows[0]
	colCC, colName, colZone := -1, -1, -1
	for i, h := range head {
		k := strings.ToLower(strings.TrimSpace(h))
		k = strings.ReplaceAll(k, " ", "")
		switch k {
		case "country_code", "country", "code", "countrycode", "iso2", "iso":
			colCC = i
		case "country_name", "name", "countryname":
			colName = i
		case "zone", "region", "area":
			colZone = i
		case "\u56fd\u5bb6\u4ee3\u7801", "\u56fd\u5bb6\u7801", "\u56fd\u522b":
			colCC = i
		case "\u56fd\u5bb6\u540d\u79f0", "\u56fd\u5bb6", "\u540d\u79f0":
			colName = i
		case "\u5206\u533a", "\u5206\u533a(zone)", "\u533a\u57df", "\u5206\u533a\u7801", "\u5206\u533a\u4ee3\u7801":
			colZone = i
		}
	}

	// If header doesn't look like a header, treat the first row as data.
	looksLikeHeader := colCC >= 0 || colZone >= 0 || strings.Contains(strings.ToLower(strings.Join(head, ",")), "country") || strings.Contains(strings.ToLower(strings.Join(head, ",")), "zone")
	startRow := 1
	if !looksLikeHeader {
		colCC, colName, colZone = 0, 1, 2
		startRow = 0
	} else {
		if colCC < 0 {
			colCC = 0
		}
		if colName < 0 {
			colName = 1
		}
		if colZone < 0 {
			colZone = 2
		}
	}

	get := func(r []string, idx int) string {
		if idx < 0 || idx >= len(r) {
			return ""
		}
		return strings.TrimSpace(r[idx])
	}

	out := make([]countryZoneRow, 0)
	for i := startRow; i < len(rows); i++ {
		r := rows[i]
		cc := get(r, colCC)
		if cc == "" {
			continue
		}
		out = append(out, countryZoneRow{CountryCode: cc, CountryName: get(r, colName), Zone: get(r, colZone)})
	}
	if len(out) == 0 {
		return nil, []string{"CountryZones: no rows"}
	}
	return out, nil
}

func parseZoneRatesSheets(f *excelize.File, under21Name string, over21Name string) (zoneRates, []string) {
	errStrs := []string{}
	out := zoneRates{Under21: map[string]map[float64]float64{}, Over21: map[string][]models.ShippingCarrierWeightBracket{}}

	// If the expected sheets are missing, support the FedEx eBay workbook format by reading
	// the combined sheet: "加过利润的所有运费（含旺季附加费）".
	if !hasSheet(f, under21Name) || !hasSheet(f, over21Name) {
		if hasSheet(f, "加过利润的所有运费（含旺季附加费）") {
			z, errs := parseFedexEbayCombinedSheet(f, "加过利润的所有运费（含旺季附加费）")
			if len(errs) == 0 {
				return z, nil
			}
			// fall through to report regular sheet errors too
			errStrs = append(errStrs, errs...)
		}
	}

	// Under21 matrix
	rows, err := f.GetRows(under21Name)
	if err != nil {
		return out, append(errStrs, err.Error())
	}
	if len(rows) <= 1 {
		return out, []string{under21Name + " sheet has no data"}
	}
	head := rows[0]
	if len(head) < 2 {
		return out, []string{under21Name + " header is too short"}
	}
	zones := make([]struct {
		z   string
		col int
	}, 0)
	for i := 1; i < len(head); i++ {
		z := strings.TrimSpace(head[i])
		if z == "" {
			continue
		}
		zones = append(zones, struct {
			z   string
			col int
		}{z: z, col: i})
		if out.Under21[z] == nil {
			out.Under21[z] = map[float64]float64{}
		}
	}
	if len(zones) == 0 {
		return out, []string{under21Name + ": no zone columns detected"}
	}

	get := func(r []string, idx int) string {
		if idx < 0 || idx >= len(r) {
			return ""
		}
		return strings.TrimSpace(r[idx])
	}
	for i := 1; i < len(rows); i++ {
		r := rows[i]
		wStr := get(r, 0)
		if wStr == "" {
			continue
		}
		w, e := parseFloat(wStr)
		if e != nil {
			errStrs = append(errStrs, fmt.Sprintf("%s row %d: invalid weight: %v", under21Name, i+1, e))
			continue
		}
		if w <= 0 || w >= 21 {
			continue
		}
		w = round3(w)
		for _, z := range zones {
			feeStr := get(r, z.col)
			if feeStr == "" {
				continue
			}
			fee, e := parseMoney(feeStr)
			if e != nil {
				errStrs = append(errStrs, fmt.Sprintf("%s row %d: invalid fee for zone %s: %v", under21Name, i+1, z.z, e))
				continue
			}
			if fee <= 0 {
				continue
			}
			out.Under21[z.z][w] = round3(fee)
		}
	}

	// Over21 list
	rows2, err := f.GetRows(over21Name)
	if err != nil {
		return out, append(errStrs, err.Error())
	}
	if len(rows2) <= 1 {
		return out, append(errStrs, over21Name+" sheet has no data")
	}
	head2 := rows2[0]
	colZone, colRange, colRate := 0, 1, 2
	for i, h := range head2 {
		k := strings.ToLower(strings.TrimSpace(h))
		k = strings.ReplaceAll(k, " ", "")
		switch {
		case k == "zone" || strings.Contains(k, "zone"):
			colZone = i
		case strings.Contains(k, "range"):
			colRange = i
		case strings.Contains(k, "rate") || strings.Contains(k, "price") || strings.Contains(k, "fee"):
			colRate = i
		}
	}
	for i := 1; i < len(rows2); i++ {
		r := rows2[i]
		z := strings.TrimSpace(get(r, colZone))
		if z == "" {
			continue
		}
		minV, maxV, e := parseMinMaxKg(get(r, colRange), "")
		if e != nil {
			errStrs = append(errStrs, fmt.Sprintf("%s row %d: invalid range for zone %s: %v", over21Name, i+1, z, e))
			continue
		}
		if minV < 21 {
			continue
		}
		rate, e := parseMoney(get(r, colRate))
		if e != nil {
			errStrs = append(errStrs, fmt.Sprintf("%s row %d: invalid rate for zone %s: %v", over21Name, i+1, z, e))
			continue
		}
		if rate <= 0 {
			continue
		}
		out.Over21[z] = append(out.Over21[z], models.ShippingCarrierWeightBracket{MinKg: round3(minV), MaxKg: round3(maxV), RatePerKg: round3(rate)})
	}
	return out, errStrs
}

func isZoneCode(s string) bool {
	s = strings.TrimSpace(s)
	if s == "" {
		return false
	}
	if len(s) > 2 {
		return false
	}
	for _, r := range s {
		if (r >= '0' && r <= '9') || (r >= 'A' && r <= 'Z') {
			continue
		}
		return false
	}
	return true
}

// parseFedexEbayCombinedSheet parses the existing workbook you provided (Fedex价格表2025上ebay.xlsx).
// It extracts zone-based rates from the combined sheet which contains:
// - <21kg table with columns like: 1 报价 附加费 2 报价 附加费 A 报价 ...
// - >=21kg brackets with columns like: 1 <rate> <surcharge> 2 <rate> <surcharge> ...
// This function returns FINAL values:
// - Under21: final shipping fee per weight row
// - Over21: final rate per kg per bracket
func parseFedexEbayCombinedSheet(f *excelize.File, name string) (zoneRates, []string) {
	rows, err := f.GetRows(name)
	if err != nil {
		return zoneRates{Under21: map[string]map[float64]float64{}, Over21: map[string][]models.ShippingCarrierWeightBracket{}}, []string{err.Error()}
	}
	if len(rows) < 20 {
		return zoneRates{Under21: map[string]map[float64]float64{}, Over21: map[string][]models.ShippingCarrierWeightBracket{}}, []string{"fedex sheet too short"}
	}

	out := zoneRates{Under21: map[string]map[float64]float64{}, Over21: map[string][]models.ShippingCarrierWeightBracket{}}
	errStrs := []string{}

	// Find the header row that starts with "公斤" and contains "报价".
	headerIdx := -1
	for i := 0; i < len(rows); i++ {
		r := rows[i]
		if len(r) < 4 {
			continue
		}
		if strings.TrimSpace(r[0]) == "公斤" {
			for _, v := range r {
				if strings.TrimSpace(v) == "报价" {
					headerIdx = i
					break
				}
			}
		}
		if headerIdx != -1 {
			break
		}
	}
	if headerIdx == -1 {
		return out, []string{"fedex: cannot find under-21 header row"}
	}

	// Parse under21 columns: zone -> quote col + optional surcharge col
	type uCol struct {
		zone     string
		quoteCol int
		surCol   int
	}
	cols := []uCol{}
	h := rows[headerIdx]
	for i := 1; i < len(h); {
		z := strings.TrimSpace(h[i])
		if !isZoneCode(z) {
			i++
			continue
		}
		// Expect next cell is "报价"
		quoteCol := -1
		surCol := -1
		if i+1 < len(h) && strings.TrimSpace(h[i+1]) == "报价" {
			quoteCol = i + 1
			if i+2 < len(h) && strings.TrimSpace(h[i+2]) == "附加费" {
				surCol = i + 2
				i += 3
			} else {
				i += 2
			}
		} else {
			i++
			continue
		}
		cols = append(cols, uCol{zone: z, quoteCol: quoteCol, surCol: surCol})
		if out.Under21[z] == nil {
			out.Under21[z] = map[float64]float64{}
		}
	}
	if len(cols) == 0 {
		return out, []string{"fedex: no under-21 zone columns detected"}
	}

	get := func(r []string, idx int) string {
		if idx < 0 || idx >= len(r) {
			return ""
		}
		return strings.TrimSpace(r[idx])
	}

	for i := headerIdx + 1; i < len(rows); i++ {
		r := rows[i]
		wStr := get(r, 0)
		if wStr == "" {
			continue
		}
		// Stop when reaching the >=21 header section (another "公斤" row without "报价")
		if wStr == "公斤" {
			break
		}
		w, e := parseFloat(wStr)
		if e != nil {
			continue
		}
		if w <= 0 || w >= 21 {
			continue
		}
		w = round3(w)
		for _, c := range cols {
			qStr := get(r, c.quoteCol)
			if qStr == "" {
				continue
			}
			q, e := parseMoney(qStr)
			if e != nil {
				errStrs = append(errStrs, fmt.Sprintf("fedex under21 row %d zone %s: invalid quote: %v", i+1, c.zone, e))
				continue
			}
			s := 0.0
			if c.surCol >= 0 {
				sStr := get(r, c.surCol)
				if sStr != "" {
					v, e := parseMoney(sStr)
					if e != nil {
						errStrs = append(errStrs, fmt.Sprintf("fedex under21 row %d zone %s: invalid surcharge: %v", i+1, c.zone, e))
					} else {
						s = v
					}
				}
			}
			fee := q + s
			if fee > 0 {
				out.Under21[c.zone][w] = round3(fee)
			}
		}
	}

	// Find the >=21 header row: starts with "公斤" and has zone codes.
	brHeaderIdx := -1
	for i := headerIdx + 1; i < len(rows); i++ {
		r := rows[i]
		if len(r) < 3 {
			continue
		}
		if strings.TrimSpace(r[0]) == "公斤" {
			brHeaderIdx = i
			break
		}
	}
	if brHeaderIdx == -1 {
		return out, append(errStrs, "fedex: cannot find >=21 header row")
	}

	bh := rows[brHeaderIdx]
	// zone column positions: zone -> rateCol (+ optional surCol which is often the next column)
	type bCol struct {
		zone    string
		rateCol int
		surCol  int
	}
	bCols := []bCol{}
	for i := 1; i < len(bh); i++ {
		z := strings.TrimSpace(bh[i])
		if !isZoneCode(z) {
			continue
		}
		rateCol := i
		surCol := -1
		if i+1 < len(bh) && strings.TrimSpace(bh[i+1]) == "" {
			surCol = i + 1
		}
		bCols = append(bCols, bCol{zone: z, rateCol: rateCol, surCol: surCol})
	}
	if len(bCols) == 0 {
		return out, append(errStrs, "fedex: no >=21 zone columns detected")
	}

	for i := brHeaderIdx + 1; i < len(rows); i++ {
		r := rows[i]
		rangeStr := get(r, 0)
		if rangeStr == "" {
			continue
		}
		minV, maxV, e := parseMinMaxKg(rangeStr, "")
		if e != nil {
			continue
		}
		if minV < 21 {
			continue
		}
		for _, c := range bCols {
			rateStr := get(r, c.rateCol)
			if rateStr == "" {
				continue
			}
			rate, e := parseMoney(rateStr)
			if e != nil {
				errStrs = append(errStrs, fmt.Sprintf("fedex over21 row %d zone %s: invalid rate: %v", i+1, c.zone, e))
				continue
			}
			sur := 0.0
			if c.surCol >= 0 {
				sStr := get(r, c.surCol)
				if sStr != "" {
					v, e := parseMoney(sStr)
					if e != nil {
						errStrs = append(errStrs, fmt.Sprintf("fedex over21 row %d zone %s: invalid surcharge: %v", i+1, c.zone, e))
					} else {
						sur = v
					}
				}
			}
			finalRate := rate + sur
			if finalRate <= 0 {
				continue
			}
			out.Over21[c.zone] = append(out.Over21[c.zone], models.ShippingCarrierWeightBracket{MinKg: round3(minV), MaxKg: round3(maxV), RatePerKg: round3(finalRate)})
		}
	}

	return out, errStrs
}
