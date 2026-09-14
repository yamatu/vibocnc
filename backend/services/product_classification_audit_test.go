package services

import (
	"testing"

	"fanuc-backend/models"
)

func auditTestIndex() map[uint]auditCategoryInfo {
	return buildAuditCategoryIndex([]models.Category{
		{ID: 1, Name: "FANUC", IsActive: true},
		{ID: 2, Name: "Servo Amplifiers", ParentID: cleanupTestUintPtr(1), IsActive: true},
		{ID: 3, Name: "Siemens", IsActive: true},
		{ID: 4, Name: "PLC Modules", ParentID: cleanupTestUintPtr(3), IsActive: true},
		{ID: 5, Name: "Industrial Automation Spare Parts", IsActive: true},
		{ID: 6, Name: "Terminal Modules", ParentID: cleanupTestUintPtr(5), IsActive: true},
		{ID: 7, Name: "S7-1500 Spare Parts", ParentID: cleanupTestUintPtr(3), IsActive: true},
	})
}

func TestEvaluateProductClassificationGenericCategoryTree(t *testing.T) {
	// An active unverified product inside a catch-all tree must be reworked...
	product := models.Product{ID: 7, SKU: "MYSTERY-4", Model: "ZZZ996", CategoryID: 6, IsActive: true}
	issue, _ := evaluateProductClassification(nil, product, auditTestIndex())
	if issue != AuditIssueGenericCategory {
		t.Fatalf("expected generic_category, got %q", issue)
	}
	// ...but the same product under a brand's family node is left alone: only
	// the ROOT segment decides whether a tree is a catch-all.
	product.CategoryID = 7
	issue, _ = evaluateProductClassification(nil, product, auditTestIndex())
	if issue != "" {
		t.Fatalf("brand family node must not be treated as catch-all, got %q", issue)
	}
}

func TestEvaluateProductClassificationUncategorized(t *testing.T) {
	issue, _ := evaluateProductClassification(nil, models.Product{ID: 1, SKU: "X", CategoryID: 999}, auditTestIndex())
	if issue != AuditIssueUncategorized {
		t.Fatalf("missing category should be uncategorized, got %q", issue)
	}
}

func TestEvaluateProductClassificationWrongCategory(t *testing.T) {
	// A verified FANUC servo amplifier placed under Siemens PLC Modules.
	product := models.Product{ID: 2, SKU: "A06B-6114-H105", Brand: "FANUC", Model: "A06B-6114-H105", CategoryID: 4, IsActive: true}
	issue, detail := evaluateProductClassification(nil, product, auditTestIndex())
	if issue != AuditIssueWrongCategory {
		t.Fatalf("expected wrong_category, got %q (%s)", issue, detail)
	}
}

func TestEvaluateProductClassificationCorrectPlacementIsOK(t *testing.T) {
	product := models.Product{ID: 3, SKU: "A06B-6114-H105", Brand: "FANUC", Model: "A06B-6114-H105", CategoryID: 2, IsActive: true}
	issue, detail := evaluateProductClassification(nil, product, auditTestIndex())
	if issue != "" {
		t.Fatalf("correctly placed product must be OK, got %q (%s)", issue, detail)
	}
}

func TestEvaluateProductClassificationInactiveUnresolved(t *testing.T) {
	product := models.Product{ID: 4, SKU: "MYSTERY-1", Model: "ZZZ999", CategoryID: 2, IsActive: false}
	issue, _ := evaluateProductClassification(nil, product, auditTestIndex())
	if issue != AuditIssueInactiveUnresolved {
		t.Fatalf("expected inactive_unresolved, got %q", issue)
	}
}

func TestEvaluateProductClassificationRootCategory(t *testing.T) {
	product := models.Product{ID: 5, SKU: "MYSTERY-2", Model: "ZZZ998", CategoryID: 1, IsActive: true}
	issue, _ := evaluateProductClassification(nil, product, auditTestIndex())
	if issue != AuditIssueRootCategory {
		t.Fatalf("expected root_category for unverified product on a root node, got %q", issue)
	}
}

func TestEvaluateProductClassificationActiveLeafUnverifiedLeftAlone(t *testing.T) {
	product := models.Product{ID: 6, SKU: "MYSTERY-3", Model: "ZZZ997", CategoryID: 2, IsActive: true}
	issue, _ := evaluateProductClassification(nil, product, auditTestIndex())
	if issue != "" {
		t.Fatalf("active unverified product in a leaf category must be left alone, got %q", issue)
	}
}

func TestLLMMatchRuleConfirmsAnyBrand(t *testing.T) {
	inference := ProductCategoryInference{
		BrandKey:  "heidenhain",
		BrandName: "Heidenhain",
		PartType:  "Encoder",
		MatchRule: "llm:type:encoder",
	}
	if !isConfirmedInference(inference) {
		t.Fatalf("llm rule with a concrete brand must confirm the inference")
	}
	inference.BrandKey = ""
	if isConfirmedInference(inference) {
		t.Fatalf("llm rule without a brand must not confirm")
	}
}
