package controllers

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fanuc-backend/config"
	"fanuc-backend/models"
	"fanuc-backend/services"
	"fanuc-backend/utils"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type MediaController struct{}

func getUploadRoot() string {
	p := os.Getenv("UPLOAD_PATH")
	if strings.TrimSpace(p) == "" {
		return "./uploads"
	}
	return p
}

func (mc *MediaController) List(c *gin.Context) {
	db := config.GetDB()

	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	if page < 1 {
		page = 1
	}
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "24"))
	if pageSize < 1 {
		pageSize = 24
	}
	if pageSize > 200 {
		pageSize = 200
	}

	q := strings.TrimSpace(c.Query("q"))
	folder := strings.TrimSpace(c.Query("folder"))

	query := db.Model(&models.MediaAsset{})
	if q != "" {
		like := "%" + q + "%"
		query = query.Where("original_name LIKE ? OR sha256 LIKE ? OR title LIKE ?", like, like, like)
	}
	if folder != "" {
		query = query.Where("folder = ?", folder)
	}

	var total int64
	if err := query.Count(&total).Error; err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{
			Success: false,
			Message: "Failed to count media assets",
			Error:   err.Error(),
		})
		return
	}

	var assets []models.MediaAsset
	if err := query.Order("id DESC").
		Offset((page - 1) * pageSize).
		Limit(pageSize).
		Find(&assets).Error; err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{
			Success: false,
			Message: "Failed to list media assets",
			Error:   err.Error(),
		})
		return
	}

	items := make([]models.MediaAssetResponse, 0, len(assets))
	for i := range assets {
		items = append(items, assets[i].ToResponse())
	}

	c.JSON(http.StatusOK, models.APIResponse{
		Success: true,
		Message: "Media assets retrieved successfully",
		Data: models.MediaListResponse{
			Items:    items,
			Total:    total,
			Page:     page,
			PageSize: pageSize,
		},
	})
}

type mediaUploadItemResult struct {
	OriginalName string                     `json:"original_name"`
	SHA256       string                     `json:"sha256,omitempty"`
	Duplicate    bool                       `json:"duplicate"`
	Asset        *models.MediaAssetResponse `json:"asset,omitempty"`
	Error        string                     `json:"error,omitempty"`
}

type mediaUploadResponse struct {
	TotalFiles   int                     `json:"total_files"`
	SuccessCount int                     `json:"success_count"`
	ErrorCount   int                     `json:"error_count"`
	Results      []mediaUploadItemResult `json:"results"`
}

type mediaCleanupMissingResponse struct {
	Scanned int      `json:"scanned"`
	Deleted int      `json:"deleted"`
	Errors  []string `json:"errors,omitempty"`
}

// Upload handles batch image upload for the admin media library.
// Multipart fields:
// - files: one or multiple files
// Optional fields:
// - folder, tags
func (mc *MediaController) Upload(c *gin.Context) {
	db := config.GetDB()

	form, err := c.MultipartForm()
	if err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{
			Success: false,
			Message: "Failed to parse multipart form",
			Error:   err.Error(),
		})
		return
	}

	files := form.File["files"]
	if len(files) == 0 {
		// Some clients may send `file` instead of `files`.
		files = form.File["file"]
	}
	if len(files) == 0 {
		c.JSON(http.StatusBadRequest, models.APIResponse{
			Success: false,
			Message: "No files provided",
			Error:   "no_files",
		})
		return
	}

	folder := strings.TrimSpace(c.PostForm("folder"))
	tags := strings.TrimSpace(c.PostForm("tags"))

	uploadRoot := getUploadRoot()
	mediaDir := filepath.Join(uploadRoot, "media")
	if err := os.MkdirAll(mediaDir, 0755); err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{
			Success: false,
			Message: "Failed to create upload directory",
			Error:   err.Error(),
		})
		return
	}

	results := make([]mediaUploadItemResult, 0, len(files))
	successCount := 0
	errorCount := 0

	for _, fh := range files {
		r := mediaUploadItemResult{OriginalName: fh.Filename}

		if !utils.ValidateImageExtension(fh.Filename) {
			r.Error = "Invalid file type. Only JPG, JPEG, PNG, GIF, and WebP are allowed"
			results = append(results, r)
			errorCount++
			continue
		}
		// 20MB limit for media library items
		if fh.Size > 20*1024*1024 {
			r.Error = "File size exceeds 20MB limit"
			results = append(results, r)
			errorCount++
			continue
		}

		ext := strings.ToLower(filepath.Ext(utils.CleanFilename(fh.Filename)))
		if ext == "" {
			r.Error = "Missing file extension"
			results = append(results, r)
			errorCount++
			continue
		}

		src, err := fh.Open()
		if err != nil {
			r.Error = "Failed to open uploaded file: " + err.Error()
			results = append(results, r)
			errorCount++
			continue
		}

		// Optimize + hash in one pass.
		// Note: GIF is stored as-is to preserve animations.
		optBytes, mimeType, optErr := services.OptimizeImage(src, ext)
		_ = src.Close()
		if optErr != nil {
			r.Error = "Failed to optimize image: " + optErr.Error()
			results = append(results, r)
			errorCount++
			continue
		}
		if len(optBytes) == 0 {
			r.Error = "Failed to optimize image: empty output"
			results = append(results, r)
			errorCount++
			continue
		}

		hasher := sha256.New()
		_, _ = hasher.Write(optBytes)
		written := int64(len(optBytes))
		hashHex := hex.EncodeToString(hasher.Sum(nil))
		r.SHA256 = hashHex

		var existing models.MediaAsset
		if e := db.Where("sha256 = ?", hashHex).First(&existing).Error; e == nil {
			resp := existing.ToResponse()
			r.Duplicate = true
			r.Asset = &resp
			results = append(results, r)
			successCount++
			continue
		} else if e != nil && !errors.Is(e, gorm.ErrRecordNotFound) {
			r.Error = "Database error: " + e.Error()
			results = append(results, r)
			errorCount++
			continue
		}

		finalName := hashHex + ext
		finalPath := filepath.Join(mediaDir, finalName)
		relPath := filepath.ToSlash(filepath.Join("media", finalName))

		// Write optimized bytes to final path.
		// If it already exists (same SHA), we skip writing.
		if _, statErr := os.Stat(finalPath); statErr != nil {
			if err := os.WriteFile(finalPath, optBytes, 0o644); err != nil {
				r.Error = "Failed to write optimized file: " + err.Error()
				results = append(results, r)
				errorCount++
				continue
			}
		}
		asset := models.MediaAsset{
			OriginalName: fh.Filename,
			FileName:     finalName,
			RelativePath: relPath,
			SHA256:       hashHex,
			MimeType:     mimeType,
			SizeBytes:    written,
			Folder:       folder,
			Tags:         tags,
			Title:        "",
			AltText:      "",
		}
		if err := db.Create(&asset).Error; err != nil {
			_ = os.Remove(finalPath)
			r.Error = "Failed to create media record: " + err.Error()
			results = append(results, r)
			errorCount++
			continue
		}

		resp := asset.ToResponse()
		r.Asset = &resp
		results = append(results, r)
		successCount++
	}

	data := mediaUploadResponse{
		TotalFiles:   len(files),
		SuccessCount: successCount,
		ErrorCount:   errorCount,
		Results:      results,
	}

	status := http.StatusOK
	if successCount == 0 {
		status = http.StatusBadRequest
	} else if errorCount > 0 {
		status = http.StatusPartialContent
	}

	c.JSON(status, models.APIResponse{
		Success: successCount > 0,
		Message: "Upload processed",
		Data:    data,
	})
}

func (mc *MediaController) CleanupMissing(c *gin.Context) {
	db := config.GetDB()

	var assets []models.MediaAsset
	if err := db.Select("id", "relative_path").Find(&assets).Error; err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{
			Success: false,
			Message: "Failed to query media assets",
			Error:   err.Error(),
		})
		return
	}

	uploadRoot := getUploadRoot()
	missingIDs := make([]uint, 0)
	errorsList := make([]string, 0)

	for _, asset := range assets {
		diskPath, ok := mediaAssetDiskPath(uploadRoot, asset.RelativePath)
		if !ok {
			missingIDs = append(missingIDs, asset.ID)
			continue
		}

		if _, err := os.Stat(diskPath); err == nil {
			continue
		} else if os.IsNotExist(err) {
			missingIDs = append(missingIDs, asset.ID)
		} else {
			errorsList = append(errorsList, "id "+strconv.FormatUint(uint64(asset.ID), 10)+": "+err.Error())
		}
	}

	if len(missingIDs) > 0 {
		if err := db.Where("id IN ?", missingIDs).Delete(&models.MediaAsset{}).Error; err != nil {
			c.JSON(http.StatusInternalServerError, models.APIResponse{
				Success: false,
				Message: "Failed to delete missing media records",
				Error:   err.Error(),
			})
			return
		}
	}

	c.JSON(http.StatusOK, models.APIResponse{
		Success: true,
		Message: "Missing media records cleaned successfully",
		Data: mediaCleanupMissingResponse{
			Scanned: len(assets),
			Deleted: len(missingIDs),
			Errors:  errorsList,
		},
	})
}

func (mc *MediaController) Update(c *gin.Context) {
	db := config.GetDB()

	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		c.JSON(http.StatusBadRequest, models.APIResponse{
			Success: false,
			Message: "Invalid ID",
			Error:   "invalid_id",
		})
		return
	}

	var req models.MediaBatchUpdateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{
			Success: false,
			Message: "Invalid request data",
			Error:   err.Error(),
		})
		return
	}

	var asset models.MediaAsset
	if err := db.First(&asset, id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, models.APIResponse{
				Success: false,
				Message: "Media asset not found",
				Error:   "not_found",
			})
			return
		}
		c.JSON(http.StatusInternalServerError, models.APIResponse{
			Success: false,
			Message: "Database error",
			Error:   err.Error(),
		})
		return
	}

	updates := map[string]any{}
	if req.Folder != nil {
		updates["folder"] = strings.TrimSpace(*req.Folder)
	}
	if req.Tags != nil {
		updates["tags"] = strings.TrimSpace(*req.Tags)
	}
	if req.Title != nil {
		updates["title"] = strings.TrimSpace(*req.Title)
	}
	if req.AltText != nil {
		updates["alt_text"] = strings.TrimSpace(*req.AltText)
	}
	if len(updates) == 0 {
		c.JSON(http.StatusBadRequest, models.APIResponse{
			Success: false,
			Message: "No fields to update",
			Error:   "no_updates",
		})
		return
	}

	if err := db.Model(&asset).Updates(updates).Error; err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{
			Success: false,
			Message: "Failed to update media asset",
			Error:   err.Error(),
		})
		return
	}
	_ = db.First(&asset, id).Error
	resp := asset.ToResponse()
	c.JSON(http.StatusOK, models.APIResponse{
		Success: true,
		Message: "Media asset updated successfully",
		Data:    resp,
	})
}

func (mc *MediaController) BatchUpdate(c *gin.Context) {
	db := config.GetDB()

	var req models.MediaBatchUpdateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{
			Success: false,
			Message: "Invalid request data",
			Error:   err.Error(),
		})
		return
	}

	updates := map[string]any{}
	if req.Folder != nil {
		updates["folder"] = strings.TrimSpace(*req.Folder)
	}
	if req.Tags != nil {
		updates["tags"] = strings.TrimSpace(*req.Tags)
	}
	if req.Title != nil {
		updates["title"] = strings.TrimSpace(*req.Title)
	}
	if req.AltText != nil {
		updates["alt_text"] = strings.TrimSpace(*req.AltText)
	}
	if len(updates) == 0 {
		c.JSON(http.StatusBadRequest, models.APIResponse{
			Success: false,
			Message: "No fields to update",
			Error:   "no_updates",
		})
		return
	}

	if err := db.Model(&models.MediaAsset{}).Where("id IN ?", req.IDs).Updates(updates).Error; err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{
			Success: false,
			Message: "Failed to batch update media assets",
			Error:   err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, models.APIResponse{
		Success: true,
		Message: "Media assets updated successfully",
		Data:    gin.H{"updated": len(req.IDs)},
	})
}

func mediaAssetDiskPath(uploadRoot string, relativePath string) (string, bool) {
	trimmed := strings.TrimSpace(relativePath)
	if trimmed == "" || filepath.IsAbs(trimmed) {
		return "", false
	}

	rootAbs, err := filepath.Abs(uploadRoot)
	if err != nil {
		return "", false
	}

	cleanRel := filepath.Clean(filepath.FromSlash(trimmed))
	if cleanRel == "." || cleanRel == ".." || strings.HasPrefix(cleanRel, ".."+string(os.PathSeparator)) {
		return "", false
	}

	assetAbs, err := filepath.Abs(filepath.Join(rootAbs, cleanRel))
	if err != nil {
		return "", false
	}

	relToRoot, err := filepath.Rel(rootAbs, assetAbs)
	if err != nil || relToRoot == ".." || strings.HasPrefix(relToRoot, ".."+string(os.PathSeparator)) {
		return "", false
	}

	return assetAbs, true
}

func (mc *MediaController) BatchDelete(c *gin.Context) {
	db := config.GetDB()

	var req models.MediaBatchDeleteRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{
			Success: false,
			Message: "Invalid request data",
			Error:   err.Error(),
		})
		return
	}

	var assets []models.MediaAsset
	if err := db.Where("id IN ?", req.IDs).Find(&assets).Error; err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{
			Success: false,
			Message: "Failed to query media assets",
			Error:   err.Error(),
		})
		return
	}

	if err := db.Where("id IN ?", req.IDs).Delete(&models.MediaAsset{}).Error; err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{
			Success: false,
			Message: "Failed to delete media assets",
			Error:   err.Error(),
		})
		return
	}

	uploadRoot := getUploadRoot()
	// Best-effort file deletion.
	for _, a := range assets {
		if p, ok := mediaAssetDiskPath(uploadRoot, a.RelativePath); ok {
			_ = os.Remove(p)
		}
	}

	c.JSON(http.StatusOK, models.APIResponse{
		Success: true,
		Message: "Media assets deleted successfully",
		Data:    gin.H{"deleted": len(assets)},
	})
}
