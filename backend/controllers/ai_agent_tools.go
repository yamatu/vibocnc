package controllers

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"fanuc-backend/models"
	"fanuc-backend/services"

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

	// Write-capable tools. They never write themselves: each validates the
	// request and attaches a review proposal (an aiAction) that an
	// administrator applies from the admin UI.
	aiToolListUncategorized = "list_uncategorized_products"
	aiToolAssignCategory    = "assign_product_category"
	aiToolCreateCategory    = "create_category"
	aiToolStartCategoryJob  = "start_category_optimization"

	aiToolDefaultLimit  = 20
	aiToolMaxLimit      = 50
	aiToolQueryMaxRunes = 120

	// Per-answer caps for review proposals, so one turn cannot flood the
	// administrator with suggestions.
	aiAgentMaxPendingSuggestions = 30
	aiAgentMaxAssignProposals    = 20
	aiAgentMaxCreateProposals    = 5
	aiAgentMaxStartProposals     = 2
	// aiAgentMaxJobProductIDs bounds an explicit product scope for one
	// category optimization proposal.
	aiAgentMaxJobProductIDs = 500
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
		{
			Type: "function",
			Function: aiToolFunctionSchema{
				Name:        aiToolListUncategorized,
				Description: "List products that currently have no category (category_id = 0), optionally filtered by brand. Products already held by another queued or running task are excluded, so the count matches what a new category task would process; products held by a paused task are reported separately. Use this before proposing bulk category repairs.",
				Parameters: objectSchema(map[string]any{
					"brand":       map[string]any{"type": "string", "description": "Exact brand name filter."},
					"only_active": map[string]any{"type": "boolean", "description": "When true, skip inactive products. Defaults to false."},
					"limit":       map[string]any{"type": "integer", "minimum": 1, "maximum": aiToolMaxLimit},
					"offset":      map[string]any{"type": "integer", "minimum": 0},
				}),
			},
		},
		{
			Type: "function",
			Function: aiToolFunctionSchema{
				Name:        aiToolAssignCategory,
				Description: "Propose moving ONE product into an existing active leaf category. This does not write: it attaches a review proposal (assign_product_category) that the administrator applies from the UI. The target category must already exist; use create_category first when it does not.",
				Parameters: objectSchema(map[string]any{
					"product_id":  map[string]any{"type": "integer", "description": "Product id obtained from a read tool."},
					"category_id": map[string]any{"type": "integer", "description": "Active leaf category id obtained from list_categories."},
				}, "product_id", "category_id"),
			},
		},
		{
			Type: "function",
			Function: aiToolFunctionSchema{
				Name:        aiToolCreateCategory,
				Description: "Propose creating a new 'Brand > Product type' category node. Only brands on the verified brand list can pass; every other brand must go through start_category_optimization (web-verified) or the category admin page. Creating a product type outside the existing vocabulary additionally requires allow_new_types, which you may set only when the administrator explicitly asked for a new product type. This does not write: it attaches a review proposal (create_category) that the administrator applies from the UI.",
				Parameters: objectSchema(map[string]any{
					"brand":           map[string]any{"type": "string", "description": "Manufacturer brand, for example 'Schneider Electric'."},
					"product_type":    map[string]any{"type": "string", "description": "Specific product-type node name, for example 'Servo Drive'. Never a generic word like 'Spare Part'."},
					"allow_new_types": map[string]any{"type": "boolean", "description": "Set true ONLY when the administrator explicitly asked to allow a product type outside the existing vocabulary."},
				}, "brand", "product_type"),
			},
		},
		{
			Type: "function",
			Function: aiToolFunctionSchema{
				Name:        aiToolStartCategoryJob,
				Description: "Propose starting the background category optimization task. The task verifies products by brand/model plus web evidence, assigns the correct leaf category, creates missing categories after verification, and keeps unverifiable products for review. Scopes: 'uncategorized' (products with no category), 'brand' (all products of one brand), 'rework' (classification audit of misplaced/unresolved products), 'products' (explicit ids). This does not write: it attaches a review proposal (start_category_optimization) that the administrator starts from the UI.",
				Parameters: objectSchema(map[string]any{
					"scope":       map[string]any{"type": "string", "enum": []string{"uncategorized", "brand", "rework", "products"}},
					"product_ids": map[string]any{"type": "array", "items": map[string]any{"type": "integer"}, "description": "Required when scope=products. At most 500 ids."},
					"brand":       map[string]any{"type": "string", "description": "Required when scope=brand."},
					"limit":       map[string]any{"type": "integer", "minimum": 0, "description": "Maximum products to process; 0 or omitted = all matching products."},
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

// executeAIAgentTool runs one tool with no conversation session attached.
// Write tools need a session to collect their review proposals, so they refuse
// to run from here.
func executeAIAgentTool(db *gorm.DB, name, rawArguments string) (any, error) {
	return executeAIAgentToolWithSession(db, name, rawArguments, nil)
}

func executeAIAgentToolWithSession(db *gorm.DB, name, rawArguments string, session *aiAgentToolSession) (any, error) {
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
	case aiToolListUncategorized:
		return aiToolRunListUncategorizedProducts(db, rawArguments)
	case aiToolAssignCategory:
		return aiToolRunAssignProductCategory(db, rawArguments, session)
	case aiToolCreateCategory:
		return aiToolRunCreateCategory(db, rawArguments, session)
	case aiToolStartCategoryJob:
		return aiToolRunStartCategoryOptimization(db, rawArguments, session)
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
	// COUNT(CASE ...) rather than SUM(CASE ...) so an empty catalogue reports 0
	// instead of NULL, which the model would otherwise read as "unknown".
	if err := query.Select(`COUNT(*) AS scanned,
		COUNT(CASE WHEN TRIM(COALESCE(meta_title, '')) = '' THEN 1 END) AS missing_meta_title,
		COUNT(CASE WHEN TRIM(COALESCE(meta_description, '')) = '' THEN 1 END) AS missing_meta_description,
		COUNT(CASE WHEN TRIM(COALESCE(meta_keywords, '')) = '' THEN 1 END) AS missing_meta_keywords,
		COUNT(CASE WHEN TRIM(COALESCE(description, '')) = '' AND TRIM(COALESCE(short_description, '')) = '' THEN 1 END) AS missing_description,
		COUNT(CASE WHEN TRIM(COALESCE(model, '')) = '' THEN 1 END) AS missing_model,
		COUNT(CASE WHEN TRIM(COALESCE(brand, '')) = '' THEN 1 END) AS missing_brand,
		COUNT(CASE WHEN category_id = 0 THEN 1 END) AS missing_category,
		COUNT(CASE WHEN TRIM(COALESCE(ai_seo_status, '')) <> 'optimized' THEN 1 END) AS not_optimized,
		COUNT(CASE WHEN is_active = 0 THEN 1 END) AS inactive`).Scan(&row).Error; err != nil {
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
	case aiToolListUncategorized:
		var args struct {
			Brand string `json:"brand"`
		}
		_ = json.Unmarshal([]byte(call.Function.Arguments), &args)
		detail = strings.TrimSpace(args.Brand)
		if detail == "" {
			detail = "all brands"
		}
	case aiToolAssignCategory:
		var args struct {
			ProductID  uint `json:"product_id"`
			CategoryID uint `json:"category_id"`
		}
		_ = json.Unmarshal([]byte(call.Function.Arguments), &args)
		detail = fmt.Sprintf("#%d → #%d", args.ProductID, args.CategoryID)
	case aiToolCreateCategory:
		var args struct {
			Brand       string `json:"brand"`
			ProductType string `json:"product_type"`
		}
		_ = json.Unmarshal([]byte(call.Function.Arguments), &args)
		detail = strings.TrimSpace(strings.Join(nonEmptyStrings(args.Brand, args.ProductType), " > "))
	case aiToolStartCategoryJob:
		var args struct {
			Scope string `json:"scope"`
			Brand string `json:"brand"`
		}
		_ = json.Unmarshal([]byte(call.Function.Arguments), &args)
		detail = strings.TrimSpace(strings.Join(nonEmptyStrings(args.Scope, args.Brand), " / "))
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

// ---------------------------------------------------------------------------
// Write tools: review proposals only.
//
// The write tools never touch the database. Each validates its request
// against live data, then attaches a review proposal (an aiAction) to the
// current answer through the tool session. A proposal only becomes a write
// when an administrator applies it through the Apply endpoint, which
// re-validates everything inside its transaction.
// ---------------------------------------------------------------------------

// aiAgentToolSession collects the review proposals a conversation turn
// produces and enforces per-answer caps so a misbehaving model cannot flood
// the administrator with proposals.
type aiAgentToolSession struct {
	pending []aiAction
}

func (s *aiAgentToolSession) add(action aiAction) error {
	if s == nil {
		return errors.New("this tool needs an active assistant conversation")
	}
	if len(s.pending) >= aiAgentMaxPendingSuggestions {
		return fmt.Errorf("the per-answer proposal limit (%d) has been reached", aiAgentMaxPendingSuggestions)
	}
	limit := 0
	switch action.Type {
	case aiToolAssignCategory:
		limit = aiAgentMaxAssignProposals
	case aiToolCreateCategory:
		limit = aiAgentMaxCreateProposals
	case aiToolStartCategoryJob:
		limit = aiAgentMaxStartProposals
	}
	if limit > 0 {
		count := 0
		for _, existing := range s.pending {
			if existing.Type == action.Type {
				count++
			}
		}
		if count >= limit {
			return fmt.Errorf("at most %d %s proposals are allowed per answer", limit, action.Type)
		}
	}
	key := aiActionDedupeKey(action)
	for _, existing := range s.pending {
		if aiActionDedupeKey(existing) == key {
			return errors.New("this exact proposal already exists in the current answer")
		}
	}
	s.pending = append(s.pending, action)
	return nil
}

// aiActionDedupeKey renders a proposal to a stable key so duplicates (the
// model repeating a tool proposal in its own JSON, or calling a tool twice
// with the same arguments) collapse into one.
func aiActionDedupeKey(action aiAction) string {
	raw, err := json.Marshal(map[string]any{"type": action.Type, "data": action.Data})
	if err != nil {
		return action.Type
	}
	return string(raw)
}

// mergeAIAgentPendingSuggestions prepends the tool-generated proposals to the
// model-authored ones. Tool proposals come first so the answer cap can never
// truncate an action the tools already validated.
func mergeAIAgentPendingSuggestions(pending, modelAuthored []aiAction) []aiAction {
	if len(pending) == 0 {
		return modelAuthored
	}
	out := make([]aiAction, 0, len(pending)+len(modelAuthored))
	seen := map[string]bool{}
	add := func(action aiAction) {
		key := aiActionDedupeKey(action)
		if seen[key] {
			return
		}
		seen[key] = true
		out = append(out, action)
	}
	for _, action := range pending {
		add(action)
	}
	for _, action := range modelAuthored {
		add(action)
	}
	return out
}

func aiAgentProductLabel(product models.Product) string {
	if sku := strings.TrimSpace(product.SKU); sku != "" {
		return sku
	}
	return fmt.Sprintf("#%d", product.ID)
}

func aiAgentCategoryPathFor(db *gorm.DB, category models.Category) string {
	paths, err := aiAgentCategoryPathIndex(db, []uint{category.ID})
	if err == nil {
		if path := strings.TrimSpace(paths[category.ID]); path != "" {
			return path
		}
	}
	return category.Name
}

// aiAgentPausedHeldUncategorized reports how many uncategorized products are
// currently held by paused category tasks, plus the largest task id. The
// administrator can resume that task instead of starting a competing one.
func aiAgentPausedHeldUncategorized(db *gorm.DB) (string, int64) {
	type row struct {
		JobID string `gorm:"column:job_id"`
		N     int64  `gorm:"column:n"`
	}
	var result row
	err := db.Model(&models.AIAgentSEOJobItem{}).
		Select("ai_agent_seo_job_items.job_id AS job_id, COUNT(*) AS n").
		Joins("JOIN ai_agent_seo_jobs ON ai_agent_seo_jobs.id = ai_agent_seo_job_items.job_id").
		Where("ai_agent_seo_job_items.status = ? AND ai_agent_seo_jobs.status = ?", "queued", "paused").
		Where("ai_agent_seo_job_items.product_id IN (?)",
			db.Model(&models.Product{}).Select("id").Where("products.category_id = 0 AND products.disable_auto_seo = ?", false)).
		Group("ai_agent_seo_job_items.job_id").
		Order("n DESC").
		Limit(1).
		Scan(&result).Error
	if err != nil || result.N == 0 {
		return "", 0
	}
	return result.JobID, result.N
}

// aiAgentCountCategoryJobCandidates previews how many products a category
// task request would select. It mirrors findCategoryOptimizationCandidates so
// the number on the proposal card matches what the task actually processes.
func aiAgentCountCategoryJobCandidates(db *gorm.DB, req aiSEOCategoryJobRequest) (int64, error) {
	query := db.Model(&models.Product{}).Where("products.disable_auto_seo = ?", false)
	query = applyCategoryOptimizationProductStatus(query, req.Status, req.IncludeInactive)
	if brand := strings.TrimSpace(req.Brand); brand != "" {
		query = query.Where("LOWER(products.brand) = LOWER(?)", truncateRunes(brand, 100))
	}
	if req.UncategorizedOnly {
		query = query.Where("products.category_id = 0")
	}
	if len(req.ProductIDs) > 0 {
		query = query.Where("products.id IN ?", req.ProductIDs)
	}
	pendingIDs := db.Model(&models.AIAgentSEOJobItem{}).
		Select("product_id").
		Where("status IN ?", []string{"queued", "running"})
	query = query.Where("products.id NOT IN (?)", pendingIDs)
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return 0, err
	}
	return total, nil
}

func aiToolRunListUncategorizedProducts(db *gorm.DB, rawArguments string) (any, error) {
	var args struct {
		Brand      string `json:"brand"`
		OnlyActive *bool  `json:"only_active"`
		Limit      int    `json:"limit"`
		Offset     int    `json:"offset"`
	}
	if err := decodeAIAgentToolArguments(rawArguments, &args); err != nil {
		return nil, err
	}
	buildQuery := func() *gorm.DB {
		query := db.Model(&models.Product{}).
			Where("products.category_id = 0").
			Where("products.disable_auto_seo = ?", false)
		if brand := strings.TrimSpace(args.Brand); brand != "" {
			query = query.Where("LOWER(products.brand) = LOWER(?)", truncateRunes(brand, 100))
		}
		if args.OnlyActive != nil && *args.OnlyActive {
			query = query.Where("products.is_active = ?", true)
		}
		pendingIDs := db.Model(&models.AIAgentSEOJobItem{}).
			Select("product_id").
			Where("status IN ?", []string{"queued", "running"})
		return query.Where("products.id NOT IN (?)", pendingIDs)
	}
	var total int64
	if err := buildQuery().Count(&total).Error; err != nil {
		return nil, err
	}
	limit := normalizeAIAgentLimit(args.Limit)
	offset := args.Offset
	if offset < 0 {
		offset = 0
	}
	var products []models.Product
	if err := buildQuery().
		Select("id", "sku", "name", "brand", "model", "is_active").
		Order("products.id ASC").
		Limit(limit).
		Offset(offset).
		Find(&products).Error; err != nil {
		return nil, err
	}
	rows := make([]map[string]any, 0, len(products))
	for _, product := range products {
		rows = append(rows, map[string]any{
			"id": product.ID, "sku": product.SKU, "name": product.Name,
			"brand": product.Brand, "model": product.Model, "is_active": product.IsActive,
		})
	}
	payload := map[string]any{
		"total":    total,
		"returned": len(rows),
		"offset":   offset,
		"has_more": int64(offset+len(rows)) < total,
		"products": rows,
		"note":     "These products have no category and can be queued now. Propose start_category_optimization to classify them in the background (missing categories are created after verification); use assign_product_category only for a specific manual move.",
	}
	if jobID, held := aiAgentPausedHeldUncategorized(db); held > 0 {
		payload["paused_task"] = map[string]any{
			"job_id":             jobID,
			"held_uncategorized": held,
			"note":               "These uncategorized products are held by a paused category task and are NOT included in the total above. Suggest resuming that task from the AI SEO jobs page to keep processing that batch; a new task can only cover the remaining products.",
		}
	}
	return payload, nil
}

func aiToolRunAssignProductCategory(db *gorm.DB, rawArguments string, session *aiAgentToolSession) (any, error) {
	var args struct {
		ProductID  uint `json:"product_id"`
		CategoryID uint `json:"category_id"`
	}
	if err := decodeAIAgentToolArguments(rawArguments, &args); err != nil {
		return nil, err
	}
	if args.ProductID == 0 || args.CategoryID == 0 {
		return nil, errors.New("product_id and category_id are required")
	}
	var product models.Product
	if err := db.Select("id", "sku", "name", "brand", "model", "part_number", "category_id").
		First(&product, args.ProductID).Error; err != nil || product.ID == 0 {
		if err == nil || errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, fmt.Errorf("product %d was not found", args.ProductID)
		}
		return nil, err
	}
	var category models.Category
	if err := db.Select("id", "name", "slug", "parent_id", "is_active").
		First(&category, args.CategoryID).Error; err != nil || category.ID == 0 {
		if err == nil || errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, fmt.Errorf("category %d was not found", args.CategoryID)
		}
		return nil, err
	}
	if !category.IsActive {
		return nil, fmt.Errorf("category %d is inactive", category.ID)
	}
	var childCount int64
	if err := db.Model(&models.Category{}).
		Where("parent_id = ? AND is_active = ?", category.ID, true).
		Count(&childCount).Error; err != nil {
		return nil, err
	}
	if childCount > 0 {
		return nil, fmt.Errorf("category %d is a parent category; choose an active leaf", category.ID)
	}
	if product.CategoryID == category.ID {
		return nil, fmt.Errorf("product %s already belongs to category %d", aiAgentProductLabel(product), category.ID)
	}
	path := aiAgentCategoryPathFor(db, category)
	action := aiAction{
		Type:  aiToolAssignCategory,
		Title: fmt.Sprintf("将商品 %s 归入分类「%s」", aiAgentProductLabel(product), path),
		Data: map[string]any{
			"product_id":    product.ID,
			"category_id":   category.ID,
			"product_sku":   product.SKU,
			"category_path": path,
		},
	}
	if err := session.add(action); err != nil {
		return nil, err
	}
	return map[string]any{
		"status":        "proposal_created",
		"proposal_type": action.Type,
		"product_sku":   product.SKU,
		"category_path": path,
		"note":          "A review proposal is attached to this answer; the administrator applies it from the UI. Do not repeat it in your own suggestions array.",
	}, nil
}

func aiToolRunCreateCategory(db *gorm.DB, rawArguments string, session *aiAgentToolSession) (any, error) {
	var args struct {
		Brand         string `json:"brand"`
		ProductType   string `json:"product_type"`
		AllowNewTypes bool   `json:"allow_new_types"`
	}
	if err := decodeAIAgentToolArguments(rawArguments, &args); err != nil {
		return nil, err
	}
	inference, err := services.BuildAdministratorCategoryInference(args.Brand, args.ProductType)
	if err != nil {
		return nil, err
	}
	knownType := services.IsKnownProductTypeName(db, inference.PartType)
	if !knownType && !args.AllowNewTypes {
		return nil, fmt.Errorf("product type %q is not part of the existing category vocabulary; call again with allow_new_types=true only if the administrator explicitly asked for a new product type", inference.PartType)
	}
	if existingID, resolveErr := services.ResolveExistingCategoryForInference(db, inference, ""); resolveErr == nil && existingID > 0 {
		path := aiAgentCategoryPathFor(db, models.Category{ID: existingID, Name: inference.PartType})
		return map[string]any{
			"status":        "category_exists",
			"category_id":   existingID,
			"category_path": path,
			"note":          "An active leaf already covers this brand and type; use assign_product_category with this id instead of creating a category.",
		}, nil
	}
	title := fmt.Sprintf("创建分类「%s > %s」", inference.BrandName, inference.PartType)
	if !knownType {
		title = fmt.Sprintf("创建分类「%s > %s」（新类型，将公开）", inference.BrandName, inference.PartType)
	}
	action := aiAction{
		Type:  aiToolCreateCategory,
		Title: title,
		Data: map[string]any{
			"brand":                   inference.BrandName,
			"brand_key":               inference.BrandKey,
			"product_type":            inference.PartType,
			"new_type":                !knownType,
			"allow_new_product_types": !knownType && args.AllowNewTypes,
		},
	}
	if err := session.add(action); err != nil {
		return nil, err
	}
	return map[string]any{
		"status":        "proposal_created",
		"proposal_type": action.Type,
		"brand":         inference.BrandName,
		"product_type":  inference.PartType,
		"new_type":      !knownType,
		"note":          "A review proposal is attached; the category is created only after the administrator applies it. Do not repeat it in your own suggestions.",
	}, nil
}

func aiToolRunStartCategoryOptimization(db *gorm.DB, rawArguments string, session *aiAgentToolSession) (any, error) {
	var args struct {
		Scope      string `json:"scope"`
		ProductIDs []uint `json:"product_ids"`
		Brand      string `json:"brand"`
		Limit      *int   `json:"limit"`
	}
	if err := decodeAIAgentToolArguments(rawArguments, &args); err != nil {
		return nil, err
	}
	scope := strings.ToLower(strings.TrimSpace(args.Scope))
	if scope == "" {
		scope = "uncategorized"
	}
	brand := truncateRunes(strings.TrimSpace(args.Brand), 100)
	ids := args.ProductIDs
	if len(ids) > aiAgentMaxJobProductIDs {
		return nil, fmt.Errorf("at most %d product_ids can be queued from one message", aiAgentMaxJobProductIDs)
	}
	switch scope {
	case "uncategorized", "rework":
	case "brand":
		if brand == "" {
			return nil, errors.New("scope=brand requires a brand")
		}
	case "products":
		if len(ids) == 0 {
			return nil, errors.New("scope=products requires product_ids")
		}
	default:
		return nil, fmt.Errorf("unknown scope %q; use uncategorized, brand, rework or products", scope)
	}
	limit := 0
	if args.Limit != nil {
		limit = *args.Limit
		if limit < 0 {
			return nil, errors.New("limit must be zero (all matching products) or a positive count")
		}
	}
	// Preview how many products the task would process, so the administrator
	// sees a concrete number on the proposal card. The rework scope is
	// resolved by the classification audit inside the task itself, so it is
	// not pre-counted here.
	count := int64(-1)
	if scope != "rework" {
		preview := aiSEOCategoryJobRequest{
			Status:          "all",
			IncludeInactive: true,
			Brand:           brand,
		}
		if scope == "uncategorized" {
			preview.UncategorizedOnly = true
		}
		if scope == "products" {
			preview.ProductIDs = ids
		}
		total, countErr := aiAgentCountCategoryJobCandidates(db, preview)
		if countErr != nil {
			return nil, countErr
		}
		count = total
		if count == 0 {
			if jobID, held := aiAgentPausedHeldUncategorized(db); scope == "uncategorized" && held > 0 {
				return nil, fmt.Errorf("no uncategorized products are currently selectable: %d of them are held by paused task %s, which the administrator can resume from the AI SEO jobs page", held, jobID)
			}
			return nil, errors.New("no products currently match this scope (they may already belong to a running task)")
		}
	}
	data := map[string]any{
		"scope":         scope,
		"limit":         limit,
		"product_count": count,
	}
	if brand != "" {
		data["brand"] = brand
	}
	if len(ids) > 0 {
		data["product_ids"] = ids
	}
	action := aiAction{
		Type:  aiToolStartCategoryJob,
		Title: aiAgentCategoryJobProposalTitle(scope, brand, count),
		Data:  data,
	}
	if err := session.add(action); err != nil {
		return nil, err
	}
	note := "A review proposal is attached; the task starts after the administrator confirms it. It verifies brand/type with web evidence, assigns categories and creates missing ones. Do not repeat it in your own suggestions."
	if jobID, held := aiAgentPausedHeldUncategorized(db); scope == "uncategorized" && held > 0 {
		note = fmt.Sprintf("%s Note: %d uncategorized products are held by paused task %s; suggest resuming it from the AI SEO jobs page to keep processing that batch.", note, held, jobID)
	}
	return map[string]any{
		"status":        "proposal_created",
		"proposal_type": action.Type,
		"scope":         scope,
		"product_count": count,
		"note":          note,
	}, nil
}

func aiAgentCategoryJobProposalTitle(scope, brand string, count int64) string {
	switch scope {
	case "uncategorized":
		if count >= 0 {
			return fmt.Sprintf("启动分类优化任务：全部未分类商品（%d 个，缺失分类自动创建）", count)
		}
		return "启动分类优化任务：全部未分类商品"
	case "brand":
		return fmt.Sprintf("启动分类优化任务：品牌「%s」（%d 个商品）", brand, count)
	case "rework":
		return "启动分类返工任务：按分类审计处理待返修商品"
	case "products":
		return fmt.Sprintf("启动分类优化任务：指定商品（%d 个）", count)
	}
	return "启动分类优化任务"
}
