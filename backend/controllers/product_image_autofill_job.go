package controllers

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"

	"fanuc-backend/config"
	"fanuc-backend/models"
	"fanuc-backend/services"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	defaultProductImageAutofillBatchSize = 250
	maxProductImageAutofillBatchSize     = 1000
)

type productImageAutofillStartRequest struct {
	Brand              string `json:"brand"`
	CategoryID         uint   `json:"category_id"`
	IncludeDescendants bool   `json:"include_descendants"`
	ProductStatus      string `json:"product_status"`
	BatchSize          int    `json:"batch_size"`
}

type productImageAutofillBrand struct {
	Name  string `json:"name"`
	Count int64  `json:"count"`
}

func normalizeProductImageAutofillBatchSize(value int) int {
	if value <= 0 {
		return defaultProductImageAutofillBatchSize
	}
	if value > maxProductImageAutofillBatchSize {
		return maxProductImageAutofillBatchSize
	}
	return value
}

func normalizeProductImageAutofillStatus(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "active":
		return "active"
	case "inactive":
		return "inactive"
	default:
		return "all"
	}
}

func productImageAutofillSelector(db *gorm.DB, brand string, categoryID uint, includeDescendants bool, productStatus string) (*gorm.DB, error) {
	if db == nil {
		return nil, errors.New("db is nil")
	}
	category := ""
	if categoryID > 0 {
		category = strconv.FormatUint(uint64(categoryID), 10)
	}
	selector := buildBulkProductSelector(db, bulkProductScopeReq{
		CategoryID:         category,
		IncludeDescendants: includeDescendants,
		Status:             normalizeProductImageAutofillStatus(productStatus),
	})
	if brand = strings.TrimSpace(brand); brand != "" {
		// Use the exact catalogue value (case-insensitive) instead of forcing a
		// small hard-coded brand registry. This supports every imported brand.
		selector = selector.Where("LOWER(TRIM(brand)) = LOWER(?)", brand)
	}
	return selector, nil
}

func defaultImageURLForSKUVersion(sku, version string) string {
	imageURL := defaultImageURLForSKU(sku)
	version = strings.TrimSpace(version)
	if version == "" {
		return imageURL
	}
	return imageURL + "&v=" + url.QueryEscape(version)
}

func currentWatermarkImageVersion(db *gorm.DB) string {
	if db == nil {
		return strconv.FormatInt(time.Now().UTC().Unix(), 10)
	}
	setting, err := services.GetOrCreateWatermarkSetting(db)
	if err != nil || setting.UpdatedAt.IsZero() {
		return strconv.FormatInt(time.Now().UTC().Unix(), 10)
	}
	return strconv.FormatInt(setting.UpdatedAt.UTC().Unix(), 10)
}

// StartProductImageAutofill creates a durable, fill-empty-only background job.
func (pc *ProductController) StartProductImageAutofill(c *gin.Context) {
	var req productImageAutofillStartRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Invalid request", Error: err.Error()})
		return
	}

	db := config.GetDB()
	setting, err := services.GetOrCreateWatermarkSetting(db)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to load default image settings", Error: err.Error()})
		return
	}
	if !setting.Enabled || setting.BaseMediaAssetID == nil || *setting.BaseMediaAssetID == 0 {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Enable the default product image and select a base image before starting SKU autofill", Error: "default_image_not_configured"})
		return
	}

	brand := strings.TrimSpace(req.Brand)
	status := normalizeProductImageAutofillStatus(req.ProductStatus)
	selector, err := productImageAutofillSelector(db, brand, req.CategoryID, req.IncludeDescendants, status)
	if err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Invalid product scope", Error: err.Error()})
		return
	}

	var scope struct {
		Total int64
		MaxID uint
	}
	if err := selector.Select("COUNT(*) AS total, COALESCE(MAX(id), 0) AS max_id").Scan(&scope).Error; err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to inspect product scope", Error: err.Error()})
		return
	}
	if scope.Total == 0 || scope.MaxID == 0 {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "No products matched the selected brand/category scope", Error: "empty_scope"})
		return
	}

	job := models.ProductImageAutofillJob{
		ID:                 uuid.NewString(),
		Status:             "queued",
		Brand:              brand,
		CategoryID:         req.CategoryID,
		IncludeDescendants: req.IncludeDescendants,
		ProductStatus:      status,
		BatchSize:          normalizeProductImageAutofillBatchSize(req.BatchSize),
		MaxProductID:       scope.MaxID,
		ImageVersion:       currentWatermarkImageVersion(db),
		Total:              int(scope.Total),
		Message:            "queued",
		CreatedByID:        c.GetUint("user_id"),
	}

	err = db.Transaction(func(tx *gorm.DB) error {
		var active int64
		if err := tx.Model(&models.ProductImageAutofillJob{}).
			Where("status IN ?", []string{"queued", "running", "paused"}).
			Count(&active).Error; err != nil {
			return err
		}
		if active > 0 {
			return errors.New("another SKU image autofill task is already queued, running, or paused")
		}
		return tx.Create(&job).Error
	})
	if err != nil {
		c.JSON(http.StatusConflict, models.APIResponse{Success: false, Message: "Failed to start SKU image autofill task", Error: err.Error()})
		return
	}

	go processProductImageAutofillJob(job.ID)
	c.JSON(http.StatusAccepted, models.APIResponse{Success: true, Message: "SKU image autofill task started", Data: job})
}

func (pc *ProductController) GetProductImageAutofillJob(c *gin.Context) {
	var job models.ProductImageAutofillJob
	if err := config.GetDB().First(&job, "id = ?", strings.TrimSpace(c.Param("id"))).Error; err != nil {
		c.JSON(http.StatusNotFound, models.APIResponse{Success: false, Message: "SKU image autofill task not found", Error: "task_not_found"})
		return
	}
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Data: job})
}

func (pc *ProductController) GetLatestProductImageAutofillJob(c *gin.Context) {
	var job models.ProductImageAutofillJob
	err := config.GetDB().Order("created_at DESC").First(&job).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "No SKU image autofill task", Data: nil})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to load SKU image autofill task", Error: err.Error()})
		return
	}
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Data: job})
}

func (pc *ProductController) PauseProductImageAutofillJob(c *gin.Context) {
	db := config.GetDB()
	result := db.Model(&models.ProductImageAutofillJob{}).
		Where("id = ? AND status IN ?", strings.TrimSpace(c.Param("id")), []string{"queued", "running"}).
		Updates(map[string]interface{}{"status": "paused", "worker_token": "", "message": "paused by administrator"})
	if result.Error != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to pause SKU image autofill task", Error: result.Error.Error()})
		return
	}
	if result.RowsAffected == 0 {
		c.JSON(http.StatusConflict, models.APIResponse{Success: false, Message: "Only queued or running tasks can be paused"})
		return
	}
	pc.GetProductImageAutofillJob(c)
}

func (pc *ProductController) ResumeProductImageAutofillJob(c *gin.Context) {
	jobID := strings.TrimSpace(c.Param("id"))
	result := config.GetDB().Model(&models.ProductImageAutofillJob{}).
		Where("id = ? AND status = ?", jobID, "paused").
		Updates(map[string]interface{}{"status": "queued", "worker_token": "", "message": "queued for resume"})
	if result.Error != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to resume SKU image autofill task", Error: result.Error.Error()})
		return
	}
	if result.RowsAffected == 0 {
		c.JSON(http.StatusConflict, models.APIResponse{Success: false, Message: "Only paused tasks can be resumed"})
		return
	}
	go processProductImageAutofillJob(jobID)
	pc.GetProductImageAutofillJob(c)
}

func (pc *ProductController) ListProductImageAutofillBrands(c *gin.Context) {
	var rows []struct {
		Brand string
		Count int64
	}
	if err := config.GetDB().Model(&models.Product{}).
		Select("brand, COUNT(*) AS count").
		Where("brand IS NOT NULL AND TRIM(brand) <> ''").
		Group("brand").
		Order("LOWER(brand) ASC, brand ASC").
		Find(&rows).Error; err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to load product brands", Error: err.Error()})
		return
	}

	counts := make(map[string]int64)
	names := make(map[string]string)
	for _, row := range rows {
		name := strings.TrimSpace(row.Brand)
		key := strings.ToLower(strings.TrimSpace(name))
		if key == "" {
			continue
		}
		counts[key] += row.Count
		if names[key] == "" {
			names[key] = name
		}
	}
	brands := make([]productImageAutofillBrand, 0, len(counts))
	for key, count := range counts {
		brands = append(brands, productImageAutofillBrand{Name: names[key], Count: count})
	}
	sort.Slice(brands, func(i, j int) bool {
		if brands[i].Count == brands[j].Count {
			return brands[i].Name < brands[j].Name
		}
		return brands[i].Count > brands[j].Count
	})
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Data: brands})
}

func processProductImageAutofillJob(jobID string) {
	db := config.GetDB()
	if db == nil {
		return
	}
	now := time.Now().UTC()
	workerToken := uuid.NewString()
	claim := db.Model(&models.ProductImageAutofillJob{}).
		Where("id = ? AND status = ?", jobID, "queued").
		Updates(map[string]interface{}{
			"status":       "running",
			"worker_token": workerToken,
			"started_at":   &now,
			"message":      "scanning products with empty images",
		})
	if claim.Error != nil || claim.RowsAffected == 0 {
		return
	}

	for {
		var job models.ProductImageAutofillJob
		if err := db.First(&job, "id = ?", jobID).Error; err != nil {
			return
		}
		if job.Status != "running" || job.WorkerToken != workerToken {
			go services.InvalidatePublicCaches(context.Background(), "product:sku-image-autofill:paused", nil)
			return
		}

		selector, err := productImageAutofillSelector(db, job.Brand, job.CategoryID, job.IncludeDescendants, job.ProductStatus)
		if err != nil {
			finishProductImageAutofillJob(jobID, workerToken, "failed", err.Error())
			return
		}
		var products []models.Product
		if err := selector.Select("id", "sku", "image_urls").
			Where("id > ? AND id <= ?", job.LastProductID, job.MaxProductID).
			Order("id ASC").Limit(normalizeProductImageAutofillBatchSize(job.BatchSize)).
			Find(&products).Error; err != nil {
			finishProductImageAutofillJob(jobID, workerToken, "failed", err.Error())
			return
		}
		if len(products) == 0 {
			status := "completed"
			if job.Failed > 0 {
				status = "completed_with_errors"
			}
			finishProductImageAutofillJob(jobID, workerToken, status, "")
			go services.InvalidatePublicCaches(context.Background(), "product:sku-image-autofill:completed", nil)
			return
		}

		lastID := products[len(products)-1].ID
		batchUpdated := 0
		batchSkipped := 0
		batchFailed := 0
		err = db.Transaction(func(tx *gorm.DB) error {
			for _, product := range products {
				var current models.Product
				if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Select("id", "sku", "image_urls").First(&current, product.ID).Error; err != nil {
					return err
				}
				if len(parseImageURLsJSON(current.ImageURLs)) > 0 {
					batchSkipped++
					continue
				}
				sku := strings.TrimSpace(current.SKU)
				if sku == "" {
					batchFailed++
					continue
				}
				imageURL := defaultImageURLForSKUVersion(sku, job.ImageVersion)
				if err := tx.Model(&models.Product{}).Where("id = ?", current.ID).
					Update("image_urls", toImageURLsJSON([]string{imageURL})).Error; err != nil {
					return err
				}
				if err := services.ClearExplicitProductImageTrust(tx, current.ID); err != nil {
					return err
				}
				batchUpdated++
			}

			processed := batchUpdated + batchSkipped + batchFailed
			result := tx.Model(&models.ProductImageAutofillJob{}).
				Where("id = ? AND status = ? AND worker_token = ?", jobID, "running", workerToken).
				Updates(map[string]interface{}{
					"last_product_id": lastID,
					"processed":       gorm.Expr("processed + ?", processed),
					"updated":         gorm.Expr("updated + ?", batchUpdated),
					"skipped":         gorm.Expr("skipped + ?", batchSkipped),
					"failed":          gorm.Expr("failed + ?", batchFailed),
					"message":         fmt.Sprintf("processed through product %d", lastID),
				})
			if result.Error != nil {
				return result.Error
			}
			if result.RowsAffected == 0 {
				return errors.New("SKU image autofill task is no longer running")
			}
			return nil
		})
		if err != nil {
			var current models.ProductImageAutofillJob
			if reloadErr := db.First(&current, "id = ?", jobID).Error; reloadErr == nil && current.Status == "paused" {
				return
			}
			finishProductImageAutofillJob(jobID, workerToken, "failed", err.Error())
			return
		}
	}
}

func finishProductImageAutofillJob(jobID, workerToken, status, errorMessage string) {
	now := time.Now().UTC()
	message := "SKU image autofill completed"
	if status == "completed_with_errors" {
		message = "SKU image autofill completed with skipped errors"
	} else if status == "failed" {
		message = "SKU image autofill failed"
	}
	config.GetDB().Model(&models.ProductImageAutofillJob{}).
		Where("id = ? AND status = ? AND worker_token = ?", jobID, "running", workerToken).
		Updates(map[string]interface{}{
			"status":       status,
			"worker_token": "",
			"message":      message,
			"error":        strings.TrimSpace(errorMessage),
			"completed_at": &now,
		})
}

// ResumeProductImageAutofillJobs is called after database initialization. Any
// interrupted worker is safely returned to the queue, while administrator-
// paused tasks remain paused.
func ResumeProductImageAutofillJobs() {
	db := config.GetDB()
	if db == nil || !db.Migrator().HasTable(&models.ProductImageAutofillJob{}) {
		return
	}
	if err := db.Model(&models.ProductImageAutofillJob{}).
		Where("status = ?", "running").
		Updates(map[string]interface{}{"status": "queued", "worker_token": "", "message": "queued after service restart"}).Error; err != nil {
		return
	}
	var jobs []models.ProductImageAutofillJob
	if err := db.Where("status = ?", "queued").Order("created_at ASC").Find(&jobs).Error; err != nil {
		return
	}
	for _, job := range jobs {
		go processProductImageAutofillJob(job.ID)
	}
}
