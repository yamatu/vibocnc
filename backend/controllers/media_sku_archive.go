package controllers

import (
	"archive/zip"
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"fanuc-backend/config"
	"fanuc-backend/models"
	"fanuc-backend/services"
	"fanuc-backend/utils"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	defaultSKUArchiveChunkSize       = int64(5 * 1024 * 1024)
	maxSKUArchiveChunkSize           = int64(8 * 1024 * 1024)
	defaultSKUArchiveMaxBytes        = int64(20 * 1024 * 1024 * 1024)
	defaultSKUArchiveMaxEntries      = 200000
	defaultSKUArchiveMaxEntryBytes   = int64(25 * 1024 * 1024)
	defaultSKUArchiveMaxExpandedSize = int64(100 * 1024 * 1024 * 1024)
	defaultSKUArchiveMaxImagesPerSKU = 30
	defaultSKUArchiveUploadTTL       = 24 * time.Hour
)

type skuArchiveStartRequest struct {
	FileName    string `json:"file_name" binding:"required"`
	FileSize    int64  `json:"file_size" binding:"required"`
	Fingerprint string `json:"fingerprint"`
}

type skuArchiveFolder struct {
	SKU           string
	Files         []*zip.File
	TooManyImages bool
}

type skuArchiveImageEntry struct {
	parts []string
	file  *zip.File
}

func validSKUArchiveFingerprint(value string) bool {
	value = strings.TrimSpace(value)
	if value == "" {
		return true
	}
	if len(value) != 64 {
		return false
	}
	for _, r := range value {
		if !((r >= '0' && r <= '9') || (r >= 'a' && r <= 'f') || (r >= 'A' && r <= 'F')) {
			return false
		}
	}
	return true
}

var skuArchiveUploadLocks sync.Map
var skuArchiveStartMu sync.Mutex
var skuArchiveWorkerLocks sync.Map

func skuArchiveUploadLock(jobID string) *sync.Mutex {
	value, _ := skuArchiveUploadLocks.LoadOrStore(jobID, &sync.Mutex{})
	return value.(*sync.Mutex)
}

func skuArchiveWorkerLock(jobID string) *sync.Mutex {
	value, _ := skuArchiveWorkerLocks.LoadOrStore(jobID, &sync.Mutex{})
	return value.(*sync.Mutex)
}

func imageArchiveEnvInt64(name string, fallback, minimum, maximum int64) int64 {
	value := strings.TrimSpace(os.Getenv(name))
	if value == "" {
		return fallback
	}
	parsed, err := strconv.ParseInt(value, 10, 64)
	if err != nil {
		return fallback
	}
	if parsed < minimum {
		return minimum
	}
	if parsed > maximum {
		return maximum
	}
	return parsed
}

func skuArchiveMaxBytes() int64 {
	return imageArchiveEnvInt64("SKU_IMAGE_ARCHIVE_MAX_BYTES", defaultSKUArchiveMaxBytes, 100*1024*1024, 100*1024*1024*1024)
}

func skuArchiveMaxEntries() int {
	return int(imageArchiveEnvInt64("SKU_IMAGE_ARCHIVE_MAX_ENTRIES", defaultSKUArchiveMaxEntries, 100, 1000000))
}

func skuArchiveMaxEntryBytes() int64 {
	return imageArchiveEnvInt64("SKU_IMAGE_ARCHIVE_MAX_ENTRY_BYTES", defaultSKUArchiveMaxEntryBytes, 1024*1024, 100*1024*1024)
}

func skuArchiveMaxExpandedBytes() int64 {
	return imageArchiveEnvInt64("SKU_IMAGE_ARCHIVE_MAX_EXPANDED_BYTES", defaultSKUArchiveMaxExpandedSize, 100*1024*1024, 500*1024*1024*1024)
}

func skuArchiveMaxImagesPerSKU() int {
	return int(imageArchiveEnvInt64("SKU_IMAGE_ARCHIVE_MAX_IMAGES_PER_SKU", defaultSKUArchiveMaxImagesPerSKU, 1, 100))
}

func skuArchiveTempDir() string {
	return filepath.Join(getUploadRoot(), ".imports", "product-images")
}

func skuArchiveUploadTTL() time.Duration {
	minutes := imageArchiveEnvInt64("SKU_IMAGE_ARCHIVE_UPLOAD_TTL_MINUTES", int64(defaultSKUArchiveUploadTTL/time.Minute), 30, 7*24*60)
	return time.Duration(minutes) * time.Minute
}

func (mc *MediaController) StartSKUImageArchive(c *gin.Context) {
	skuArchiveStartMu.Lock()
	defer skuArchiveStartMu.Unlock()

	var req skuArchiveStartRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Invalid SKU image archive request", Error: err.Error()})
		return
	}
	fileName := utils.CleanFilename(filepath.Base(strings.TrimSpace(req.FileName)))
	if fileName == "" || !strings.EqualFold(filepath.Ext(fileName), ".zip") {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "A .zip archive is required", Error: "invalid_archive_name"})
		return
	}
	if req.FileSize <= 0 || req.FileSize > skuArchiveMaxBytes() {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Archive size is outside the configured limit", Error: "invalid_archive_size"})
		return
	}
	if !validSKUArchiveFingerprint(req.Fingerprint) {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Invalid archive fingerprint", Error: "invalid_fingerprint"})
		return
	}

	db := config.GetDB()
	var active models.ProductImageArchiveJob
	activeErr := db.Where("status IN ?", []string{"uploading", "queued", "running", "paused"}).Order("created_at DESC").First(&active).Error
	if activeErr == nil {
		if active.Status == "uploading" {
			_, statErr := os.Stat(active.TempPath)
			expired := !active.UpdatedAt.IsZero() && time.Since(active.UpdatedAt) > skuArchiveUploadTTL()
			if expired || os.IsNotExist(statErr) {
				_ = db.Model(&models.ProductImageArchiveJob{}).
					Where("id = ? AND status = ?", active.ID, "uploading").
					Updates(map[string]interface{}{"status": "cancelled", "message": "expired or missing upload cancelled", "completed_at": time.Now().UTC()}).Error
				_ = os.Remove(active.TempPath)
				activeErr = gorm.ErrRecordNotFound
			} else if active.FileName == fileName && active.FileSize == req.FileSize && (active.Fingerprint == "" || strings.EqualFold(active.Fingerprint, strings.TrimSpace(req.Fingerprint))) {
				c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "Resuming existing archive upload", Data: active})
				return
			}
		}
		if activeErr == nil {
			c.JSON(http.StatusConflict, models.APIResponse{Success: false, Message: "Another SKU image archive task is active", Error: "archive_task_active", Data: active})
			return
		}
	}
	if !errors.Is(activeErr, gorm.ErrRecordNotFound) {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to inspect archive tasks", Error: activeErr.Error()})
		return
	}

	jobID := uuid.NewString()
	tempDir := skuArchiveTempDir()
	if err := os.MkdirAll(tempDir, 0o750); err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to prepare archive upload", Error: err.Error()})
		return
	}
	tempPath := filepath.Join(tempDir, jobID+".zip")
	file, err := os.OpenFile(tempPath, os.O_CREATE|os.O_EXCL|os.O_RDWR, 0o600)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to create archive upload", Error: err.Error()})
		return
	}
	_ = file.Close()

	job := models.ProductImageArchiveJob{
		ID: jobID, Status: "uploading", FileName: fileName, FileSize: req.FileSize, Fingerprint: strings.TrimSpace(req.Fingerprint), TempPath: tempPath,
		ChunkSize: defaultSKUArchiveChunkSize, Message: "waiting for archive chunks", CreatedByID: c.GetUint("user_id"),
	}
	if _, err := getOrCreateProductImagePolicySetting(db); err != nil {
		_ = os.Remove(tempPath)
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to prepare archive task lock", Error: err.Error()})
		return
	}
	err = db.Transaction(func(tx *gorm.DB) error {
		var policy models.ProductImagePolicySetting
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&policy, 1).Error; err != nil {
			return err
		}
		var activeJob models.ProductImageArchiveJob
		if err := tx.Where("status IN ?", []string{"uploading", "queued", "running", "paused"}).Order("created_at DESC").First(&activeJob).Error; err == nil {
			return errors.New("another SKU image archive task is active")
		} else if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		return tx.Create(&job).Error
	})
	if err != nil {
		_ = os.Remove(tempPath)
		c.JSON(http.StatusConflict, models.APIResponse{Success: false, Message: "Failed to create archive task", Error: err.Error()})
		return
	}
	c.JSON(http.StatusCreated, models.APIResponse{Success: true, Message: "Archive upload created", Data: job})
}

func readArchiveChunk(c *gin.Context) ([]byte, error) {
	limited := io.LimitReader(c.Request.Body, maxSKUArchiveChunkSize+1)
	chunk, err := io.ReadAll(limited)
	if err != nil {
		return nil, err
	}
	if len(chunk) == 0 {
		return nil, errors.New("empty archive chunk")
	}
	if int64(len(chunk)) > maxSKUArchiveChunkSize {
		return nil, errors.New("archive chunk exceeds 8 MiB")
	}
	return chunk, nil
}

func archiveChunkAlreadyStored(file *os.File, offset int64, chunk []byte, uploadedBytes int64) bool {
	if file == nil || offset < 0 || len(chunk) == 0 || offset+int64(len(chunk)) > uploadedBytes {
		return false
	}
	existing := make([]byte, len(chunk))
	if _, err := file.ReadAt(existing, offset); err != nil {
		return false
	}
	return bytes.Equal(existing, chunk)
}

func (mc *MediaController) UploadSKUImageArchiveChunk(c *gin.Context) {
	offset, err := strconv.ParseInt(strings.TrimSpace(c.Query("offset")), 10, 64)
	if err != nil || offset < 0 {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Invalid chunk offset", Error: "invalid_offset"})
		return
	}
	chunk, err := readArchiveChunk(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Invalid archive chunk", Error: err.Error()})
		return
	}
	jobID := strings.TrimSpace(c.Param("id"))
	lock := skuArchiveUploadLock(jobID)
	lock.Lock()
	defer lock.Unlock()

	db := config.GetDB()
	var job models.ProductImageArchiveJob
	if err := db.First(&job, "id = ?", jobID).Error; err != nil {
		c.JSON(http.StatusNotFound, models.APIResponse{Success: false, Message: "Archive upload not found", Error: "task_not_found"})
		return
	}
	if job.Status != "uploading" {
		c.JSON(http.StatusConflict, models.APIResponse{Success: false, Message: "Archive is not accepting chunks", Error: "invalid_upload_status", Data: job})
		return
	}
	if offset+int64(len(chunk)) > job.FileSize {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Chunk exceeds declared archive size", Error: "chunk_out_of_bounds"})
		return
	}

	file, err := os.OpenFile(job.TempPath, os.O_RDWR, 0o600)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to open archive upload", Error: err.Error()})
		return
	}
	defer file.Close()

	if archiveChunkAlreadyStored(file, offset, chunk, job.UploadedBytes) {
		c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "Chunk already received", Data: job})
		return
	}
	if offset != job.UploadedBytes {
		c.JSON(http.StatusConflict, models.APIResponse{Success: false, Message: "Chunk offset does not match server progress", Error: "offset_mismatch", Data: job})
		return
	}
	if _, err := file.WriteAt(chunk, offset); err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to write archive chunk", Error: err.Error()})
		return
	}
	if err := file.Sync(); err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to persist archive chunk", Error: err.Error()})
		return
	}
	nextOffset := offset + int64(len(chunk))
	result := db.Model(&models.ProductImageArchiveJob{}).
		Where("id = ? AND status = ? AND uploaded_bytes = ?", job.ID, "uploading", offset).
		Updates(map[string]interface{}{"uploaded_bytes": nextOffset, "message": "uploading archive"})
	if result.Error != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to save upload progress", Error: result.Error.Error()})
		return
	}
	if result.RowsAffected == 0 {
		_ = db.First(&job, "id = ?", job.ID).Error
		c.JSON(http.StatusConflict, models.APIResponse{Success: false, Message: "Upload progress changed; continue from the returned offset", Error: "upload_progress_changed", Data: job})
		return
	}
	job.UploadedBytes = nextOffset
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "Archive chunk uploaded", Data: job})
}

func cleanSKUArchivePath(name string) ([]string, bool) {
	value := strings.ReplaceAll(strings.TrimSpace(name), "\\", "/")
	if value == "" || len(value) > 1024 {
		return nil, false
	}
	cleaned := path.Clean(value)
	if cleaned == "." || strings.HasPrefix(cleaned, "../") || strings.HasPrefix(cleaned, "/") {
		return nil, false
	}
	parts := strings.Split(cleaned, "/")
	for _, part := range parts {
		if part == "" || part == "." || part == ".." || len(part) > 255 || strings.EqualFold(part, "__MACOSX") || strings.HasPrefix(part, "._") {
			return nil, false
		}
	}
	return parts, true
}

func loadArchiveProductSKUSet(db *gorm.DB) map[string]struct{} {
	set := make(map[string]struct{})
	if db == nil {
		return set
	}
	var skus []string
	if err := db.Model(&models.Product{}).Where("sku IS NOT NULL AND TRIM(sku) <> ''").Pluck("sku", &skus).Error; err != nil {
		return set
	}
	for _, sku := range skus {
		set[strings.ToLower(strings.TrimSpace(sku))] = struct{}{}
	}
	return set
}

func chooseSKUArchiveFolderDepth(images []skuArchiveImageEntry, db *gorm.DB) int {
	if len(images) == 0 {
		return 0
	}
	maxDepth := 0
	allSameTop := true
	firstTop := images[0].parts[0]
	allDeepEnough := true
	secondLevelCandidates := make(map[string]struct{})
	for _, image := range images {
		if len(image.parts)-2 > maxDepth {
			maxDepth = len(image.parts) - 2
		}
		if !strings.EqualFold(image.parts[0], firstTop) {
			allSameTop = false
		}
		if len(image.parts) < 3 {
			allDeepEnough = false
		} else {
			secondLevelCandidates[strings.ToLower(strings.TrimSpace(image.parts[1]))] = struct{}{}
		}
	}
	if maxDepth < 1 {
		maxDepth = 1
	}

	productSKUs := loadArchiveProductSKUSet(db)
	bestDepth := 0
	bestMatches := 0
	for depth := 0; depth <= maxDepth; depth++ {
		candidates := make(map[string]struct{})
		matches := 0
		for _, image := range images {
			if len(image.parts) <= depth+1 {
				continue
			}
			sku := strings.ToLower(strings.TrimSpace(image.parts[depth]))
			if sku == "" {
				continue
			}
			if _, seen := candidates[sku]; seen {
				continue
			}
			candidates[sku] = struct{}{}
			if _, exists := productSKUs[sku]; exists {
				matches++
			}
		}
		// Prefer the deeper level when it produces more real SKU matches. This
		// detects a common wrapper directory without guessing from its name.
		if matches > bestMatches || (matches > 0 && matches == bestMatches && depth > bestDepth) {
			bestMatches = matches
			bestDepth = depth
		}
	}
	if bestMatches > 0 {
		return bestDepth
	}
	// When no database is available (or every folder is unmatched), retain the
	// useful legacy heuristic for a single common wrapper directory.
	commonWrapperNames := map[string]bool{
		"archive": true, "batch": true, "export": true, "exports": true,
		"images": true, "import": true, "imports": true, "photos": true,
		"products": true, "upload": true, "uploads": true,
	}
	if allSameTop && allDeepEnough && (len(secondLevelCandidates) > 1 || commonWrapperNames[strings.ToLower(strings.TrimSpace(firstTop))]) {
		return 1
	}
	return 0
}

func openSKUArchive(db *gorm.DB, archivePath string) (*zip.ReadCloser, []skuArchiveFolder, error) {
	reader, err := zip.OpenReader(archivePath)
	if err != nil {
		return nil, nil, err
	}
	closeWithError := func(err error) (*zip.ReadCloser, []skuArchiveFolder, error) {
		_ = reader.Close()
		return nil, nil, err
	}
	if len(reader.File) > skuArchiveMaxEntries() {
		return closeWithError(fmt.Errorf("archive has too many entries: %d", len(reader.File)))
	}

	images := make([]skuArchiveImageEntry, 0)
	var expanded int64
	for _, entry := range reader.File {
		if entry.FileInfo().IsDir() {
			continue
		}
		parts, ok := cleanSKUArchivePath(entry.Name)
		if !ok || len(parts) < 2 || !services.IsSupportedMediaExt(parts[len(parts)-1]) {
			continue
		}
		entrySize := int64(entry.UncompressedSize64)
		if entrySize < 0 || entrySize > skuArchiveMaxEntryBytes() {
			return closeWithError(fmt.Errorf("archive image is too large: %s", entry.Name))
		}
		if expanded > skuArchiveMaxExpandedBytes()-entrySize {
			return closeWithError(errors.New("archive expanded size exceeds configured limit"))
		}
		expanded += entrySize
		images = append(images, skuArchiveImageEntry{parts: parts, file: entry})
	}
	if len(images) == 0 {
		return closeWithError(errors.New("archive contains no supported images inside SKU folders"))
	}

	wrapperDepth := chooseSKUArchiveFolderDepth(images, db)

	type folderBuilder struct {
		name          string
		files         []*zip.File
		tooManyImages bool
	}
	builders := make(map[string]*folderBuilder)
	for _, image := range images {
		if len(image.parts) < wrapperDepth+2 {
			continue
		}
		sku := strings.TrimSpace(image.parts[wrapperDepth])
		if sku == "" {
			continue
		}
		key := strings.ToLower(sku)
		builder := builders[key]
		if builder == nil {
			builder = &folderBuilder{name: sku}
			builders[key] = builder
		}
		if len(builder.files) < skuArchiveMaxImagesPerSKU() {
			builder.files = append(builder.files, image.file)
		} else {
			builder.tooManyImages = true
		}
	}
	folders := make([]skuArchiveFolder, 0, len(builders))
	for _, builder := range builders {
		sort.Slice(builder.files, func(i, j int) bool {
			return strings.ToLower(builder.files[i].Name) < strings.ToLower(builder.files[j].Name)
		})
		folders = append(folders, skuArchiveFolder{SKU: builder.name, Files: builder.files, TooManyImages: builder.tooManyImages})
	}
	sort.Slice(folders, func(i, j int) bool { return strings.ToLower(folders[i].SKU) < strings.ToLower(folders[j].SKU) })
	if len(folders) == 0 {
		return closeWithError(errors.New("archive contains no valid SKU folders"))
	}
	return reader, folders, nil
}

func (mc *MediaController) CompleteSKUImageArchive(c *gin.Context) {
	db := config.GetDB()
	jobID := strings.TrimSpace(c.Param("id"))
	lock := skuArchiveUploadLock(jobID)
	lock.Lock()
	defer lock.Unlock()
	var job models.ProductImageArchiveJob
	if err := db.First(&job, "id = ?", jobID).Error; err != nil {
		c.JSON(http.StatusNotFound, models.APIResponse{Success: false, Message: "Archive upload not found", Error: "task_not_found"})
		return
	}
	if job.Status != "uploading" || job.UploadedBytes != job.FileSize {
		c.JSON(http.StatusConflict, models.APIResponse{Success: false, Message: "Archive upload is incomplete", Error: "upload_incomplete", Data: job})
		return
	}
	stat, err := os.Stat(job.TempPath)
	if err != nil || stat.Size() != job.FileSize {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Uploaded archive size does not match", Error: "archive_size_mismatch"})
		return
	}
	reader, err := zip.OpenReader(job.TempPath)
	if err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Invalid SKU image archive", Error: err.Error()})
		return
	}
	entryCount := len(reader.File)
	_ = reader.Close()
	if entryCount == 0 || entryCount > skuArchiveMaxEntries() {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Archive entry count is outside the configured limit", Error: "invalid_archive_entry_count"})
		return
	}
	result := db.Model(&models.ProductImageArchiveJob{}).Where("id = ? AND status = ?", jobID, "uploading").
		Updates(map[string]interface{}{"status": "queued", "message": "archive queued for validation and processing"})
	if result.Error != nil || result.RowsAffected == 0 {
		c.JSON(http.StatusConflict, models.APIResponse{Success: false, Message: "Archive could not be queued", Error: "queue_failed"})
		return
	}
	go processSKUImageArchiveJob(jobID)
	_ = db.First(&job, "id = ?", jobID).Error
	c.JSON(http.StatusAccepted, models.APIResponse{Success: true, Message: "Archive processing started", Data: job})
}

func (mc *MediaController) GetSKUImageArchiveJob(c *gin.Context) {
	var job models.ProductImageArchiveJob
	if err := config.GetDB().First(&job, "id = ?", strings.TrimSpace(c.Param("id"))).Error; err != nil {
		c.JSON(http.StatusNotFound, models.APIResponse{Success: false, Message: "SKU image archive task not found", Error: "task_not_found"})
		return
	}
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Data: job})
}

func (mc *MediaController) GetLatestSKUImageArchiveJob(c *gin.Context) {
	var job models.ProductImageArchiveJob
	err := config.GetDB().Order("created_at DESC").First(&job).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		c.JSON(http.StatusOK, models.APIResponse{Success: true, Data: nil})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to load archive task", Error: err.Error()})
		return
	}
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Data: job})
}

func (mc *MediaController) PauseSKUImageArchiveJob(c *gin.Context) {
	jobID := strings.TrimSpace(c.Param("id"))
	result := config.GetDB().Model(&models.ProductImageArchiveJob{}).
		Where("id = ? AND status IN ?", jobID, []string{"queued", "running"}).
		Updates(map[string]interface{}{"status": "paused", "worker_token": "", "message": "paused by administrator"})
	if result.Error != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to pause archive task", Error: result.Error.Error()})
		return
	}
	if result.RowsAffected == 0 {
		c.JSON(http.StatusConflict, models.APIResponse{Success: false, Message: "Only queued or running archive tasks can be paused"})
		return
	}
	mc.GetSKUImageArchiveJob(c)
}

func (mc *MediaController) ResumeSKUImageArchiveJob(c *gin.Context) {
	jobID := strings.TrimSpace(c.Param("id"))
	result := config.GetDB().Model(&models.ProductImageArchiveJob{}).
		Where("id = ? AND status = ?", jobID, "paused").
		Updates(map[string]interface{}{"status": "queued", "worker_token": "", "message": "queued for resume"})
	if result.Error != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to resume archive task", Error: result.Error.Error()})
		return
	}
	if result.RowsAffected == 0 {
		c.JSON(http.StatusConflict, models.APIResponse{Success: false, Message: "Only paused archive tasks can be resumed"})
		return
	}
	go processSKUImageArchiveJob(jobID)
	mc.GetSKUImageArchiveJob(c)
}

func (mc *MediaController) CancelSKUImageArchiveJob(c *gin.Context) {
	jobID := strings.TrimSpace(c.Param("id"))
	lock := skuArchiveUploadLock(jobID)
	lock.Lock()
	defer lock.Unlock()
	db := config.GetDB()
	var job models.ProductImageArchiveJob
	if err := db.First(&job, "id = ?", jobID).Error; err != nil {
		c.JSON(http.StatusNotFound, models.APIResponse{Success: false, Message: "Archive task not found", Error: "task_not_found"})
		return
	}
	if job.Status != "uploading" && job.Status != "queued" && job.Status != "paused" && job.Status != "failed" {
		c.JSON(http.StatusConflict, models.APIResponse{Success: false, Message: "Upload, queued, paused, or failed tasks can be cancelled", Error: "invalid_cancel_status"})
		return
	}
	now := time.Now().UTC()
	if err := db.Model(&models.ProductImageArchiveJob{}).Where("id = ? AND status = ?", jobID, job.Status).
		Updates(map[string]interface{}{"status": "cancelled", "message": "cancelled by administrator", "completed_at": &now, "worker_token": ""}).Error; err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to cancel archive task", Error: err.Error()})
		return
	}
	_ = os.Remove(job.TempPath)
	_ = db.First(&job, "id = ?", jobID).Error
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "Archive task cancelled", Data: job})
}

func readZipImage(entry *zip.File) ([]byte, error) {
	reader, err := entry.Open()
	if err != nil {
		return nil, err
	}
	defer reader.Close()
	limit := skuArchiveMaxEntryBytes()
	data, err := io.ReadAll(io.LimitReader(reader, limit+1))
	if err != nil {
		return nil, err
	}
	if int64(len(data)) > limit {
		return nil, errors.New("expanded image exceeds configured limit")
	}
	return data, nil
}

func processSKUImageArchiveFolder(db *gorm.DB, folder skuArchiveFolder) (matched, updated, imported, duplicates int, err error) {
	var products []models.Product
	if err := db.Select("id", "sku").Where("LOWER(TRIM(sku)) = LOWER(?)", strings.TrimSpace(folder.SKU)).Find(&products).Error; err != nil {
		return 0, 0, 0, 0, err
	}
	if len(products) == 0 {
		return 0, 0, 0, 0, nil
	}
	if folder.TooManyImages {
		return len(products), 0, 0, 0, fmt.Errorf("SKU folder contains more than %d supported images", skuArchiveMaxImagesPerSKU())
	}
	matched = len(products)
	imageURLs := make([]string, 0, len(folder.Files))
	imageNames := make([]string, 0, len(folder.Files))
	seenURLs := make(map[string]bool)
	mediaFolder := filepath.ToSlash(filepath.Join("products", utils.CleanFilename(folder.SKU)))
	for _, entry := range folder.Files {
		data, readErr := readZipImage(entry)
		if readErr != nil {
			return matched, 0, imported, duplicates, fmt.Errorf("%s: %w", entry.Name, readErr)
		}
		asset, duplicate, storeErr := services.StoreMediaImageBytes(db, data, filepath.Base(entry.Name), mediaFolder, "product,sku-archive")
		if storeErr != nil {
			return matched, 0, imported, duplicates, fmt.Errorf("%s: %w", entry.Name, storeErr)
		}
		if duplicate {
			duplicates++
		} else {
			imported++
		}
		imageURL := asset.ToResponse().URL
		if !seenURLs[imageURL] {
			seenURLs[imageURL] = true
			imageURLs = append(imageURLs, imageURL)
			imageNames = append(imageNames, filepath.Base(entry.Name))
		}
	}
	if len(imageURLs) == 0 {
		return matched, 0, imported, duplicates, errors.New("SKU folder contains no usable images")
	}

	productIDs := make([]uint, 0, len(products))
	for _, product := range products {
		productIDs = append(productIDs, product.ID)
	}
	err = db.Transaction(func(tx *gorm.DB) error {
		var locked []models.Product
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Select("id").Where("id IN ?", productIDs).Find(&locked).Error; err != nil {
			return err
		}
		if err := tx.Model(&models.Product{}).Where("id IN ?", productIDs).Update("image_urls", toImageURLsJSON(imageURLs)).Error; err != nil {
			return err
		}
		for _, productID := range productIDs {
			if err := services.ClearExplicitProductImageTrust(tx, productID); err != nil {
				return err
			}
		}
		if hasImagesTable() {
			if err := tx.Where("product_id IN ?", productIDs).Delete(&models.ProductImage{}).Error; err != nil {
				return err
			}
			relations := make([]models.ProductImage, 0, len(productIDs)*len(imageURLs))
			for _, productID := range productIDs {
				for index, imageURL := range imageURLs {
					relation := models.ProductImage{
						ProductID: productID,
						URL:       imageURL,
						SortOrder: index,
						IsPrimary: index == 0,
					}
					if index < len(imageNames) {
						relation.Filename = imageNames[index]
						relation.OriginalName = imageNames[index]
					}
					relations = append(relations, relation)
				}
			}
			if len(relations) > 0 {
				if err := tx.CreateInBatches(&relations, 500).Error; err != nil {
					return err
				}
			}
		}
		return nil
	})
	if err != nil {
		return matched, 0, imported, duplicates, err
	}
	return matched, len(products), imported, duplicates, nil
}

func processSKUImageArchiveJob(jobID string) {
	workerLock := skuArchiveWorkerLock(jobID)
	workerLock.Lock()
	defer workerLock.Unlock()

	db := config.GetDB()
	workerToken := uuid.NewString()
	now := time.Now().UTC()
	claim := db.Model(&models.ProductImageArchiveJob{}).Where("id = ? AND status = ?", jobID, "queued").
		Updates(map[string]interface{}{"status": "running", "worker_token": workerToken, "started_at": &now, "message": "reading SKU folders"})
	if claim.Error != nil || claim.RowsAffected == 0 {
		return
	}
	var job models.ProductImageArchiveJob
	if err := db.First(&job, "id = ?", jobID).Error; err != nil {
		return
	}
	reader, folders, err := openSKUArchive(db, job.TempPath)
	if err != nil {
		finishSKUImageArchiveJob(jobID, workerToken, "failed", err.Error(), false)
		return
	}
	defer reader.Close()
	if len(folders) != job.TotalFolders {
		_ = db.Model(&models.ProductImageArchiveJob{}).Where("id = ? AND worker_token = ?", jobID, workerToken).Update("total_folders", len(folders)).Error
	}

	startIndex := job.LastFolderIndex
	if startIndex < 0 || startIndex > len(folders) {
		startIndex = 0
	}
	for index := startIndex; index < len(folders); index++ {
		var current models.ProductImageArchiveJob
		if err := db.Select("status", "worker_token").First(&current, "id = ?", jobID).Error; err != nil {
			return
		}
		if current.Status != "running" || current.WorkerToken != workerToken {
			go services.InvalidatePublicCaches(context.Background(), "product:sku-archive:paused", nil)
			return
		}
		folder := folders[index]
		matched, updated, imported, duplicates, folderErr := processSKUImageArchiveFolder(db, folder)
		skipped := 0
		failed := 0
		errorMessage := ""
		if folderErr != nil {
			failed = 1
			errorMessage = fmt.Sprintf("%s: %v", folder.SKU, folderErr)
		} else if matched == 0 {
			skipped = 1
		}
		updates := map[string]interface{}{
			"processed_folders": gorm.Expr("processed_folders + 1"),
			"last_folder_index": index + 1,
			"matched_products":  gorm.Expr("matched_products + ?", matched),
			"updated_products":  gorm.Expr("updated_products + ?", updated),
			"imported_images":   gorm.Expr("imported_images + ?", imported),
			"duplicate_images":  gorm.Expr("duplicate_images + ?", duplicates),
			"skipped_folders":   gorm.Expr("skipped_folders + ?", skipped),
			"failed_folders":    gorm.Expr("failed_folders + ?", failed),
			"message":           "processing SKU folder " + folder.SKU,
		}
		if errorMessage != "" {
			updates["error"] = errorMessage
		}
		result := db.Model(&models.ProductImageArchiveJob{}).
			Where("id = ? AND status = ? AND worker_token = ?", jobID, "running", workerToken).Updates(updates)
		if result.Error != nil || result.RowsAffected == 0 {
			return
		}
	}
	var finished models.ProductImageArchiveJob
	_ = db.First(&finished, "id = ?", jobID).Error
	status := "completed"
	if finished.FailedFolders > 0 {
		status = "completed_with_errors"
	}
	finishSKUImageArchiveJob(jobID, workerToken, status, finished.Error, true)
	go services.InvalidatePublicCaches(context.Background(), "product:sku-archive:completed", nil)
	services.TriggerNextRevalidate(nil, []string{"/products"}, true)
}

func finishSKUImageArchiveJob(jobID, workerToken, status, errorMessage string, removeArchive bool) {
	db := config.GetDB()
	var job models.ProductImageArchiveJob
	_ = db.Select("temp_path").First(&job, "id = ?", jobID).Error
	now := time.Now().UTC()
	message := "SKU image archive import completed"
	if status == "completed_with_errors" {
		message = "SKU image archive import completed with errors"
	} else if status == "failed" {
		message = "SKU image archive import failed"
	}
	result := db.Model(&models.ProductImageArchiveJob{}).
		Where("id = ? AND status = ? AND worker_token = ?", jobID, "running", workerToken).
		Updates(map[string]interface{}{"status": status, "worker_token": "", "message": message, "error": strings.TrimSpace(errorMessage), "completed_at": &now})
	if result.Error == nil && result.RowsAffected > 0 && removeArchive {
		_ = os.Remove(job.TempPath)
	}
}

func resumeSKUImageArchiveJobs() {
	db := config.GetDB()
	if db == nil || !db.Migrator().HasTable(&models.ProductImageArchiveJob{}) {
		return
	}
	if err := db.Model(&models.ProductImageArchiveJob{}).Where("status = ?", "running").
		Updates(map[string]interface{}{"status": "queued", "worker_token": "", "message": "queued after service restart"}).Error; err != nil {
		return
	}
	var jobs []models.ProductImageArchiveJob
	if err := db.Where("status = ?", "queued").Order("created_at ASC").Find(&jobs).Error; err != nil {
		return
	}
	for _, job := range jobs {
		go processSKUImageArchiveJob(job.ID)
	}
}

// ResumeProductImageManagementJobs restores durable cleanup and archive work
// after database initialization. Uploading jobs stay resumable but are not
// processed until the browser completes the remaining chunks.
func ResumeProductImageManagementJobs() {
	resumeProductImageCleanupJobs()
	resumeSKUImageArchiveJobs()
}
