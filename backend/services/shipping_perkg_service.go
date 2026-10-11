package services

import (
	"errors"
	"fmt"
	"strings"

	"fanuc-backend/models"

	"github.com/xuri/excelize/v2"
	"gorm.io/gorm"
)

const perKgSheetName = "RatePerKg"

// PerKgRateFor returns the flat per-kg rate when a template is configured with a single
// open-ended bracket (min 0, no max), i.e. the "rate per kg" pricing mode.
func PerKgRateFor(brackets []models.ShippingWeightBracket) (float64, bool) {
	if len(brackets) != 1 {
		return 0, false
	}
	b := brackets[0]
	if b.MinKg == 0 && b.MaxKg <= 0 {
		return b.RatePerKg, true
	}
	return 0, false
}

// GenerateShippingPerKgTemplateXLSX lists every country with its current per-kg rate so the
// sheet can be edited and uploaded back as-is.
func GenerateShippingPerKgTemplateXLSX(db *gorm.DB) ([]byte, error) {
	current := map[string]struct {
		Rate     float64
		Currency string
	}{}
	if db != nil {
		var tpls []models.ShippingTemplate
		if err := db.Preload("WeightBrackets").Find(&tpls).Error; err == nil {
			for _, t := range tpls {
				if rate, ok := PerKgRateFor(t.WeightBrackets); ok {
					current[t.CountryCode] = struct {
						Rate     float64
						Currency string
					}{rate, t.Currency}
				}
			}
		}
	}

	f := excelize.NewFile()
	defer func() { _ = f.Close() }()
	sh := perKgSheetName
	if err := f.SetSheetName("Sheet1", sh); err != nil {
		return nil, err
	}

	headers := []string{"Country Code\n国家代码", "Country Name\n英文名称", "中文名称", "Rate per kg\n每公斤运费", "Currency\n币种"}
	for i, h := range headers {
		cell, _ := excelize.CoordinatesToCellName(i+1, 1)
		_ = f.SetCellValue(sh, cell, h)
	}

	countries := WorldCountryList()
	for i, c := range countries {
		row := i + 2
		_ = f.SetCellValue(sh, fmt.Sprintf("A%d", row), c.Code)
		_ = f.SetCellValue(sh, fmt.Sprintf("B%d", row), c.Name)
		_ = f.SetCellValue(sh, fmt.Sprintf("C%d", row), c.NameZh)
		cur := "USD"
		if v, ok := current[c.Code]; ok {
			_ = f.SetCellValue(sh, fmt.Sprintf("D%d", row), v.Rate)
			if strings.TrimSpace(v.Currency) != "" {
				cur = v.Currency
			}
		}
		_ = f.SetCellValue(sh, fmt.Sprintf("E%d", row), cur)
	}
	lastRow := len(countries) + 1

	border := []excelize.Border{
		{Type: "left", Color: "D9E2EC", Style: 1}, {Type: "right", Color: "D9E2EC", Style: 1},
		{Type: "top", Color: "D9E2EC", Style: 1}, {Type: "bottom", Color: "D9E2EC", Style: 1},
	}
	headerStyle, _ := f.NewStyle(&excelize.Style{
		Font:      &excelize.Font{Bold: true, Color: "FFFFFF"},
		Fill:      excelize.Fill{Type: "pattern", Color: []string{"0B3E75"}, Pattern: 1},
		Alignment: &excelize.Alignment{Horizontal: "center", Vertical: "center", WrapText: true},
		Border:    border,
	})
	rateHeaderStyle, _ := f.NewStyle(&excelize.Style{
		Font:      &excelize.Font{Bold: true, Color: "FFFFFF"},
		Fill:      excelize.Fill{Type: "pattern", Color: []string{"C46A2D"}, Pattern: 1},
		Alignment: &excelize.Alignment{Horizontal: "center", Vertical: "center", WrapText: true},
		Border:    border,
	})
	lockedStyle, _ := f.NewStyle(&excelize.Style{
		Fill:   excelize.Fill{Type: "pattern", Color: []string{"F3F6F9"}, Pattern: 1},
		Font:   &excelize.Font{Color: "334155"},
		Border: border,
	})
	inputStyle, _ := f.NewStyle(&excelize.Style{
		Fill:      excelize.Fill{Type: "pattern", Color: []string{"FFF7E6"}, Pattern: 1},
		Font:      &excelize.Font{Bold: true, Color: "0E1726"},
		NumFmt:    2,
		Alignment: &excelize.Alignment{Horizontal: "right"},
		Border:    border,
	})
	currencyStyle, _ := f.NewStyle(&excelize.Style{
		Alignment: &excelize.Alignment{Horizontal: "center"},
		Border:    border,
	})

	_ = f.SetCellStyle(sh, "A1", "E1", headerStyle)
	_ = f.SetCellStyle(sh, "D1", "D1", rateHeaderStyle)
	_ = f.SetCellStyle(sh, "A2", fmt.Sprintf("C%d", lastRow), lockedStyle)
	_ = f.SetCellStyle(sh, "D2", fmt.Sprintf("D%d", lastRow), inputStyle)
	_ = f.SetCellStyle(sh, "E2", fmt.Sprintf("E%d", lastRow), currencyStyle)
	_ = f.SetRowHeight(sh, 1, 34)
	_ = f.SetColWidth(sh, "A", "A", 14)
	_ = f.SetColWidth(sh, "B", "B", 30)
	_ = f.SetColWidth(sh, "C", "C", 18)
	_ = f.SetColWidth(sh, "D", "D", 18)
	_ = f.SetColWidth(sh, "E", "E", 12)
	_ = f.SetPanes(sh, &excelize.Panes{Freeze: true, Split: false, XSplit: 0, YSplit: 1, TopLeftCell: "A2", ActivePane: "bottomLeft"})
	_ = f.AutoFilter(sh, fmt.Sprintf("A1:E%d", lastRow), nil)

	dv := excelize.NewDataValidation(true)
	dv.Sqref = fmt.Sprintf("D2:D%d", lastRow)
	if err := dv.SetRange(0, 100000, excelize.DataValidationTypeDecimal, excelize.DataValidationOperatorBetween); err == nil {
		dv.SetError(excelize.DataValidationErrorStyleStop, "运费格式错误", "请输入大于等于 0 的数字，例如 8.5；不发货的国家留空即可。")
		dv.SetInput("每公斤运费", "填写该国家每公斤运费（数字）。留空 = 不导入该国家。")
		_ = f.AddDataValidation(sh, dv)
	}
	curDv := excelize.NewDataValidation(true)
	curDv.Sqref = fmt.Sprintf("E2:E%d", lastRow)
	if err := curDv.SetDropList([]string{"USD", "EUR", "GBP", "CNY", "JPY", "AUD", "CAD"}); err == nil {
		_ = f.AddDataValidation(sh, curDv)
	}

	guide := "说明 Guide"
	if _, err := f.NewSheet(guide); err == nil {
		lines := []string{
			"运费模板填写说明（每公斤单价模式）",
			"",
			"1. 只需要在橙色列「Rate per kg / 每公斤运费」填写数字，例如 8.5 表示每公斤 8.5（按 E 列币种）。",
			"2. 留空的国家不会被导入，也不会影响已有配置；想删除某国运费请在后台列表里删除。",
			"3. 计费规则：不足 21kg 按整公斤向上取整（例：2.3kg 按 3kg）；21kg 及以上按实际重量。",
			"4. 国家识别很宽松：A 列可写 ISO 二字码(US)、英文名(United States)或中文名(美国)，可以只保留你需要的行。",
			"5. 也可以上传你自己的表格：只要有一列国家、一列「每公斤运费 / Rate per kg / 单价」，表头在前 15 行内即可自动识别。",
			"6. 下载的模板会自动带出当前已配置的运费，修改后直接上传即可覆盖更新。",
			"7. 前台显示的国家名称统一使用英文，中文名称列只是方便你查找。",
			"",
			"Guide (rate-per-kg mode)",
			"Fill only the orange 'Rate per kg' column. Blank rows are ignored.",
			"Billing: below 21kg the weight is rounded up to a whole kg; from 21kg the actual weight is used.",
			"Countries can be given as ISO2 code, English name or Chinese name.",
		}
		for i, l := range lines {
			_ = f.SetCellValue(guide, fmt.Sprintf("A%d", i+1), l)
		}
		titleStyle, _ := f.NewStyle(&excelize.Style{Font: &excelize.Font{Bold: true, Size: 14, Color: "0B3E75"}})
		_ = f.SetCellStyle(guide, "A1", "A1", titleStyle)
		_ = f.SetCellStyle(guide, "A11", "A11", titleStyle)
		_ = f.SetColWidth(guide, "A", "A", 110)
	}

	f.SetActiveSheet(0)
	buf, err := f.WriteToBuffer()
	if err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

type perKgColumns struct {
	code, name, zh, rate, currency int
}

func detectPerKgHeader(row []string) (perKgColumns, bool) {
	cols := perKgColumns{-1, -1, -1, -1, -1}
	hasRange := false
	for i, h := range row {
		k := strings.ToLower(strings.Join(strings.Fields(h), ""))
		if k == "" {
			continue
		}
		switch {
		case strings.Contains(k, "currency") || strings.Contains(k, "币种") || strings.Contains(k, "货币"):
			cols.currency = i
		case strings.Contains(k, "perkg") || strings.Contains(k, "/kg") || strings.Contains(k, "每公斤") ||
			strings.Contains(k, "每kg") || strings.Contains(k, "单价") || strings.Contains(k, "rate") ||
			strings.Contains(k, "price") || strings.Contains(k, "运费"):
			if cols.rate == -1 {
				cols.rate = i
			}
		case strings.Contains(k, "code") || strings.Contains(k, "iso") || strings.Contains(k, "代码") || strings.Contains(k, "二字码"):
			cols.code = i
		case strings.Contains(k, "中文"):
			cols.zh = i
		case strings.Contains(k, "country") || strings.Contains(k, "国家") || strings.Contains(k, "地区") ||
			strings.Contains(k, "destination") || strings.Contains(k, "目的地") || k == "name" || strings.Contains(k, "英文"):
			cols.name = i
		case strings.Contains(k, "区间") || strings.Contains(k, "range") || strings.Contains(k, "重量") ||
			strings.Contains(k, "weight") || strings.HasPrefix(k, "min") || strings.HasPrefix(k, "max"):
			hasRange = true
		}
	}
	if hasRange || cols.rate == -1 || (cols.code == -1 && cols.name == -1 && cols.zh == -1) {
		return cols, false
	}
	return cols, true
}

func parsePerKgMoney(s string) (float64, error) {
	v := strings.TrimSpace(s)
	for _, cut := range []string{"USD", "usd", "US$", "$", "/kg", "/KG", "/Kg", "kg", "KG", "元", "¥", "￥"} {
		v = strings.ReplaceAll(v, cut, "")
	}
	return parseMoney(v)
}

func normalizePerKgCurrency(s string) string {
	v := strings.ToUpper(strings.TrimSpace(s))
	switch v {
	case "", "$", "US$", "美元":
		return "USD"
	case "¥", "￥", "RMB", "元", "人民币":
		return "CNY"
	case "€", "欧元":
		return "EUR"
	case "£", "英镑":
		return "GBP"
	}
	return v
}

// parsePerKgSheets scans every sheet for a "country + rate per kg" table. The header can sit
// anywhere in the first 15 rows and columns may be in any order.
func parsePerKgSheets(f *excelize.File) ([]weightRow, []string, bool) {
	skip := map[string]bool{"Under21Kg": true, "Over21Kg": true, "QuoteSurcharge": true, "WeightKg": true}
	found := false
	errs := []string{}
	byCode := map[string]weightRow{}
	order := []string{}

	for _, sheet := range f.GetSheetList() {
		if skip[sheet] {
			continue
		}
		rows, err := f.GetRows(sheet)
		if err != nil || len(rows) == 0 {
			continue
		}
		headerIdx := -1
		var cols perKgColumns
		for i := 0; i < len(rows) && i < 15; i++ {
			if c, ok := detectPerKgHeader(rows[i]); ok {
				headerIdx, cols = i, c
				break
			}
		}
		if headerIdx == -1 {
			continue
		}
		found = true

		for i := headerIdx + 1; i < len(rows); i++ {
			r := rows[i]
			get := func(idx int) string {
				if idx < 0 || idx >= len(r) {
					return ""
				}
				return strings.TrimSpace(r[idx])
			}
			rateCell := get(cols.rate)
			countryCells := []string{get(cols.code), get(cols.name), get(cols.zh)}
			anyCountry := false
			cc := ""
			for _, v := range countryCells {
				if v == "" {
					continue
				}
				anyCountry = true
				if cc = ResolveCountryCode(v); cc != "" {
					break
				}
			}
			if !anyCountry || rateCell == "" {
				continue
			}
			if cc == "" {
				errs = append(errs, fmt.Sprintf("%s 第 %d 行：无法识别国家「%s」", sheet, i+1, strings.Join(nonEmpty(countryCells), " / ")))
				continue
			}
			rate, e := parsePerKgMoney(rateCell)
			if e != nil {
				errs = append(errs, fmt.Sprintf("%s 第 %d 行（%s）：运费「%s」不是有效数字", sheet, i+1, cc, rateCell))
				continue
			}
			if rate < 0 {
				errs = append(errs, fmt.Sprintf("%s 第 %d 行（%s）：运费不能为负数", sheet, i+1, cc))
				continue
			}
			if rate == 0 {
				continue
			}
			if _, seen := byCode[cc]; !seen {
				order = append(order, cc)
			}
			byCode[cc] = weightRow{
				CountryCode: cc,
				CountryName: EnglishCountryName(cc, ""),
				MinKg:       0,
				MaxKg:       0,
				RatePerKg:   round3(rate),
				Currency:    normalizePerKgCurrency(get(cols.currency)),
			}
		}
	}

	out := make([]weightRow, 0, len(order))
	for _, cc := range order {
		out = append(out, byCode[cc])
	}
	return out, errs, found
}

func nonEmpty(values []string) []string {
	out := make([]string, 0, len(values))
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			out = append(out, v)
		}
	}
	return out
}

// UpsertCountryPerKgRate sets a single country to flat per-kg pricing, replacing its rules.
func UpsertCountryPerKgRate(db *gorm.DB, countryCode string, ratePerKg float64, currency string) (models.ShippingTemplate, error) {
	cc := ResolveCountryCode(countryCode)
	if cc == "" {
		return models.ShippingTemplate{}, errors.New("unknown country code")
	}
	if ratePerKg <= 0 {
		return models.ShippingTemplate{}, errors.New("rate_per_kg must be greater than 0")
	}
	cur := normalizePerKgCurrency(currency)
	var tpl models.ShippingTemplate
	err := db.Transaction(func(tx *gorm.DB) error {
		e := tx.Where("country_code = ?", cc).First(&tpl).Error
		if errors.Is(e, gorm.ErrRecordNotFound) {
			tpl = models.ShippingTemplate{CountryCode: cc, CountryName: EnglishCountryName(cc, ""), Currency: cur, IsActive: true}
			if ce := tx.Create(&tpl).Error; ce != nil {
				return ce
			}
		} else if e != nil {
			return e
		} else {
			tpl.CountryName = EnglishCountryName(cc, tpl.CountryName)
			tpl.Currency = cur
			tpl.IsActive = true
			if se := tx.Save(&tpl).Error; se != nil {
				return se
			}
		}
		if de := tx.Where("template_id = ?", tpl.ID).Delete(&models.ShippingWeightBracket{}).Error; de != nil {
			return de
		}
		if de := tx.Where("template_id = ?", tpl.ID).Delete(&models.ShippingQuoteSurcharge{}).Error; de != nil {
			return de
		}
		return tx.Create(&models.ShippingWeightBracket{TemplateID: tpl.ID, MinKg: 0, MaxKg: 0, RatePerKg: round3(ratePerKg)}).Error
	})
	return tpl, err
}
