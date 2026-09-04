package services

import (
	"strings"
	"testing"

	"fanuc-backend/models"
)

func healthyContentProduct() models.Product {
	return models.Product{
		Name: "FANUC A06B-6114-H105 Servo Amplifier",
		SKU:  "A06B-6114-H105", Brand: "FANUC", Model: "A06B-6114-H105",
		ShortDescription: "FANUC A06B-6114-H105 servo amplifier for industrial CNC maintenance and replacement planning.",
		Description: "FANUC A06B-6114-H105 is a servo amplifier used in industrial CNC control and motion systems. " +
			"The exact model and part number should be checked against the installed machine before replacement. " +
			"This product record supports maintenance teams sourcing a compatible replacement for legacy or current equipment. " +
			"Review the machine documentation, connector layout, and existing unit label before installation to confirm the application.",
	}
}

func TestEvaluateProductContentQuality(t *testing.T) {
	tests := []struct {
		name   string
		mutate func(*models.Product)
		want   string
	}{
		{name: "healthy", want: ""},
		{name: "missing", mutate: func(product *models.Product) { product.Description = "" }, want: ContentIssueMissing},
		{name: "thin", mutate: func(product *models.Product) { product.Description = "FANUC A06B-6114-H105 servo amplifier." }, want: ContentIssueThin},
		{name: "wrong brand", mutate: func(product *models.Product) {
			product.Description = strings.ReplaceAll(product.Description, "FANUC", "Siemens")
		}, want: ContentIssueBrandMismatch},
		{name: "missing model", mutate: func(product *models.Product) {
			product.Description = strings.ReplaceAll(product.Description, "A06B-6114-H105", "servo unit")
		}, want: ContentIssueModelMissing},
		{name: "repetitive", mutate: func(product *models.Product) {
			sentence := "FANUC A06B-6114-H105 supports industrial maintenance teams selecting a replacement unit"
			product.Description = sentence + ". " + sentence + ". " + product.Description
		}, want: ContentIssueRepetitive},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			product := healthyContentProduct()
			if test.mutate != nil {
				test.mutate(&product)
			}
			issue, detail := EvaluateProductContentQuality(product)
			if issue != test.want {
				t.Fatalf("issue = %q, want %q (%s)", issue, test.want, detail)
			}
		})
	}
}

func TestNormalizeProductContentTextStripsHTML(t *testing.T) {
	got := normalizeProductContentText("<p>FANUC&nbsp;<strong>A06B</strong></p>")
	if got != "FANUC A06B" {
		t.Fatalf("normalized text = %q", got)
	}
}
