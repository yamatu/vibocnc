package controllers

import (
	"context"
	"net/http"
	"strconv"
	"strings"
	"time"

	"fanuc-backend/config"
	"fanuc-backend/models"
	"fanuc-backend/services"

	"github.com/gin-gonic/gin"
)

type IndexNowController struct{}

type updateIndexNowSettingsRequest struct {
	Enabled                  *bool   `json:"enabled"`
	Key                      *string `json:"key"`
	SiteURL                  *string `json:"site_url"`
	AutoSubmitProductUpdates *bool   `json:"auto_submit_product_updates"`
}

type submitIndexNowURLsRequest struct {
	URLs       []string `json:"urls"`
	ProductIDs []uint   `json:"product_ids"`
}

type submitIndexNowProductsRequest struct {
	Mode      string `json:"mode"`
	Limit     int    `json:"limit"`
	BatchSize int    `json:"batch_size"`
}

type indexNowProductStatusResponse struct {
	TotalProducts       int64 `json:"total_products"`
	SubmittedProducts   int64 `json:"submitted_products"`
	UnsubmittedProducts int64 `json:"unsubmitted_products"`
}

func indexNowHTTPStatus(result *services.IndexNowSubmitResult, fallback int) int {
	if result != nil && result.StatusCode >= 400 && result.StatusCode <= 599 {
		return result.StatusCode
	}
	return fallback
}

func (ic *IndexNowController) GetSettings(c *gin.Context) {
	db := config.GetDB()
	if db == nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Database not initialized"})
		return
	}
	service := services.NewIndexNowService(db)
	s, err := service.GetOrCreateSetting()
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to load IndexNow settings", Error: err.Error()})
		return
	}
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "OK", Data: services.BuildIndexNowResponse(s)})
}

func (ic *IndexNowController) VerifyKey(c *gin.Context) {
	db := config.GetDB()
	if db == nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Database not initialized"})
		return
	}

	service := services.NewIndexNowService(db)
	ctx, cancel := context.WithTimeout(c.Request.Context(), 20*time.Second)
	defer cancel()

	result, err := service.VerifyKeyFile(ctx)
	if err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{
			Success: false,
			Message: "IndexNow key file verification failed",
			Error:   err.Error(),
			Data:    result,
		})
		return
	}

	c.JSON(http.StatusOK, models.APIResponse{
		Success: true,
		Message: "IndexNow key file is reachable",
		Data:    result,
	})
}

func (ic *IndexNowController) UpdateSettings(c *gin.Context) {
	var req updateIndexNowSettingsRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Invalid request", Error: err.Error()})
		return
	}

	db := config.GetDB()
	if db == nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Database not initialized"})
		return
	}
	service := services.NewIndexNowService(db)
	s, err := service.GetOrCreateSetting()
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to load IndexNow settings", Error: err.Error()})
		return
	}

	if req.Enabled != nil {
		s.Enabled = *req.Enabled
	}
	if req.Key != nil {
		key := strings.TrimSpace(*req.Key)
		if key != "" && len(key) < 8 {
			c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Invalid key", Error: "key is too short"})
			return
		}
		s.Key = key
	}
	if req.SiteURL != nil {
		s.SiteURL = strings.TrimSpace(*req.SiteURL)
	}
	if req.AutoSubmitProductUpdates != nil {
		s.AutoSubmitProductUpdates = *req.AutoSubmitProductUpdates
	}

	if err := db.Save(s).Error; err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to save IndexNow settings", Error: err.Error()})
		return
	}

	c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "Saved", Data: services.BuildIndexNowResponse(s)})
}

func (ic *IndexNowController) Submit(c *gin.Context) {
	var req submitIndexNowURLsRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Invalid request", Error: err.Error()})
		return
	}

	db := config.GetDB()
	if db == nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Database not initialized"})
		return
	}

	service := services.NewIndexNowService(db)
	setting, err := service.GetOrCreateSetting()
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to load IndexNow settings", Error: err.Error()})
		return
	}

	urls := make([]string, 0, len(req.URLs)+len(req.ProductIDs))
	urls = append(urls, req.URLs...)

	if len(req.ProductIDs) > 0 {
		var products []models.Product
		if err := db.Select("id", "sku").Where("id IN ?", req.ProductIDs).Find(&products).Error; err != nil {
			c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to load products", Error: err.Error()})
			return
		}
		productIDs := make([]uint, 0, len(products))
		for _, product := range products {
			urls = append(urls, services.BuildProductCanonicalURL(setting.SiteURL, product.SKU))
			productIDs = append(productIDs, product.ID)
		}

		_ = productIDs
	}

	if len(urls) == 0 {
		urls = services.BuildDefaultIndexNowURLs(setting.SiteURL)
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 25*time.Second)
	defer cancel()

	result, err := service.SubmitURLs(ctx, urls)
	if err != nil {
		status := indexNowHTTPStatus(result, http.StatusBadRequest)
		message := "IndexNow submission failed"
		if services.IsIndexNowOwnershipError(result) {
			message = "Bing IndexNow site verification is not ready yet"
		}
		if result == nil {
			c.JSON(status, models.APIResponse{Success: false, Message: message, Error: err.Error()})
			return
		}
		c.JSON(status, models.APIResponse{Success: false, Message: message, Error: err.Error(), Data: result})
		return
	}

	if len(req.ProductIDs) > 0 {
		_ = services.MarkProductsIndexNowSubmitted(db, req.ProductIDs, result.SubmittedAt, result.StatusCode)
	}

	c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "IndexNow submission sent", Data: result})
}

func (ic *IndexNowController) GetProductStatus(c *gin.Context) {
	db := config.GetDB()
	if db == nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Database not initialized"})
		return
	}

	var totalProducts int64
	var submittedProducts int64
	var unsubmittedProducts int64

	db.Model(&models.Product{}).Where("is_active = ?", true).Count(&totalProducts)
	db.Model(&models.Product{}).Where("is_active = ? AND index_now_last_submitted_at IS NOT NULL", true).Count(&submittedProducts)
	db.Model(&models.Product{}).Where("is_active = ? AND index_now_last_submitted_at IS NULL", true).Count(&unsubmittedProducts)

	c.JSON(http.StatusOK, models.APIResponse{
		Success: true,
		Message: "OK",
		Data: indexNowProductStatusResponse{
			TotalProducts:       totalProducts,
			SubmittedProducts:   submittedProducts,
			UnsubmittedProducts: unsubmittedProducts,
		},
	})
}

func (ic *IndexNowController) SubmitProducts(c *gin.Context) {
	var req submitIndexNowProductsRequest
	if err := c.ShouldBindJSON(&req); err != nil && err.Error() != "EOF" {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Invalid request", Error: err.Error()})
		return
	}

	db := config.GetDB()
	if db == nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Database not initialized"})
		return
	}

	service := services.NewIndexNowService(db)
	setting, err := service.GetOrCreateSetting()
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to load IndexNow settings", Error: err.Error()})
		return
	}

	mode := strings.ToLower(strings.TrimSpace(req.Mode))
	if mode == "" {
		mode = "unsubmitted"
	}
	if mode != "all" && mode != "unsubmitted" {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Invalid mode", Error: "mode must be all or unsubmitted"})
		return
	}

	batchSize := req.BatchSize
	if batchSize <= 0 {
		batchSize = 100
	}
	if batchSize > 500 {
		batchSize = 500
	}

	remaining := req.Limit
	processed := 0
	submitted := 0
	batches := 0
	var lastID uint
	var lastResult *services.IndexNowSubmitResult

	for {
		limit := batchSize
		if remaining > 0 && remaining < limit {
			limit = remaining
		}
		if remaining == 0 && req.Limit > 0 {
			break
		}

		query := db.Model(&models.Product{}).
			Select("id", "sku").
			Where("is_active = ? AND id > ?", true, lastID)

		if mode == "unsubmitted" {
			query = query.Where("index_now_last_submitted_at IS NULL")
		}

		var products []models.Product
		if err := query.Order("id ASC").Limit(limit).Find(&products).Error; err != nil {
			c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to load products", Error: err.Error()})
			return
		}
		if len(products) == 0 {
			break
		}

		productIDs := make([]uint, 0, len(products))
		urls := make([]string, 0, len(products))
		for _, product := range products {
			productIDs = append(productIDs, product.ID)
			urls = append(urls, services.BuildProductCanonicalURL(setting.SiteURL, product.SKU))
		}
		lastID = products[len(products)-1].ID

		ctx, cancel := context.WithTimeout(c.Request.Context(), 30*time.Second)
		result, submitErr := service.SubmitURLs(ctx, urls)
		cancel()
		if submitErr != nil {
			message := "IndexNow batch submission failed"
			if services.IsIndexNowOwnershipError(result) {
				message = "Bing IndexNow site verification is not ready yet"
			}
			c.JSON(indexNowHTTPStatus(result, http.StatusBadRequest), models.APIResponse{
				Success: false,
				Message: message,
				Error:   submitErr.Error(),
				Data: gin.H{
					"mode":               mode,
					"processed_products": processed,
					"submitted_products": submitted,
					"batches_completed":  batches,
					"last_result":        result,
				},
			})
			return
		}

		lastResult = result
		_ = services.MarkProductsIndexNowSubmitted(db, productIDs, result.SubmittedAt, result.StatusCode)
		processed += len(products)
		submitted += len(products)
		batches++

		if req.Limit > 0 {
			remaining -= len(products)
		}

		if mode == "all" && len(products) < limit {
			break
		}
	}

	c.JSON(http.StatusOK, models.APIResponse{
		Success: true,
		Message: "IndexNow product batch submission completed",
		Data: gin.H{
			"mode":               mode,
			"processed_products": processed,
			"submitted_products": submitted,
			"batches_completed":  batches,
			"last_result":        lastResult,
		},
	})
}

func (ic *IndexNowController) GetPublicKey(c *gin.Context) {
	db := config.GetDB()
	if db == nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Database not initialized"})
		return
	}
	service := services.NewIndexNowService(db)
	s, err := service.GetOrCreateSetting()
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to load IndexNow settings", Error: err.Error()})
		return
	}
	resp := services.BuildIndexNowResponse(s)
	if strings.TrimSpace(resp.Key) == "" {
		c.JSON(http.StatusNotFound, models.APIResponse{Success: false, Message: "IndexNow key is not configured", Error: "not_configured"})
		return
	}
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "OK", Data: gin.H{
		"key":          resp.Key,
		"key_location": resp.KeyLocation,
		"host":         resp.Host,
	}})
}

func (ic *IndexNowController) SubmitProductByID(c *gin.Context) {
	id, err := strconv.ParseUint(strings.TrimSpace(c.Param("id")), 10, 64)
	if err != nil || id == 0 {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Invalid product id", Error: "invalid_product_id"})
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 1024)
	ic.SubmitWithSingleProduct(c, uint(id))
}

func (ic *IndexNowController) SubmitSampleProduct(c *gin.Context) {
	db := config.GetDB()
	if db == nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Database not initialized"})
		return
	}

	var product models.Product
	err := db.Select("id", "sku").
		Where("is_active = ? AND index_now_last_submitted_at IS NULL", true).
		Order("id ASC").
		First(&product).Error
	if err != nil {
		err = db.Select("id", "sku").
			Where("is_active = ?", true).
			Order("id ASC").
			First(&product).Error
	}
	if err != nil {
		c.JSON(http.StatusNotFound, models.APIResponse{
			Success: false,
			Message: "No active product available for sample submission",
			Error:   "product_not_found",
		})
		return
	}

	ic.SubmitWithSingleProduct(c, product.ID)
}

func (ic *IndexNowController) SubmitWithSingleProduct(c *gin.Context, productID uint) {
	db := config.GetDB()
	if db == nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Database not initialized"})
		return
	}

	var product models.Product
	if err := db.Select("id", "sku").First(&product, productID).Error; err != nil {
		c.JSON(http.StatusNotFound, models.APIResponse{Success: false, Message: "Product not found", Error: "product_not_found"})
		return
	}

	service := services.NewIndexNowService(db)
	setting, err := service.GetOrCreateSetting()
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to load IndexNow settings", Error: err.Error()})
		return
	}
	url := services.BuildProductCanonicalURL(setting.SiteURL, product.SKU)

	ctx, cancel := context.WithTimeout(c.Request.Context(), 25*time.Second)
	defer cancel()
	result, err := service.SubmitURLs(ctx, []string{url})
	if err != nil {
		message := "IndexNow submission failed"
		if services.IsIndexNowOwnershipError(result) {
			message = "Bing IndexNow site verification is not ready yet"
		}
		c.JSON(indexNowHTTPStatus(result, http.StatusBadRequest), models.APIResponse{Success: false, Message: message, Error: err.Error(), Data: result})
		return
	}
	_ = services.MarkProductsIndexNowSubmitted(db, []uint{product.ID}, result.SubmittedAt, result.StatusCode)
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "IndexNow submission sent", Data: result})
}
