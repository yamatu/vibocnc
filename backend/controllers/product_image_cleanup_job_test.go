package controllers

import (
	"reflect"
	"testing"

	"fanuc-backend/services"
)

func TestNormalizeTrustedImageDomains(t *testing.T) {
	got := normalizeTrustedImageDomains([]string{"https://IMG.Example.com/path", "*.cdn.example.com", "img.example.com"})
	want := []string{"cdn.example.com", "img.example.com"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("normalizeTrustedImageDomains() = %#v, want %#v", got, want)
	}
}

func TestIsTrustedProductImageURL(t *testing.T) {
	trusted := []string{"cdn.my-supplier.example"}
	tests := []struct {
		name string
		url  string
		want bool
	}{
		{name: "local upload", url: "/uploads/media/a.jpg", want: true},
		{name: "default sku image", url: "/api/v1/public/products/default-image?sku=A06B", want: true},
		{name: "owned domain", url: "https://www.vibocnc.com/uploads/a.jpg", want: true},
		{name: "local absolute upload", url: "http://127.0.0.1:8080/uploads/a.jpg", want: true},
		{name: "trusted external domain", url: "https://images.cdn.my-supplier.example/a.jpg", want: true},
		{name: "untrusted import", url: "https://marketplace.example/a.jpg", want: false},
		{name: "untrusted protocol relative import", url: "//marketplace.example/a.jpg", want: false},
		{name: "unknown value preserved", url: "legacy-image-reference", want: true},
	}
	for _, testCase := range tests {
		t.Run(testCase.name, func(t *testing.T) {
			if got := isTrustedProductImageURL(testCase.url, trusted); got != testCase.want {
				t.Fatalf("isTrustedProductImageURL(%q) = %v, want %v", testCase.url, got, testCase.want)
			}
		})
	}
}

func TestSplitTrustedAndUntrustedImagesPreservesOrder(t *testing.T) {
	urls := []string{"/uploads/a.jpg", "https://bad.example/one.jpg", "https://cdn.good.example/two.jpg", "https://bad.example/three.jpg"}
	kept, removed := splitTrustedAndUntrustedImages(urls, []string{"cdn.good.example"})
	if !reflect.DeepEqual(kept, []string{"/uploads/a.jpg", "https://cdn.good.example/two.jpg"}) {
		t.Fatalf("kept = %#v", kept)
	}
	if !reflect.DeepEqual(removed, []string{"https://bad.example/one.jpg", "https://bad.example/three.jpg"}) {
		t.Fatalf("removed = %#v", removed)
	}
}

func TestExplicitProductImageTrustPreservesExternalURL(t *testing.T) {
	manual := "https://seller.example/manual.jpg"
	explicit := map[string]struct{}{services.ProductImageURLHash(manual): {}}
	kept, removed := splitTrustedAndUntrustedImagesForProduct([]string{manual, "https://import.example/source.jpg"}, nil, explicit)
	if !reflect.DeepEqual(kept, []string{manual}) {
		t.Fatalf("kept = %#v", kept)
	}
	if !reflect.DeepEqual(removed, []string{"https://import.example/source.jpg"}) {
		t.Fatalf("removed = %#v", removed)
	}
}
