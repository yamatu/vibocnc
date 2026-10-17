package services

import (
	"regexp"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"
)

// ProductListingRecord is one product in the fixed "Basic Information / SEO
// Basic Information" listing format used by the admin product form. It is the
// shared shape of pasted imports and AI listing optimization output.
type ProductListingRecord struct {
	Name             string   `json:"name"`
	SKU              string   `json:"sku"`
	Price            *float64 `json:"price,omitempty"`
	PriceText        string   `json:"price_text,omitempty"`
	CategoryText     string   `json:"category_text,omitempty"`
	StockQuantity    *int     `json:"stock_quantity,omitempty"`
	Brand            string   `json:"brand"`
	Model            string   `json:"model"`
	PartNumber       string   `json:"part_number"`
	WarrantyPeriod   string   `json:"warranty_period"`
	LeadTime         string   `json:"lead_time"`
	WeightKg         *float64 `json:"weight_kg,omitempty"`
	ShortDescription string   `json:"short_description"`
	Description      string   `json:"description"`
	MetaTitle        string   `json:"meta_title"`
	MetaDescription  string   `json:"meta_description"`
	MetaKeywords     string   `json:"meta_keywords"`
}

const (
	listingFieldName         = "name"
	listingFieldSKU          = "sku"
	listingFieldPrice        = "price"
	listingFieldCategory     = "category"
	listingFieldStock        = "stock_quantity"
	listingFieldBrand        = "brand"
	listingFieldModel        = "model"
	listingFieldPartNumber   = "part_number"
	listingFieldWarranty     = "warranty_period"
	listingFieldLeadTime     = "lead_time"
	listingFieldWeight       = "weight"
	listingFieldShort        = "short_description"
	listingFieldDescription  = "description"
	listingFieldMetaTitle    = "meta_title"
	listingFieldMetaDesc     = "meta_description"
	listingFieldMetaKeywords = "meta_keywords"
	listingFieldIgnore       = "_ignore"
)

var listingLabelAliases = map[string]string{
	"productname": listingFieldName, "name": listingFieldName, "producttitle": listingFieldName, "title": listingFieldName,
	"产品名称": listingFieldName, "商品名称": listingFieldName, "名称": listingFieldName, "产品标题": listingFieldName,
	"sku": listingFieldSKU, "货号": listingFieldSKU,
	"price": listingFieldPrice, "unitprice": listingFieldPrice, "价格": listingFieldPrice, "售价": listingFieldPrice,
	"category": listingFieldCategory, "categories": listingFieldCategory, "分类": listingFieldCategory, "产品分类": listingFieldCategory, "类目": listingFieldCategory,
	"stockquantity": listingFieldStock, "stock": listingFieldStock, "quantity": listingFieldStock, "qty": listingFieldStock,
	"库存": listingFieldStock, "库存数量": listingFieldStock,
	"brand": listingFieldBrand, "manufacturer": listingFieldBrand, "品牌": listingFieldBrand,
	"model": listingFieldModel, "modelnumber": listingFieldModel, "型号": listingFieldModel,
	"partnumber": listingFieldPartNumber, "partno": listingFieldPartNumber, "pn": listingFieldPartNumber, "mpn": listingFieldPartNumber,
	"零件号": listingFieldPartNumber, "料号": listingFieldPartNumber, "部件号": listingFieldPartNumber,
	"warrantyperiod": listingFieldWarranty, "warranty": listingFieldWarranty, "质保期": listingFieldWarranty, "保修期": listingFieldWarranty, "质保": listingFieldWarranty,
	"deliverytime": listingFieldLeadTime, "leadtime": listingFieldLeadTime, "delivery": listingFieldLeadTime,
	"交货期": listingFieldLeadTime, "交期": listingFieldLeadTime, "发货时间": listingFieldLeadTime,
	"weight": listingFieldWeight, "netweight": listingFieldWeight, "重量": listingFieldWeight, "净重": listingFieldWeight,
	"description": listingFieldDescription, "productdescription": listingFieldDescription, "longdescription": listingFieldDescription,
	"描述": listingFieldDescription, "产品描述": listingFieldDescription, "详情": listingFieldDescription,
	"shortdescription": listingFieldShort, "summary": listingFieldShort, "简介": listingFieldShort, "简短描述": listingFieldShort,
	"seotitle": listingFieldMetaTitle, "metatitle": listingFieldMetaTitle, "seo标题": listingFieldMetaTitle,
	"seodescription": listingFieldMetaDesc, "metadescription": listingFieldMetaDesc, "seo描述": listingFieldMetaDesc,
	"seokeywords": listingFieldMetaKeywords, "metakeywords": listingFieldMetaKeywords, "keywords": listingFieldMetaKeywords,
	"seo关键词": listingFieldMetaKeywords, "关键词": listingFieldMetaKeywords,
	"shippingpreview": listingFieldIgnore, "shipping": listingFieldIgnore, "运费预览": listingFieldIgnore, "运费": listingFieldIgnore,
}

var listingSectionHeaders = map[string]bool{
	"basicinformation": true, "seobasicinformation": true, "seoinformation": true, "seo": true,
	"基础信息": true, "基本信息": true, "seo基础信息": true, "seo信息": true,
}

var (
	listingLabelPattern     = regexp.MustCompile(`^\s*(?:[-*•#>]+\s*)*(?:\*\*)?\s*([^:：]{1,48}?)\s*(?:\*\*)?\s*[:：]\s*(?:\*\*)?\s*(.*)$`)
	listingSeparatorPattern = regexp.MustCompile(`^\s*[-=_*~]{3,}\s*$`)
	listingParenPattern     = regexp.MustCompile(`\s*[\(（][^\)）]*[\)）]`)
	listingNumberPattern    = regexp.MustCompile(`\d[\d,]*(?:\.\d+)?`)
	listingKgPattern        = regexp.MustCompile(`(?i)(\d+(?:\.\d+)?)\s*(?:[-–~]\s*\d+(?:\.\d+)?\s*)?(?:kg|kgs|kilograms?|公斤|千克)`)
	listingLbPattern        = regexp.MustCompile(`(?i)(\d+(?:\.\d+)?)\s*(?:[-–~]\s*\d+(?:\.\d+)?\s*)?(?:lbs?|pounds?)\b`)
	listingGramPattern      = regexp.MustCompile(`(?i)(\d+(?:\.\d+)?)\s*(?:g|grams?|克)\b`)
	// "/" only splits when surrounded by spaces so "I/O Modules" stays intact.
	listingCategorySplitPattern = regexp.MustCompile(`\s+/\s+|\s*(?:>|›|»|\|)\s*`)
)

var listingPlaceholderPhrases = []string{
	"to be confirmed", "check availability", "request a quote", "request quote", "on request", "contact us",
	"not available", "unknown", "待定", "待确认", "询价", "咨询", "未知",
}

func normalizeListingLabel(label string) string {
	label = listingParenPattern.ReplaceAllString(label, "")
	var builder strings.Builder
	for _, r := range strings.ToLower(label) {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			builder.WriteRune(r)
		}
	}
	return builder.String()
}

func isListingBoundaryLine(line string) bool {
	trimmed := strings.ToLower(strings.TrimSpace(line))
	if listingSeparatorPattern.MatchString(line) {
		return true
	}
	return strings.HasPrefix(trimmed, "here is") || strings.HasPrefix(trimmed, "here are") || strings.HasPrefix(trimmed, "以下是")
}

func isListingNoteLine(line string) bool {
	trimmed := strings.TrimSpace(line)
	if listingSectionHeaders[normalizeListingLabel(trimmed)] {
		return true
	}
	lower := strings.ToLower(trimmed)
	return strings.HasPrefix(lower, "(recommended") || strings.HasPrefix(trimmed, "（建议") || strings.HasPrefix(trimmed, "(建议")
}

type listingDraft struct {
	values map[string]string
	order  []string
}

func (draft *listingDraft) has(key string) bool {
	_, ok := draft.values[key]
	return ok
}

func (draft *listingDraft) empty() bool {
	for key, value := range draft.values {
		if key != listingFieldIgnore && strings.TrimSpace(value) != "" {
			return false
		}
	}
	return true
}

// ParseProductListingText splits pasted text into listing records. A new record
// starts at a separator line, an "Here is ..." intro line, or when the product
// name or SKU label appears a second time.
func ParseProductListingText(text string) []ProductListingRecord {
	text = strings.ReplaceAll(strings.ReplaceAll(text, "\r\n", "\n"), "\r", "\n")
	drafts := make([]*listingDraft, 0, 8)
	current := &listingDraft{values: map[string]string{}}
	currentKey := ""
	flush := func() {
		if !current.empty() {
			drafts = append(drafts, current)
		}
		current = &listingDraft{values: map[string]string{}}
		currentKey = ""
	}

	for _, line := range strings.Split(text, "\n") {
		if strings.TrimSpace(line) == "" {
			if currentKey == listingFieldDescription && current.values[currentKey] != "" {
				current.values[currentKey] += "\n"
			}
			continue
		}
		if isListingBoundaryLine(line) {
			flush()
			continue
		}
		if match := listingLabelPattern.FindStringSubmatch(line); match != nil {
			if key, ok := listingLabelAliases[normalizeListingLabel(match[1])]; ok {
				if (key == listingFieldName || key == listingFieldSKU) && current.has(key) {
					flush()
				}
				if !current.has(key) {
					current.order = append(current.order, key)
				}
				current.values[key] = strings.TrimSpace(strings.Trim(match[2], "*"))
				currentKey = key
				continue
			}
		}
		if isListingNoteLine(line) {
			currentKey = ""
			continue
		}
		if currentKey == "" || currentKey == listingFieldIgnore {
			continue
		}
		existing := current.values[currentKey]
		separator := " "
		if currentKey == listingFieldDescription {
			separator = "\n"
		}
		if strings.TrimSpace(existing) == "" {
			current.values[currentKey] = strings.TrimSpace(line)
		} else {
			current.values[currentKey] = strings.TrimRight(existing, " ") + separator + strings.TrimSpace(line)
		}
	}
	flush()

	records := make([]ProductListingRecord, 0, len(drafts))
	for _, draft := range drafts {
		record := listingRecordFromValues(draft.values)
		if record.SKU == "" && record.Name == "" {
			continue
		}
		records = append(records, record)
	}
	return records
}

func listingRecordFromValues(values map[string]string) ProductListingRecord {
	record := ProductListingRecord{
		Name:             truncateListingText(cleanListingInline(values[listingFieldName]), 255),
		SKU:              cleanListingIdentifier(values[listingFieldSKU]),
		PriceText:        strings.TrimSpace(values[listingFieldPrice]),
		CategoryText:     truncateListingText(cleanListingInline(values[listingFieldCategory]), 500),
		Brand:            truncateListingText(CanonicalBrandName(cleanListingShort(values[listingFieldBrand])), 100),
		Model:            cleanListingIdentifier(values[listingFieldModel]),
		PartNumber:       cleanListingIdentifier(values[listingFieldPartNumber]),
		WarrantyPeriod:   truncateListingText(cleanListingShort(values[listingFieldWarranty]), 50),
		LeadTime:         truncateListingText(cleanListingShort(values[listingFieldLeadTime]), 50),
		ShortDescription: truncateListingText(cleanListingInline(values[listingFieldShort]), 2000),
		Description:      truncateListingText(cleanListingDescription(values[listingFieldDescription]), 20000),
		MetaTitle:        truncateListingText(cleanListingInline(values[listingFieldMetaTitle]), 255),
		MetaDescription:  truncateListingText(cleanListingInline(values[listingFieldMetaDesc]), 1000),
		MetaKeywords:     truncateListingText(cleanListingInline(values[listingFieldMetaKeywords]), 1000),
	}
	record.Price = ParseListingPrice(values[listingFieldPrice])
	record.StockQuantity = parseListingStock(values[listingFieldStock])
	record.WeightKg = ParseListingWeightKg(values[listingFieldWeight])
	NormalizeListingRecord(&record)
	return record
}

// SanitizeListingRecord re-applies the parser's cleaning rules to a record that
// came from an AI answer or a browser round trip.
func SanitizeListingRecord(record *ProductListingRecord) {
	record.Name = truncateListingText(cleanListingInline(record.Name), 255)
	record.SKU = cleanListingIdentifier(record.SKU)
	record.CategoryText = truncateListingText(cleanListingInline(record.CategoryText), 500)
	record.Brand = truncateListingText(CanonicalBrandName(cleanListingShort(record.Brand)), 100)
	record.Model = cleanListingIdentifier(record.Model)
	record.PartNumber = cleanListingIdentifier(record.PartNumber)
	record.WarrantyPeriod = truncateListingText(cleanListingShort(record.WarrantyPeriod), 50)
	record.LeadTime = truncateListingText(cleanListingShort(record.LeadTime), 50)
	record.ShortDescription = truncateListingText(cleanListingInline(record.ShortDescription), 2000)
	record.Description = truncateListingText(cleanListingDescription(record.Description), 20000)
	record.MetaTitle = truncateListingText(cleanListingInline(record.MetaTitle), 255)
	record.MetaDescription = truncateListingText(cleanListingInline(record.MetaDescription), 1000)
	record.MetaKeywords = truncateListingText(cleanListingInline(record.MetaKeywords), 1000)
	if record.Price != nil && *record.Price < 0 {
		record.Price = nil
	}
	if record.StockQuantity != nil && *record.StockQuantity < 0 {
		record.StockQuantity = nil
	}
	if record.WeightKg != nil && (*record.WeightKg <= 0 || *record.WeightKg > 100000) {
		record.WeightKg = nil
	}
	NormalizeListingRecord(record)
}

// NormalizeListingRecord fills identity fields that the format leaves implicit
// and derives a short description from the long one.
func NormalizeListingRecord(record *ProductListingRecord) {
	if record.SKU == "" {
		record.SKU = firstListingValue(record.PartNumber, record.Model)
	}
	if record.PartNumber == "" {
		record.PartNumber = record.SKU
	}
	if record.Model == "" {
		record.Model = record.PartNumber
	}
	if record.ShortDescription == "" && record.Description != "" {
		record.ShortDescription = DeriveListingShortDescription(record.Description)
	}
}

func firstListingValue(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func isListingEmptyMarker(value string) bool {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "", "-", "--", "n/a", "na", "tbd", "tbc", "none", "null", "$", "无":
		return true
	}
	return false
}

// isListingPlaceholder is only applied to short commerce values; long copy may
// legitimately say "contact us" or "request a quote".
func isListingPlaceholder(value string) bool {
	if isListingEmptyMarker(value) {
		return true
	}
	lower := strings.ToLower(strings.TrimSpace(value))
	for _, phrase := range listingPlaceholderPhrases {
		if strings.Contains(lower, phrase) {
			return true
		}
	}
	return false
}

func cleanListingInline(value string) string {
	value = strings.Join(strings.Fields(strings.Trim(strings.TrimSpace(value), "*")), " ")
	if isListingEmptyMarker(value) {
		return ""
	}
	return value
}

func cleanListingShort(value string) string {
	value = cleanListingInline(listingParenPattern.ReplaceAllString(value, ""))
	if isListingPlaceholder(value) {
		return ""
	}
	return strings.TrimRight(value, " ;,.")
}

func cleanListingIdentifier(value string) string {
	value = cleanListingShort(value)
	if value == "" {
		return ""
	}
	if index := strings.Index(value, " / "); index > 0 {
		value = value[:index]
	}
	return truncateListingText(strings.TrimSpace(value), 100)
}

func cleanListingDescription(value string) string {
	lines := strings.Split(strings.TrimSpace(value), "\n")
	cleaned := make([]string, 0, len(lines))
	blank := false
	for _, line := range lines {
		line = strings.Join(strings.Fields(line), " ")
		if line == "" {
			if !blank && len(cleaned) > 0 {
				cleaned = append(cleaned, "")
			}
			blank = true
			continue
		}
		blank = false
		cleaned = append(cleaned, line)
	}
	return strings.TrimSpace(strings.Join(cleaned, "\n"))
}

// ParseListingPrice returns nil for quote-only prices such as "$ (Request a quote)".
func ParseListingPrice(value string) *float64 {
	match := listingNumberPattern.FindString(listingParenPattern.ReplaceAllString(value, ""))
	if match == "" {
		return nil
	}
	price, err := strconv.ParseFloat(strings.ReplaceAll(match, ",", ""), 64)
	if err != nil || price < 0 {
		return nil
	}
	return &price
}

func parseListingStock(value string) *int {
	if isListingPlaceholder(value) {
		return nil
	}
	match := listingNumberPattern.FindString(value)
	if match == "" {
		return nil
	}
	stock, err := strconv.Atoi(strings.ReplaceAll(strings.SplitN(match, ".", 2)[0], ",", ""))
	if err != nil || stock < 0 {
		return nil
	}
	return &stock
}

// ParseListingWeightKg reads the first net weight, e.g. "Approx. 3.66 kg (8.07 lbs) net".
func ParseListingWeightKg(value string) *float64 {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	parse := func(text string, factor float64) *float64 {
		number, err := strconv.ParseFloat(text, 64)
		if err != nil || number <= 0 {
			return nil
		}
		weight := float64(int(number*factor*1000+0.5)) / 1000
		return &weight
	}
	if match := listingKgPattern.FindStringSubmatch(value); match != nil {
		return parse(match[1], 1)
	}
	if match := listingLbPattern.FindStringSubmatch(value); match != nil {
		return parse(match[1], 0.45359237)
	}
	if match := listingGramPattern.FindStringSubmatch(value); match != nil {
		return parse(match[1], 0.001)
	}
	if match := listingNumberPattern.FindString(value); match != "" {
		return parse(strings.ReplaceAll(match, ",", ""), 1)
	}
	return nil
}

// DeriveListingShortDescription keeps whole sentences up to about 300 characters.
func DeriveListingShortDescription(description string) string {
	text := strings.Join(strings.Fields(description), " ")
	if utf8.RuneCountInString(text) <= 300 {
		return text
	}
	result := ""
	for _, sentence := range splitListingSentences(text) {
		next := strings.TrimSpace(result + " " + sentence)
		if utf8.RuneCountInString(next) > 300 {
			break
		}
		result = next
	}
	if result == "" {
		runes := []rune(text)
		result = strings.TrimSpace(string(runes[:297])) + "..."
	}
	return result
}

func splitListingSentences(text string) []string {
	sentences := make([]string, 0, 8)
	start := 0
	runes := []rune(text)
	for index, r := range runes {
		if r == '.' || r == '!' || r == '?' || r == '。' {
			if index+1 == len(runes) || runes[index+1] == ' ' {
				sentences = append(sentences, strings.TrimSpace(string(runes[start:index+1])))
				start = index + 1
			}
		}
	}
	if start < len(runes) {
		if tail := strings.TrimSpace(string(runes[start:])); tail != "" {
			sentences = append(sentences, tail)
		}
	}
	return sentences
}

func truncateListingText(value string, max int) string {
	runes := []rune(strings.TrimSpace(value))
	if len(runes) <= max {
		return string(runes)
	}
	return strings.TrimSpace(string(runes[:max]))
}

// SplitListingCategoryText turns "A / B > C" into trimmed path segments.
func SplitListingCategoryText(text string) []string {
	parts := listingCategorySplitPattern.Split(strings.TrimSpace(text), -1)
	segments := make([]string, 0, len(parts))
	for _, part := range parts {
		part = cleanListingInline(part)
		if part != "" {
			segments = append(segments, truncateListingText(part, 100))
		}
	}
	return segments
}

var genericListingCategoryKeys = map[string]bool{
	"industrialautomation": true, "industrialautomationparts": true, "automation": true,
	"sparepart": true, "spareparts": true, "parts": true, "products": true, "other": true, "others": true,
}

// FallbackListingCategoryPath builds [Brand, product line, product type] from a
// free-text category without AI: generic words are dropped, the first remaining
// segment is the brand product line and the last is the product type.
func FallbackListingCategoryPath(brand, categoryText string) []string {
	segments := make([]string, 0, 4)
	for _, segment := range SplitListingCategoryText(categoryText) {
		if genericListingCategoryKeys[CategoryNameKey(segment)] {
			continue
		}
		if brand != "" && CategoryNameKey(segment) == CategoryNameKey(brand) {
			continue
		}
		segments = append(segments, segment)
	}
	path := make([]string, 0, 3)
	if brand = strings.TrimSpace(brand); brand != "" {
		path = append(path, brand)
	}
	switch len(segments) {
	case 0:
	case 1:
		path = append(path, segments[0])
	default:
		path = append(path, segments[0], segments[len(segments)-1])
	}
	return path
}
