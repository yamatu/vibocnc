package routes

import (
	"net/http"
	"os"
	"path/filepath"
	"testing"
)

// Directory requests must not be served as an index: Gin's StaticFS uses
// http.FileServer, which happily lists an upload directory to anonymous users.
func TestNoDirectoryListingFSRejectsDirectories(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "media"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "media", "photo.jpg"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}

	fs := noDirectoryListingFS{fs: http.Dir(root)}

	if _, err := fs.Open("/media"); err == nil {
		t.Fatal("expected directory listing to be refused at /media")
	}
	if _, err := fs.Open("/media/"); err == nil {
		t.Fatal("expected directory listing to be refused at /media/")
	}
	if _, err := fs.Open("/"); err == nil {
		t.Fatal("expected directory listing to be refused at root")
	}

	f, err := fs.Open("/media/photo.jpg")
	if err != nil {
		t.Fatalf("expected file to be served, got %v", err)
	}
	_ = f.Close()
}

// A directory that explicitly ships an index.html may still be served.
func TestNoDirectoryListingFSAllowsIndexHTML(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "index.html"), []byte("<h1>ok</h1>"), 0o644); err != nil {
		t.Fatal(err)
	}

	fs := noDirectoryListingFS{fs: http.Dir(root)}
	f, err := fs.Open("/")
	if err != nil {
		t.Fatalf("expected index.html directory to be served, got %v", err)
	}
	_ = f.Close()
}
