package controllers

import (
	"encoding/json"
	"fanuc-backend/config"
	"fanuc-backend/models"
	"fanuc-backend/utils"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type UploadController struct{}

// BatchUploadImages uploads multiple images for a product
func (uc *UploadController) BatchUploadImages(c *gin.Context) {
	productID := c.PostForm("product_id")
	if productID == "" {
		c.JSON(http.StatusBadRequest, models.APIResponse{
			Success: false,
			Message: "Product ID is required",
			Error:   "missing_product_id",
		})
		return
	}

	db := config.GetDB()

	// Check if product exists
	var product models.Product
	if err := db.First(&product, productID).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, models.APIResponse{
				Success: false,
				Message: "Product not found",
				Error:   "product_not_found",
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

	// Parse multipart form
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
		c.JSON(http.StatusBadRequest, models.APIResponse{
			Success: false,
			Message: "No files provided",
			Error:   "no_files",
		})
		return
	}

	uploadPath := config.UploadPath()

	// Ensure upload directory exists
	// #nosec G703 -- uploadPath is server-controlled UPLOAD_PATH configuration.
	if err := os.MkdirAll(uploadPath, 0755); err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{
			Success: false,
			Message: "Failed to create upload directory",
			Error:   err.Error(),
		})
		return
	}

	var results []map[string]interface{}
	var successCount, errorCount int

	// Get current image URLs
	var currentURLs []string
	if product.ImageURLs != "" && product.ImageURLs != "[]" {
		if err := json.Unmarshal([]byte(product.ImageURLs), &currentURLs); err != nil {
			currentURLs = []string{}
		}
	}

	// Process each file
	for _, file := range files {
		result := map[string]interface{}{
			"filename": file.Filename,
		}

		// Validate file type
		if !utils.ValidateImageExtension(file.Filename) {
			result["error"] = "Invalid file type. Only JPG, JPEG, PNG, GIF, and WebP are allowed"
			results = append(results, result)
			errorCount++
			continue
		}

		// Validate file size
		maxSize := int64(10 * 1024 * 1024) // 10MB
		if file.Size > maxSize {
			result["error"] = "File size exceeds 10MB limit"
			results = append(results, result)
			errorCount++
			continue
		}

		// Generate unique filename
		timestamp := time.Now().Unix()
		cleanOriginalName := utils.CleanFilename(file.Filename)
		ext := filepath.Ext(cleanOriginalName)
		newFilename := fmt.Sprintf("%s_%d%s", product.Model, timestamp, ext)
		filePath := filepath.Join(uploadPath, newFilename)

		// Save file
		if err := c.SaveUploadedFile(file, filePath); err != nil {
			result["error"] = "Failed to save file: " + err.Error()
			results = append(results, result)
			errorCount++
			continue
		}

		// Store as a relative URL so it works behind host Nginx (TLS) and in docker.
		// The host reverse-proxy should serve /uploads/* to the backend.
		imageURL := fmt.Sprintf("/uploads/%s", newFilename)

		// Add to current URLs
		currentURLs = append(currentURLs, imageURL)

		result["success"] = true
		result["url"] = imageURL
		result["filename"] = newFilename
		results = append(results, result)
		successCount++
	}

	// Update product with new image URLs
	if successCount > 0 {
		imageURLsBytes, err := json.Marshal(currentURLs)
		if err != nil {
			c.JSON(http.StatusInternalServerError, models.APIResponse{
				Success: false,
				Message: "Failed to serialize image URLs",
				Error:   err.Error(),
			})
			return
		}

		product.ImageURLs = string(imageURLsBytes)
		if err := db.Save(&product).Error; err != nil {
			c.JSON(http.StatusInternalServerError, models.APIResponse{
				Success: false,
				Message: "Failed to update product with image URLs",
				Error:   err.Error(),
			})
			return
		}
	}

	response := map[string]interface{}{
		"total_files":   len(files),
		"success_count": successCount,
		"error_count":   errorCount,
		"results":       results,
	}

	statusCode := http.StatusOK
	if errorCount > 0 && successCount == 0 {
		statusCode = http.StatusBadRequest
	} else if errorCount > 0 {
		statusCode = http.StatusPartialContent
	}

	c.JSON(statusCode, models.APIResponse{
		Success: successCount > 0,
		Message: fmt.Sprintf("Processed %d files: %d successful, %d errors", len(files), successCount, errorCount),
		Data:    response,
	})
}
