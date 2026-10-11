package controllers

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"

	"fanuc-backend/models"
	"gorm.io/gorm"
)

// The same typed arguments are used at proposal and approval time. Never
// silently drop a category filter or coerce fractional/negative identifiers.
type aiCategoryProposalArguments struct {
	Scope                string `json:"scope"`
	CategoryID           uint   `json:"category_id"`
	IncludeDescendants   bool   `json:"include_descendants"`
	ProductIDs           []uint `json:"product_ids"`
	Brand                string `json:"brand"`
	Status               string `json:"status"`
	Limit                int    `json:"limit"`
	RepairContent        *bool  `json:"repair_content"`
	RewriteContent       *bool  `json:"rewrite_content"`
	ConfirmCatalogWide   bool   `json:"confirm_catalog_wide"`
	ProductCount         *int   `json:"product_count"`
	SelectionFingerprint string `json:"selection_fingerprint"`
}

func buildAICategoryOptimizationJobRequest(data map[string]any) (aiSEOCategoryJobRequest, error) {
	var args aiCategoryProposalArguments
	raw, err := json.Marshal(data)
	if err != nil {
		return aiSEOCategoryJobRequest{}, err
	}
	if err = json.Unmarshal(raw, &args); err != nil {
		return aiSEOCategoryJobRequest{}, errors.New("invalid task arguments: IDs/counts must be integers")
	}
	return categoryRequestFromProposal(args)
}

func categoryRequestFromProposal(args aiCategoryProposalArguments) (aiSEOCategoryJobRequest, error) {
	preserveStatus := false
	req := aiSEOCategoryJobRequest{
		Status: "all", IncludeInactive: true, ActivateResolved: &preserveStatus,
		Limit: args.Limit, RepairContent: args.RepairContent,
		RewriteContent:       optionalBool(args.RewriteContent, false),
		ExpectedProductCount: args.ProductCount, SelectionFingerprint: args.SelectionFingerprint,
		ConfirmCatalogWide: args.ConfirmCatalogWide,
	}
	if req.Limit < 0 {
		return req, errors.New("limit must be zero or positive")
	}
	if status := strings.ToLower(strings.TrimSpace(args.Status)); status != "" {
		switch status {
		case "all", "active", "inactive":
			req.Status = status
		default:
			return req, errors.New("status must be all, active or inactive")
		}
	}
	scope := strings.ToLower(strings.TrimSpace(args.Scope))
	if (args.CategoryID > 0 || args.IncludeDescendants) && scope != "category" {
		return req, errors.New("category_id requires scope=category; refusing to discard category filter")
	}
	if len(args.ProductIDs) > 0 && scope != "products" {
		return req, errors.New("product_ids requires scope=products")
	}
	if strings.TrimSpace(args.Brand) != "" && scope != "brand" {
		return req, errors.New("brand requires scope=brand; use category_id for a named category")
	}
	switch scope {
	case "category":
		if args.CategoryID == 0 {
			return req, errors.New("scope=category requires category_id from list_categories")
		}
		req.CategoryID, req.IncludeDescendants = args.CategoryID, args.IncludeDescendants
	case "uncategorized":
		req.UncategorizedOnly = true
	case "brand":
		req.Brand = truncateRunes(strings.TrimSpace(args.Brand), 100)
		if req.Brand == "" {
			return req, errors.New("scope=brand requires a brand")
		}
	case "rework":
		if !args.ConfirmCatalogWide {
			return req, errors.New("rework is a catalog-wide audit; use scope=category for a named category or explicitly confirm catalog-wide work")
		}
		req.ReworkOnly = true
	case "products":
		if len(args.ProductIDs) > aiAgentMaxJobProductIDs {
			return req, fmt.Errorf("at most %d product_ids per proposal", aiAgentMaxJobProductIDs)
		}
		for _, id := range args.ProductIDs {
			if id == 0 {
				return req, errors.New("product_ids must be positive")
			}
		}
		req.ProductIDs = uniqueProductIDs(args.ProductIDs)
		if len(req.ProductIDs) == 0 {
			return req, errors.New("scope=products requires product_ids")
		}
	default:
		return req, fmt.Errorf("unknown category task scope %q", scope)
	}
	if req.ExpectedProductCount != nil && *req.ExpectedProductCount <= 0 {
		return req, errors.New("proposal must preview at least one selectable product")
	}
	if req.SelectionFingerprint != "" {
		if decoded, err := hex.DecodeString(req.SelectionFingerprint); err != nil || len(decoded) != sha256.Size {
			return req, errors.New("invalid selection fingerprint; request a fresh preview")
		}
	}
	return req, nil
}

func requireCategoryProposalPreview(req aiSEOCategoryJobRequest) error {
	if req.ExpectedProductCount == nil || req.SelectionFingerprint == "" {
		return errors.New("旧提案没有锁定商品范围，已拒绝启动。请让 Agent 重新生成含分类和准确件数的提案 / A fresh scoped preview is required")
	}
	return nil
}

func categorySelectionFingerprint(products []aiSEOProductRef) string {
	ordered := append([]aiSEOProductRef(nil), products...)
	sort.Slice(ordered, func(i, j int) bool { return ordered[i].ID < ordered[j].ID })
	h := sha256.New()
	for _, p := range ordered {
		fmt.Fprintf(h, "%d:%s\n", p.ID, p.SKU)
	}
	return hex.EncodeToString(h.Sum(nil))
}

func verifyCategoryOptimizationPreview(req aiSEOCategoryJobRequest, products []aiSEOProductRef) error {
	if req.ExpectedProductCount != nil && len(products) != *req.ExpectedProductCount {
		return fmt.Errorf("商品范围已变化：审批 %d 件，当前可处理 %d 件。请重新预览 / Selection changed", *req.ExpectedProductCount, len(products))
	}
	if req.SelectionFingerprint != "" && categorySelectionFingerprint(products) != req.SelectionFingerprint {
		return errors.New("商品清单已变化，请重新生成提案 / Product selection changed; request a fresh preview")
	}
	return nil
}

func categoryJobScopeMetadata(db *gorm.DB, req aiSEOCategoryJobRequest, opts *aiSEOCategoryJobOptions, products []aiSEOProductRef) error {
	opts.Scope, opts.Status = "all", req.Status
	if opts.Status == "" {
		opts.Status = "active"
		if req.IncludeInactive {
			opts.Status = "all"
		}
	}
	opts.ProductCount, opts.SelectionFingerprint = len(products), categorySelectionFingerprint(products)
	opts.CategoryID, opts.IncludeDescendants, opts.Brand, opts.ReworkOnly = req.CategoryID, req.IncludeDescendants, req.Brand, req.ReworkOnly
	switch {
	case req.CategoryID > 0:
		var category models.Category
		if err := db.Select("id", "name").First(&category, req.CategoryID).Error; err != nil {
			return errors.New("source category no longer exists; refusing unscoped task")
		}
		opts.Scope, opts.CategoryName = "category", category.Name
	case len(req.ProductIDs) > 0:
		opts.Scope = "products"
	case req.UncategorizedOnly:
		opts.Scope = "uncategorized"
	case strings.TrimSpace(req.Brand) != "":
		opts.Scope = "brand"
	case req.ReworkOnly:
		opts.Scope = "rework"
	case req.Search != "" || req.Featured != "" || req.AISEOStatus != "":
		opts.Scope = "filtered"
	}
	return nil
}

func validateCategoryJobSelection(req aiSEOCategoryJobRequest) error {
	if req.Limit < 0 {
		return errors.New("limit must be zero or positive")
	}
	switch strings.ToLower(strings.TrimSpace(req.Status)) {
	case "", "all", "active", "inactive":
	default:
		return errors.New("invalid product publication status")
	}
	if req.IncludeDescendants && req.CategoryID == 0 {
		return errors.New("include_descendants requires category_id")
	}
	if req.CategoryID > 0 && req.UncategorizedOnly {
		return errors.New("category_id and uncategorized_only conflict")
	}
	for _, id := range req.ProductIDs {
		if id == 0 {
			return errors.New("product_ids must be positive; refusing to widen an empty selection")
		}
	}
	hasScope := req.CategoryID > 0 || len(req.ProductIDs) > 0 || req.UncategorizedOnly || strings.TrimSpace(req.Brand) != "" || strings.TrimSpace(req.Search) != ""
	if !hasScope && !req.ConfirmCatalogWide {
		return errors.New("未指定商品或分类范围，拒绝全站任务；全站处理必须显式确认 / Catalog-wide work requires explicit confirmation")
	}
	return nil
}

func categoryTaskUserRequest(message string) string {
	if i := strings.LastIndex(message, "USER_REQUEST:\n"); i >= 0 {
		message = message[i+len("USER_REQUEST:\n"):]
	}
	return strings.ToLower(strings.TrimSpace(message))
}

func explicitlyRequestsCatalogWideRework(message string) bool {
	message = categoryTaskUserRequest(message)
	for _, negative := range []string{"不要全站", "不是全站", "不要全量", "不需要全量", "不要所有", "not all products", "not the entire catalog", "do not rework all"} {
		if strings.Contains(message, negative) {
			return false
		}
	}
	for _, term := range []string{"全站", "整个网站", "整个商品库", "全量商品", "所有商品", "全部商品", "所有产品", "全部产品", "entire catalog", "whole catalog", "catalog-wide", "all products"} {
		if strings.Contains(message, term) {
			return true
		}
	}
	return false
}

// Only successful read tools establish the scope for this turn.
func observeAICategoryFilter(session *aiAgentToolSession, name, raw string) {
	if session == nil || (name != aiToolSearchProducts && name != aiToolCountProducts && name != aiToolSEOGapReport) {
		return
	}
	var args struct {
		CategoryID uint `json:"category_id"`
	}
	if json.Unmarshal([]byte(raw), &args) == nil && args.CategoryID > 0 {
		if session.categoryFilters == nil {
			session.categoryFilters = map[uint]bool{}
		}
		session.categoryFilters[args.CategoryID] = true
	}
}

func validateAICategoryTaskIntent(args aiCategoryProposalArguments, session *aiAgentToolSession) error {
	if session == nil {
		return errors.New("this tool needs an active assistant conversation")
	}
	scope := strings.ToLower(strings.TrimSpace(args.Scope))
	if len(session.categoryFilters) > 0 && scope != "category" && scope != "products" {
		return errors.New("本轮查询已限定分类，不能扩大到品牌/全站；请用 scope=category 和原 category_id / Do not broaden category scope")
	}
	if scope == "category" && !session.categoryFilters[args.CategoryID] {
		return errors.New("先用 count_products 按目标 category_id 核对范围，再创建同分类提案 / Count the requested category before proposing work")
	}
	if scope == "rework" && (!args.ConfirmCatalogWide || !explicitlyRequestsCatalogWideRework(session.userMessage)) {
		return errors.New("administrator did not explicitly request catalog-wide rework; use category scope")
	}
	return nil
}

func validateAICategoryProductSubset(db *gorm.DB, req aiSEOCategoryJobRequest, session *aiAgentToolSession) error {
	if len(req.ProductIDs) == 0 || session == nil || len(session.categoryFilters) == 0 {
		return nil
	}
	ids := make([]uint, 0, len(session.categoryFilters))
	for id := range session.categoryFilters {
		ids = append(ids, id)
	}
	var count int64
	if err := db.Model(&models.Product{}).Where("id IN ? AND category_id IN ?", req.ProductIDs, ids).Count(&count).Error; err != nil {
		return err
	}
	if count != int64(len(req.ProductIDs)) {
		return errors.New("selected products fall outside the category inspected in this conversation")
	}
	return nil
}
