package controllers

import (
	"errors"
	"fmt"
	"gorm.io/gorm"
	"strings"
)

func aiToolRunStartCategoryOptimization(db *gorm.DB, rawArguments string, session *aiAgentToolSession) (any, error) {
	var args aiCategoryProposalArguments
	if err := decodeAIAgentToolArguments(rawArguments, &args); err != nil {
		return nil, err
	}
	args.Scope = strings.ToLower(strings.TrimSpace(args.Scope))
	args.ProductCount = nil
	args.SelectionFingerprint = ""
	req, err := categoryRequestFromProposal(args)
	if err != nil {
		return nil, err
	}
	if err = validateAICategoryTaskIntent(args, session); err != nil {
		return nil, err
	}
	if err = validateAICategoryProductSubset(db, req, session); err != nil {
		return nil, err
	}
	message := categoryTaskUserRequest(session.userMessage)
	if args.RepairContent == nil {
		repair := req.ReworkOnly
		for _, term := range []string{"seo", "标题", "描述", "内容", "title", "description", "content", "rewrite", "重写"} {
			repair = repair || strings.Contains(message, term)
		}
		req.RepairContent = &repair
	}
	if args.RewriteContent == nil {
		for _, term := range []string{"重写", "重新生成", "rewrite", "regenerate"} {
			req.RewriteContent = req.RewriteContent || strings.Contains(message, term)
		}
	}
	repair := optionalBool(req.RepairContent, false) || req.RewriteContent
	products, err := findCategoryOptimizationCandidates(db, req, repair)
	if err != nil {
		return nil, err
	}
	if len(products) == 0 {
		return nil, errors.New("指定范围没有可排队商品（可能被任务占用或已关闭自动优化）。请在 /admin/ai-seo 检查原任务，不要扩大范围 / No selectable products in this scope")
	}
	var metadata aiSEOCategoryJobOptions
	if err = categoryJobScopeMetadata(db, req, &metadata, products); err != nil {
		return nil, err
	}
	data := map[string]any{
		"scope": args.Scope, "limit": req.Limit, "status": req.Status, "product_count": len(products),
		"selection_fingerprint": metadata.SelectionFingerprint, "repair_content": repair,
		"rewrite_content": req.RewriteContent, "activate_resolved": false,
	}
	if req.CategoryID > 0 {
		data["category_id"] = req.CategoryID
		data["category_name"] = metadata.CategoryName
		data["include_descendants"] = req.IncludeDescendants
	}
	if req.Brand != "" {
		data["brand"] = req.Brand
	}
	if len(req.ProductIDs) > 0 {
		data["product_ids"] = req.ProductIDs
	}
	if req.ReworkOnly {
		data["confirm_catalog_wide"] = true
	}
	title := aiAgentCategoryJobProposalTitle(args.Scope, req.Brand, int64(len(products)))
	if req.CategoryID > 0 {
		title = fmt.Sprintf("优化分类「%s」(#%d)：%d 件商品", metadata.CategoryName, req.CategoryID, len(products))
	}
	if repair {
		title += "；标题、描述、SEO"
	}
	action := aiAction{Type: aiToolStartCategoryJob, Title: title, Data: data}
	if err = session.add(action); err != nil {
		return nil, err
	}
	return map[string]any{
		"status": "proposal_created", "proposal_type": action.Type, "scope": args.Scope,
		"category_id": req.CategoryID, "category_name": metadata.CategoryName, "product_count": len(products),
		"repair_content": repair, "rewrite_content": req.RewriteContent, "activate_resolved": false,
		"note": "A scoped review proposal is attached. Nothing has started. After approval one job classifies these exact products and, only if repair_content=true, writes their title, short description, description and SEO. Track /admin/ai-seo. Uncertain products retain original data for review. Publication status is preserved. Never claim all products were inspected from a sample or that suspicious identifiers are proven invalid. Do not repeat this proposal in suggestions.",
	}, nil
}

// Preview and execution must use exactly the same selector, including limits,
// disabled automation, job reservations and the classification audit.
func aiAgentCountCategoryJobCandidates(db *gorm.DB, req aiSEOCategoryJobRequest) (int64, error) {
	products, err := findCategoryOptimizationCandidates(db, req, optionalBool(req.RepairContent, req.ReworkOnly) || req.RewriteContent)
	return int64(len(products)), err
}
