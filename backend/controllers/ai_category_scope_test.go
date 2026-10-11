package controllers

import (
	"strings"
	"testing"
)

func TestCategoryScopeRejectsWideningAndInvalidIdentifiers(t *testing.T) {
	for _, raw := range []string{
		`{"scope":"rework","category_id":2813,"confirm_catalog_wide":true}`,
		`{"scope":"brand","brand":"Unbranded","category_id":2813}`,
		`{"scope":"category"}`,
		`{"scope":"category","category_id":2813.5}`,
		`{"scope":"category","category_id":-1}`,
		`{"scope":"products","product_ids":[0]}`,
		`{"scope":"rework"}`,
		`{"scope":"category","category_id":2813,"limit":-1}`,
	} {
		var args aiCategoryProposalArguments
		err := decodeAIAgentToolArguments(raw, &args)
		if err == nil { _, err = categoryRequestFromProposal(args) }
		if err == nil { t.Fatalf("unsafe scope accepted: %s", raw) }
	}
}

func TestCategoryScopePreservesPublicationAndRewrite(t *testing.T) {
	on := true
	req, err := categoryRequestFromProposal(aiCategoryProposalArguments{Scope: "category", CategoryID: 2813, RepairContent: &on, RewriteContent: &on})
	if err != nil { t.Fatal(err) }
	if req.CategoryID != 2813 || req.ReworkOnly || req.UncategorizedOnly || req.IncludeDescendants || req.Status != "all" || !req.RewriteContent || !optionalBool(req.RepairContent, false) || optionalBool(req.ActivateResolved, true) {
		t.Fatalf("scope/publication contract lost: %+v", req)
	}
	if requireCategoryProposalPreview(req) == nil { t.Fatal("legacy preview-less action accepted") }
}

func TestCategoryPreviewRejectsCountAndSameCountMembershipDrift(t *testing.T) {
	original := []aiSEOProductRef{{ID: 1, SKU: "MODEL-1"}, {ID: 2, SKU: "MODEL-2"}}
	count := len(original)
	req := aiSEOCategoryJobRequest{ExpectedProductCount: &count, SelectionFingerprint: categorySelectionFingerprint(original)}
	if err := verifyCategoryOptimizationPreview(req, original); err != nil { t.Fatal(err) }
	if err := verifyCategoryOptimizationPreview(req, []aiSEOProductRef{original[1], original[0]}); err != nil { t.Fatal("order must not matter", err) }
	if verifyCategoryOptimizationPreview(req, original[:1]) == nil { t.Fatal("count drift accepted") }
	if verifyCategoryOptimizationPreview(req, []aiSEOProductRef{original[0], {ID: 3, SKU: "MODEL-3"}}) == nil { t.Fatal("same-count membership drift accepted") }
}

func TestCategoryIntentNeverBroadensObservedCategory(t *testing.T) {
	session := &aiAgentToolSession{userMessage: "Unbranded 分类里的商品重新分类、标题重写、描述重写、SEO 优化"}
	observeAICategoryFilter(session, aiToolCountProducts, `{"category_id":2813}`)
	for _, args := range []aiCategoryProposalArguments{
		{Scope: "rework", ConfirmCatalogWide: true},
		{Scope: "brand", Brand: "Unbranded"},
		{Scope: "category", CategoryID: 42},
		{Scope: "uncategorized"},
	} {
		if validateAICategoryTaskIntent(args, session) == nil { t.Fatalf("scope widening accepted: %+v", args) }
	}
	if err := validateAICategoryTaskIntent(aiCategoryProposalArguments{Scope: "category", CategoryID: 2813}, session); err != nil { t.Fatal(err) }
	if explicitlyRequestsCatalogWideRework("不要全站，只处理 Unbranded 分类里的所有产品") { t.Fatal("negative catalog-wide intent ignored") }
	if validateAICategoryTaskIntent(aiCategoryProposalArguments{Scope: "category", CategoryID: 2813}, &aiAgentToolSession{}) == nil { t.Fatal("uninspected category accepted") }
}

func TestCategorySelectionRequiresExplicitCatalogWideConfirmation(t *testing.T) {
	for _, req := range []aiSEOCategoryJobRequest{{}, {ReworkOnly: true}, {ProductIDs: []uint{0}}, {IncludeDescendants: true}, {CategoryID: 2813, UncategorizedOnly: true}} {
		if validateCategoryJobSelection(req) == nil { t.Fatalf("unsafe selection accepted: %+v", req) }
	}
	for _, req := range []aiSEOCategoryJobRequest{{CategoryID: 2813}, {UncategorizedOnly: true}, {ProductIDs: []uint{1}}, {ConfirmCatalogWide: true}, {ReworkOnly: true, ConfirmCatalogWide: true}} {
		if err := validateCategoryJobSelection(req); err != nil { t.Fatal(err) }
	}
}

func TestCategoryRewritePromptAndOutputMustBeComplete(t *testing.T) {
	prompt := categoryContentRepairPrompt(true)
	for _, phrase := range []string{"corrected_name", "short_description", "meta_title", "meta_description", "meta_keywords", "explicitly requested", "Never"} {
		if !strings.Contains(strings.ToLower(prompt), strings.ToLower(phrase)) { t.Fatalf("rewrite contract missing %s", phrase) }
	}
	if validateCategoryRewriteOutput(aiSEOOutput{}) == nil { t.Fatal("empty rewrite must not silently retain old values as success") }
	if err := validateCategoryRewriteOutput(aiSEOOutput{CorrectedName: "name", ShortDescription: "short", Description: "description", MetaTitle: "title", MetaDescription: "meta", MetaKeywords: "keywords"}); err != nil { t.Fatal(err) }
}
