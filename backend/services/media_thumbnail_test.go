package services

import (
	"image"
	"image/color"
	"image/jpeg"
	"os"
	"path/filepath"
	"testing"
)

func TestCachedMediaThumbnailCreatesAndReusesDerivative(t *testing.T) {
	root := t.TempDir()
	relative := "media/example.jpg"
	original := filepath.Join(root, filepath.FromSlash(relative))
	if err := os.MkdirAll(filepath.Dir(original), 0o755); err != nil {
		t.Fatal(err)
	}
	img := image.NewRGBA(image.Rect(0, 0, 1200, 900))
	for y := 0; y < 900; y++ {
		for x := 0; x < 1200; x++ {
			img.Set(x, y, color.RGBA{R: 20, G: 80, B: 140, A: 255})
		}
	}
	file, err := os.Create(original)
	if err != nil {
		t.Fatal(err)
	}
	if err := jpeg.Encode(file, img, &jpeg.Options{Quality: 90}); err != nil {
		file.Close()
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}
	thumb, err := CachedMediaThumbnail(root, relative, original)
	if err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(thumb)
	if err != nil || info.Size() == 0 {
		t.Fatalf("thumbnail missing: %v", err)
	}
	second, err := CachedMediaThumbnail(root, relative, original)
	if err != nil || second != thumb {
		t.Fatalf("thumbnail was not reused: %q %v", second, err)
	}
}
