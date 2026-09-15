package services

import (
	"strings"
	"testing"

	"fanuc-backend/models"
)

func TestContentSkeletonIsBrandAgnostic(t *testing.T) {
	cases := []struct {
		brandKey     string
		brandName    string
		model        string
		wantBrand    string
		wantPartType string
	}{
		{brandKey: "fanuc", brandName: "FANUC", model: "A06B-0123-B077", wantBrand: "FANUC", wantPartType: "Servo Motor"},
		{brandKey: "mitsubishi", brandName: "Mitsubishi", model: "MR-J2S-70A", wantBrand: "Mitsubishi"},
		{brandKey: "siemens", brandName: "Siemens", model: "6ES7 315-2AG10-0AB0", wantBrand: "Siemens"},
		{brandKey: "abb", brandName: "ABB", model: "DSQC-652", wantBrand: "ABB"},
	}

	for _, tc := range cases {
		enriched := enrichWithContentSkeleton(tc.brandKey, tc.brandName, tc.model, nil)
		if strings.Contains(enriched.Description, "FANUC") && tc.brandKey != "fanuc" {
			t.Fatalf("brand %s leaked FANUC into generated copy: %s", tc.brandKey, enriched.Description)
		}
		if !strings.Contains(enriched.Description, tc.wantBrand) {
			t.Fatalf("expected %s to appear in generated copy: %s", tc.wantBrand, enriched.Description)
		}
		if tc.wantPartType != "" && enriched.PartType != tc.wantPartType {
			t.Fatalf("part type mismatch for %s: got %q want %q", tc.model, enriched.PartType, tc.wantPartType)
		}
		for _, section := range []string{"Overview", "Key details", "Compatibility and ordering guidance", "Typical applications"} {
			if !strings.Contains(enriched.Description, section) {
				t.Fatalf("expected section %q in generated copy for %s", section, tc.model)
			}
		}
		if enriched.CompatibilityInfo == "" || enriched.InstallationGuide == "" || enriched.MaintenanceTips == "" {
			t.Fatalf("expected operational content for %s", tc.model)
		}
	}
}

func TestContentSkeletonUsesCommercePolicyPromise(t *testing.T) {
	policy := models.DefaultCommercePolicy()
	policy.ShippingTransitTimeText = "4-5 DAYS"
	policy.DefaultLeadTime = "4-5 DAYS"
	policy.DefaultWarrantyPeriod = "18 months"
	policy.ReturnWindowText = "1 year"
	policy.ReturnShippingPayer = models.ReturnShippingPayerShared

	enriched := BuildProductContentSkeleton(ContentSkeletonInput{
		BrandKey:  "siemens",
		BrandName: "Siemens",
		Model:     "6ES7 315-2AG10-0AB0",
		Policy:    policy,
	})

	for _, want := range []string{"4-5 DAYS", "18 months", "1 year", "shared between buyer and Vibocnc"} {
		if !strings.Contains(enriched.Description, want) {
			t.Fatalf("expected policy value %q in generated copy:\n%s", want, enriched.Description)
		}
	}
	for _, hardcoded := range []string{"3-7 days", "12 months"} {
		if strings.Contains(enriched.Description, hardcoded) {
			t.Fatalf("hard-coded promise %q still present in generated copy:\n%s", hardcoded, enriched.Description)
		}
	}
}

func TestKnownTechnicalSpecsOnlyPublishesRealValues(t *testing.T) {
	weight := 2.5
	product := &models.Product{
		SKU:                  "SIEMENS-6ES7",
		Brand:                "Siemens",
		Model:                "6ES7 315-2AG10-0AB0",
		PartNumber:           "6ES7-315-2AG10-0AB0",
		Weight:               &weight,
		Dimensions:           "120 x 80 x 60 mm",
		ConditionType:        "refurbished",
		PackagingInfo:        "",
		MinimumOrderQuantity: 1,
	}

	specs := KnownTechnicalSpecs(product, models.DefaultCommercePolicy())

	if specs["Brand"] != "Siemens" {
		t.Fatalf("brand missing from specs: %+v", specs)
	}
	if specs["Weight"] != "2.5 kg" {
		t.Fatalf("unexpected weight: %q", specs["Weight"])
	}
	if specs["Condition"] != "Refurbished (tested)" {
		t.Fatalf("unexpected condition: %q", specs["Condition"])
	}
	if specs["Warranty"] != "12 months" {
		t.Fatalf("expected policy warranty fallback: %q", specs["Warranty"])
	}
	if _, exists := specs["Certifications"]; exists {
		t.Fatalf("empty field must not be published: %+v", specs)
	}
	if _, exists := specs["Packaging"]; exists {
		t.Fatalf("empty field must not be published: %+v", specs)
	}

	// Researched parameters overlay the deterministic base table.
	merged := MergeTechnicalSpecs(specs, map[string]string{"Rated output": "7.5 kW", "Weight": "2.6 kg"})
	if merged["Rated output"] != "7.5 kW" {
		t.Fatalf("overlay not applied: %+v", merged)
	}
	if merged["Weight"] != "2.6 kg" {
		t.Fatalf("overlay must win: %+v", merged)
	}

	encoded := TechnicalSpecsJSON(map[string]string{"Brand": "Siemens", "Quote": `5" flange`})
	if encoded != `{"Brand": "Siemens", "Quote": "5\" flange"}` {
		t.Fatalf("unexpected JSON: %s", encoded)
	}
}

func TestBuildDefaultProductSEOStaysBrandAgnostic(t *testing.T) {
	product := &models.Product{
		SKU:             "MIT-MRJ2S-70A",
		Name:            "Mitsubishi MR-J2S-70A Servo Amplifier",
		Brand:           "Mitsubishi",
		Model:           "MR-J2S-70A",
		LeadTime:        "4-5 DAYS",
		WarrantyPeriod:  "12 months",
		ConditionType:   "new",
		MetaTitle:       "Mitsubishi MR-J2S-70A Servo Amplifier | Vibocnc",
		MetaDescription: "Mitsubishi MR-J2S-70A servo amplifier in stock with compatibility support and worldwide delivery.",
	}

	enriched := BuildDefaultProductSEO(product)
	if strings.TrimSpace(enriched.Name) == "" || strings.TrimSpace(enriched.Description) == "" {
		t.Fatalf("expected populated defaults: %+v", enriched)
	}
	if strings.Contains(enriched.Description, "FANUC") {
		t.Fatalf("default content must not mention FANUC for a Mitsubishi product:\n%s", enriched.Description)
	}
	if enriched.TechnicalSpecs == "" {
		t.Fatalf("expected a technical specification table")
	}
	if !strings.Contains(enriched.TechnicalSpecs, "4-5 DAYS") {
		t.Fatalf("expected lead time in specifications: %s", enriched.TechnicalSpecs)
	}
}

func TestCommercePolicyCountryNormalization(t *testing.T) {
	policy := models.DefaultCommercePolicy()
	policy.ShippingDestinationCountries = "us, de , xyz, us, GLOBAL"
	normalized := NormalizeCommercePolicy(policy)
	if normalized.ShippingDestinationCountries != "US,DE,GLOBAL" {
		t.Fatalf("unexpected normalized countries: %q", normalized.ShippingDestinationCountries)
	}

	policy.ShippingDestinationCountries = "global"
	if got := CommercePolicyCountryList(NormalizeCommercePolicy(policy)); len(got) != 0 {
		t.Fatalf("GLOBAL must expand to worldwide (empty list): %+v", got)
	}

	policy.ReturnWindowDays = 5000
	policy.ReturnShippingPayer = "nonsense"
	normalized = NormalizeCommercePolicy(policy)
	if normalized.ReturnWindowDays != 365 {
		t.Fatalf("return window must be capped at 365 days: %d", normalized.ReturnWindowDays)
	}
	if normalized.ReturnShippingPayer != models.ReturnShippingPayerShared {
		t.Fatalf("unknown payer must fall back to shared: %q", normalized.ReturnShippingPayer)
	}
}

func TestContentSkeletonShippingScopeFollowsPolicy(t *testing.T) {
	worldwide := models.DefaultCommercePolicy()
	worldwide.ShippingDestinationCountries = "GLOBAL"
	worldwideEnriched := BuildProductContentSkeleton(ContentSkeletonInput{
		BrandKey:  "siemens",
		BrandName: "Siemens",
		Model:     "6ES7 315-2AG10-0AB0",
		Policy:    worldwide,
	})
	if !strings.Contains(worldwideEnriched.ShortDescription, "worldwide") {
		t.Fatalf("GLOBAL policy must read as worldwide: %s", worldwideEnriched.ShortDescription)
	}

	restricted := models.DefaultCommercePolicy()
	restricted.ShippingDestinationCountries = "US,CA"
	restrictedEnriched := BuildProductContentSkeleton(ContentSkeletonInput{
		BrandKey:  "siemens",
		BrandName: "Siemens",
		Model:     "6ES7 315-2AG10-0AB0",
		Policy:    restricted,
	})
	for _, copy := range []string{restrictedEnriched.ShortDescription, restrictedEnriched.MetaDescription, restrictedEnriched.Description} {
		if strings.Contains(strings.ToLower(copy), "worldwide") {
			t.Fatalf("a country-limited policy must not claim worldwide shipping: %s", copy)
		}
	}
	if !strings.Contains(restrictedEnriched.MetaDescription, "US") {
		t.Fatalf("expected the destination list in the meta description: %s", restrictedEnriched.MetaDescription)
	}
}

func TestCommercePolicyTextHelpers(t *testing.T) {
	policy := models.DefaultCommercePolicy()
	if !CommercePolicyShipsWorldwide(policy) {
		t.Fatalf("the default policy ships worldwide")
	}
	if got := CommercePolicyWarrantyText(policy); got != policy.DefaultWarrantyPeriod {
		t.Fatalf("warranty text mismatch: %q", got)
	}
	if got := CommercePolicyLeadTimeText(policy); got != policy.DefaultLeadTime {
		t.Fatalf("lead time text mismatch: %q", got)
	}

	policy.ShippingDestinationCountries = "US"
	policy.DefaultWarrantyPeriod = ""
	policy.DefaultLeadTime = ""
	if CommercePolicyShipsWorldwide(policy) {
		t.Fatalf("a country list must not be reported as worldwide")
	}
	if got := CommercePolicyWarrantyText(policy); got != models.DefaultCommercePolicy().DefaultWarrantyPeriod {
		t.Fatalf("empty warranty must fall back to the shipped default: %q", got)
	}
	if got := CommercePolicyLeadTimeText(policy); got != models.DefaultCommercePolicy().DefaultLeadTime {
		t.Fatalf("empty lead time must fall back to the shipped default: %q", got)
	}
}

// The specification table is the only place AI-researched parameters live, so an
// approved draft must reach regenerated copy through the record — this is the
// link that closes the "model number -> params -> published content" loop.
func TestApprovedSpecsReachGeneratedCopyForRecord(t *testing.T) {
	product := &models.Product{
		SKU:            "A06B-0123-B077",
		Name:           "FANUC A06B-0123-B077 Servo Drive",
		Brand:          "FANUC",
		Model:          "A06B-0123-B077",
		TechnicalSpecs: `{"Rated output":"7.5 kW","Reviewed parameter":"42 V"}`,
		Category:       models.Category{Name: "Servo Drives"},
	}

	enriched := EnrichProductForRecord(product)
	for _, want := range []string{"Rated output", "7.5 kW", "Reviewed parameter", "42 V"} {
		if !strings.Contains(enriched.Description, want) {
			t.Fatalf("approved parameter %q must appear in the generated body copy", want)
		}
		if !strings.Contains(enriched.TechnicalSpecs, want) {
			t.Fatalf("approved parameter %q must appear in the generated specification table", want)
		}
	}
	// Catalogue-owned values must survive the merge instead of being replaced.
	for _, want := range []string{"Brand", "Model / part number", "SKU"} {
		if !strings.Contains(enriched.TechnicalSpecs, want) {
			t.Fatalf("catalogue key %q must be kept in the merged table: %s", want, enriched.TechnicalSpecs)
		}
	}
}
