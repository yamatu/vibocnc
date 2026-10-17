package controllers

import "testing"

func TestParseAIListingOutput(t *testing.T) {
	raw := "```json\n{\"product_name\":\"ABB ACU-01B Air Control Unit 3HNA024871-001\",\"sku\":\"3HNA024871-001\",\"brand\":\"abb\",\"model\":\"ACU-01B (IRC5P)\",\"part_number\":\"3HNA024871-001\",\"category_path\":[\"ABB\",\"Robot Spare Parts\",\"Air Control Units\"],\"existing_category_id\":\"12\",\"weight_kg\":\"3.66 kg\",\"description\":\"The ABB 3HNA024871-001 (ACU-01B) is an air control unit.\",\"meta_title\":\"ABB 3HNA024871-001 ACU-01B Air Control Unit\",\"meta_keywords\":[\"3HNA024871-001\",\"ACU-01B\"]}\n```"
	output, err := parseAIListingOutput(raw)
	if err != nil {
		t.Fatalf("parse failed: %v", err)
	}
	if output.Record.Brand != "ABB" || output.Record.Model != "ACU-01B" {
		t.Errorf("identity not sanitized: %+v", output.Record)
	}
	if output.ExistingCategoryID != 12 || len(output.CategoryPath) != 3 {
		t.Errorf("category not parsed: %v %d", output.CategoryPath, output.ExistingCategoryID)
	}
	if output.Record.WeightKg == nil || *output.Record.WeightKg != 3.66 {
		t.Errorf("weight not parsed: %v", output.Record.WeightKg)
	}
	if output.Record.MetaKeywords != "3HNA024871-001, ACU-01B" {
		t.Errorf("keywords = %q", output.Record.MetaKeywords)
	}
	if output.Record.ShortDescription == "" {
		t.Errorf("short description should be derived")
	}
}

func TestParseListingCategoryDecisions(t *testing.T) {
	raw := "Sure: {\"items\":[{\"index\":3,\"category_path\":\"FANUC > Servo Amplifiers\",\"existing_category_id\":7}]}"
	decisions := parseListingCategoryDecisions(raw)
	decision, ok := decisions[3]
	if !ok || decision.existingID != 7 || len(decision.path) != 2 || decision.path[1] != "Servo Amplifiers" {
		t.Fatalf("unexpected decisions: %+v", decisions)
	}
	if path := listingPathWithBrand("ABB", []string{"Robot Parts"}); len(path) != 2 || path[0] != "ABB" {
		t.Errorf("brand should be prepended: %v", path)
	}
}
