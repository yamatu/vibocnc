package services

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/url"
	"strings"
	"sync"

	"fanuc-backend/models"

	"gorm.io/gorm"
)

var productImageTrustTableCache sync.Map

func hasProductImageTrustTable(db *gorm.DB) bool {
	if db == nil {
		return false
	}
	sqlDB, err := db.DB()
	if err != nil || sqlDB == nil {
		return false
	}
	if cached, ok := productImageTrustTableCache.Load(sqlDB); ok {
		return cached.(bool)
	}
	exists := db.Migrator().HasTable(&models.ProductImageTrustedURL{})
	if exists {
		productImageTrustTableCache.Store(sqlDB, true)
	}
	return exists
}

func ProductImageURLHash(raw string) string {
	hash := sha256.Sum256([]byte(strings.TrimSpace(raw)))
	return hex.EncodeToString(hash[:])
}

func isExternalHTTPImageURL(raw string) bool {
	value := strings.TrimSpace(raw)
	if value == "" || (strings.HasPrefix(value, "/") && !strings.HasPrefix(value, "//")) || strings.HasPrefix(strings.ToLower(value), "uploads/") {
		return false
	}
	if strings.HasPrefix(value, "//") {
		value = "https:" + value
	}
	parsed, err := url.Parse(value)
	if err != nil || parsed.Hostname() == "" {
		return false
	}
	scheme := strings.ToLower(parsed.Scheme)
	return scheme == "http" || scheme == "https"
}

// SyncExplicitProductImageTrust keeps manually approved external URLs aligned
// with the product's current image list. Existing trusted rows are retained
// when the URL is still present, even if an older client omits Source.
func SyncExplicitProductImageTrust(db *gorm.DB, productID uint, images []models.ImageReq, createdByID uint) error {
	if db == nil || productID == 0 {
		return errors.New("db and product ID are required")
	}
	if !hasProductImageTrustTable(db) {
		// Deployments with DB_AUTO_MIGRATE=false can continue using the legacy
		// image flow until the additive migration is applied.
		return nil
	}
	var existing []models.ProductImageTrustedURL
	if err := db.Where("product_id = ?", productID).Find(&existing).Error; err != nil {
		return err
	}
	current := make(map[string]struct{}, len(images))
	for _, image := range images {
		value := strings.TrimSpace(image.URL)
		if value == "" {
			continue
		}
		hash := ProductImageURLHash(value)
		current[hash] = struct{}{}
		if !isExternalHTTPImageURL(value) || !strings.EqualFold(strings.TrimSpace(image.Source), "admin_external") {
			continue
		}
		var trusted models.ProductImageTrustedURL
		findErr := db.Where("product_id = ? AND url_hash = ?", productID, hash).First(&trusted).Error
		if errors.Is(findErr, gorm.ErrRecordNotFound) {
			if err := db.Create(&models.ProductImageTrustedURL{ProductID: productID, URLHash: hash, URL: value, Source: "admin_external", CreatedByID: createdByID}).Error; err != nil {
				return err
			}
			continue
		}
		if findErr != nil {
			return findErr
		}
		updates := map[string]interface{}{"url": value, "source": "admin_external"}
		if createdByID > 0 {
			updates["created_by_id"] = createdByID
		}
		if err := db.Model(&trusted).Updates(updates).Error; err != nil {
			return err
		}
	}

	for _, trusted := range existing {
		if _, present := current[trusted.URLHash]; present {
			continue
		}
		if err := db.Delete(&trusted).Error; err != nil {
			return err
		}
	}
	return nil
}

func MarkExplicitProductImageTrusted(db *gorm.DB, productID uint, rawURL, source string, createdByID uint) error {
	value := strings.TrimSpace(rawURL)
	if !isExternalHTTPImageURL(value) || !strings.EqualFold(strings.TrimSpace(source), "admin_external") {
		return nil
	}
	if db == nil || !hasProductImageTrustTable(db) {
		return nil
	}
	hash := ProductImageURLHash(value)
	var trusted models.ProductImageTrustedURL
	err := db.Where("product_id = ? AND url_hash = ?", productID, hash).First(&trusted).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return db.Create(&models.ProductImageTrustedURL{ProductID: productID, URLHash: hash, URL: value, Source: "admin_external", CreatedByID: createdByID}).Error
	}
	if err != nil {
		return err
	}
	updates := map[string]interface{}{"url": value, "source": "admin_external"}
	if createdByID > 0 {
		updates["created_by_id"] = createdByID
	}
	return db.Model(&trusted).Updates(updates).Error
}

func RemoveExplicitProductImageTrust(db *gorm.DB, productID uint, rawURL string) error {
	if db == nil || productID == 0 || !hasProductImageTrustTable(db) {
		return nil
	}
	return db.Where("product_id = ? AND url_hash = ?", productID, ProductImageURLHash(rawURL)).Delete(&models.ProductImageTrustedURL{}).Error
}

func ClearExplicitProductImageTrust(db *gorm.DB, productID uint) error {
	if db == nil || productID == 0 || !hasProductImageTrustTable(db) {
		return nil
	}
	return db.Where("product_id = ?", productID).Delete(&models.ProductImageTrustedURL{}).Error
}

// LoadExplicitProductImageTrust returns exact URL hashes grouped by product.
func LoadExplicitProductImageTrust(db *gorm.DB, productIDs []uint) (map[uint]map[string]struct{}, error) {
	result := make(map[uint]map[string]struct{})
	if db == nil || len(productIDs) == 0 {
		return result, nil
	}
	if !hasProductImageTrustTable(db) {
		return result, nil
	}
	var rows []models.ProductImageTrustedURL
	query := db.Session(&gorm.Session{NewDB: true}).Model(&models.ProductImageTrustedURL{}).
		Select("product_id", "url_hash").Where("product_id IN ?", productIDs)
	if err := query.Find(&rows).Error; err != nil {
		return nil, err
	}
	for _, row := range rows {
		if result[row.ProductID] == nil {
			result[row.ProductID] = make(map[string]struct{})
		}
		result[row.ProductID][row.URLHash] = struct{}{}
	}
	return result, nil
}
