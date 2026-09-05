package controllers

import (
	"errors"
	"fanuc-backend/services"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/gin-gonic/gin"
)

// MediaThumbnail serves a small cached derivative for gallery grids. The
// original media file remains available through /uploads for previews.
func (mc *MediaController) Thumbnail(c *gin.Context) {
	relative := strings.TrimPrefix(filepath.ToSlash(c.Param("path")), "/")
	if relative == "" || !strings.HasPrefix(relative, "media/") {
		c.Status(http.StatusNotFound)
		return
	}
	root := getUploadRoot()
	original, err := safeThumbnailPath(root, relative)
	if err != nil {
		c.Status(http.StatusNotFound)
		return
	}
	if _, err := os.Stat(original); err != nil {
		c.Status(http.StatusNotFound)
		return
	}
	thumb, err := services.CachedMediaThumbnail(root, relative, original)
	if err != nil {
		c.Status(http.StatusNotFound)
		return
	}
	c.Header("Cache-Control", "public, max-age=31536000, immutable")
	c.Header("Content-Type", "image/jpeg")
	c.File(thumb)
}

func safeThumbnailPath(root, relative string) (string, error) {
	rootAbs, err := filepath.Abs(strings.TrimSpace(root))
	if err != nil {
		return "", err
	}
	clean := filepath.Clean(filepath.FromSlash(relative))
	if clean == "." || filepath.IsAbs(clean) || clean == ".." || strings.HasPrefix(clean, ".."+string(os.PathSeparator)) {
		return "", errors.New("unsafe media path")
	}
	full, err := filepath.Abs(filepath.Join(rootAbs, clean))
	if err != nil {
		return "", err
	}
	within, err := filepath.Rel(rootAbs, full)
	if err != nil || within == ".." || strings.HasPrefix(within, ".."+string(os.PathSeparator)) {
		return "", errors.New("media path escapes upload root")
	}
	return full, nil
}
