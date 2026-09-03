package services

import (
	"strings"
	"testing"

	"golang.org/x/image/font"
	"golang.org/x/image/font/opentype"
)

func TestWrapWatermarkTextPreservesLongSKU(t *testing.T) {
	parsed, err := getGoRegularFont()
	if err != nil {
		t.Fatalf("parse font: %v", err)
	}
	face, err := opentype.NewFace(parsed, &opentype.FaceOptions{Size: 30, DPI: 72, Hinting: font.HintingFull})
	if err != nil {
		t.Fatalf("create face: %v", err)
	}
	defer face.Close()

	sku := "A06B-6117-H209/210#H550-LONG-MODEL-SUFFIX"
	lines := wrapWatermarkText(face, sku, 260)
	if len(lines) < 2 {
		t.Fatalf("expected a long SKU to wrap, got %#v", lines)
	}
	if got := strings.Join(lines, ""); got != sku {
		t.Fatalf("wrapped text lost SKU characters: got %q, want %q", got, sku)
	}
	for _, line := range lines {
		drawer := &font.Drawer{Face: face}
		if width := drawer.MeasureString(line).Ceil(); width > 260 {
			t.Fatalf("wrapped line width = %d, want <= 260; line=%q", width, line)
		}
	}
}

func TestWatermarkCacheKeyChangedForWrappedRenderer(t *testing.T) {
	key := buildWatermarkCacheKey("builtin", "SKU-1", "bottom-right")
	if len(key) != 64 {
		t.Fatalf("cache key length = %d, want 64", len(key))
	}
	if key == buildWatermarkCacheKey("builtin", "SKU-2", "bottom-right") {
		t.Fatal("different SKU text produced the same cache key")
	}
}
