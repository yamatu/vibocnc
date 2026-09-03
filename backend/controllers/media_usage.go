package controllers

import (
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"

	"fanuc-backend/config"
	"fanuc-backend/models"

	"github.com/gin-gonic/gin"
)

type mediaProductUsageItem struct {
	ProductID  uint   `json:"product_id"`
	SKU        string `json:"sku"`
	Name       string `json:"name"`
	Brand      string `json:"brand"`
	IsActive   bool   `json:"is_active"`
	MatchedURL string `json:"matched_url"`
}

type mediaProductUsageResponse struct {
	Items    []mediaProductUsageItem `json:"items"`
	Total    int                     `json:"total"`
	Page     int                     `json:"page"`
	PageSize int                     `json:"page_size"`
}

func productImageURLMatchesMedia(imageURL, assetURL, relativePath string) bool {
	value := strings.TrimSpace(imageURL)
	if value == "" {
		return false
	}
	assetURL = strings.TrimSpace(assetURL)
	if value == assetURL {
		return true
	}
	parsedValue := value
	if strings.HasPrefix(parsedValue, "//") {
		parsedValue = "https:" + parsedValue
	}
	parsed, err := url.Parse(parsedValue)
	if err != nil {
		return false
	}
	cleanRelative := strings.TrimPrefix(strings.TrimSpace(relativePath), "/")
	wantedPaths := map[string]struct{}{
		"uploads/" + cleanRelative: {},
		cleanRelative:              {},
	}
	parsedPath := strings.TrimPrefix(parsed.Path, "/")
	if _, ok := wantedPaths[parsedPath]; !ok {
		return false
	}
	return parsed.Hostname() == "" || hostnameMatchesTrustedDomain(parsed.Hostname(), nil)
}

func (mc *MediaController) ProductsUsingMedia(c *gin.Context) {
	mediaID, err := strconv.ParseUint(strings.TrimSpace(c.Param("id")), 10, 32)
	if err != nil || mediaID == 0 {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Invalid media ID", Error: "invalid_media_id"})
		return
	}
	db := config.GetDB()
	var asset models.MediaAsset
	if err := db.First(&asset, uint(mediaID)).Error; err != nil {
		c.JSON(http.StatusNotFound, models.APIResponse{Success: false, Message: "Media asset not found", Error: "not_found"})
		return
	}
	assetURL := asset.ToResponse().URL
	like := "%" + asset.FileName + "%"

	matched := make(map[uint]string)
	var products []models.Product
	if err := db.Select("id", "sku", "name", "brand", "is_active", "image_urls").Where("image_urls LIKE ?", like).Find(&products).Error; err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to inspect product image usage", Error: err.Error()})
		return
	}
	productByID := make(map[uint]models.Product, len(products))
	for _, product := range products {
		productByID[product.ID] = product
		for _, imageURL := range parseImageURLsJSON(product.ImageURLs) {
			if productImageURLMatchesMedia(imageURL, assetURL, asset.RelativePath) {
				matched[product.ID] = imageURL
				break
			}
		}
	}

	var relationRows []models.ProductImage
	if hasImagesTable() {
		if err := db.Where("url LIKE ?", like).Find(&relationRows).Error; err != nil {
			c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to inspect product image relations", Error: err.Error()})
			return
		}
	}
	missingProductIDs := make([]uint, 0)
	for _, relation := range relationRows {
		if !productImageURLMatchesMedia(relation.URL, assetURL, asset.RelativePath) {
			continue
		}
		matched[relation.ProductID] = relation.URL
		if _, exists := productByID[relation.ProductID]; !exists {
			missingProductIDs = append(missingProductIDs, relation.ProductID)
		}
	}
	if len(missingProductIDs) > 0 {
		var missingProducts []models.Product
		if findErr := db.Select("id", "sku", "name", "brand", "is_active").Where("id IN ?", missingProductIDs).Find(&missingProducts).Error; findErr != nil {
			c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to load products using media", Error: findErr.Error()})
			return
		}
		for _, product := range missingProducts {
			productByID[product.ID] = product
		}
	}

	items := make([]mediaProductUsageItem, 0, len(matched))
	for productID, matchedURL := range matched {
		product, exists := productByID[productID]
		if !exists {
			continue
		}
		items = append(items, mediaProductUsageItem{
			ProductID: product.ID, SKU: product.SKU, Name: product.Name, Brand: product.Brand, IsActive: product.IsActive, MatchedURL: matchedURL,
		})
	}
	sort.Slice(items, func(i, j int) bool { return items[i].ProductID > items[j].ProductID })

	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	if page < 1 {
		page = 1
	}
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "50"))
	if pageSize < 1 {
		pageSize = 50
	}
	if pageSize > 200 {
		pageSize = 200
	}
	start := (page - 1) * pageSize
	if start > len(items) {
		start = len(items)
	}
	end := start + pageSize
	if end > len(items) {
		end = len(items)
	}
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Data: mediaProductUsageResponse{Items: items[start:end], Total: len(items), Page: page, PageSize: pageSize}})
}
