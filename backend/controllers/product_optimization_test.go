package controllers

import (
	"strings"
	"testing"

	"fanuc-backend/models"
)

func TestEnhanceProductContentPopulatesMissingFields(t *testing.T) {
	controller := &ProductOptimizationController{}
	product := &models.Product{
		SKU:           "A06B-0123-B077",
		Brand:         "FANUC",
		Model:         "A06B-0123-B077",
		Category:      models.Category{Name: "Servo Motors"},
		StockQuantity: 4,
	}

	updateData := map[string]interface{}{}
	updated := controller.enhanceProductContent(product, updateData)
	if !updated {
		t.Fatal("expected content to be updated")
	}

	requiredFields := []string{
		"meta_title",
		"meta_description",
		"meta_keywords",
		"short_description",
		"description",
		"compatibility_info",
		"installation_guide",
		"maintenance_tips",
	}
	for _, field := range requiredFields {
		value, ok := updateData[field]
		if !ok {
			t.Fatalf("missing field %s in update data", field)
		}
		asString, ok := value.(string)
		if !ok || strings.TrimSpace(asString) == "" {
			t.Fatalf("field %s should be a non-empty string", field)
		}
	}
}
