package services

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"fanuc-backend/models"
	"fanuc-backend/utils"

	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// StoreMediaImage applies the same optimization, SHA-256 deduplication, and
// media-library storage rules used by the normal upload endpoint.
func StoreMediaImage(db *gorm.DB, source io.Reader, originalName, folder, tags string) (models.MediaAsset, bool, error) {
	if db == nil {
		return models.MediaAsset{}, false, errors.New("db is nil")
	}
	cleanName := utils.CleanFilename(filepath.Base(strings.TrimSpace(originalName)))
	if cleanName == "" || !IsSupportedMediaExt(cleanName) {
		return models.MediaAsset{}, false, errors.New("unsupported image file")
	}
	extHint := strings.ToLower(filepath.Ext(cleanName))
	optimized, mimeType, err := OptimizeImage(source, extHint)
	if err != nil {
		return models.MediaAsset{}, false, err
	}
	if len(optimized) == 0 {
		return models.MediaAsset{}, false, errors.New("optimized image is empty")
	}

	hash := sha256.Sum256(optimized)
	hashHex := hex.EncodeToString(hash[:])
	finalExt := sanitizeExtFromFilename(cleanName)
	if finalExt == "" {
		return models.MediaAsset{}, false, errors.New("missing image extension")
	}
	fileName := hashHex + finalExt
	relativePath := filepath.ToSlash(filepath.Join("media", fileName))
	mediaDir := filepath.Join(getUploadRootForServices(), "media")
	finalPath := filepath.Join(mediaDir, fileName)

	silentDB := db.Session(&gorm.Session{Logger: logger.Default.LogMode(logger.Silent)})
	var existing models.MediaAsset
	if err := silentDB.Where("sha256 = ?", hashHex).First(&existing).Error; err == nil {
		existingPath, pathErr := safeMediaStorePath(getUploadRootForServices(), existing.RelativePath)
		if pathErr != nil {
			return models.MediaAsset{}, false, pathErr
		}
		if _, statErr := os.Stat(existingPath); os.IsNotExist(statErr) {
			if mkdirErr := os.MkdirAll(filepath.Dir(existingPath), 0o755); mkdirErr != nil {
				return models.MediaAsset{}, false, mkdirErr
			}
			if writeErr := os.WriteFile(existingPath, optimized, 0o644); writeErr != nil {
				return models.MediaAsset{}, false, writeErr
			}
		}
		return existing, true, nil
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		return models.MediaAsset{}, false, err
	}

	if err := os.MkdirAll(mediaDir, 0o755); err != nil {
		return models.MediaAsset{}, false, err
	}
	if err := os.WriteFile(finalPath, optimized, 0o644); err != nil {
		return models.MediaAsset{}, false, err
	}

	asset := models.MediaAsset{
		OriginalName: cleanName,
		FileName:     fileName,
		RelativePath: relativePath,
		SHA256:       hashHex,
		MimeType:     mimeType,
		SizeBytes:    int64(len(optimized)),
		Folder:       strings.TrimSpace(folder),
		Tags:         strings.TrimSpace(tags),
	}
	if err := db.Create(&asset).Error; err != nil {
		var concurrent models.MediaAsset
		if findErr := silentDB.Where("sha256 = ?", hashHex).First(&concurrent).Error; findErr == nil {
			return concurrent, true, nil
		}
		// Keep the file on a concurrent insert failure. Another uploader may
		// have committed the same SHA-256 row just after the lookup; removing
		// this shared hash path would make that valid asset unreadable.
		return models.MediaAsset{}, false, fmt.Errorf("create media asset: %w", err)
	}
	return asset, false, nil
}

func safeMediaStorePath(root, relative string) (string, error) {
	rootAbs, err := filepath.Abs(strings.TrimSpace(root))
	if err != nil {
		return "", err
	}
	cleanRelative := filepath.Clean(filepath.FromSlash(strings.TrimSpace(relative)))
	if cleanRelative == "." || filepath.IsAbs(cleanRelative) || cleanRelative == ".." || strings.HasPrefix(cleanRelative, ".."+string(os.PathSeparator)) {
		return "", errors.New("unsafe media relative path")
	}
	fullPath, err := filepath.Abs(filepath.Join(rootAbs, cleanRelative))
	if err != nil {
		return "", err
	}
	relToRoot, err := filepath.Rel(rootAbs, fullPath)
	if err != nil || relToRoot == ".." || strings.HasPrefix(relToRoot, ".."+string(os.PathSeparator)) {
		return "", errors.New("media path escapes upload root")
	}
	return fullPath, nil
}

func StoreMediaImageBytes(db *gorm.DB, data []byte, originalName, folder, tags string) (models.MediaAsset, bool, error) {
	return StoreMediaImage(db, bytes.NewReader(data), originalName, folder, tags)
}
