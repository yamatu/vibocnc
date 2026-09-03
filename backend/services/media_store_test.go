package services

import (
	"path/filepath"
	"testing"
)

func TestSafeMediaStorePathStaysInsideRoot(t *testing.T) {
	root := t.TempDir()
	path, err := safeMediaStorePath(root, "media/example.jpg")
	if err != nil {
		t.Fatalf("safeMediaStorePath: %v", err)
	}
	want := filepath.Join(root, "media", "example.jpg")
	if path != want {
		t.Fatalf("path = %q, want %q", path, want)
	}
	if _, err := safeMediaStorePath(root, "../outside.jpg"); err == nil {
		t.Fatal("expected traversal path to be rejected")
	}
}

func TestProductImageURLHashTrimsOnlyOuterWhitespace(t *testing.T) {
	first := ProductImageURLHash("  https://images.example/item.jpg  ")
	second := ProductImageURLHash("https://images.example/item.jpg")
	if first != second {
		t.Fatal("equivalent trimmed URLs produced different trust hashes")
	}
	if first == ProductImageURLHash("https://images.example/other.jpg") {
		t.Fatal("different URLs produced the same trust hash")
	}
}
