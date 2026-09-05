package services

import (
	"bytes"
	"fmt"
	"image"
	"image/jpeg"
	"os"
	"path/filepath"
	"strings"

	_ "golang.org/x/image/webp"
	"golang.org/x/image/draw"
)

// CachedMediaThumbnail creates a 480px JPEG derivative once and reuses it.
// It intentionally lives outside the media table so existing uploads benefit
// immediately without a database migration or re-upload.
func CachedMediaThumbnail(root, relative, original string) (string, error) {
	clean := filepath.Clean(filepath.FromSlash(relative))
	base := strings.TrimSuffix(filepath.Base(clean), filepath.Ext(clean))
	thumbDir := filepath.Join(root, "media", ".thumbs")
	thumbPath := filepath.Join(thumbDir, base+".jpg")
	if info, err := os.Stat(thumbPath); err == nil && info.Size() > 0 {
		return thumbPath, nil
	}
	raw, err := os.ReadFile(original)
	if err != nil {
		return "", err
	}
	img, _, err := image.Decode(bytes.NewReader(raw))
	if err != nil {
		return "", err
	}
	b := img.Bounds()
	maxDim := 480
	scale := 1.0
	if b.Dx() > maxDim || b.Dy() > maxDim {
		if b.Dx() >= b.Dy() {
			scale = float64(maxDim) / float64(b.Dx())
		} else {
			scale = float64(maxDim) / float64(b.Dy())
		}
	}
	dw, dh := int(float64(b.Dx())*scale), int(float64(b.Dy())*scale)
	if dw < 1 { dw = 1 }
	if dh < 1 { dh = 1 }
	dst := image.NewRGBA(image.Rect(0, 0, dw, dh))
	draw.ApproxBiLinear.Scale(dst, dst.Bounds(), img, b, draw.Over, nil)
	var out bytes.Buffer
	if err := jpeg.Encode(&out, dst, &jpeg.Options{Quality: 72}); err != nil {
		return "", err
	}
	if err := os.MkdirAll(thumbDir, 0o755); err != nil { return "", err }
	tmp := thumbPath + ".tmp"
	if err := os.WriteFile(tmp, out.Bytes(), 0o644); err != nil { return "", err }
	if err := os.Rename(tmp, thumbPath); err != nil {
		if _, statErr := os.Stat(thumbPath); statErr == nil { return thumbPath, nil }
		return "", fmt.Errorf("store thumbnail: %w", err)
	}
	return thumbPath, nil
}
