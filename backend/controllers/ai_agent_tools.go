package controllers

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"fanuc-backend/models"

	"gorm.io/gorm"
)

// ---------------------------------------------------------------------------
// Read-only catalog tools for the AI assistant.
//
// The assistant used to receive one pre-fetched context blob: a single LIKE
// search built from the first >=4 character token of the administrator's
// message, capped at 80 products. Anything the guess missed was invisible to
// the model, so it answered from the wrong data or asked the administrator to
// paste records by hand.
//
// These tools let the model retrieve catalog facts itself, in a bounded
// read-only loop, before it proposes anything. Every tool is a SELECT; no tool
// can write to the database. Writes still only happen through the existing
// allow-listed Apply endpoint after a human confirms the proposal.
// ---------------------------------------------------------------------------

const (
	aiToolSearchProducts = "search_products"
	aiToolGetProduct     = "get_product"
	aiToolListCategories = "list_categories"
	aiToolCountProducts  = "count_products"
	aiToolSEOGapReport   = "seo_gap_report"

	aiToolDefaultLimit  = 20
	aiToolMaxLimit      = 50
	aiToolQueryMaxRunes = 120
)

type aiToolCallFunction struct {
	Name      string `json:"name"`
	Arguments string `json:"arguments"`
}

type aiToolCall struct {
	ID       string             `json:"id"`
	Type     string             `json:"type"`
	Function aiToolCallFunction `json:"function"`
}

type aiToolFunctionSchema struct {
	Name        string         `json:"name"`
	Description string         `json:"description"`
	Parameters  map[string]any `json:"parameters"`
}

type aiToolDefinition struct {
	Type     string               `json:"type"`
	Function aiToolFunctionSchema `json:"function"`
}

// aiToolTrace is returned to the admin UI so a proposal can be explained by the
// lookups that produced it.
type aiToolTrace struct {
	Tool   string `json:"tool"`
	Detail string `json:"detail"`
	Error  string `json:"error,omitempty"`
}

func objectSchema(properties map[string]any, required ...string) map[string]any {
	schema := map[string]any{
		"type":                 "object",
		"properties":           properties,
		"additionalProperties": false,
	}
	if len(required) > 0 {
		schema["required"] = required
	}
	return schema
}

// aiAgentToolDefinitions is the allow-list advertised to the provider. Only
// tools present here can ever be executed, and executeAIAgentTool re-checks the
// name, so an unknown or injected tool name is rejected instead of falling
// through to arbitrary behaviour.
func aiAgentToolDefinitions() []aiToolDefinition {
	return []aiToolDefinition{
		{
			Type: "function",
			Function: aiToolFunctionSchema{
				Name:        aiToolSearchProducts,
				Description: "Search the current catalogue and return matching products. Use this instead of guessing which products exist. Returns at most `limit` rows, newest first.",
				Parameters: objectSchema(map[string]any{
					"query":       map[string]any{"type": "string", "description": "Free text matched against SKU, name, description, part number and model."},
					"brand":       map[string]any{"type": "string", "description": "Exact brand name filter."},
					"category_id": map[string]any{"type": "integer", "description": "Restrict to one category id from list_categories."},
					"missing":     map[string]any{"type": "string", "enum": []string{"meta_title", "meta_description", "meta_keywords", "description"}, "description": "Return only products where this SEO field is empty."},
					"only_active": map[string]any{"type": "boolean", "description": "When true, skip inactive products. Defaults to false."},
					"limit":       map[string]any{"type": "integer", "minimum": 1, "maximum": aiToolMaxLimit},
					"offset":      map[string]any{"type": "integer", "minimum": 0},
				}),
			},
		},
		{
			Type: "function",
			Function: aiToolFunctionSchema{
				Name:        aiToolGetProduct,
				Description: "Read one product in full, including its saved translations. Identify it by product_id, or by an exact SKU / part number / model.",
				Parameters: objectSchema(map[string]any{
					"product_id": map[string]any{"type": "integer"},
					"identifier": map[string]any{"type": "string", "description": "Exact SKU, part number or model."},
				}),
			},
		},
		{
			Type: "function",
			Function: aiToolFunctionSchema{
				Name:        aiToolListCategories,
				Description: "List the category taxonomy with each category's path and product count. This is the only source of valid category ids.",
				Parameters: objectSchema(map[string]any{
					"parent_id":        map[string]any{"type": "integer", "description": "Only return children of this category."},
					"leaf_only":        map[string]any{"type": "boolean", "description": "Only return categories without active children."},
					"include_inactive": map[string]any{"type": "boolean", "description": "Include disabled categories. Defaults to false."},
				}),
			},
		},
		{
			Type: "function",
			Function: aiToolFunctionSchema{
				Name:        aiToolCountProducts,
				Description: "Count how many products match the same filters as search_products, without loading their rows.",
				Parameters: objectSchema(map[string]any{
					"query":       map[string]any{"type": "string"},
					"brand":       map[string]any{"type": "string"},
					"category_id": map[string]any{"type": "integer"},
					"missing":     map[string]any{"type": "string", "enum": []string{"meta_title", "meta_description", "meta_keywords", "description"}},
					"only_active": map[string]any{"type": "boolean"},
				}),
			},
		},
		{
			Type: "function",
			Function: aiToolFunctionSchema{
				Name:        aiToolSEOGapReport,
				Description: "Summarise catalogue SEO health with aggregate counts. Use it to answer 'what needs work' questions before proposing a batch.",
				Parameters: objectSchema(map[string]any{
					"brand":       map[string]any{"type": "string"},
					"category_id": map[string]any{"type": "integer"},
					"only_active": map[string]any{"type": "boolean"},
				}),
			},
		},
	}
}

func aiAgentToolNames() []string {
	definitions := aiAgentToolDefinitions()
	names := make([]string, 0, len(definitions))
	for _, definition := range definitions {
		names = append(names, definition.Function.Name)
	}
	return names
}

// aiAgentProductFilter is shared by search_products and count_products so the
// two tools can never disagree about which rows match.
type aiAgentProductFilter struct {
	Query      string `json:"query"`
	Brand      string `json:"brand"`
	CategoryID uint   `json:"category_id"`
	Missing    string `json:"missing"`
	OnlyActive *bool  `json:"only_active"`
}

// aiAgentMissingColumns maps the model-visible field name to the physical
// column. The key set mirrors the enum in the tool schema.
var aiAgentMissingColumns = map[string]string{
	"meta_title":       "meta_title",
	"meta_description": "meta_description",
	"meta_keywords":    "meta_keywords",
	"description":      "description",
}

func (f aiAgentProductFilter) apply(query *gorm.DB) (*gorm.DB, error) {
	if missing := strings.ToLower(strings.TrimSpace(f.Missing)); missing != "" {
		column, ok := aiAgentMissingColumns[missing]
		if !ok {
			return nil, fmt.Errorf("unknown missing field %q", f.Missing)
		}
		query = query.Where("TRIM(COALESCE(" + column + ", '')) = ''")
	}
	if brand := strings.TrimSpace(f.Brand); brand != "" {
		query = query.Where("brand = ?", truncateRunes(brand, 100))
	}
	if f.CategoryID > 0 {
		if err := aiAgentRequireCategory(query, f.CategoryID); err != nil {
			return nil, err
		}
		query = query.Where("category_id = ?", f.CategoryID)
	}
	if f.OnlyActive != nil && *f.OnlyActive {
		query = query.Where("is_active = ?", true)
	}
	return applyProductSearchFilter(query, truncateRunes(strings.TrimSpace(f.Query), aiToolQueryMaxRunes)), nil
}

// aiAgentRequireCategory rejects an invented category id before it can reach a
// WHERE clause. The assistant must call list_categories first.
func aiAgentRequireCategory(db *gorm.DB, categoryID uint) error {
	var count int64
	// NewDB drops any conditions already added to the caller's statement; the
	// product filters must never leak into the category existence check.
	if err := db.Session(&gorm.Session{NewDB: true}).Model(&models.Category{}).Where("id = ?", categoryID).Count(&count).Error; err != nil {
		return err
	}
	if count == 0 {
		return fmt.Errorf("category %d does not exist", categoryID)
	}
	return nil
}

func normalizeAIAgentLimit(limit int) int {
	if limit <= 0 {
		return aiToolDefaultLimit
	}
	if limit > aiToolMaxLimit {
		return aiToolMaxLimit
	}
	return limit
}

// aiAgentCategoryPathIndex resolves category names and paths for tool output.
// It reuses the cached taxonomy that automatic SEO jobs already load, and only
// falls back to the database for ids outside the active tree.
func aiAgentCategoryPathIndex(db *gorm.DB, ids []uint) (map[uint]string, error) {
	paths := map[uint]string{}
	references, _ := cachedAISEOCategoryReferences()
	for _, reference := range references {
		paths[reference.ID] = reference.Path
	}
	missing := make([]uint, 0, len(ids))
	seen := map[uint]bool{}
	for _, id := range ids {
		if id == 0 || seen[id] {
			continue
		}
		seen[id] = true
		if _, ok := paths[id]; !ok {
			missing = append(missing, id)
		}
	}
	if len(missing) == 0 {
		return paths, nil
	}
	var rows []models.Category
	if err := db.Model(&models.Category{}).Select("id", "name").Where("id IN ?", missing).Find(&rows).Error; err != nil {
		return nil, err
	}
	for _, row := range rows {
		paths[row.ID] = row.Name
	}
	return paths, nil
}

func executeAIAgentTool(db *gorm.DB, name, rawArguments string) (any, error) {
	if db == nil {
		return nil, errors.New("the catalogue database is unavailable")
	}
	switch name {
	case aiToolSearchProducts:
		return aiToolRunSearchProducts(db, rawArguments)
	case aiToolGetProduct:
		return aiToolRunGetProduct(db, rawArguments)
	case aiToolListCategories:
		return aiToolRunListCategories(db, rawArguments)
	case aiToolCountProducts:
		return aiToolRunCountProducts(db, rawArguments)
	case aiToolSEOGapReport:
		return aiToolRunSEOGapReport(db, rawArguments)
	default:
		return nil, fmt.Errorf("tool %q is not available", name)
	}
}

func decodeAIAgentToolArguments(raw string, target any) error {
	raw = strings.TrimSpace(raw)
	if raw == "" || raw == "{}" {
		return nil
	}
	if err := json.Unmarshal([]byte(raw), target); err != nil {
		return errors.New("arguments were not valid JSON")
	}
	return nil
}

func aiToolRunSearchProducts(db *gorm.DB, rawArguments string) (any, error) {
	var envelope struct {
		aiAgentProductFilter
		Limit  int `json:"limit"`
		Offset int `json:"offset"`
	}
	if err := decodeAIAgentToolArguments(rawArguments, &envelope); err != nil {
		return nil, err
	}
	args := envelope.aiAgentProductFilter
	limit := normalizeAIAgentLimit(envelope.Limit)
	offset := envelope.Offset
	if offset < 0 {
		offset = 0
	}
	// Request one extra row so has_more is definitive instead of a guess.
	query, err := args.apply(db.Model(&models.Product{}))
	if err != nil {
		return nil, err
	}
	var products []models.Product
	if err := query.
		Select("id", "sku", "name", "brand", "model", "part_number", "price", "category_id", "is_active", "meta_title", "meta_description", "meta_keywords", "short_description", "ai_seo_status").
		Order("id ASC").
		Limit(limit + 1).
		Offset(offset).
		Find(&products).Error; err != nil {
		return nil, err
	}
	hasMore := len(products) > limit
	if hasMore {
		products = products[:limit]
	}
	ids := make([]uint, 0, len(products))
	for _, product := range products {
		ids = append(ids, product.CategoryID)
	}
	paths, err := aiAgentCategoryPathIndex(db, ids)
	if err != nil {
		return nil, err
	}
	rows := make([]map[string]any, 0, len(products))
	for _, product := range products {
		rows = append(rows, map[string]any{
			"id": product.ID, "sku": product.SKU, "name": product.Name, "brand": product.Brand,
			"model": product.Model, "part_number": product.PartNumber, "price": product.Price,
			"is_active": product.IsActive, "ai_seo_status": product.AISEOStatus,
			"category_id": product.CategoryID, "category_path": paths[product.CategoryID],
			"has_meta_title":        strings.TrimSpace(product.MetaTitle) != "",
			"has_meta_description":  strings.TrimSpace(product.MetaDescription) != "",
			"has_meta_keywords":     strings.TrimSpace(product.MetaKeywords) != "",
			"has_short_description": strings.TrimSpace(product.ShortDescription) != "",
		})
	}
	return map[string]any{"returned": len(rows), "offset": offset, "has_more": hasMore, "products": rows}, nil
}

func aiToolRunCountProducts(db *gorm.DB, rawArguments string) (any, error) {
	var args aiAgentProductFilter
	if err := decodeAIAgentToolArguments(rawArguments, &args); err != nil {
		return nil, err
	}
	query, err := args.apply(db.Model(&models.Product{}))
	if err != nil {
		return nil, err
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, err
	}
	return map[string]any{"total": total}, nil
}

func aiToolRunGetProduct(db *gorm.DB, rawArguments string) (any, error) {
	var args struct {
		ProductID  uint   `json:"product_id"`
		Identifier string `json:"identifier"`
	}
	if err := decodeAIAgentToolArguments(rawArguments, &args); err != nil {
		return nil, err
	}
	query := db.Model(&models.Product{})
	switch {
	case args.ProductID > 0:
		query = query.Where("id = ?", args.ProductID)
	case strings.TrimSpace(args.Identifier) != "":
		identifier := truncateRunes(strings.TrimSpace(args.Identifier), 100)
		query = query.Where("sku = ? OR part_number = ? OR model = ?", identifier, identifier, identifier)
	default:
		return nil, errors.New("provide product_id or identifier")
	}
	var product models.Product
	if err := query.First(&product).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return map[string]any{"found": false}, nil
		}
		return nil, err
	}
	var translations []models.ProductTranslation
	if err := db.Model(&models.ProductTranslation{}).
		Select("language_code", "name", "meta_title", "meta_description").
		Where("product_id = ?", product.ID).
		Order("language_code ASC").
		Limit(30).
		Find(&translations).Error; err != nil {
		return nil, err
	}
	languageCodes := make([]string, 0, len(translations))
	for _, translation := range translations {
		languageCodes = append(languageCodes, translation.LanguageCode)
	}
	paths, err := aiAgentCategoryPathIndex(db, []uint{product.CategoryID})
	if err != nil {
		return nil, err
	}
	return map[string]any{"found": true, "product": map[string]any{
		"id": product.ID, "sku": product.SKU, "name": product.Name, "brand": product.Brand,
		"model": product.Model, "part_number": product.PartNumber, "price": product.Price,
		"is_active": product.IsActive, "ai_seo_status": product.AISEOStatus,
		"category_id": product.CategoryID, "category_path": paths[product.CategoryID],
		"meta_title": product.MetaTitle, "meta_description": product.MetaDescription,
		"meta_keywords":         product.MetaKeywords,
		"short_description":     truncateRunes(product.ShortDescription, 1200),
		"description":           truncateRunes(product.Description, 2000),
		"translation_languages": languageCodes,
	}}, nil
}

func aiToolRunListCategories(db *gorm.DB, rawArguments string) (any, error) {
	var args struct {
		ParentID        *uint `json:"parent_id"`
		LeafOnly        bool  `json:"leaf_only"`
		IncludeInactive bool  `json:"include_inactive"`
	}
	if err := decodeAIAgentToolArguments(rawArguments, &args); err != nil {
		return nil, err
	}
	// Read the whole taxonomy once. Path prefixes and "is this a leaf" both need
	// the full tree, and the table is small compared with the product catalogue.
	var all []models.Category
	if err := db.Model(&models.Category{}).
		Select("id", "name", "slug", "parent_id", "sort_order", "is_active").
		Order("parent_id ASC, sort_order ASC, name ASC").
		Find(&all).Error; err != nil {
		return nil, err
	}

	// A disabled parent hides its children from the prompt, matching the taxonomy
	// the administrator actually sees in the category tree. Leaf detection uses
	// the same visible set, so a category whose only children are disabled is
	// reported as a leaf rather than as an unusable parent.
	visible := func(category models.Category) bool {
		return args.IncludeInactive || category.IsActive
	}
	byID := make(map[uint]models.Category, len(all))
	hasVisibleChildren := map[uint]bool{}
	for _, category := range all {
		byID[category.ID] = category
	}
	for _, category := range all {
		if !visible(category) || category.ParentID == nil || *category.ParentID == 0 {
			continue
		}
		parent, ok := byID[*category.ParentID]
		if !ok || !visible(parent) {
			continue
		}
		hasVisibleChildren[*category.ParentID] = true
	}

	// Product counts come from one grouped query rather than one COUNT per
	// category, which would be a classic N+1 on a taxonomy of any size.
	type countRow struct {
		CategoryID uint
		Total      int64
	}
	var counts []countRow
	if err := db.Model(&models.Product{}).
		Select("category_id, COUNT(*) AS total").
		Group("category_id").
		Scan(&counts).Error; err != nil {
		return nil, err
	}
	countByCategory := make(map[uint]int64, len(counts))
	for _, row := range counts {
		countByCategory[row.CategoryID] = row.Total
	}

	rows := make([]map[string]any, 0, len(all))
	for _, category := range all {
		if !visible(category) {
			continue
		}
		if args.ParentID != nil {
			if category.ParentID == nil || *category.ParentID != *args.ParentID {
				continue
			}
		}
		isLeaf := !hasVisibleChildren[category.ID]
		if args.LeafOnly && !isLeaf {
			continue
		}
		rows = append(rows, map[string]any{
			"id": category.ID, "name": category.Name, "slug": category.Slug,
			"parent_id": category.ParentID, "path": aiAgentCategoryPath(category.ID, byID),
			"is_leaf": isLeaf, "is_active": category.IsActive,
			"product_count": countByCategory[category.ID],
		})
	}
	return map[string]any{"returned": len(rows), "categories": rows}, nil
}

// aiAgentCategoryPath renders "Parent > Child" for a category, guarding against
// a cyclic parent chain that a bad import could have created.
func aiAgentCategoryPath(id uint, byID map[uint]models.Category) string {
	category, ok := byID[id]
	if !ok {
		return ""
	}
	parts := []string{category.Name}
	visited := map[uint]bool{id: true}
	parentID := category.ParentID
	for parentID != nil && *parentID > 0 && !visited[*parentID] {
		parent, found := byID[*parentID]
		if !found {
			break
		}
		visited[parent.ID] = true
		parts = append([]string{parent.Name}, parts...)
		parentID = parent.ParentID
	}
	return strings.Join(parts, " > ")
}

type aiSEOProductGapRow struct {
	Scanned                int64 `gorm:"column:scanned"`
	MissingMetaTitle       int64 `gorm:"column:missing_meta_title"`
	MissingMetaDescription int64 `gorm:"column:missing_meta_description"`
	MissingMetaKeywords    int64 `gorm:"column:missing_meta_keywords"`
	MissingDescription     int64 `gorm:"column:missing_description"`
	MissingModel           int64 `gorm:"column:missing_model"`
	MissingBrand           int64 `gorm:"column:missing_brand"`
	MissingCategory        int64 `gorm:"column:missing_category"`
	NotOptimized           int64 `gorm:"column:not_optimized"`
	Inactive               int64 `gorm:"column:inactive"`
}

func aiToolRunSEOGapReport(db *gorm.DB, rawArguments string) (any, error) {
	var args struct {
		Brand      string `json:"brand"`
		CategoryID uint   `json:"category_id"`
		OnlyActive *bool  `json:"only_active"`
	}
	if err := decodeAIAgentToolArguments(rawArguments, &args); err != nil {
		return nil, err
	}
	// One aggregate pass instead of loading rows: the audit endpoint walks the
	// whole table in 1000-row batches, which is far too heavy for a chat turn.
	query := db.Model(&models.Product{})
	if brand := strings.TrimSpace(args.Brand); brand != "" {
		query = query.Where("brand = ?", truncateRunes(brand, 100))
	}
	if args.CategoryID > 0 {
		if err := aiAgentRequireCategory(db, args.CategoryID); err != nil {
			return nil, err
		}
		query = query.Where("category_id = ?", args.CategoryID)
	}
	if args.OnlyActive != nil && *args.OnlyActive {
		query = query.Where("is_active = ?", true)
	}
	var row aiSEOProductGapRow
	if err := query.Select(`COUNT(*) AS scanned,
		SUM(CASE WHEN TRIM(COALESCE(meta_title, '')) = '' THEN 1 ELSE 0 END) AS missing_meta_title,
		SUM(CASE WHEN TRIM(COALESCE(meta_description, '')) = '' THEN 1 ELSE 0 END) AS missing_meta_description,
		SUM(CASE WHEN TRIM(COALESCE(meta_keywords, '')) = '' THEN 1 ELSE 0 END) AS missing_meta_keywords,
		SUM(CASE WHEN TRIM(COALESCE(description, '')) = '' AND TRIM(COALESCE(short_description, '')) = '' THEN 1 ELSE 0 END) AS missing_description,
		SUM(CASE WHEN TRIM(COALESCE(model, '')) = '' THEN 1 ELSE 0 END) AS missing_model,
		SUM(CASE WHEN TRIM(COALESCE(brand, '')) = '' THEN 1 ELSE 0 END) AS missing_brand,
		SUM(CASE WHEN category_id = 0 THEN 1 ELSE 0 END) AS missing_category,
		SUM(CASE WHEN TRIM(COALESCE(ai_seo_status, '')) <> 'optimized' THEN 1 ELSE 0 END) AS not_optimized,
		SUM(CASE WHEN is_active = 0 THEN 1 ELSE 0 END) AS inactive`).Scan(&row).Error; err != nil {
		return nil, err
	}
	return map[string]any{
		"scanned": row.Scanned, "missing_meta_title": row.MissingMetaTitle,
		"missing_meta_description": row.MissingMetaDescription,
		"missing_meta_keywords":    row.MissingMetaKeywords,
		"missing_description":      row.MissingDescription,
		"missing_model":            row.MissingModel, "missing_brand": row.MissingBrand,
		"missing_category": row.MissingCategory, "not_optimized": row.NotOptimized,
		"inactive": row.Inactive,
		"note":     "Counts cover the whole catalogue with the applied filters, not a sample.",
	}, nil
}

// describeAIAgentToolCall renders a short Chinese/English-neutral label for the
// admin UI trace, without echoing raw arguments back into the page.
func describeAIAgentToolCall(call aiToolCall) string {
	detail := ""
	switch call.Function.Name {
	case aiToolSearchProducts:
		var args aiAgentProductFilter
		_ = json.Unmarshal([]byte(call.Function.Arguments), &args)
		detail = strings.TrimSpace(strings.Join(nonEmptyStrings(args.Query, args.Brand, args.Missing), " / "))
	case aiToolGetProduct:
		var args struct {
			ProductID  uint   `json:"product_id"`
			Identifier string `json:"identifier"`
		}
		_ = json.Unmarshal([]byte(call.Function.Arguments), &args)
		if args.ProductID > 0 {
			detail = fmt.Sprintf("#%d", args.ProductID)
		} else {
			detail = truncateRunes(strings.TrimSpace(args.Identifier), 60)
		}
	case aiToolCountProducts, aiToolSEOGapReport:
		detail = truncateRunes(strings.TrimSpace(call.Function.Arguments), 80)
	}
	return detail
}

func nonEmptyStrings(values ...string) []string {
	result := make([]string, 0, len(values))
	for _, value := range values {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			result = append(result, trimmed)
		}
	}
	return result
}
