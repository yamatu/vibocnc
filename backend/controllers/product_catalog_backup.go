package controllers

import (
	"fmt"
	"io"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"fanuc-backend/config"
	"fanuc-backend/models"
	"fanuc-backend/services"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type createProductCatalogImportRequest struct {
	FileName    string `json:"file_name" binding:"required"`
	FileSize    int64  `json:"file_size" binding:"required"`
	Fingerprint string `json:"fingerprint"`
}

func productCatalogJobResponse(job models.ProductCatalogImportJob) gin.H {
	progress := 0.0
	if job.Status == "uploading" && job.FileSize > 0 {
		progress = float64(job.UploadedBytes) * 100 / float64(job.FileSize)
	} else if job.TotalProducts > 0 {
		progress = float64(job.ProcessedProducts) * 100 / float64(job.TotalProducts)
	}
	if progress > 100 {
		progress = 100
	}
	return gin.H{"job": job, "progress": progress}
}

// DownloadProductCatalog exports products, category paths, supported product
// relations, and only the local upload files referenced by those products.
func (bc *BackupController) DownloadProductCatalog(c *gin.Context) {
	siteName := strings.TrimSpace(os.Getenv("SITE_NAME"))
	if siteName == "" {
		siteName = "Vibocnc"
	}
	siteURL := strings.TrimSpace(os.Getenv("SITE_URL"))
	if siteURL == "" {
		siteURL = "https://vibocnc.com"
	}
	filename := fmt.Sprintf("product-catalog-%s.zip", time.Now().Format("20060102-150405"))
	c.Header("Content-Type", "application/zip")
	c.Header("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, filename))
	c.Header("Cache-Control", "no-store")
	if _, err := services.WriteProductCatalogArchive(config.GetDB(), c.Writer, siteName, siteURL); err != nil {
		// Headers may already be committed once ZIP streaming starts. Abort the
		// connection so a partial archive is never mistaken for a valid export.
		_ = c.Error(err)
		c.Abort()
	}
}

func (bc *BackupController) CreateProductCatalogImportJob(c *gin.Context) {
	var request createProductCatalogImportRequest
	if err := c.ShouldBindJSON(&request); err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Invalid product catalog upload request", Error: err.Error()})
		return
	}
	job, err := services.StartProductCatalogUpload(config.GetDB(), request.FileName, request.FileSize, request.Fingerprint, c.GetUint("user_id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Failed to create product catalog upload", Error: err.Error()})
		return
	}
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "Product catalog upload ready", Data: productCatalogJobResponse(job)})
}

func (bc *BackupController) UploadProductCatalogChunk(c *gin.Context) {
	offset, err := strconv.ParseInt(strings.TrimSpace(c.Query("offset")), 10, 64)
	if err != nil || offset < 0 {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Invalid chunk offset", Error: "invalid_offset"})
		return
	}
	chunk, err := io.ReadAll(io.LimitReader(c.Request.Body, services.ProductCatalogMaxChunkSize+1))
	if err != nil || len(chunk) == 0 || int64(len(chunk)) > services.ProductCatalogMaxChunkSize {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Chunk must be between 1 byte and 8 MiB", Error: "invalid_chunk_size"})
		return
	}
	job, err := services.UploadProductCatalogChunk(config.GetDB(), c.Param("id"), offset, chunk)
	if err != nil {
		c.JSON(http.StatusConflict, models.APIResponse{Success: false, Message: "Failed to upload product catalog chunk", Error: err.Error(), Data: productCatalogJobResponse(job)})
		return
	}
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "Product catalog chunk uploaded", Data: productCatalogJobResponse(job)})
}

func (bc *BackupController) CompleteProductCatalogImportUpload(c *gin.Context) {
	job, preview, err := services.CompleteProductCatalogUpload(config.GetDB(), c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Product catalog validation failed", Error: err.Error(), Data: productCatalogJobResponse(job)})
		return
	}
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "Product catalog is ready for preview", Data: gin.H{"job": job, "preview": preview}})
}

func findProductCatalogJob(c *gin.Context) (models.ProductCatalogImportJob, bool) {
	var job models.ProductCatalogImportJob
	if err := config.GetDB().First(&job, "id = ?", c.Param("id")).Error; err != nil {
		status := http.StatusInternalServerError
		if err == gorm.ErrRecordNotFound {
			status = http.StatusNotFound
		}
		c.JSON(status, models.APIResponse{Success: false, Message: "Product catalog job not found", Error: err.Error()})
		return job, false
	}
	return job, true
}

func (bc *BackupController) GetProductCatalogImportJob(c *gin.Context) {
	job, ok := findProductCatalogJob(c)
	if !ok {
		return
	}
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Data: productCatalogJobResponse(job)})
}

func (bc *BackupController) GetProductCatalogImportPreview(c *gin.Context) {
	job, ok := findProductCatalogJob(c)
	if !ok {
		return
	}
	preview, err := services.GetProductCatalogPreview(job)
	if err != nil {
		c.JSON(http.StatusConflict, models.APIResponse{Success: false, Message: "Product catalog preview is not ready", Error: err.Error()})
		return
	}
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Data: preview})
}

func (bc *BackupController) ApplyProductCatalogImport(c *gin.Context) {
	var options services.ProductCatalogImportOptions
	if err := c.ShouldBindJSON(&options); err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Invalid product catalog import options", Error: err.Error()})
		return
	}
	job, err := services.ApplyProductCatalogImport(config.GetDB(), c.Param("id"), options)
	if err != nil {
		c.JSON(http.StatusConflict, models.APIResponse{Success: false, Message: "Failed to start product catalog import", Error: err.Error()})
		return
	}
	c.JSON(http.StatusAccepted, models.APIResponse{Success: true, Message: "Product catalog import is running in the background", Data: productCatalogJobResponse(job)})
}

func (bc *BackupController) PauseProductCatalogImport(c *gin.Context) {
	job, err := services.PauseProductCatalogImport(config.GetDB(), c.Param("id"))
	if err != nil {
		c.JSON(http.StatusConflict, models.APIResponse{Success: false, Message: "Failed to pause product catalog import", Error: err.Error()})
		return
	}
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "Product catalog import paused", Data: productCatalogJobResponse(job)})
}

func (bc *BackupController) ResumeProductCatalogImport(c *gin.Context) {
	job, err := services.ResumeProductCatalogImport(config.GetDB(), c.Param("id"))
	if err != nil {
		c.JSON(http.StatusConflict, models.APIResponse{Success: false, Message: "Failed to resume product catalog import", Error: err.Error()})
		return
	}
	c.JSON(http.StatusAccepted, models.APIResponse{Success: true, Message: "Product catalog import resumed", Data: productCatalogJobResponse(job)})
}

func (bc *BackupController) CancelProductCatalogImport(c *gin.Context) {
	job, err := services.CancelProductCatalogImport(config.GetDB(), c.Param("id"))
	if err != nil {
		c.JSON(http.StatusConflict, models.APIResponse{Success: false, Message: "Failed to cancel product catalog import", Error: err.Error()})
		return
	}
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "Product catalog import canceled", Data: productCatalogJobResponse(job)})
}
