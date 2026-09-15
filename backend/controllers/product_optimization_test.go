package controllers

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"fanuc-backend/models"
	"fanuc-backend/services"
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

// A record captured from a model number alone must be filled with everything the
// catalogue can derive: the customer-facing copy, the SEO block, the operational
// guides, the compliance/logistics defaults and the JSON specification table.
func TestModelOnlyRecordCoversModelDerivableFields(t *testing.T) {
	controller := &ProductOptimizationController{}
	product := &models.Product{
		SKU:           "MITSUBISHI-MR-J4-40A",
		Brand:         "Mitsubishi",
		Model:         "MR-J4-40A",
		Category:      models.Category{Name: "Servo Drives"},
		StockQuantity: 2,
	}

	updateData := map[string]interface{}{}
	if !controller.enhanceProductContent(product, updateData) {
		t.Fatal("expected content to be updated")
	}

	// modelDerivedFields is the same list the admin coverage report uses, so
	// this test fails if the report and the generator ever drift apart.
	if len(modelDerivedFields) == 0 {
		t.Fatal("expected a list of model-derivable fields")
	}
	for _, field := range modelDerivedFields {
		value, ok := updateData[field.Key]
		if !ok {
			t.Fatalf("field %s was not filled for a model-only record", field.Key)
		}
		asString, ok := value.(string)
		if !ok || strings.TrimSpace(asString) == "" {
			t.Fatalf("field %s must be a non-empty string, got %#v", field.Key, value)
		}
	}

	// Every model-derived string must belong to the record's own brand, and the
	// commercial promise must follow the admin-editable policy.
	policy := services.CurrentCommercePolicy()
	if got := updateData["warranty_period"]; got != policy.DefaultWarrantyPeriod {
		t.Fatalf("warranty must come from the commerce policy: %v", got)
	}
	if got := updateData["lead_time"]; got != policy.DefaultLeadTime {
		t.Fatalf("lead time must come from the commerce policy: %v", got)
	}
	for field, value := range updateData {
		text, ok := value.(string)
		if !ok {
			continue
		}
		if strings.Contains(text, "FANUC") {
			t.Fatalf("field %s leaked a foreign brand: %s", field, text)
		}
	}

	specs := map[string]string{}
	if err := json.Unmarshal([]byte(updateData["technical_specs"].(string)), &specs); err != nil {
		t.Fatalf("technical_specs must be valid JSON: %v", err)
	}
	for _, key := range []string{"Brand", "Model / part number", "SKU", "Component type", "Condition", "Warranty", "Lead time"} {
		if strings.TrimSpace(specs[key]) == "" {
			t.Fatalf("expected %q in the specification table: %#v", key, specs)
		}
	}
	if specs["Brand"] != "Mitsubishi" || specs["SKU"] != product.SKU {
		t.Fatalf("specification values must come from the record: %#v", specs)
	}
}

// A published specification table is only replaced by an approved research
// draft, never by the generator, so indexed pages keep their parameters.
func TestApplyKnownTechnicalSpecsNeverOverwritesPublishedTable(t *testing.T) {
	controller := &ProductOptimizationController{}
	product := &models.Product{
		SKU:            "A06B-0123-B077",
		Brand:          "FANUC",
		Model:          "A06B-0123-B077",
		TechnicalSpecs: `{"Reviewed parameter":"42 V"}`,
	}

	updateData := map[string]interface{}{}
	if controller.applyKnownTechnicalSpecs(product, updateData) {
		t.Fatal("an existing specification table must not be reported as updated")
	}
	if _, ok := updateData["technical_specs"]; ok {
		t.Fatal("an existing specification table must not be overwritten")
	}

	product.TechnicalSpecs = "{}"
	if !controller.applyKnownTechnicalSpecs(product, updateData) {
		t.Fatal("an empty specification table should be filled")
	}
}

func TestComputeFieldCoverageDegradesWithoutDatabase(t *testing.T) {
	coverage := computeFieldCoverage(nil)
	if len(coverage) != 0 {
		t.Fatalf("a nil database must produce an empty coverage report: %#v", coverage)
	}
}

func TestNumericCellNormalisesDriverResults(t *testing.T) {
	cases := []struct {
		in   any
		want int64
		ok   bool
	}{
		{in: nil, want: 0, ok: true},
		{in: int64(7), want: 7, ok: true},
		{in: 12, want: 12, ok: true},
		{in: float64(3), want: 3, ok: true},
		{in: []byte("42"), want: 42, ok: true},
		{in: "9", want: 9, ok: true},
		{in: "not-a-number", ok: false},
		{in: true, ok: false},
	}
	for _, tc := range cases {
		got, ok := numericCell(tc.in)
		if ok != tc.ok || got != tc.want {
			t.Fatalf("numericCell(%#v) = (%d,%v), want (%d,%v)", tc.in, got, ok, tc.want, tc.ok)
		}
	}
}

// The coverage report is a single aggregate query, so its generated SQL is
// asserted here instead of against a live database.
func TestFieldCoverageSelectionsMatchTheFieldList(t *testing.T) {
	selections := fieldCoverageSelections()
	if len(selections) != len(modelDerivedFields) {
		t.Fatalf("expected one selection per field: %d vs %d", len(selections), len(modelDerivedFields))
	}
	for index, field := range modelDerivedFields {
		want := fmt.Sprintf("SUM(CASE WHEN %s IS NULL OR %s = '' THEN 1 ELSE 0 END) AS %s", field.Column, field.Column, field.Key)
		if field.JSON {
			want = fmt.Sprintf("SUM(CASE WHEN %s IS NULL OR %s = '{}' THEN 1 ELSE 0 END) AS %s", field.Column, field.Column, field.Key)
		}
		if selections[index] != want {
			t.Fatalf("selection %d mismatch:\n got %s\nwant %s", index, selections[index], want)
		}
	}

	byKey := map[string]modelDerivedField{}
	for _, field := range modelDerivedFields {
		byKey[field.Key] = field
	}
	if !byKey["technical_specs"].JSON {
		t.Fatal("technical_specs is a JSON column and must compare against '{}'")
	}
}
