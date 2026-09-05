package services

import (
	"archive/zip"
	"bufio"
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	"fanuc-backend/models"
	"fanuc-backend/utils"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

const (
	ProductCatalogFormat       = "fanuc-product-catalog"
	ProductCatalogVersion      = 1
	ProductCatalogChunkSize    = int64(5 * 1024 * 1024)
	ProductCatalogMaxChunkSize = int64(8 * 1024 * 1024)
	productCatalogMaxEntries   = 250000
	productCatalogMaxBytes     = int64(50 * 1024 * 1024 * 1024)
)

var productCatalogWorkers sync.Map

type ProductCatalogManifest struct {
	Format         string    `json:"format"`
	Version        int       `json:"version"`
	SourceSite     string    `json:"source_site"`
	SourceURL      string    `json:"source_url"`
	ExportedAt     time.Time `json:"exported_at"`
	ProductCount   int       `json:"product_count"`
	CategoryCount  int       `json:"category_count"`
	LocalFileCount int       `json:"local_file_count"`
	CatalogSHA256  string    `json:"catalog_sha256"`
	Capabilities   []string  `json:"capabilities"`
}

type ProductCatalog struct {
	SchemaVersion int                      `json:"schema_version"`
	Categories    []ProductCatalogCategory `json:"categories"`
	Products      []ProductCatalogProduct  `json:"products"`
}

type ProductCatalogCategory struct {
	Path         string                              `json:"path"`
	Name         string                              `json:"name"`
	Slug         string                              `json:"slug"`
	Description  string                              `json:"description,omitempty"`
	ImageURL     string                              `json:"image_url,omitempty"`
	SortOrder    int                                 `json:"sort_order"`
	IsActive     bool                                `json:"is_active"`
	Translations []ProductCatalogCategoryTranslation `json:"translations,omitempty"`
}

type ProductCatalogCategoryTranslation struct {
	LanguageCode string `json:"language_code"`
	Name         string `json:"name"`
	Slug         string `json:"slug"`
	Description  string `json:"description,omitempty"`
}

type ProductCatalogProduct struct {
	SKU                  string                       `json:"sku"`
	Name                 string                       `json:"name"`
	Slug                 string                       `json:"slug,omitempty"`
	ShortDescription     string                       `json:"short_description,omitempty"`
	Description          string                       `json:"description,omitempty"`
	Price                float64                      `json:"price"`
	ComparePrice         *float64                     `json:"compare_price,omitempty"`
	CostPrice            *float64                     `json:"cost_price,omitempty"`
	StockQuantity        int                          `json:"stock_quantity"`
	MinStockLevel        int                          `json:"min_stock_level"`
	Weight               *float64                     `json:"weight,omitempty"`
	Dimensions           string                       `json:"dimensions,omitempty"`
	Brand                string                       `json:"brand,omitempty"`
	Model                string                       `json:"model,omitempty"`
	PartNumber           string                       `json:"part_number,omitempty"`
	CategoryPath         string                       `json:"category_path"`
	IsActive             bool                         `json:"is_active"`
	IsFeatured           bool                         `json:"is_featured"`
	MetaTitle            string                       `json:"meta_title,omitempty"`
	MetaDescription      string                       `json:"meta_description,omitempty"`
	MetaKeywords         string                       `json:"meta_keywords,omitempty"`
	DisableAutoSEO       bool                         `json:"disable_auto_seo,omitempty"`
	WarrantyPeriod       string                       `json:"warranty_period,omitempty"`
	ConditionType        string                       `json:"condition_type,omitempty"`
	OriginCountry        string                       `json:"origin_country,omitempty"`
	Manufacturer         string                       `json:"manufacturer,omitempty"`
	LeadTime             string                       `json:"lead_time,omitempty"`
	MinimumOrderQuantity int                          `json:"minimum_order_quantity"`
	PackagingInfo        string                       `json:"packaging_info,omitempty"`
	Certifications       string                       `json:"certifications,omitempty"`
	TechnicalSpecs       string                       `json:"technical_specs,omitempty"`
	CompatibilityInfo    string                       `json:"compatibility_info,omitempty"`
	InstallationGuide    string                       `json:"installation_guide,omitempty"`
	MaintenanceTips      string                       `json:"maintenance_tips,omitempty"`
	RelatedProducts      string                       `json:"related_products,omitempty"`
	VideoURLs            string                       `json:"video_urls,omitempty"`
	DatasheetURL         string                       `json:"datasheet_url,omitempty"`
	ManualURL            string                       `json:"manual_url,omitempty"`
	PopularityScore      float64                      `json:"popularity_score"`
	Images               []ProductCatalogImage        `json:"images,omitempty"`
	Attributes           []ProductCatalogAttribute    `json:"attributes,omitempty"`
	Translations         []ProductCatalogTranslation  `json:"translations,omitempty"`
	PurchaseLinks        []ProductCatalogPurchaseLink `json:"purchase_links,omitempty"`
}

type ProductCatalogImage struct {
	URL          string `json:"url"`
	Filename     string `json:"filename,omitempty"`
	OriginalName string `json:"original_name,omitempty"`
	AltText      string `json:"alt_text,omitempty"`
	SortOrder    int    `json:"sort_order"`
	IsPrimary    bool   `json:"is_primary"`
}

type ProductCatalogAttribute struct {
	Name      string `json:"name"`
	Value     string `json:"value"`
	SortOrder int    `json:"sort_order"`
}

type ProductCatalogTranslation struct {
	LanguageCode     string `json:"language_code"`
	Name             string `json:"name"`
	Slug             string `json:"slug,omitempty"`
	ShortDescription string `json:"short_description,omitempty"`
	Description      string `json:"description,omitempty"`
	MetaTitle        string `json:"meta_title,omitempty"`
	MetaDescription  string `json:"meta_description,omitempty"`
	MetaKeywords     string `json:"meta_keywords,omitempty"`
}

type ProductCatalogPurchaseLink struct {
	Platform    string   `json:"platform"`
	URL         string   `json:"url"`
	Price       *float64 `json:"price,omitempty"`
	Currency    string   `json:"currency,omitempty"`
	IsActive    bool     `json:"is_active"`
	SortOrder   int      `json:"sort_order"`
	Description string   `json:"description,omitempty"`
}

type ProductCatalogTextReplacement struct {
	From string `json:"from"`
	To   string `json:"to"`
}

type ProductCatalogImportOptions struct {
	ConflictPolicy      string                          `json:"conflict_policy"`
	CreateCategories    bool                            `json:"create_categories"`
	OverwriteLocalFiles bool                            `json:"overwrite_local_files"`
	BrandMap            map[string]string               `json:"brand_map"`
	TextReplacements    []ProductCatalogTextReplacement `json:"text_replacements"`
}

type ProductCatalogPreview struct {
	Manifest          ProductCatalogManifest `json:"manifest"`
	NewProducts       int                    `json:"new_products"`
	ExistingProducts  int                    `json:"existing_products"`
	MissingCategories int                    `json:"missing_categories"`
	SourceBrands      []string               `json:"source_brands"`
	Warnings          []string               `json:"warnings"`
}

func productCatalogRoot() (string, error) {
	root := strings.TrimSpace(os.Getenv("UPLOAD_PATH"))
	if root == "" {
		root = "./uploads"
	}
	abs, err := filepath.Abs(root)
	if err != nil {
		return "", err
	}
	volumeRoot := filepath.VolumeName(abs) + string(os.PathSeparator)
	if filepath.Clean(abs) == filepath.Clean(volumeRoot) {
		return "", errors.New("UPLOAD_PATH cannot be a filesystem root")
	}
	if err := os.MkdirAll(abs, 0o755); err != nil {
		return "", err
	}
	return abs, nil
}

func productCatalogWorkDir() (string, error) {
	root, err := productCatalogRoot()
	if err != nil {
		return "", err
	}
	dir := filepath.Join(root, ".imports", "catalog")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	return dir, nil
}

func categoryPaths(categories []models.Category) map[uint]string {
	byID := make(map[uint]models.Category, len(categories))
	for _, category := range categories {
		byID[category.ID] = category
	}
	paths := make(map[uint]string, len(categories))
	var build func(uint, map[uint]bool) string
	build = func(id uint, visiting map[uint]bool) string {
		if path := paths[id]; path != "" {
			return path
		}
		category, ok := byID[id]
		if !ok || visiting[id] {
			return ""
		}
		visiting[id] = true
		path := strings.TrimSpace(category.Slug)
		if category.ParentID != nil {
			if parent := build(*category.ParentID, visiting); parent != "" {
				path = parent + "/" + path
			}
		}
		delete(visiting, id)
		paths[id] = strings.Trim(path, "/")
		return paths[id]
	}
	for id := range byID {
		build(id, map[uint]bool{})
	}
	return paths
}

func localUploadRelative(raw string) (string, bool) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return "", false
	}
	pathValue := trimmed
	if parsed, err := url.Parse(trimmed); err == nil && parsed.Path != "" {
		pathValue = parsed.Path
	}
	pathValue = strings.ReplaceAll(pathValue, "\\", "/")
	idx := strings.Index(strings.ToLower(pathValue), "/uploads/")
	if idx < 0 {
		return "", false
	}
	rel := strings.TrimPrefix(pathValue[idx+len("/uploads/"):], "/")
	clean := filepath.Clean(filepath.FromSlash(rel))
	if clean == "." || clean == ".." || filepath.IsAbs(clean) || strings.HasPrefix(clean, ".."+string(os.PathSeparator)) {
		return "", false
	}
	return filepath.ToSlash(clean), true
}

func portableProduct(product models.Product, paths map[uint]string, localFiles map[string]struct{}) ProductCatalogProduct {
	result := ProductCatalogProduct{
		SKU: product.SKU, Name: product.Name, Slug: product.Slug,
		ShortDescription: product.ShortDescription, Description: product.Description,
		Price: product.Price, ComparePrice: product.ComparePrice, CostPrice: product.CostPrice,
		StockQuantity: product.StockQuantity, MinStockLevel: product.MinStockLevel,
		Weight: product.Weight, Dimensions: product.Dimensions, Brand: product.Brand,
		Model: product.Model, PartNumber: product.PartNumber, CategoryPath: paths[product.CategoryID],
		IsActive: product.IsActive, IsFeatured: product.IsFeatured, MetaTitle: product.MetaTitle,
		MetaDescription: product.MetaDescription, MetaKeywords: product.MetaKeywords,
		DisableAutoSEO: product.DisableAutoSEO, WarrantyPeriod: product.WarrantyPeriod,
		ConditionType: product.ConditionType, OriginCountry: product.OriginCountry,
		Manufacturer: product.Manufacturer, LeadTime: product.LeadTime,
		MinimumOrderQuantity: product.MinimumOrderQuantity, PackagingInfo: product.PackagingInfo,
		Certifications: product.Certifications, TechnicalSpecs: product.TechnicalSpecs,
		CompatibilityInfo: product.CompatibilityInfo, InstallationGuide: product.InstallationGuide,
		MaintenanceTips: product.MaintenanceTips, RelatedProducts: product.RelatedProducts,
		VideoURLs: product.VideoURLs, DatasheetURL: product.DatasheetURL, ManualURL: product.ManualURL,
		PopularityScore: product.PopularityScore,
	}
	for _, image := range product.Images {
		imageURL := image.URL
		if rel, ok := localUploadRelative(image.URL); ok {
			localFiles[rel] = struct{}{}
			imageURL = "/uploads/" + rel
		}
		result.Images = append(result.Images, ProductCatalogImage{URL: imageURL, Filename: image.Filename, OriginalName: image.OriginalName, AltText: image.AltText, SortOrder: image.SortOrder, IsPrimary: image.IsPrimary})
	}
	for _, attribute := range product.Attributes {
		result.Attributes = append(result.Attributes, ProductCatalogAttribute{Name: attribute.AttributeName, Value: attribute.AttributeValue, SortOrder: attribute.SortOrder})
	}
	for _, translation := range product.Translations {
		result.Translations = append(result.Translations, ProductCatalogTranslation{LanguageCode: translation.LanguageCode, Name: translation.Name, Slug: translation.Slug, ShortDescription: translation.ShortDescription, Description: translation.Description, MetaTitle: translation.MetaTitle, MetaDescription: translation.MetaDescription, MetaKeywords: translation.MetaKeywords})
	}
	for _, link := range product.PurchaseLinks {
		result.PurchaseLinks = append(result.PurchaseLinks, ProductCatalogPurchaseLink{Platform: link.Platform, URL: link.URL, Price: link.Price, Currency: link.Currency, IsActive: link.IsActive, SortOrder: link.SortOrder, Description: link.Description})
	}
	return result
}

// WriteProductCatalogArchive writes a portable ZIP without loading the entire
// product table or all local files into memory.
func WriteProductCatalogArchive(db *gorm.DB, target io.Writer, sourceSite, sourceURL string) (ProductCatalogManifest, error) {
	if db == nil {
		return ProductCatalogManifest{}, errors.New("db is nil")
	}
	workDir, err := productCatalogWorkDir()
	if err != nil {
		return ProductCatalogManifest{}, err
	}
	catalogFile, err := os.CreateTemp(workDir, "catalog-export-*.json")
	if err != nil {
		return ProductCatalogManifest{}, err
	}
	catalogPath := catalogFile.Name()
	defer os.Remove(catalogPath)

	var categories []models.Category
	if err := db.Preload("Translations").Order("id ASC").Find(&categories).Error; err != nil {
		catalogFile.Close()
		return ProductCatalogManifest{}, err
	}
	paths := categoryPaths(categories)
	localFiles := map[string]struct{}{}
	portableCategories := make([]ProductCatalogCategory, 0, len(categories))
	for _, category := range categories {
		imageURL := category.ImageURL
		if rel, ok := localUploadRelative(imageURL); ok {
			localFiles[rel] = struct{}{}
			imageURL = "/uploads/" + rel
		}
		item := ProductCatalogCategory{Path: paths[category.ID], Name: category.Name, Slug: category.Slug, Description: category.Description, ImageURL: imageURL, SortOrder: category.SortOrder, IsActive: category.IsActive}
		for _, translation := range category.Translations {
			item.Translations = append(item.Translations, ProductCatalogCategoryTranslation{LanguageCode: translation.LanguageCode, Name: translation.Name, Slug: translation.Slug, Description: translation.Description})
		}
		portableCategories = append(portableCategories, item)
	}

	hash := sha256.New()
	buffered := bufio.NewWriterSize(io.MultiWriter(catalogFile, hash), 256*1024)
	if _, err := buffered.WriteString(`{"schema_version":1,"categories":`); err != nil {
		catalogFile.Close()
		return ProductCatalogManifest{}, err
	}
	categoryJSON, err := json.Marshal(portableCategories)
	if err != nil {
		catalogFile.Close()
		return ProductCatalogManifest{}, err
	}
	if _, err := buffered.Write(categoryJSON); err != nil {
		catalogFile.Close()
		return ProductCatalogManifest{}, err
	}
	if _, err := buffered.WriteString(`,"products":[`); err != nil {
		catalogFile.Close()
		return ProductCatalogManifest{}, err
	}

	productCount := 0
	lastID := uint(0)
	first := true
	for {
		var products []models.Product
		err := db.Where("id > ?", lastID).Order("id ASC").Limit(200).
			Preload("Images", func(tx *gorm.DB) *gorm.DB { return tx.Order("sort_order ASC, id ASC") }).
			Preload("Attributes", func(tx *gorm.DB) *gorm.DB { return tx.Order("sort_order ASC, id ASC") }).
			Preload("Translations").
			Preload("PurchaseLinks", func(tx *gorm.DB) *gorm.DB { return tx.Order("sort_order ASC, id ASC") }).
			Find(&products).Error
		if err != nil {
			catalogFile.Close()
			return ProductCatalogManifest{}, err
		}
		if len(products) == 0 {
			break
		}
		for _, product := range products {
			itemJSON, marshalErr := json.Marshal(portableProduct(product, paths, localFiles))
			if marshalErr != nil {
				catalogFile.Close()
				return ProductCatalogManifest{}, marshalErr
			}
			if !first {
				if err := buffered.WriteByte(','); err != nil {
					catalogFile.Close()
					return ProductCatalogManifest{}, err
				}
			}
			first = false
			if _, err := buffered.Write(itemJSON); err != nil {
				catalogFile.Close()
				return ProductCatalogManifest{}, err
			}
			productCount++
			lastID = product.ID
		}
	}
	if _, err := buffered.WriteString(`]}`); err != nil {
		catalogFile.Close()
		return ProductCatalogManifest{}, err
	}
	if err := buffered.Flush(); err != nil {
		catalogFile.Close()
		return ProductCatalogManifest{}, err
	}
	if err := catalogFile.Close(); err != nil {
		return ProductCatalogManifest{}, err
	}

	manifest := ProductCatalogManifest{
		Format: ProductCatalogFormat, Version: ProductCatalogVersion,
		SourceSite: strings.TrimSpace(sourceSite), SourceURL: strings.TrimSpace(sourceURL),
		ExportedAt: time.Now().UTC(), ProductCount: productCount, CategoryCount: len(categories),
		LocalFileCount: len(localFiles), CatalogSHA256: hex.EncodeToString(hash.Sum(nil)),
		Capabilities: []string{"sku_identity", "category_path_identity", "brand_mapping", "text_replacement", "local_uploads"},
	}
	archive := zip.NewWriter(target)
	writeBytes := func(name string, data []byte) error {
		entry, createErr := archive.Create(name)
		if createErr != nil {
			return createErr
		}
		_, createErr = entry.Write(data)
		return createErr
	}
	manifestJSON, _ := json.MarshalIndent(manifest, "", "  ")
	if err := writeBytes("manifest.json", manifestJSON); err != nil {
		archive.Close()
		return ProductCatalogManifest{}, err
	}
	catalogEntry, err := archive.Create("catalog.json")
	if err != nil {
		archive.Close()
		return ProductCatalogManifest{}, err
	}
	in, err := os.Open(catalogPath)
	if err != nil {
		archive.Close()
		return ProductCatalogManifest{}, err
	}
	_, copyErr := io.Copy(catalogEntry, in)
	in.Close()
	if copyErr != nil {
		archive.Close()
		return ProductCatalogManifest{}, copyErr
	}
	uploadRoot, _ := productCatalogRoot()
	localPaths := make([]string, 0, len(localFiles))
	for rel := range localFiles {
		localPaths = append(localPaths, rel)
	}
	sort.Strings(localPaths)
	for _, rel := range localPaths {
		fullPath := filepath.Join(uploadRoot, filepath.FromSlash(rel))
		info, statErr := os.Stat(fullPath)
		if statErr != nil || info.IsDir() {
			continue
		}
		entry, createErr := archive.Create("uploads/" + rel)
		if createErr != nil {
			archive.Close()
			return ProductCatalogManifest{}, createErr
		}
		file, openErr := os.Open(fullPath)
		if openErr != nil {
			continue
		}
		_, copyErr = io.Copy(entry, file)
		file.Close()
		if copyErr != nil {
			archive.Close()
			return ProductCatalogManifest{}, copyErr
		}
	}
	if err := archive.Close(); err != nil {
		return ProductCatalogManifest{}, err
	}
	return manifest, nil
}

func normalizeCatalogOptions(options ProductCatalogImportOptions) ProductCatalogImportOptions {
	options.ConflictPolicy = strings.ToLower(strings.TrimSpace(options.ConflictPolicy))
	if options.ConflictPolicy != "skip" && options.ConflictPolicy != "update" && options.ConflictPolicy != "upsert" {
		options.ConflictPolicy = "upsert"
	}
	cleanMap := map[string]string{}
	for from, to := range options.BrandMap {
		from = strings.TrimSpace(from)
		to = strings.TrimSpace(to)
		if from != "" && to != "" {
			cleanMap[strings.ToLower(from)] = to
		}
	}
	options.BrandMap = cleanMap
	cleanReplacements := make([]ProductCatalogTextReplacement, 0, len(options.TextReplacements))
	for _, replacement := range options.TextReplacements {
		if strings.TrimSpace(replacement.From) != "" && replacement.From != replacement.To {
			cleanReplacements = append(cleanReplacements, replacement)
		}
	}
	options.TextReplacements = cleanReplacements
	return options
}

func replaceCatalogText(value string, replacements []ProductCatalogTextReplacement) string {
	for _, replacement := range replacements {
		matcher := regexp.MustCompile(`(?i)` + regexp.QuoteMeta(replacement.From))
		value = matcher.ReplaceAllStringFunc(value, func(string) string { return replacement.To })
	}
	return value
}

func mapCatalogBrand(value string, brandMap map[string]string) string {
	if mapped := brandMap[strings.ToLower(strings.TrimSpace(value))]; mapped != "" {
		return mapped
	}
	return value
}

func StartProductCatalogUpload(db *gorm.DB, fileName string, fileSize int64, fingerprint string, createdBy uint) (models.ProductCatalogImportJob, error) {
	if db == nil || fileSize <= 0 {
		return models.ProductCatalogImportJob{}, errors.New("invalid catalog archive size")
	}
	if strings.TrimSpace(fingerprint) != "" {
		var existing models.ProductCatalogImportJob
		if err := db.Where("fingerprint = ? AND file_size = ? AND status IN ?", strings.TrimSpace(fingerprint), fileSize, []string{"uploading", "ready", "queued", "running", "paused"}).Order("created_at DESC").First(&existing).Error; err == nil {
			return existing, nil
		}
	}
	workDir, err := productCatalogWorkDir()
	if err != nil {
		return models.ProductCatalogImportJob{}, err
	}
	id := uuid.NewString()
	archivePath := filepath.Join(workDir, id+".zip")
	file, err := os.OpenFile(archivePath, os.O_CREATE|os.O_EXCL|os.O_RDWR, 0o600)
	if err != nil {
		return models.ProductCatalogImportJob{}, err
	}
	file.Close()
	job := models.ProductCatalogImportJob{ID: id, Status: "uploading", FileName: filepath.Base(strings.TrimSpace(fileName)), FileSize: fileSize, Fingerprint: strings.TrimSpace(fingerprint), ChunkSize: ProductCatalogChunkSize, ArchivePath: archivePath, Message: "waiting for archive chunks", CreatedByID: createdBy}
	if err := db.Create(&job).Error; err != nil {
		os.Remove(archivePath)
		return models.ProductCatalogImportJob{}, err
	}
	return job, nil
}

func UploadProductCatalogChunk(db *gorm.DB, id string, offset int64, chunk []byte) (models.ProductCatalogImportJob, error) {
	var job models.ProductCatalogImportJob
	if err := db.First(&job, "id = ?", id).Error; err != nil {
		return job, err
	}
	if job.Status != "uploading" {
		return job, errors.New("catalog job is not accepting chunks")
	}
	if offset < 0 || len(chunk) == 0 || int64(len(chunk)) > ProductCatalogMaxChunkSize || offset+int64(len(chunk)) > job.FileSize {
		return job, errors.New("invalid catalog chunk")
	}
	file, err := os.OpenFile(job.ArchivePath, os.O_RDWR, 0o600)
	if err != nil {
		return job, err
	}
	defer file.Close()
	if offset < job.UploadedBytes && offset+int64(len(chunk)) <= job.UploadedBytes {
		existing := make([]byte, len(chunk))
		if _, readErr := file.ReadAt(existing, offset); readErr == nil && bytes.Equal(existing, chunk) {
			return job, nil
		}
	}
	if offset != job.UploadedBytes {
		return job, fmt.Errorf("unexpected chunk offset: expected %d", job.UploadedBytes)
	}
	if _, err := file.WriteAt(chunk, offset); err != nil {
		return job, err
	}
	job.UploadedBytes = offset + int64(len(chunk))
	job.Message = "uploading product catalog"
	if err := db.Model(&models.ProductCatalogImportJob{}).Where("id = ? AND uploaded_bytes = ?", job.ID, offset).Updates(map[string]any{"uploaded_bytes": job.UploadedBytes, "message": job.Message}).Error; err != nil {
		return job, err
	}
	return job, nil
}

func safeCatalogArchiveName(name string) (string, bool) {
	normalized := strings.ReplaceAll(name, "\\", "/")
	if strings.HasPrefix(normalized, "/") {
		return "", false
	}
	clean := filepath.Clean(filepath.FromSlash(normalized))
	if clean == "." || clean == ".." || filepath.IsAbs(clean) || strings.HasPrefix(clean, ".."+string(os.PathSeparator)) {
		return "", false
	}
	return filepath.ToSlash(clean), true
}

func loadProductCatalog(extractedPath string) (ProductCatalogManifest, ProductCatalog, error) {
	var manifest ProductCatalogManifest
	var catalog ProductCatalog
	manifestBytes, err := os.ReadFile(filepath.Join(extractedPath, "manifest.json"))
	if err != nil {
		return manifest, catalog, err
	}
	if err := json.Unmarshal(manifestBytes, &manifest); err != nil {
		return manifest, catalog, fmt.Errorf("invalid manifest.json: %w", err)
	}
	if manifest.Format != ProductCatalogFormat || manifest.Version != ProductCatalogVersion {
		return manifest, catalog, fmt.Errorf("unsupported catalog format/version: %s/%d", manifest.Format, manifest.Version)
	}
	catalogBytes, err := os.ReadFile(filepath.Join(extractedPath, "catalog.json"))
	if err != nil {
		return manifest, catalog, err
	}
	hash := sha256.Sum256(catalogBytes)
	if manifest.CatalogSHA256 != "" && !strings.EqualFold(manifest.CatalogSHA256, hex.EncodeToString(hash[:])) {
		return manifest, catalog, errors.New("catalog.json checksum mismatch")
	}
	if err := json.Unmarshal(catalogBytes, &catalog); err != nil {
		return manifest, catalog, fmt.Errorf("invalid catalog.json: %w", err)
	}
	if catalog.SchemaVersion != ProductCatalogVersion {
		return manifest, catalog, fmt.Errorf("unsupported catalog schema version: %d", catalog.SchemaVersion)
	}
	return manifest, catalog, nil
}

func buildCatalogPreview(db *gorm.DB, manifest ProductCatalogManifest, catalog ProductCatalog) ProductCatalogPreview {
	preview := ProductCatalogPreview{Manifest: manifest}
	brands := map[string]string{}
	skus := make([]string, 0, len(catalog.Products))
	for _, product := range catalog.Products {
		if sku := strings.TrimSpace(product.SKU); sku != "" {
			skus = append(skus, sku)
		}
		if brand := strings.TrimSpace(product.Brand); brand != "" {
			brands[strings.ToLower(brand)] = brand
		}
	}
	for i := 0; i < len(skus); i += 500 {
		end := i + 500
		if end > len(skus) {
			end = len(skus)
		}
		var count int64
		if err := db.Model(&models.Product{}).Where("sku IN ?", skus[i:end]).Count(&count).Error; err == nil {
			preview.ExistingProducts += int(count)
		}
	}
	preview.NewProducts = len(skus) - preview.ExistingProducts
	for _, value := range brands {
		preview.SourceBrands = append(preview.SourceBrands, value)
	}
	sort.Strings(preview.SourceBrands)

	var targetCategories []models.Category
	if err := db.Find(&targetCategories).Error; err == nil {
		existingPaths := map[string]bool{}
		for _, path := range categoryPaths(targetCategories) {
			existingPaths[strings.ToLower(path)] = true
		}
		for _, category := range catalog.Categories {
			if !existingPaths[strings.ToLower(strings.Trim(category.Path, "/"))] {
				preview.MissingCategories++
			}
		}
	}
	if manifest.ProductCount != len(catalog.Products) {
		preview.Warnings = append(preview.Warnings, fmt.Sprintf("manifest product count is %d but catalog contains %d", manifest.ProductCount, len(catalog.Products)))
	}
	if preview.MissingCategories > 0 {
		preview.Warnings = append(preview.Warnings, fmt.Sprintf("%d category paths do not exist on the target site", preview.MissingCategories))
	}
	return preview
}

func CompleteProductCatalogUpload(db *gorm.DB, id string) (models.ProductCatalogImportJob, ProductCatalogPreview, error) {
	var job models.ProductCatalogImportJob
	if err := db.First(&job, "id = ?", id).Error; err != nil {
		return job, ProductCatalogPreview{}, err
	}
	if job.Status == "ready" {
		var preview ProductCatalogPreview
		_ = json.Unmarshal([]byte(job.PreviewJSON), &preview)
		return job, preview, nil
	}
	if job.Status != "uploading" || job.UploadedBytes != job.FileSize {
		return job, ProductCatalogPreview{}, errors.New("catalog upload is incomplete")
	}
	reader, err := zip.OpenReader(job.ArchivePath)
	if err != nil {
		return job, ProductCatalogPreview{}, fmt.Errorf("invalid ZIP archive: %w", err)
	}
	defer reader.Close()
	workDir, err := productCatalogWorkDir()
	if err != nil {
		return job, ProductCatalogPreview{}, err
	}
	extractedPath := filepath.Join(workDir, job.ID)
	if err := os.MkdirAll(extractedPath, 0o755); err != nil {
		return job, ProductCatalogPreview{}, err
	}
	var totalBytes int64
	foundManifest, foundCatalog := false, false
	if len(reader.File) > productCatalogMaxEntries {
		return job, ProductCatalogPreview{}, errors.New("catalog archive contains too many entries")
	}
	for _, entry := range reader.File {
		name, ok := safeCatalogArchiveName(entry.Name)
		if !ok {
			return job, ProductCatalogPreview{}, fmt.Errorf("unsafe ZIP path: %q", entry.Name)
		}
		if name != "manifest.json" && name != "catalog.json" && !strings.HasPrefix(name, "uploads/") {
			continue
		}
		if entry.FileInfo().IsDir() {
			continue
		}
		totalBytes += int64(entry.UncompressedSize64)
		if totalBytes > productCatalogMaxBytes {
			return job, ProductCatalogPreview{}, errors.New("catalog archive expands beyond the safety limit")
		}
		if name == "manifest.json" {
			foundManifest = true
		}
		if name == "catalog.json" {
			foundCatalog = true
		}
		target := filepath.Join(extractedPath, filepath.FromSlash(name))
		rel, relErr := filepath.Rel(extractedPath, target)
		if relErr != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(os.PathSeparator)) {
			return job, ProductCatalogPreview{}, errors.New("ZIP entry escapes extraction directory")
		}
		if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
			return job, ProductCatalogPreview{}, err
		}
		rc, openErr := entry.Open()
		if openErr != nil {
			return job, ProductCatalogPreview{}, openErr
		}
		out, createErr := os.OpenFile(target, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
		if createErr != nil {
			rc.Close()
			return job, ProductCatalogPreview{}, createErr
		}
		_, copyErr := io.Copy(out, rc)
		out.Close()
		rc.Close()
		if copyErr != nil {
			return job, ProductCatalogPreview{}, copyErr
		}
	}
	if !foundManifest || !foundCatalog {
		return job, ProductCatalogPreview{}, errors.New("catalog ZIP must contain manifest.json and catalog.json")
	}
	manifest, catalog, err := loadProductCatalog(extractedPath)
	if err != nil {
		return job, ProductCatalogPreview{}, err
	}
	preview := buildCatalogPreview(db, manifest, catalog)
	previewJSON, _ := json.Marshal(preview)
	job.Status = "ready"
	job.ExtractedPath = extractedPath
	job.PreviewJSON = string(previewJSON)
	job.TotalProducts = len(catalog.Products)
	job.Message = "catalog validated; review preview and import options"
	if err := db.Model(&job).Updates(map[string]any{"status": job.Status, "extracted_path": job.ExtractedPath, "preview_json": job.PreviewJSON, "total_products": job.TotalProducts, "message": job.Message, "error": ""}).Error; err != nil {
		return job, preview, err
	}
	return job, preview, nil
}

func GetProductCatalogPreview(job models.ProductCatalogImportJob) (ProductCatalogPreview, error) {
	var preview ProductCatalogPreview
	if strings.TrimSpace(job.PreviewJSON) == "" {
		return preview, errors.New("catalog preview is not ready")
	}
	return preview, json.Unmarshal([]byte(job.PreviewJSON), &preview)
}

func targetCategoryPath(sourcePath string, options ProductCatalogImportOptions) string {
	parts := strings.Split(strings.Trim(sourcePath, "/"), "/")
	if len(parts) == 0 {
		return ""
	}
	for from, to := range options.BrandMap {
		if parts[0] == utils.GenerateSlug(from) {
			parts[0] = utils.GenerateSlug(to)
			break
		}
	}
	return strings.Join(parts, "/")
}

func uniqueCatalogSlug(db *gorm.DB, wanted string, excludeID uint) string {
	base := utils.GenerateSlug(wanted)
	if base == "" {
		base = "catalog-item"
	}
	return utils.GenerateUniqueSlug(base, func(candidate string) bool {
		var count int64
		query := db.Model(&models.Category{}).Where("slug = ?", candidate)
		if excludeID != 0 {
			query = query.Where("id <> ?", excludeID)
		}
		_ = query.Count(&count).Error
		return count > 0
	})
}

func uniqueCatalogProductSlug(db *gorm.DB, wanted string, excludeID uint) string {
	base := utils.GenerateSlug(wanted)
	if base == "" {
		base = "product"
	}
	return utils.GenerateUniqueSlug(base, func(candidate string) bool {
		var count int64
		query := db.Model(&models.Product{}).Where("slug = ?", candidate)
		if excludeID != 0 {
			query = query.Where("id <> ?", excludeID)
		}
		_ = query.Count(&count).Error
		return count > 0
	})
}

func prepareCatalogCategories(db *gorm.DB, source []ProductCatalogCategory, options ProductCatalogImportOptions) (map[string]uint, error) {
	var existing []models.Category
	if err := db.Find(&existing).Error; err != nil {
		return nil, err
	}
	existingPaths := categoryPaths(existing)
	byPath := map[string]uint{}
	for id, path := range existingPaths {
		byPath[strings.ToLower(path)] = id
	}
	sort.Slice(source, func(i, j int) bool {
		return strings.Count(source[i].Path, "/") < strings.Count(source[j].Path, "/")
	})
	resolved := map[string]uint{}
	for _, item := range source {
		sourcePath := strings.ToLower(strings.Trim(item.Path, "/"))
		wantedPath := strings.ToLower(targetCategoryPath(item.Path, options))
		if id := byPath[wantedPath]; id != 0 {
			if options.ConflictPolicy != "skip" {
				name := replaceCatalogText(item.Name, options.TextReplacements)
				if len(strings.Split(wantedPath, "/")) == 1 {
					name = mapCatalogBrand(name, options.BrandMap)
				}
				updates := map[string]any{
					"name": name,
					"description": replaceCatalogText(item.Description, options.TextReplacements),
					"image_url": replaceCatalogText(item.ImageURL, options.TextReplacements),
					"sort_order": item.SortOrder,
					"is_active": item.IsActive,
				}
				if err := db.Model(&models.Category{}).Where("id = ?", id).Updates(updates).Error; err != nil {
					return nil, err
				}
				for _, translation := range item.Translations {
					row := models.CategoryTranslation{}
					findErr := db.Where("category_id = ? AND language_code = ?", id, translation.LanguageCode).First(&row).Error
					translationUpdates := map[string]any{
						"name": replaceCatalogText(translation.Name, options.TextReplacements),
						"slug": translation.Slug,
						"description": replaceCatalogText(translation.Description, options.TextReplacements),
					}
					if errors.Is(findErr, gorm.ErrRecordNotFound) {
						row = models.CategoryTranslation{CategoryID: id, LanguageCode: translation.LanguageCode}
						for key, value := range translationUpdates {
							if key == "name" { row.Name = value.(string) }
							if key == "slug" { row.Slug = value.(string) }
							if key == "description" { row.Description = value.(string) }
						}
						if err := db.Create(&row).Error; err != nil { return nil, err }
					} else if findErr != nil {
						return nil, findErr
					} else if err := db.Model(&row).Updates(translationUpdates).Error; err != nil {
						return nil, err
					}
				}
			}
			resolved[sourcePath] = id
			continue
		}
		if !options.CreateCategories {
			continue
		}
		parts := strings.Split(wantedPath, "/")
		var parentID *uint
		if len(parts) > 1 {
			parentPath := strings.Join(parts[:len(parts)-1], "/")
			id := byPath[parentPath]
			if id == 0 {
				return nil, fmt.Errorf("missing parent category path %s", parentPath)
			}
			parentID = &id
		}
		name := replaceCatalogText(item.Name, options.TextReplacements)
		if len(parts) == 1 {
			name = mapCatalogBrand(name, options.BrandMap)
		}
		category := models.Category{Name: name, Slug: uniqueCatalogSlug(db, parts[len(parts)-1], 0), Description: replaceCatalogText(item.Description, options.TextReplacements), ImageURL: replaceCatalogText(item.ImageURL, options.TextReplacements), ParentID: parentID, SortOrder: item.SortOrder, IsActive: item.IsActive}
		if err := db.Create(&category).Error; err != nil {
			return nil, err
		}
		for _, translation := range item.Translations {
			row := models.CategoryTranslation{CategoryID: category.ID, LanguageCode: translation.LanguageCode, Name: replaceCatalogText(translation.Name, options.TextReplacements), Slug: translation.Slug, Description: replaceCatalogText(translation.Description, options.TextReplacements)}
			if err := db.Create(&row).Error; err != nil {
				return nil, err
			}
		}
		byPath[wantedPath] = category.ID
		resolved[sourcePath] = category.ID
	}
	return resolved, nil
}

func restoreCatalogLocalFile(extractedPath, rawURL string, overwrite bool) (bool, error) {
	rel, ok := localUploadRelative(rawURL)
	if !ok {
		return false, nil
	}
	source := filepath.Join(extractedPath, "uploads", filepath.FromSlash(rel))
	if info, err := os.Stat(source); err != nil || info.IsDir() {
		return false, nil
	}
	uploadRoot, err := productCatalogRoot()
	if err != nil {
		return false, err
	}
	target := filepath.Join(uploadRoot, filepath.FromSlash(rel))
	relCheck, err := filepath.Rel(uploadRoot, target)
	if err != nil || relCheck == ".." || strings.HasPrefix(relCheck, ".."+string(os.PathSeparator)) {
		return false, errors.New("local image path escapes upload root")
	}
	if _, err := os.Stat(target); err == nil && !overwrite {
		return false, nil
	}
	if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
		return false, err
	}
	in, err := os.Open(source)
	if err != nil {
		return false, err
	}
	defer in.Close()
	temp, err := os.CreateTemp(filepath.Dir(target), ".catalog-copy-*")
	if err != nil {
		return false, err
	}
	tempPath := temp.Name()
	defer os.Remove(tempPath)
	if _, err := io.Copy(temp, in); err != nil {
		temp.Close()
		return false, err
	}
	if err := temp.Close(); err != nil {
		return false, err
	}
	if overwrite {
		_ = os.Remove(target)
	}
	if err := os.Rename(tempPath, target); err != nil {
		return false, err
	}
	return true, nil
}

func transformCatalogProduct(input ProductCatalogProduct, options ProductCatalogImportOptions) ProductCatalogProduct {
	input.Brand = mapCatalogBrand(input.Brand, options.BrandMap)
	input.Name = replaceCatalogText(input.Name, options.TextReplacements)
	input.ShortDescription = replaceCatalogText(input.ShortDescription, options.TextReplacements)
	input.Description = replaceCatalogText(input.Description, options.TextReplacements)
	input.MetaTitle = replaceCatalogText(input.MetaTitle, options.TextReplacements)
	input.MetaDescription = replaceCatalogText(input.MetaDescription, options.TextReplacements)
	input.MetaKeywords = replaceCatalogText(input.MetaKeywords, options.TextReplacements)
	input.PackagingInfo = replaceCatalogText(input.PackagingInfo, options.TextReplacements)
	input.CompatibilityInfo = replaceCatalogText(input.CompatibilityInfo, options.TextReplacements)
	input.InstallationGuide = replaceCatalogText(input.InstallationGuide, options.TextReplacements)
	input.MaintenanceTips = replaceCatalogText(input.MaintenanceTips, options.TextReplacements)
	input.DatasheetURL = replaceCatalogText(input.DatasheetURL, options.TextReplacements)
	input.ManualURL = replaceCatalogText(input.ManualURL, options.TextReplacements)
	for i := range input.Images {
		input.Images[i].URL = replaceCatalogText(input.Images[i].URL, options.TextReplacements)
		input.Images[i].AltText = replaceCatalogText(input.Images[i].AltText, options.TextReplacements)
	}
	for i := range input.Translations {
		input.Translations[i].Name = replaceCatalogText(input.Translations[i].Name, options.TextReplacements)
		input.Translations[i].ShortDescription = replaceCatalogText(input.Translations[i].ShortDescription, options.TextReplacements)
		input.Translations[i].Description = replaceCatalogText(input.Translations[i].Description, options.TextReplacements)
		input.Translations[i].MetaTitle = replaceCatalogText(input.Translations[i].MetaTitle, options.TextReplacements)
		input.Translations[i].MetaDescription = replaceCatalogText(input.Translations[i].MetaDescription, options.TextReplacements)
		input.Translations[i].MetaKeywords = replaceCatalogText(input.Translations[i].MetaKeywords, options.TextReplacements)
	}
	for i := range input.PurchaseLinks {
		input.PurchaseLinks[i].URL = replaceCatalogText(input.PurchaseLinks[i].URL, options.TextReplacements)
		input.PurchaseLinks[i].Description = replaceCatalogText(input.PurchaseLinks[i].Description, options.TextReplacements)
	}
	return input
}

func applyCatalogProduct(tx *gorm.DB, item ProductCatalogProduct, categoryID uint, existing *models.Product, create bool) error {
	product := models.Product{}
	if existing != nil {
		product = *existing
	}
	product.SKU = strings.TrimSpace(item.SKU)
	product.Name = item.Name
	wantedSlug := item.Slug
	if wantedSlug == "" {
		wantedSlug = item.Name + " " + item.SKU
	}
	product.Slug = uniqueCatalogProductSlug(tx, wantedSlug, product.ID)
	product.ShortDescription = item.ShortDescription
	product.Description = item.Description
	product.Price = item.Price
	product.ComparePrice = item.ComparePrice
	product.CostPrice = item.CostPrice
	product.StockQuantity = item.StockQuantity
	product.MinStockLevel = item.MinStockLevel
	product.Weight = item.Weight
	product.Dimensions = item.Dimensions
	product.Brand = item.Brand
	product.Model = item.Model
	product.PartNumber = item.PartNumber
	product.CategoryID = categoryID
	product.IsActive = item.IsActive
	product.IsFeatured = item.IsFeatured
	product.MetaTitle = item.MetaTitle
	product.MetaDescription = item.MetaDescription
	product.MetaKeywords = item.MetaKeywords
	product.DisableAutoSEO = item.DisableAutoSEO
	product.WarrantyPeriod = item.WarrantyPeriod
	product.ConditionType = item.ConditionType
	product.OriginCountry = item.OriginCountry
	product.Manufacturer = item.Manufacturer
	product.LeadTime = item.LeadTime
	product.MinimumOrderQuantity = item.MinimumOrderQuantity
	product.PackagingInfo = item.PackagingInfo
	product.Certifications = item.Certifications
	product.TechnicalSpecs = item.TechnicalSpecs
	product.CompatibilityInfo = item.CompatibilityInfo
	product.InstallationGuide = item.InstallationGuide
	product.MaintenanceTips = item.MaintenanceTips
	product.RelatedProducts = item.RelatedProducts
	product.VideoURLs = item.VideoURLs
	product.DatasheetURL = item.DatasheetURL
	product.ManualURL = item.ManualURL
	product.PopularityScore = item.PopularityScore
	urls := make([]string, 0, len(item.Images))
	for _, image := range item.Images {
		urls = append(urls, image.URL)
	}
	if encoded, err := json.Marshal(urls); err == nil {
		product.ImageURLs = string(encoded)
	}
	if create {
		if err := tx.Create(&product).Error; err != nil {
			return err
		}
	} else if err := tx.Save(&product).Error; err != nil {
		return err
	}
	for _, relation := range []any{&models.ProductImage{}, &models.ProductAttribute{}, &models.ProductTranslation{}, &models.PurchaseLink{}} {
		if err := tx.Where("product_id = ?", product.ID).Delete(relation).Error; err != nil {
			return err
		}
	}
	for _, image := range item.Images {
		row := models.ProductImage{ProductID: product.ID, URL: image.URL, Filename: image.Filename, OriginalName: image.OriginalName, AltText: image.AltText, SortOrder: image.SortOrder, IsPrimary: image.IsPrimary}
		if err := tx.Create(&row).Error; err != nil {
			return err
		}
	}
	for _, attribute := range item.Attributes {
		row := models.ProductAttribute{ProductID: product.ID, AttributeName: attribute.Name, AttributeValue: attribute.Value, SortOrder: attribute.SortOrder}
		if err := tx.Create(&row).Error; err != nil {
			return err
		}
	}
	for _, translation := range item.Translations {
		row := models.ProductTranslation{ProductID: product.ID, LanguageCode: translation.LanguageCode, Name: translation.Name, Slug: translation.Slug, ShortDescription: translation.ShortDescription, Description: translation.Description, MetaTitle: translation.MetaTitle, MetaDescription: translation.MetaDescription, MetaKeywords: translation.MetaKeywords}
		if row.Slug == "" {
			row.Slug = product.Slug
		}
		if err := tx.Create(&row).Error; err != nil {
			return err
		}
	}
	for _, link := range item.PurchaseLinks {
		row := models.PurchaseLink{ProductID: product.ID, Platform: link.Platform, URL: link.URL, Price: link.Price, Currency: link.Currency, IsActive: link.IsActive, SortOrder: link.SortOrder, Description: link.Description}
		if err := tx.Create(&row).Error; err != nil {
			return err
		}
	}
	return nil
}

func runProductCatalogImport(db *gorm.DB, id string) {
	if _, loaded := productCatalogWorkers.LoadOrStore(id, true); loaded {
		return
	}
	defer productCatalogWorkers.Delete(id)
	var job models.ProductCatalogImportJob
	if err := db.First(&job, "id = ?", id).Error; err != nil {
		return
	}
	if job.Status != "queued" && job.Status != "running" {
		return
	}
	token := uuid.NewString()
	now := time.Now()
	claim := db.Model(&models.ProductCatalogImportJob{}).Where("id = ? AND status IN ?", id, []string{"queued", "running"}).Updates(map[string]any{"status": "running", "worker_token": token, "started_at": now, "message": "importing product catalog", "error": ""})
	if claim.Error != nil || claim.RowsAffected == 0 {
		return
	}
	if err := db.First(&job, "id = ?", id).Error; err != nil {
		return
	}
	_, catalog, err := loadProductCatalog(job.ExtractedPath)
	if err != nil {
		finishProductCatalogJob(db, id, token, "failed", err.Error())
		return
	}
	var options ProductCatalogImportOptions
	if err := json.Unmarshal([]byte(job.OptionsJSON), &options); err != nil {
		finishProductCatalogJob(db, id, token, "failed", "invalid saved import options")
		return
	}
	options = normalizeCatalogOptions(options)
	categoryRestored := 0
	for _, category := range catalog.Categories {
		if copied, restoreErr := restoreCatalogLocalFile(job.ExtractedPath, category.ImageURL, options.OverwriteLocalFiles); restoreErr != nil {
			finishProductCatalogJob(db, id, token, "failed", restoreErr.Error())
			return
		} else if copied {
			categoryRestored++
		}
	}
	categoryIDs, err := prepareCatalogCategories(db, catalog.Categories, options)
	if err != nil {
		finishProductCatalogJob(db, id, token, "failed", err.Error())
		return
	}
	if categoryRestored > 0 {
		_ = db.Model(&models.ProductCatalogImportJob{}).Where("id = ? AND worker_token = ?", id, token).Update("restored_files", gorm.Expr("restored_files + ?", categoryRestored)).Error
	}
	sort.Slice(catalog.Products, func(i, j int) bool {
		return strings.ToLower(catalog.Products[i].SKU) < strings.ToLower(catalog.Products[j].SKU)
	})
	for _, sourceItem := range catalog.Products {
		sku := strings.TrimSpace(sourceItem.SKU)
		if sku == "" || (job.LastSKU != "" && strings.ToLower(sku) <= strings.ToLower(job.LastSKU)) {
			continue
		}
		var current models.ProductCatalogImportJob
		if err := db.Select("status", "worker_token").First(&current, "id = ?", id).Error; err != nil || current.Status != "running" || current.WorkerToken != token {
			return
		}
		item := transformCatalogProduct(sourceItem, options)
		categoryID := categoryIDs[strings.ToLower(strings.Trim(item.CategoryPath, "/"))]
		created, updated, skipped, failed, restored := 0, 0, 0, 0, 0
		if categoryID == 0 {
			failed = 1
		} else {
			var existing models.Product
			findErr := db.Where("sku = ?", sku).First(&existing).Error
			exists := findErr == nil
			if findErr != nil && !errors.Is(findErr, gorm.ErrRecordNotFound) {
				failed = 1
			} else if exists && options.ConflictPolicy == "skip" {
				skipped = 1
			} else if !exists && options.ConflictPolicy == "update" {
				skipped = 1
			} else {
				for _, image := range item.Images {
					copied, copyErr := restoreCatalogLocalFile(job.ExtractedPath, image.URL, options.OverwriteLocalFiles)
					if copyErr != nil {
						failed = 1
						break
					}
					if copied {
						restored++
					}
				}
				if failed == 0 {
					applyErr := db.Transaction(func(tx *gorm.DB) error {
						if exists {
							return applyCatalogProduct(tx, item, categoryID, &existing, false)
						}
						return applyCatalogProduct(tx, item, categoryID, nil, true)
					})
					if applyErr != nil {
						failed = 1
					} else if exists {
						updated = 1
					} else {
						created = 1
					}
				}
			}
		}
		updates := map[string]any{
			"last_sku":           sku,
			"processed_products": gorm.Expr("processed_products + 1"),
			"created_products":   gorm.Expr("created_products + ?", created),
			"updated_products":   gorm.Expr("updated_products + ?", updated),
			"skipped_products":   gorm.Expr("skipped_products + ?", skipped),
			"failed_products":    gorm.Expr("failed_products + ?", failed),
			"restored_files":     gorm.Expr("restored_files + ?", restored),
			"message":            fmt.Sprintf("processed SKU %s", sku),
		}
		if err := db.Model(&models.ProductCatalogImportJob{}).Where("id = ? AND worker_token = ?", id, token).Updates(updates).Error; err != nil {
			finishProductCatalogJob(db, id, token, "failed", err.Error())
			return
		}
		job.LastSKU = sku
	}
	finishProductCatalogJob(db, id, token, "completed", "product catalog import completed")
}

func finishProductCatalogJob(db *gorm.DB, id, token, status, message string) {
	now := time.Now()
	updates := map[string]any{"status": status, "worker_token": "", "completed_at": now}
	if status == "failed" {
		updates["error"] = message
		updates["message"] = "product catalog import failed"
	} else {
		updates["message"] = message
		updates["error"] = ""
	}
	_ = db.Model(&models.ProductCatalogImportJob{}).Where("id = ? AND worker_token = ?", id, token).Updates(updates).Error
}

func ApplyProductCatalogImport(db *gorm.DB, id string, options ProductCatalogImportOptions) (models.ProductCatalogImportJob, error) {
	options = normalizeCatalogOptions(options)
	encoded, _ := json.Marshal(options)
	var job models.ProductCatalogImportJob
	if err := db.First(&job, "id = ?", id).Error; err != nil {
		return job, err
	}
	if job.Status != "ready" && job.Status != "paused" && job.Status != "failed" {
		return job, errors.New("catalog job is not ready to import")
	}
	updates := map[string]any{"status": "queued", "options_json": string(encoded), "worker_token": "", "message": "queued for background import", "error": "", "completed_at": nil}
	if job.Status == "ready" || job.Status == "failed" {
		updates["last_sku"] = ""
		updates["processed_products"] = 0
		updates["created_products"] = 0
		updates["updated_products"] = 0
		updates["skipped_products"] = 0
		updates["failed_products"] = 0
		updates["restored_files"] = 0
	}
	if err := db.Model(&job).Updates(updates).Error; err != nil {
		return job, err
	}
	_ = db.First(&job, "id = ?", id).Error
	go runProductCatalogImport(db, id)
	return job, nil
}

func PauseProductCatalogImport(db *gorm.DB, id string) (models.ProductCatalogImportJob, error) {
	var job models.ProductCatalogImportJob
	if err := db.First(&job, "id = ?", id).Error; err != nil {
		return job, err
	}
	if job.Status != "queued" && job.Status != "running" {
		return job, errors.New("catalog job is not running")
	}
	if err := db.Model(&job).Updates(map[string]any{"status": "paused", "worker_token": "", "message": "product catalog import paused"}).Error; err != nil {
		return job, err
	}
	_ = db.First(&job, "id = ?", id).Error
	return job, nil
}

func ResumeProductCatalogImport(db *gorm.DB, id string) (models.ProductCatalogImportJob, error) {
	var job models.ProductCatalogImportJob
	if err := db.First(&job, "id = ?", id).Error; err != nil {
		return job, err
	}
	if job.Status != "paused" {
		return job, errors.New("catalog job is not paused")
	}
	if err := db.Model(&job).Updates(map[string]any{"status": "queued", "worker_token": "", "message": "queued to resume product catalog import"}).Error; err != nil {
		return job, err
	}
	_ = db.First(&job, "id = ?", id).Error
	go runProductCatalogImport(db, id)
	return job, nil
}

func CancelProductCatalogImport(db *gorm.DB, id string) (models.ProductCatalogImportJob, error) {
	var job models.ProductCatalogImportJob
	if err := db.First(&job, "id = ?", id).Error; err != nil {
		return job, err
	}
	if job.Status == "completed" || job.Status == "canceled" {
		return job, nil
	}
	now := time.Now()
	if err := db.Model(&job).Updates(map[string]any{"status": "canceled", "worker_token": "", "message": "product catalog import canceled", "completed_at": now}).Error; err != nil {
		return job, err
	}
	_ = db.First(&job, "id = ?", id).Error
	return job, nil
}

// StartProductCatalogImportDaemon resumes jobs that were queued or interrupted
// by a backend/container restart.
func StartProductCatalogImportDaemon(db *gorm.DB) {
	if db == nil || !db.Migrator().HasTable(&models.ProductCatalogImportJob{}) {
		return
	}
	_ = db.Model(&models.ProductCatalogImportJob{}).Where("status = ?", "running").Updates(map[string]any{"status": "queued", "worker_token": "", "message": "recovered after backend restart"}).Error
	var jobs []models.ProductCatalogImportJob
	if err := db.Where("status = ?", "queued").Order("created_at ASC").Find(&jobs).Error; err != nil {
		return
	}
	for _, job := range jobs {
		go runProductCatalogImport(db, job.ID)
	}
}
