package services

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"strings"
	"time"

	"fanuc-backend/models"
	"fanuc-backend/utils"

	"gorm.io/gorm"
)

const (
	remoteMediaImportTimeout  = 25 * time.Second
	remoteMediaImportMaxBytes = 20 * 1024 * 1024
)

type RemoteMediaImportResult struct {
	Asset     models.MediaAsset
	Duplicate bool
}

func getMediaUploadRoot() string {
	p := os.Getenv("UPLOAD_PATH")
	if strings.TrimSpace(p) == "" {
		return "./uploads"
	}
	return p
}

func ImportRemoteMedia(db *gorm.DB, sourceURL string, folder string, tags string) (*RemoteMediaImportResult, error) {
	if db == nil {
		return nil, errors.New("database is required")
	}

	parsed, err := url.Parse(strings.TrimSpace(sourceURL))
	if err != nil || parsed == nil || parsed.Scheme == "" || parsed.Host == "" {
		return nil, fmt.Errorf("invalid remote media url")
	}
	if parsed.Scheme != "https" && parsed.Scheme != "http" {
		return nil, fmt.Errorf("unsupported remote media scheme")
	}

	filename := path.Base(parsed.Path)
	filename = utils.CleanFilename(filename)
	if filename == "" || filename == "." || filename == "/" {
		filename = "remote-image.jpg"
	}
	if !utils.ValidateImageExtension(filename) {
		return nil, fmt.Errorf("unsupported remote media file type")
	}

	req, err := http.NewRequest(http.MethodGet, parsed.String(), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "fanuc-backend/remote-media-import")

	client := &http.Client{Timeout: remoteMediaImportTimeout}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("remote media request failed with status %d", resp.StatusCode)
	}

	contentType := strings.ToLower(strings.TrimSpace(resp.Header.Get("Content-Type")))
	if contentType != "" && !strings.HasPrefix(contentType, "image/") {
		return nil, fmt.Errorf("remote media is not an image")
	}

	limitedReader := io.LimitReader(resp.Body, remoteMediaImportMaxBytes+1)
	raw, err := io.ReadAll(limitedReader)
	if err != nil {
		return nil, err
	}
	if len(raw) == 0 {
		return nil, fmt.Errorf("remote media is empty")
	}
	if int64(len(raw)) > remoteMediaImportMaxBytes {
		return nil, fmt.Errorf("remote media exceeds 20MB limit")
	}

	ext := strings.ToLower(filepath.Ext(filename))
	if ext == ".jpeg" {
		ext = ".jpg"
	}
	optBytes, mimeType, err := OptimizeImage(bytes.NewReader(raw), ext)
	if err != nil {
		return nil, err
	}
	if len(optBytes) == 0 {
		return nil, fmt.Errorf("optimized remote media is empty")
	}

	hasher := sha256.New()
	_, _ = hasher.Write(optBytes)
	hashHex := hex.EncodeToString(hasher.Sum(nil))

	var existing models.MediaAsset
	if err := db.Where("sha256 = ?", hashHex).First(&existing).Error; err == nil {
		return &RemoteMediaImportResult{Asset: existing, Duplicate: true}, nil
	} else if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}

	if ext == "" {
		ext = ".jpg"
	}
	finalName := hashHex + ext
	relPath := filepath.ToSlash(filepath.Join("media", finalName))
	finalPath := filepath.Join(getMediaUploadRoot(), filepath.FromSlash(relPath))

	if err := os.MkdirAll(filepath.Dir(finalPath), 0o755); err != nil {
		return nil, err
	}
	if _, statErr := os.Stat(finalPath); statErr != nil {
		if err := os.WriteFile(finalPath, optBytes, 0o644); err != nil {
			return nil, err
		}
	}

	asset := models.MediaAsset{
		OriginalName: filename,
		FileName:     finalName,
		RelativePath: relPath,
		SHA256:       hashHex,
		MimeType:     mimeType,
		SizeBytes:    int64(len(optBytes)),
		Folder:       strings.TrimSpace(folder),
		Tags:         strings.TrimSpace(tags),
	}
	if err := db.Create(&asset).Error; err != nil {
		_ = os.Remove(finalPath)
		return nil, err
	}

	return &RemoteMediaImportResult{Asset: asset, Duplicate: false}, nil
}
