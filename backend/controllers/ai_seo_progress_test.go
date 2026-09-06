package controllers

import (
	"fanuc-backend/models"
	"strings"
	"testing"
)

func TestAISEOReportsOnlyChangedFields(t *testing.T) {
	p := models.Product{Name: "Verified name", MetaTitle: "Old metadata", Description: "Existing description"}
	text := strings.Join(aiSEOChangeSummary(p, map[string]interface{}{"name": "Verified name", "meta_title": "New metadata"}), ";")
	if strings.Contains(text, "name:") || strings.Contains(text, "description:") || !strings.Contains(text, "Old metadata → New metadata") {
		t.Fatal(text)
	}
}
func TestUncertainClassificationCannotPublish(t *testing.T) {
	for _, conf := range []float64{0, 0.7, 0.89, 1.2} {
		if _, err := validateAICategoryClassification(aiCategoryClassification{Brand: "FANUC", PartType: "Servo Motor", Confidence: conf}); err == nil {
			t.Fatalf("accepted confidence %v", conf)
		}
	}
}
