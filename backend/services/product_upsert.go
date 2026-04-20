package services

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"fanuc-backend/models"
	"fanuc-backend/utils"

	"gorm.io/gorm"
)

type ProductUpsertError struct {
	Code    string
	Message string
	Err     error
}

func (e *ProductUpsertError) Error() string {
	if e == nil {
		return ""
	}
	if e.Err != nil {
		return fmt.Sprintf("%s: %v", e.Message, e.Err)
	}
	return e.Message
}

func (e *ProductUpsertError) Unwrap() error {
	if e == nil {
		return nil
	}
	return e.Err
}

type ProductUpsertResult struct {
	Product models.Product
	Created bool
	OldSKU  string
	OldPath string
	NewPath string
}

func marshalProductImageURLs(images []models.ImageReq) (string, *ProductUpsertError) {
	imageURLs := make([]string, 0, len(images))
	for _, img := range images {
		trimmed := strings.TrimSpace(img.URL)
		if trimmed != "" {
			imageURLs = append(imageURLs, trimmed)
		}
	}

	if len(imageURLs) == 0 {
		return "[]", nil
	}

	payload, err := json.Marshal(imageURLs)
	if err != nil {
		return "", &ProductUpsertError{
			Code:    "invalid_image_urls",
			Message: "Invalid image URLs format",
			Err:     err,
		}
	}

	return string(payload), nil
}

func validateProductCategory(db *gorm.DB, categoryID uint) *ProductUpsertError {
	if categoryID == 0 {
		return &ProductUpsertError{Code: "category_required", Message: "Category is required"}
	}

	var category models.Category
	if err := db.First(&category, categoryID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return &ProductUpsertError{Code: "category_not_found", Message: "Invalid category", Err: err}
		}
		return &ProductUpsertError{Code: "db_error", Message: "Database error", Err: err}
	}

	return nil
}

func CreateProductFromRequest(db *gorm.DB, req models.ProductCreateRequest) (*ProductUpsertResult, *ProductUpsertError) {
	if err := validateProductCategory(db, req.CategoryID); err != nil {
		return nil, err
	}

	var existingProduct models.Product
	if err := db.Where("sku = ?", req.SKU).First(&existingProduct).Error; err == nil {
		return nil, &ProductUpsertError{Code: "sku_exists", Message: "Product with this SKU already exists"}
	} else if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, &ProductUpsertError{Code: "db_error", Message: "Database error", Err: err}
	}

	imageURLsJSON, imageErr := marshalProductImageURLs(req.Images)
	if imageErr != nil {
		return nil, imageErr
	}

	baseSlug := utils.GenerateSlug(req.Name)
	slug := utils.GenerateUniqueSlug(baseSlug, func(s string) bool {
		var count int64
		db.Model(&models.Product{}).Where("slug = ?", s).Count(&count)
		return count > 0
	})

	product := models.Product{
		SKU:              req.SKU,
		Name:             req.Name,
		Slug:             slug,
		ShortDescription: req.ShortDescription,
		Description:      req.Description,
		Price:            req.Price,
		ComparePrice:     req.ComparePrice,
		StockQuantity:    req.StockQuantity,
		Weight:           req.Weight,
		Dimensions:       req.Dimensions,
		Brand:            req.Brand,
		Model:            req.Model,
		PartNumber:       req.PartNumber,
		WarrantyPeriod:   req.WarrantyPeriod,
		LeadTime:         req.LeadTime,
		CategoryID:       req.CategoryID,
		IsActive:         req.IsActive,
		IsFeatured:       req.IsFeatured,
		MetaTitle:        req.MetaTitle,
		MetaDescription:  req.MetaDescription,
		MetaKeywords:     req.MetaKeywords,
		DisableAutoSEO:   req.DisableAutoSEO,
		ImageURLs:        imageURLsJSON,
	}

	tx := db.Begin()
	if tx.Error != nil {
		return nil, &ProductUpsertError{Code: "db_error", Message: "Failed to start transaction", Err: tx.Error}
	}

	if err := tx.Select("SKU", "Name", "Slug", "ShortDescription", "Description", "Price", "ComparePrice", "StockQuantity", "Weight", "Dimensions", "Brand", "Model", "PartNumber", "WarrantyPeriod", "LeadTime", "CategoryID", "IsActive", "IsFeatured", "MetaTitle", "MetaDescription", "MetaKeywords", "DisableAutoSEO", "ImageURLs").Create(&product).Error; err != nil {
		tx.Rollback()
		return nil, &ProductUpsertError{Code: "db_error", Message: "Failed to create product", Err: err}
	}

	for _, attr := range req.Attributes {
		attribute := models.ProductAttribute{
			ProductID:      product.ID,
			AttributeName:  attr.AttributeName,
			AttributeValue: attr.AttributeValue,
			SortOrder:      attr.SortOrder,
		}
		if err := tx.Create(&attribute).Error; err != nil {
			tx.Rollback()
			return nil, &ProductUpsertError{Code: "db_error", Message: "Failed to create product attributes", Err: err}
		}
	}

	for _, trans := range req.Translations {
		translation := models.ProductTranslation{
			ProductID:        product.ID,
			LanguageCode:     trans.LanguageCode,
			Name:             trans.Name,
			Slug:             utils.GenerateSlug(trans.Name),
			ShortDescription: trans.ShortDescription,
			Description:      trans.Description,
			MetaTitle:        trans.MetaTitle,
			MetaDescription:  trans.MetaDescription,
			MetaKeywords:     trans.MetaKeywords,
		}
		if err := tx.Create(&translation).Error; err != nil {
			tx.Rollback()
			return nil, &ProductUpsertError{Code: "db_error", Message: "Failed to create product translations", Err: err}
		}
	}

	if err := tx.Commit().Error; err != nil {
		return nil, &ProductUpsertError{Code: "db_error", Message: "Failed to commit product", Err: err}
	}

	if err := db.Select("id,sku,name,slug,short_description,description,price,compare_price,stock_quantity,weight,dimensions,brand,model,part_number,category_id,is_active,is_featured,meta_title,meta_description,meta_keywords,disable_auto_seo,image_urls,created_at,updated_at").Preload("Category").First(&product, product.ID).Error; err != nil {
		return nil, &ProductUpsertError{Code: "db_error", Message: "Failed to load created product", Err: err}
	}

	return &ProductUpsertResult{
		Product: product,
		Created: true,
		NewPath: BuildProductPublicPath(product.SKU),
	}, nil
}

func UpdateProductFromRequest(db *gorm.DB, productID uint, req models.ProductCreateRequest) (*ProductUpsertResult, *ProductUpsertError) {
	if err := validateProductCategory(db, req.CategoryID); err != nil {
		return nil, err
	}

	var product models.Product
	if err := db.Select("id,sku,name,slug,image_urls").First(&product, productID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, &ProductUpsertError{Code: "product_not_found", Message: "Product not found", Err: err}
		}
		return nil, &ProductUpsertError{Code: "db_error", Message: "Database error", Err: err}
	}

	var count int64
	if err := db.Model(&models.Product{}).Where("sku = ? AND id != ?", req.SKU, product.ID).Count(&count).Error; err == nil && count > 0 {
		return nil, &ProductUpsertError{Code: "sku_exists", Message: "Product with this SKU already exists"}
	} else if err != nil {
		return nil, &ProductUpsertError{Code: "db_error", Message: "Database error", Err: err}
	}

	if req.Name != product.Name {
		baseSlug := utils.GenerateSlug(req.Name)
		product.Slug = utils.GenerateUniqueSlug(baseSlug, func(s string) bool {
			var slugCount int64
			db.Model(&models.Product{}).Where("slug = ? AND id != ?", s, product.ID).Count(&slugCount)
			return slugCount > 0
		})
	}

	imageURLsJSON, imageErr := marshalProductImageURLs(req.Images)
	if imageErr != nil {
		return nil, imageErr
	}

	oldSKU := product.SKU
	oldPath := BuildProductPublicPath(oldSKU)

	product.SKU = req.SKU
	product.Name = req.Name
	product.ShortDescription = req.ShortDescription
	product.Description = req.Description
	product.Price = req.Price
	product.ComparePrice = req.ComparePrice
	product.StockQuantity = req.StockQuantity
	product.Weight = req.Weight
	product.Dimensions = req.Dimensions
	product.Brand = req.Brand
	product.Model = req.Model
	product.PartNumber = req.PartNumber
	product.WarrantyPeriod = req.WarrantyPeriod
	product.LeadTime = req.LeadTime
	product.CategoryID = req.CategoryID
	product.IsActive = req.IsActive
	product.IsFeatured = req.IsFeatured
	product.MetaTitle = req.MetaTitle
	product.MetaDescription = req.MetaDescription
	product.MetaKeywords = req.MetaKeywords
	product.DisableAutoSEO = req.DisableAutoSEO
	product.ImageURLs = imageURLsJSON

	tx := db.Begin()
	if tx.Error != nil {
		return nil, &ProductUpsertError{Code: "db_error", Message: "Failed to start transaction", Err: tx.Error}
	}

	rawSQL := `UPDATE products SET
		sku=?, name=?, slug=?, short_description=?, description=?, price=?, compare_price=?, stock_quantity=?, weight=?, dimensions=?,
		brand=?, model=?, part_number=?, warranty_period=?, lead_time=?, category_id=?, is_active=?, is_featured=?, meta_title=?, meta_description=?, meta_keywords=?, disable_auto_seo=?, image_urls=?
		WHERE id=?`
	if err := tx.Exec(rawSQL,
		product.SKU, product.Name, product.Slug, product.ShortDescription, product.Description, product.Price, product.ComparePrice, product.StockQuantity, product.Weight, product.Dimensions,
		product.Brand, product.Model, product.PartNumber, product.WarrantyPeriod, product.LeadTime, product.CategoryID, product.IsActive, product.IsFeatured, product.MetaTitle, product.MetaDescription, product.MetaKeywords, product.DisableAutoSEO, product.ImageURLs,
		product.ID,
	).Error; err != nil {
		tx.Rollback()
		return nil, &ProductUpsertError{Code: "db_error", Message: "Failed to update product", Err: err}
	}

	if err := tx.Where("product_id = ?", product.ID).Delete(&models.ProductAttribute{}).Error; err != nil {
		tx.Rollback()
		return nil, &ProductUpsertError{Code: "db_error", Message: "Failed to clear product attributes", Err: err}
	}
	for _, attr := range req.Attributes {
		attribute := models.ProductAttribute{
			ProductID:      product.ID,
			AttributeName:  attr.AttributeName,
			AttributeValue: attr.AttributeValue,
			SortOrder:      attr.SortOrder,
		}
		if err := tx.Create(&attribute).Error; err != nil {
			tx.Rollback()
			return nil, &ProductUpsertError{Code: "db_error", Message: "Failed to update product attributes", Err: err}
		}
	}

	if err := tx.Where("product_id = ?", product.ID).Delete(&models.ProductTranslation{}).Error; err != nil {
		tx.Rollback()
		return nil, &ProductUpsertError{Code: "db_error", Message: "Failed to clear product translations", Err: err}
	}
	for _, trans := range req.Translations {
		translation := models.ProductTranslation{
			ProductID:        product.ID,
			LanguageCode:     trans.LanguageCode,
			Name:             trans.Name,
			Slug:             utils.GenerateSlug(trans.Name),
			ShortDescription: trans.ShortDescription,
			Description:      trans.Description,
			MetaTitle:        trans.MetaTitle,
			MetaDescription:  trans.MetaDescription,
			MetaKeywords:     trans.MetaKeywords,
		}
		if err := tx.Create(&translation).Error; err != nil {
			tx.Rollback()
			return nil, &ProductUpsertError{Code: "db_error", Message: "Failed to update product translations", Err: err}
		}
	}

	if err := tx.Commit().Error; err != nil {
		return nil, &ProductUpsertError{Code: "db_error", Message: "Failed to commit product", Err: err}
	}

	if err := db.Select("id,sku,name,slug,short_description,description,price,compare_price,stock_quantity,weight,dimensions,brand,model,part_number,category_id,is_active,is_featured,meta_title,meta_description,meta_keywords,disable_auto_seo,image_urls,created_at,updated_at").Preload("Category").First(&product, product.ID).Error; err != nil {
		return nil, &ProductUpsertError{Code: "db_error", Message: "Failed to load updated product", Err: err}
	}

	return &ProductUpsertResult{
		Product: product,
		OldSKU:  oldSKU,
		OldPath: oldPath,
		NewPath: BuildProductPublicPath(product.SKU),
	}, nil
}
