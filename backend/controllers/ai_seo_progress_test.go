package controllers

import (
	"fanuc-backend/models"
	"fanuc-backend/services"
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

// The publication gate must survive the move to the review queue: an uncertain
// answer still cannot be applied automatically, whatever the reason.
func TestUncertainClassificationCannotPublish(t *testing.T) {
	product := models.Product{ID: 1, SKU: "A06B-6089-H105", Brand: "FANUC"}
	inference, err := services.InferenceFromAIClassification("FANUC", "Servo Motor", "")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	for _, conf := range []float64{0, 0.7, 0.89, 1.2} {
		if proposal := services.ValidateAIClassificationAgainst(product, "A06B-6089-H105", inference, conf, "guess", nil, ""); proposal.Confirmed {
			t.Fatalf("accepted confidence %v", conf)
		}
	}
}
