package services

import (
	"strings"
	"testing"
)

const listingSampleText = `Here is the optimized product information in English for 3HNA024871-001 (ACU-01B):
Basic Information
Product Name*: ABB ACU-01B Air Control Unit for Spraying & Paint Robots 3HNA024871-001
SKU*: 3HNA024871-001
Price*: $ (Request a quote – no fixed public price available)
Category*: Robotics Spare Parts / Paint Robot Controllers / Pneumatic & Air Control Units / Industrial Automation
Stock Quantity: Check availability
Brand: ABB
Model: ACU-01B (IRB Paint Series / IRC5P)
Part Number: 3HNA024871-001 (Type: ACU-01B)
Warranty Period: 12 months (standard; refurbished units may vary)
Delivery Time: To be confirmed
Weight (kg): Approx. 3.66 kg (8.07 lbs) net; approx. 4.2–4.5 kg packaged
Description:
The ABB 3HNA024871-001 (ACU-01B) is an industrial-grade Air Control Unit (ACU) module. Compact dimensions: 210 × 160 × 140 mm (L × W × H). Ideal for automotive painting lines.
Shipping Preview (by weight): Calculate based on approx. 4.0–4.5 kg using your configured templates (FedEx / DHL by default).
SEO Basic Information
(Recommended to disable automatic SEO override and fill manually)
SEO Title: ABB 3HNA024871-001 ACU-01B Paint Robot Air Control Unit | IRB 5400/5500
SEO Description: Genuine ABB 3HNA024871-001 (ACU-01B) Air Control Unit for ABB spraying and painting robots. Request a quote.
SEO Keywords: 3HNA024871-001, ACU-01B, ABB 3HNA024871-001`

func TestParseProductListingTextSample(t *testing.T) {
	records := ParseProductListingText(listingSampleText + "\n\n" + strings.Replace(listingSampleText, "3HNA024871-001", "3HNA000000-002", -1))
	if len(records) != 2 {
		t.Fatalf("expected 2 records, got %d", len(records))
	}
	record := records[0]
	checks := map[string][2]string{
		"name":        {record.Name, "ABB ACU-01B Air Control Unit for Spraying & Paint Robots 3HNA024871-001"},
		"sku":         {record.SKU, "3HNA024871-001"},
		"brand":       {record.Brand, "ABB"},
		"model":       {record.Model, "ACU-01B"},
		"part_number": {record.PartNumber, "3HNA024871-001"},
		"warranty":    {record.WarrantyPeriod, "12 months"},
		"lead_time":   {record.LeadTime, ""},
		"meta_title":  {record.MetaTitle, "ABB 3HNA024871-001 ACU-01B Paint Robot Air Control Unit | IRB 5400/5500"},
		"keywords":    {record.MetaKeywords, "3HNA024871-001, ACU-01B, ABB 3HNA024871-001"},
	}
	for field, pair := range checks {
		if pair[0] != pair[1] {
			t.Errorf("%s = %q, want %q", field, pair[0], pair[1])
		}
	}
	if record.Price != nil {
		t.Errorf("quote-only price should be nil, got %v", *record.Price)
	}
	if record.StockQuantity != nil {
		t.Errorf("stock should be nil")
	}
	if record.WeightKg == nil || *record.WeightKg != 3.66 {
		t.Errorf("weight = %v, want 3.66", record.WeightKg)
	}
	if !strings.HasPrefix(record.Description, "The ABB 3HNA024871-001") || strings.Contains(record.Description, "Shipping") || strings.Contains(record.Description, "SEO Basic") {
		t.Errorf("unexpected description: %q", record.Description)
	}
	if record.ShortDescription == "" {
		t.Errorf("short description should be derived")
	}
	if records[1].SKU != "3HNA000000-002" {
		t.Errorf("second record SKU = %q", records[1].SKU)
	}

	path := FallbackListingCategoryPath(record.Brand, record.CategoryText)
	want := []string{"ABB", "Robotics Spare Parts", "Pneumatic & Air Control Units"}
	if strings.Join(path, "|") != strings.Join(want, "|") {
		t.Errorf("fallback path = %v, want %v", path, want)
	}
}

func TestParseListingValues(t *testing.T) {
	if price := ParseListingPrice("USD 1,250.50"); price == nil || *price != 1250.5 {
		t.Errorf("price parse failed: %v", price)
	}
	if weight := ParseListingWeightKg("2 lbs"); weight == nil || *weight != 0.907 {
		t.Errorf("lbs parse failed: %v", weight)
	}
	if CategoryNameKey("Servo Drives") != CategoryNameKey("servo drive") {
		t.Errorf("category keys should match plural forms")
	}
	if got := SanitizeCategoryPath([]string{" ABB ", "abb", "", "Robot Parts"}); len(got) != 2 {
		t.Errorf("sanitize path = %v", got)
	}
}
