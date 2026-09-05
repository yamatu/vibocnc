package services

import (
	"crypto/sha256"
	"encoding/hex"
	"fanuc-backend/models"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"gorm.io/gorm"
)

type MediaSyncResult struct {
	Inserted     int
	Updated      int
	DeletedStale int
	Scanned      int
}

func isLikelyImage(name string) bool {
	ext := strings.ToLower(filepath.Ext(name))
	switch ext {
	case ".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg":
		return true
	default:
		return false
	}
}

// SyncMediaAssetsFromDisk makes the admin media library consistent with files on disk.
//
// The admin media library lists records from the media_assets table, not raw files.
// When restoring only the uploads directory, the DB may not contain matching records.
func SyncMediaAssetsFromDisk(db *gorm.DB, uploadsDir string) (MediaSyncResult, error) {
	res := MediaSyncResult{}

	// 1) Delete stale DB records (media/*) if the file no longer exists.
	var existing []models.MediaAsset
	if err := db.Select("id,relative_path,sha256").Where("relative_path LIKE ?", "media/%").Find(&existing).Error; err != nil {
		return res, err
	}
	for _, a := range existing {
		p := filepath.Join(uploadsDir, filepath.FromSlash(a.RelativePath))
		if _, err := os.Stat(p); err == nil {
			continue
		}
		if err := db.Delete(&models.MediaAsset{}, a.ID).Error; err != nil {
			return res, err
		}
		res.DeletedStale++
	}

	// 2) Scan uploads/media and upsert records.
	mediaDir := filepath.Join(uploadsDir, "media")
	if st, err := os.Stat(mediaDir); err != nil || !st.IsDir() {
		return res, nil
	}

	err := filepath.Walk(mediaDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if info.IsDir() {
			if info.Name() == ".thumbs" {
				return filepath.SkipDir
			}
			return nil
		}
		res.Scanned++

		if !isLikelyImage(info.Name()) {
			return nil
		}

		rel, err := filepath.Rel(mediaDir, path)
		if err != nil {
			return err
		}
		relPath := filepath.ToSlash(filepath.Join("media", rel))

		f, err := os.Open(path)
		if err != nil {
			return err
		}
		defer f.Close()

		h := sha256.New()
		sniff := make([]byte, 512)
		n, _ := io.ReadFull(f, sniff)
		if _, err := f.Seek(0, 0); err != nil {
			return err
		}
		if _, err := io.Copy(h, f); err != nil {
			return err
		}
		hashHex := hex.EncodeToString(h.Sum(nil))
		mimeType := http.DetectContentType(sniff[:n])

		var asset models.MediaAsset
		if e := db.Where("sha256 = ?", hashHex).First(&asset).Error; e == nil {
			updates := map[string]any{}
			if asset.RelativePath != relPath {
				updates["relative_path"] = relPath
				updates["file_name"] = info.Name()
			}
			if asset.MimeType != mimeType {
				updates["mime_type"] = mimeType
			}
			if asset.SizeBytes != info.Size() {
				updates["size_bytes"] = info.Size()
			}
			if len(updates) > 0 {
				if err := db.Model(&asset).Updates(updates).Error; err != nil {
					return err
				}
				res.Updated++
			}
			return nil
		} else if e != nil && e != gorm.ErrRecordNotFound {
			return e
		}

		// Insert new record
		a := models.MediaAsset{
			OriginalName: info.Name(),
			FileName:     info.Name(),
			RelativePath: relPath,
			SHA256:       hashHex,
			MimeType:     mimeType,
			SizeBytes:    info.Size(),
			Folder:       "",
			Tags:         "",
			Title:        "",
			AltText:      "",
		}
		if err := db.Create(&a).Error; err != nil {
			// In case of a race/dup, ignore unique conflicts by returning nil.
			if strings.Contains(strings.ToLower(err.Error()), "duplicate") {
				return nil
			}
			return err
		}
		res.Inserted++
		return nil
	})

	return res, err
}
