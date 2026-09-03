package controllers

import (
	"archive/zip"
	"os"
	"path/filepath"
	"testing"
)

func TestCleanSKUArchivePathRejectsTraversal(t *testing.T) {
	if _, ok := cleanSKUArchivePath("../SKU/image.jpg"); ok {
		t.Fatal("expected traversal path to be rejected")
	}
	parts, ok := cleanSKUArchivePath("SKU-1/images/front.jpg")
	if !ok || len(parts) != 3 || parts[0] != "SKU-1" {
		t.Fatalf("valid archive path was not parsed: %#v, %v", parts, ok)
	}
}

func TestOpenSKUArchiveSupportsWrapperFolder(t *testing.T) {
	archivePath := filepath.Join(t.TempDir(), "products.zip")
	file, err := os.Create(archivePath)
	if err != nil {
		t.Fatalf("create archive: %v", err)
	}
	writer := zip.NewWriter(file)
	for _, name := range []string{"export/SKU-1/front.jpg", "export/SKU-2/front.png"} {
		entry, createErr := writer.Create(name)
		if createErr != nil {
			t.Fatalf("create entry: %v", createErr)
		}
		if _, writeErr := entry.Write([]byte("test")); writeErr != nil {
			t.Fatalf("write entry: %v", writeErr)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("close zip writer: %v", err)
	}
	if err := file.Close(); err != nil {
		t.Fatalf("close archive: %v", err)
	}

	reader, folders, err := openSKUArchive(nil, archivePath)
	if err != nil {
		t.Fatalf("openSKUArchive: %v", err)
	}
	defer reader.Close()
	if len(folders) != 2 || folders[0].SKU != "SKU-1" || folders[1].SKU != "SKU-2" {
		t.Fatalf("folders = %#v", folders)
	}
}

func TestArchiveChunkAlreadyStoredIsIdempotent(t *testing.T) {
	file, err := os.CreateTemp(t.TempDir(), "chunk-*.bin")
	if err != nil {
		t.Fatalf("create chunk file: %v", err)
	}
	defer file.Close()
	data := []byte("first-second")
	if _, err := file.Write(data); err != nil {
		t.Fatalf("write chunk file: %v", err)
	}
	if !archiveChunkAlreadyStored(file, 6, []byte("second"), int64(len(data))) {
		t.Fatal("expected identical retried chunk to be accepted")
	}
	if archiveChunkAlreadyStored(file, 6, []byte("changed"), int64(len(data))) {
		t.Fatal("different retried chunk must not be accepted")
	}
}

func TestChooseSKUArchiveFolderDepthUsesWrapperHeuristic(t *testing.T) {
	images := []skuArchiveImageEntry{
		{parts: []string{"export", "SKU-1", "front.jpg"}},
		{parts: []string{"export", "SKU-2", "front.jpg"}},
	}
	if got := chooseSKUArchiveFolderDepth(images, nil); got != 1 {
		t.Fatalf("wrapper folder depth = %d, want 1", got)
	}
	direct := []skuArchiveImageEntry{
		{parts: []string{"SKU-1", "front.jpg"}},
		{parts: []string{"SKU-2", "front.jpg"}},
	}
	if got := chooseSKUArchiveFolderDepth(direct, nil); got != 0 {
		t.Fatalf("direct SKU folder depth = %d, want 0", got)
	}
	nestedDirect := []skuArchiveImageEntry{{parts: []string{"SKU-1", "photos", "front.jpg"}}}
	if got := chooseSKUArchiveFolderDepth(nestedDirect, nil); got != 0 {
		t.Fatalf("nested direct SKU folder depth = %d, want 0", got)
	}
}

func TestValidSKUArchiveFingerprint(t *testing.T) {
	if !validSKUArchiveFingerprint("") {
		t.Fatal("empty fingerprint should be accepted for legacy clients")
	}
	if !validSKUArchiveFingerprint("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef") {
		t.Fatal("valid SHA-256 fingerprint was rejected")
	}
	if validSKUArchiveFingerprint("not-a-fingerprint") {
		t.Fatal("invalid fingerprint was accepted")
	}
}
