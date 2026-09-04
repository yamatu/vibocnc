package services

import "testing"

func TestLocalUploadRelativeMakesSourceURLsPortable(t *testing.T) {
	tests := map[string]string{
		"/uploads/media/a.jpg":                       "media/a.jpg",
		"https://vibocnc.com/uploads/products/b.png": "products/b.png",
		"https://example.com/not-managed/image.jpg":  "",
		"/uploads/../../outside.txt":                 "",
	}
	for input, expected := range tests {
		actual, ok := localUploadRelative(input)
		if expected == "" {
			if ok {
				t.Fatalf("localUploadRelative(%q) unexpectedly accepted %q", input, actual)
			}
			continue
		}
		if !ok || actual != expected {
			t.Fatalf("localUploadRelative(%q) = %q, %v; want %q, true", input, actual, ok, expected)
		}
	}
}

func TestCatalogBrandAndTextMapping(t *testing.T) {
	options := normalizeCatalogOptions(ProductCatalogImportOptions{
		BrandMap: map[string]string{" VIBOCNC ": "Vcocnc", "Fanuc": "FANUC"},
		TextReplacements: []ProductCatalogTextReplacement{
			{From: "sales@vibocnc.com", To: "sales@vcocncspare.com"},
			{From: "Vibocnc", To: "Vcocnc"},
		},
	})
	if actual := mapCatalogBrand("vibocnc", options.BrandMap); actual != "Vcocnc" {
		t.Fatalf("mapped brand = %q", actual)
	}
	actual := replaceCatalogText("ViBoCnC support: sales@vibocnc.com", options.TextReplacements)
	if actual != "Vcocnc support: sales@vcocncspare.com" {
		t.Fatalf("replacement result = %q", actual)
	}
}

func TestTargetCategoryPathUsesRootBrandMapping(t *testing.T) {
	options := normalizeCatalogOptions(ProductCatalogImportOptions{BrandMap: map[string]string{"FANUC": "Fanuc Robotics"}})
	if actual := targetCategoryPath("fanuc/servo-drives", options); actual != "fanuc-robotics/servo-drives" {
		t.Fatalf("target path = %q", actual)
	}
}

func TestSafeCatalogArchiveNameRejectsTraversal(t *testing.T) {
	for _, value := range []string{"../catalog.json", "uploads/../../secret", "/absolute/file"} {
		if _, ok := safeCatalogArchiveName(value); ok {
			t.Fatalf("unsafe archive name accepted: %q", value)
		}
	}
	if actual, ok := safeCatalogArchiveName("uploads/media/a.jpg"); !ok || actual != "uploads/media/a.jpg" {
		t.Fatalf("safe archive name rejected: %q, %v", actual, ok)
	}
}
