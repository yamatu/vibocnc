package controllers

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"os"
	"sort"
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

const productImageCleanupPreviewSampleLimit = 50

type productImageCleanupRequest struct {
	TrustedDomains     []string `json:"trusted_domains"`
	Brand              string   `json:"brand"`
	CategoryID         uint     `json:"category_id"`
	IncludeDescendants bool     `json:"include_descendants"`
	ProductStatus      string   `json:"product_status"`
	BatchSize          int      `json:"batch_size"`
}

type productImageCleanupSample struct {
	ProductID uint   `json:"product_id"`
	SKU       string `json:"sku"`
	Name      string `json:"name"`
	ImageURL  string `json:"image_url"`
	Hostname  string `json:"hostname"`
}

type productImageCleanupPreview struct {
	ScannedProducts  int                         `json:"scanned_products"`
	AffectedProducts int                         `json:"affected_products"`
	RemovableImages  int                         `json:"removable_images"`
	PreservedImages  int                         `json:"preserved_images"`
	TrustedDomains   []string                    `json:"trusted_domains"`
	Samples          []productImageCleanupSample `json:"samples"`
}

func getOrCreateProductImagePolicySetting(db *gorm.DB) (*models.ProductImagePolicySetting, error) {
	if db == nil {
		return nil, errors.New("db is nil")
	}
	var setting models.ProductImagePolicySetting
	if err := db.First(&setting, 1).Error; err != nil {
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, err
		}
		defaults := normalizeTrustedImageDomains([]string{os.Getenv("PRODUCT_IMAGE_TRUSTED_DOMAINS")})
		defaultsJSON, _ := json.Marshal(defaults)
		setting = models.ProductImagePolicySetting{ID: 1, TrustedDomainsJSON: string(defaultsJSON)}
		if err := db.Create(&setting).Error; err != nil {
			// Another request may have initialized the singleton concurrently.
			if retryErr := db.First(&setting, 1).Error; retryErr != nil {
				return nil, err
			}
		}
	}
	setting.TrustedDomains = nil
	if strings.TrimSpace(setting.TrustedDomainsJSON) == "" {
		setting.TrustedDomains = []string{}
	} else if err := json.Unmarshal([]byte(setting.TrustedDomainsJSON), &setting.TrustedDomains); err != nil {
		return nil, errors.New("product image policy contains invalid trusted-domain data")
	}
	return &setting, nil
}

func (pc *ProductController) GetProductImagePolicySettings(c *gin.Context) {
	setting, err := getOrCreateProductImagePolicySetting(config.GetDB())
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to load product image policy", Error: err.Error()})
		return
	}
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Data: setting})
}

func (pc *ProductController) UpdateProductImagePolicySettings(c *gin.Context) {
	var req struct {
		TrustedDomains []string `json:"trusted_domains"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Invalid product image policy", Error: err.Error()})
		return
	}
	domains := normalizeTrustedImageDomains(req.TrustedDomains)
	domainsJSON, _ := json.Marshal(domains)
	db := config.GetDB()
	setting, err := getOrCreateProductImagePolicySetting(db)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to load product image policy", Error: err.Error()})
		return
	}
	if err := db.Model(setting).Update("trusted_domains_json", string(domainsJSON)).Error; err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to update product image policy", Error: err.Error()})
		return
	}
	setting.TrustedDomainsJSON = string(domainsJSON)
	setting.TrustedDomains = domains
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "Product image policy updated", Data: setting})
}

func normalizeTrustedImageDomains(values []string) []string {
	seen := make(map[string]bool)
	domains := make([]string, 0, len(values)+1)
	for _, raw := range values {
		parts := strings.FieldsFunc(raw, func(r rune) bool {
			return r == ',' || r == ';' || r == '\n' || r == '\r' || r == '\t'
		})
		for _, part := range parts {
			value := strings.TrimSpace(strings.ToLower(part))
			value = strings.TrimPrefix(value, "*.")
			if value == "" {
				continue
			}
			candidate := value
			if !strings.Contains(candidate, "://") {
				candidate = "https://" + candidate
			}
			parsed, err := url.Parse(candidate)
			if err != nil {
				continue
			}
			host := strings.TrimSuffix(strings.ToLower(strings.TrimSpace(parsed.Hostname())), ".")
			if host == "" || seen[host] {
				continue
			}
			seen[host] = true
			domains = append(domains, host)
		}
	}
	sort.Strings(domains)
	return domains
}

func resolveTrustedImageDomains(db *gorm.DB, requested []string) ([]string, error) {
	if requested != nil {
		return normalizeTrustedImageDomains(requested), nil
	}
	setting, err := getOrCreateProductImagePolicySetting(db)
	if err != nil {
		return nil, err
	}
	return normalizeTrustedImageDomains(setting.TrustedDomains), nil
}

func decodeProductImageTrustedDomains(raw string) ([]string, error) {
	if strings.TrimSpace(raw) == "" {
		return []string{}, nil
	}
	var domains []string
	if err := json.Unmarshal([]byte(raw), &domains); err != nil {
		return nil, errors.New("product image cleanup job contains invalid trusted-domain data")
	}
	return normalizeTrustedImageDomains(domains), nil
}

func imageHostname(raw string) string {
	value := strings.TrimSpace(raw)
	if strings.HasPrefix(value, "//") {
		value = "https:" + value
	}
	parsed, err := url.Parse(value)
	if err != nil {
		return ""
	}
	return strings.TrimSuffix(strings.ToLower(strings.TrimSpace(parsed.Hostname())), ".")
}

func hostnameMatchesTrustedDomain(host string, trustedDomains []string) bool {
	host = strings.TrimSuffix(strings.ToLower(strings.TrimSpace(host)), ".")
	if host == "" {
		return false
	}
	owned := append([]string{"vibocnc.com", "localhost", "127.0.0.1", "::1"}, trustedDomains...)
	for _, envName := range []string{"FRONTEND_URL", "PUBLIC_SITE_URL", "NEXT_PUBLIC_SITE_URL", "API_BASE_URL", "NEXT_PUBLIC_API_BASE_URL"} {
		if raw := strings.TrimSpace(os.Getenv(envName)); raw != "" {
			if parsed, err := url.Parse(raw); err == nil && parsed.Hostname() != "" {
				owned = append(owned, parsed.Hostname())
			}
		}
	}
	for _, domain := range owned {
		domain = strings.TrimSuffix(strings.ToLower(strings.TrimSpace(domain)), ".")
		if domain != "" && (host == domain || strings.HasSuffix(host, "."+domain)) {
			return true
		}
	}
	return false
}

func isTrustedProductImageURL(raw string, trustedDomains []string) bool {
	value := strings.TrimSpace(raw)
	if value == "" {
		return true
	}
	lower := strings.ToLower(value)
	if (strings.HasPrefix(lower, "/") && !strings.HasPrefix(lower, "//")) || strings.HasPrefix(lower, "uploads/") {
		return true
	}
	if strings.HasPrefix(lower, "data:") || strings.HasPrefix(lower, "blob:") {
		return true
	}
	parsedValue := value
	if strings.HasPrefix(parsedValue, "//") {
		parsedValue = "https:" + parsedValue
	}
	parsed, err := url.Parse(parsedValue)
	if err != nil || parsed.Hostname() == "" {
		// Unknown/non-URL values are preserved instead of guessed as destructive.
		return true
	}
	scheme := strings.ToLower(parsed.Scheme)
	if scheme != "http" && scheme != "https" {
		return true
	}
	return hostnameMatchesTrustedDomain(parsed.Hostname(), trustedDomains)
}

func splitTrustedAndUntrustedImages(urls []string, trustedDomains []string) (kept []string, removed []string) {
	kept = make([]string, 0, len(urls))
	removed = make([]string, 0)
	for _, imageURL := range urls {
		if isTrustedProductImageURL(imageURL, trustedDomains) {
			kept = append(kept, imageURL)
		} else {
			removed = append(removed, imageURL)
		}
	}
	return kept, removed
}

func splitTrustedAndUntrustedImagesForProduct(urls []string, trustedDomains []string, explicit map[string]struct{}) (kept []string, removed []string) {
	kept = make([]string, 0, len(urls))
	removed = make([]string, 0)
	for _, imageURL := range urls {
		if isTrustedProductImageURL(imageURL, trustedDomains) {
			kept = append(kept, imageURL)
			continue
		}
		if _, ok := explicit[services.ProductImageURLHash(imageURL)]; ok {
			kept = append(kept, imageURL)
			continue
		}
		removed = append(removed, imageURL)
	}
	return kept, removed
}

func productImageCleanupScope(db *gorm.DB, req productImageCleanupRequest) (*gorm.DB, error) {
	return productImageAutofillSelector(db, req.Brand, req.CategoryID, req.IncludeDescendants, req.ProductStatus)
}

func (pc *ProductController) PreviewUntrustedProductImages(c *gin.Context) {
	var req productImageCleanupRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Invalid cleanup preview request", Error: err.Error()})
		return
	}
	trustedDomains, err := resolveTrustedImageDomains(config.GetDB(), req.TrustedDomains)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to load product image policy", Error: err.Error()})
		return
	}
	selector, err := productImageCleanupScope(config.GetDB(), req)
	if err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Invalid product scope", Error: err.Error()})
		return
	}

	preview := productImageCleanupPreview{
		TrustedDomains: trustedDomains,
		Samples:        make([]productImageCleanupSample, 0, productImageCleanupPreviewSampleLimit),
	}
	var batch []models.Product
	err = selector.Select("id", "sku", "name", "image_urls").Order("id ASC").FindInBatches(&batch, 500, func(txBatch *gorm.DB, _ int) error {
		productIDs := make([]uint, 0, len(batch))
		for _, product := range batch {
			productIDs = append(productIDs, product.ID)
		}
		var relations []models.ProductImage
		if len(productIDs) > 0 && hasImagesTable() {
			relationDB := txBatch.Session(&gorm.Session{NewDB: true}).Model(&models.ProductImage{}).
				Select("*").Where("product_id IN ?", productIDs).Order("sort_order ASC, id ASC")
			if err := relationDB.Find(&relations).Error; err != nil {
				return err
			}
		}
		explicitTrust, err := services.LoadExplicitProductImageTrust(txBatch, productIDs)
		if err != nil {
			return err
		}
		relationsByProduct := make(map[uint][]models.ProductImage)
		for _, relation := range relations {
			relationsByProduct[relation.ProductID] = append(relationsByProduct[relation.ProductID], relation)
		}
		for _, product := range batch {
			preview.ScannedProducts++
			affected := false
			urls := parseImageURLsJSON(product.ImageURLs)
			kept, removed := splitTrustedAndUntrustedImagesForProduct(urls, trustedDomains, explicitTrust[product.ID])
			preview.PreservedImages += len(kept)
			preview.RemovableImages += len(removed)
			affected = len(removed) > 0
			for _, imageURL := range removed {
				if len(preview.Samples) >= productImageCleanupPreviewSampleLimit {
					break
				}
				preview.Samples = append(preview.Samples, productImageCleanupSample{
					ProductID: product.ID,
					SKU:       product.SKU,
					Name:      product.Name,
					ImageURL:  imageURL,
					Hostname:  imageHostname(imageURL),
				})
			}
			for _, relation := range relationsByProduct[product.ID] {
				if isTrustedProductImageURL(relation.URL, trustedDomains) || trustContainsURL(explicitTrust[product.ID], relation.URL) {
					preview.PreservedImages++
					continue
				}
				affected = true
				preview.RemovableImages++
				if len(preview.Samples) < productImageCleanupPreviewSampleLimit {
					preview.Samples = append(preview.Samples, productImageCleanupSample{
						ProductID: product.ID, SKU: product.SKU, Name: product.Name, ImageURL: relation.URL, Hostname: imageHostname(relation.URL),
					})
				}
			}
			if affected {
				preview.AffectedProducts++
			}
		}
		return nil
	}).Error
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to preview product images", Error: err.Error()})
		return
	}
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "Product image cleanup preview completed", Data: preview})
}

func trustContainsURL(explicit map[string]struct{}, rawURL string) bool {
	_, ok := explicit[services.ProductImageURLHash(rawURL)]
	return ok
}

func (pc *ProductController) StartUntrustedProductImageCleanup(c *gin.Context) {
	var req productImageCleanupRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Invalid cleanup request", Error: err.Error()})
		return
	}
	trustedDomains, err := resolveTrustedImageDomains(config.GetDB(), req.TrustedDomains)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to load product image policy", Error: err.Error()})
		return
	}
	trustedJSON, _ := json.Marshal(trustedDomains)
	selector, err := productImageCleanupScope(config.GetDB(), req)
	if err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Invalid product scope", Error: err.Error()})
		return
	}
	var scope struct {
		Total int64
		MaxID uint
	}
	if err := selector.Select("COUNT(*) AS total, COALESCE(MAX(id), 0) AS max_id").Scan(&scope).Error; err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to inspect cleanup scope", Error: err.Error()})
		return
	}
	if scope.Total == 0 {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "No products matched the cleanup scope", Error: "empty_scope"})
		return
	}

	job := models.ProductImageCleanupJob{
		ID:                 uuid.NewString(),
		Status:             "queued",
		TrustedDomainsJSON: string(trustedJSON),
		TrustedDomains:     trustedDomains,
		Brand:              strings.TrimSpace(req.Brand),
		CategoryID:         req.CategoryID,
		IncludeDescendants: req.IncludeDescendants,
		ProductStatus:      normalizeProductImageAutofillStatus(req.ProductStatus),
		BatchSize:          normalizeProductImageAutofillBatchSize(req.BatchSize),
		MaxProductID:       scope.MaxID,
		Total:              int(scope.Total),
		Message:            "queued",
		CreatedByID:        c.GetUint("user_id"),
	}
	db := config.GetDB()
	if _, err := getOrCreateProductImagePolicySetting(db); err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to prepare product image cleanup", Error: err.Error()})
		return
	}
	err = db.Transaction(func(tx *gorm.DB) error {
		var policy models.ProductImagePolicySetting
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&policy, 1).Error; err != nil {
			return err
		}
		var active int64
		if err := tx.Model(&models.ProductImageCleanupJob{}).Where("status IN ?", []string{"queued", "running", "paused"}).Count(&active).Error; err != nil {
			return err
		}
		if active > 0 {
			return errors.New("another product image cleanup task is already active")
		}
		return tx.Create(&job).Error
	})
	if err != nil {
		c.JSON(http.StatusConflict, models.APIResponse{Success: false, Message: "Failed to start product image cleanup", Error: err.Error()})
		return
	}
	go processProductImageCleanupJob(job.ID)
	c.JSON(http.StatusAccepted, models.APIResponse{Success: true, Message: "Product image cleanup started", Data: job})
}

func hydrateProductImageCleanupJob(job *models.ProductImageCleanupJob) error {
	if job == nil {
		return errors.New("cleanup job is nil")
	}
	domains, err := decodeProductImageTrustedDomains(job.TrustedDomainsJSON)
	if err != nil {
		return err
	}
	job.TrustedDomains = domains
	return nil
}

func (pc *ProductController) GetProductImageCleanupJob(c *gin.Context) {
	var job models.ProductImageCleanupJob
	if err := config.GetDB().First(&job, "id = ?", strings.TrimSpace(c.Param("id"))).Error; err != nil {
		c.JSON(http.StatusNotFound, models.APIResponse{Success: false, Message: "Product image cleanup task not found", Error: "task_not_found"})
		return
	}
	if err := hydrateProductImageCleanupJob(&job); err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Product image cleanup task has invalid policy data", Error: err.Error()})
		return
	}
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Data: job})
}

func (pc *ProductController) GetLatestProductImageCleanupJob(c *gin.Context) {
	var job models.ProductImageCleanupJob
	err := config.GetDB().Order("created_at DESC").First(&job).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		c.JSON(http.StatusOK, models.APIResponse{Success: true, Data: nil})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to load cleanup task", Error: err.Error()})
		return
	}
	if err := hydrateProductImageCleanupJob(&job); err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Product image cleanup task has invalid policy data", Error: err.Error()})
		return
	}
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Data: job})
}

func (pc *ProductController) PauseProductImageCleanupJob(c *gin.Context) {
	jobID := strings.TrimSpace(c.Param("id"))
	result := config.GetDB().Model(&models.ProductImageCleanupJob{}).
		Where("id = ? AND status IN ?", jobID, []string{"queued", "running"}).
		Updates(map[string]interface{}{"status": "paused", "worker_token": "", "message": "paused by administrator"})
	if result.Error != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to pause cleanup task", Error: result.Error.Error()})
		return
	}
	if result.RowsAffected == 0 {
		c.JSON(http.StatusConflict, models.APIResponse{Success: false, Message: "Only queued or running cleanup tasks can be paused"})
		return
	}
	pc.GetProductImageCleanupJob(c)
}

func (pc *ProductController) ResumeProductImageCleanupJob(c *gin.Context) {
	jobID := strings.TrimSpace(c.Param("id"))
	result := config.GetDB().Model(&models.ProductImageCleanupJob{}).
		Where("id = ? AND status = ?", jobID, "paused").
		Updates(map[string]interface{}{"status": "queued", "worker_token": "", "message": "queued for resume"})
	if result.Error != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to resume cleanup task", Error: result.Error.Error()})
		return
	}
	if result.RowsAffected == 0 {
		c.JSON(http.StatusConflict, models.APIResponse{Success: false, Message: "Only paused cleanup tasks can be resumed"})
		return
	}
	go processProductImageCleanupJob(jobID)
	pc.GetProductImageCleanupJob(c)
}

func processProductImageCleanupJob(jobID string) {
	db := config.GetDB()
	workerToken := uuid.NewString()
	now := time.Now().UTC()
	claim := db.Model(&models.ProductImageCleanupJob{}).
		Where("id = ? AND status = ?", jobID, "queued").
		Updates(map[string]interface{}{"status": "running", "worker_token": workerToken, "started_at": &now, "message": "scanning product images"})
	if claim.Error != nil || claim.RowsAffected == 0 {
		return
	}

	for {
		var job models.ProductImageCleanupJob
		if err := db.First(&job, "id = ?", jobID).Error; err != nil {
			return
		}
		if job.Status != "running" || job.WorkerToken != workerToken {
			go services.InvalidatePublicCaches(context.Background(), "product:image-cleanup:paused", nil)
			return
		}
		if err := hydrateProductImageCleanupJob(&job); err != nil {
			finishProductImageCleanupJob(jobID, workerToken, "failed", err.Error())
			return
		}
		selector, err := productImageCleanupScope(db, productImageCleanupRequest{
			Brand: job.Brand, CategoryID: job.CategoryID, IncludeDescendants: job.IncludeDescendants, ProductStatus: job.ProductStatus,
		})
		if err != nil {
			finishProductImageCleanupJob(jobID, workerToken, "failed", err.Error())
			return
		}
		var products []models.Product
		if err := selector.Select("id", "sku", "image_urls").Where("id > ? AND id <= ?", job.LastProductID, job.MaxProductID).
			Order("id ASC").Limit(normalizeProductImageAutofillBatchSize(job.BatchSize)).Find(&products).Error; err != nil {
			finishProductImageCleanupJob(jobID, workerToken, "failed", err.Error())
			return
		}
		if len(products) == 0 {
			status := "completed"
			if job.Failed > 0 {
				status = "completed_with_errors"
			}
			finishProductImageCleanupJob(jobID, workerToken, status, "")
			go services.InvalidatePublicCaches(context.Background(), "product:image-cleanup:completed", nil)
			services.TriggerNextRevalidate(nil, []string{"/products"}, true)
			return
		}

		lastID := products[len(products)-1].ID
		batchUpdated := 0
		batchSkipped := 0
		batchRemoved := 0
		err = db.Transaction(func(tx *gorm.DB) error {
			productIDs := make([]uint, 0, len(products))
			for _, product := range products {
				productIDs = append(productIDs, product.ID)
			}
			var lockedProducts []models.Product
			if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Select("id", "image_urls").Where("id IN ?", productIDs).Find(&lockedProducts).Error; err != nil {
				return err
			}
			lockedByID := make(map[uint]models.Product, len(lockedProducts))
			for _, product := range lockedProducts {
				lockedByID[product.ID] = product
			}
			var relations []models.ProductImage
			if len(productIDs) > 0 && hasImagesTable() {
				relationDB := tx.Session(&gorm.Session{NewDB: true}).Model(&models.ProductImage{}).
					Select("*").Where("product_id IN ?", productIDs)
				if err := relationDB.Find(&relations).Error; err != nil {
					return err
				}
			}
			explicitTrust, err := services.LoadExplicitProductImageTrust(tx, productIDs)
			if err != nil {
				return err
			}
			relationsByProduct := make(map[uint][]models.ProductImage, len(productIDs))
			for _, relation := range relations {
				relationsByProduct[relation.ProductID] = append(relationsByProduct[relation.ProductID], relation)
			}

			for _, product := range products {
				current, exists := lockedByID[product.ID]
				if !exists {
					batchSkipped++
					continue
				}
				urls := parseImageURLsJSON(current.ImageURLs)
				kept, removed := splitTrustedAndUntrustedImagesForProduct(urls, job.TrustedDomains, explicitTrust[current.ID])
				relationIDs := make([]uint, 0)
				for _, relation := range relationsByProduct[current.ID] {
					if !isTrustedProductImageURL(relation.URL, job.TrustedDomains) && !trustContainsURL(explicitTrust[current.ID], relation.URL) {
						relationIDs = append(relationIDs, relation.ID)
					}
				}
				if len(removed) == 0 && len(relationIDs) == 0 {
					batchSkipped++
					continue
				}
				if len(removed) > 0 {
					if err := tx.Model(&models.Product{}).Where("id = ?", current.ID).Update("image_urls", toImageURLsJSON(kept)).Error; err != nil {
						return err
					}
				}
				if len(relationIDs) > 0 {
					if err := tx.Where("id IN ?", relationIDs).Delete(&models.ProductImage{}).Error; err != nil {
						return err
					}
				}
				batchUpdated++
				batchRemoved += len(removed) + len(relationIDs)
			}
			processed := batchUpdated + batchSkipped
			result := tx.Model(&models.ProductImageCleanupJob{}).
				Where("id = ? AND status = ? AND worker_token = ?", jobID, "running", workerToken).
				Updates(map[string]interface{}{
					"last_product_id":  lastID,
					"processed":        gorm.Expr("processed + ?", processed),
					"updated_products": gorm.Expr("updated_products + ?", batchUpdated),
					"skipped_products": gorm.Expr("skipped_products + ?", batchSkipped),
					"removed_images":   gorm.Expr("removed_images + ?", batchRemoved),
					"message":          "removing untrusted external image URLs",
				})
			if result.Error != nil {
				return result.Error
			}
			if result.RowsAffected == 0 {
				return errors.New("cleanup task is no longer running")
			}
			return nil
		})
		if err != nil {
			var current models.ProductImageCleanupJob
			if reloadErr := db.First(&current, "id = ?", jobID).Error; reloadErr == nil && current.Status == "paused" {
				return
			}
			finishProductImageCleanupJob(jobID, workerToken, "failed", err.Error())
			return
		}
	}
}

func finishProductImageCleanupJob(jobID, workerToken, status, errorMessage string) {
	now := time.Now().UTC()
	message := "product image cleanup completed"
	if status == "completed_with_errors" {
		message = "product image cleanup completed with errors"
	} else if status == "failed" {
		message = "product image cleanup failed"
	}
	config.GetDB().Model(&models.ProductImageCleanupJob{}).
		Where("id = ? AND status = ? AND worker_token = ?", jobID, "running", workerToken).
		Updates(map[string]interface{}{"status": status, "worker_token": "", "message": message, "error": strings.TrimSpace(errorMessage), "completed_at": &now})
}

func resumeProductImageCleanupJobs() {
	db := config.GetDB()
	if db == nil || !db.Migrator().HasTable(&models.ProductImageCleanupJob{}) {
		return
	}
	if err := db.Model(&models.ProductImageCleanupJob{}).Where("status = ?", "running").
		Updates(map[string]interface{}{"status": "queued", "worker_token": "", "message": "queued after service restart"}).Error; err != nil {
		return
	}
	var jobs []models.ProductImageCleanupJob
	if err := db.Where("status = ?", "queued").Order("created_at ASC").Find(&jobs).Error; err != nil {
		return
	}
	for _, job := range jobs {
		go processProductImageCleanupJob(job.ID)
	}
}
