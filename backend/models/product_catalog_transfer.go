package models

import "time"

// ProductCatalogImportJob persists resumable product-library uploads and the
// background import cursor. ArchivePath and ExtractedPath are server-only.
type ProductCatalogImportJob struct {
	ID                string     `json:"id" gorm:"primaryKey;size:36"`
	Status            string     `json:"status" gorm:"size:32;index;not null"`
	FileName          string     `json:"file_name" gorm:"size:255"`
	FileSize          int64      `json:"file_size"`
	Fingerprint       string     `json:"-" gorm:"size:128;index"`
	UploadedBytes     int64      `json:"uploaded_bytes"`
	ChunkSize         int64      `json:"chunk_size"`
	ArchivePath       string     `json:"-" gorm:"size:1024"`
	ExtractedPath     string     `json:"-" gorm:"size:1024"`
	OptionsJSON       string     `json:"-" gorm:"type:longtext"`
	PreviewJSON       string     `json:"-" gorm:"type:longtext"`
	WorkerToken       string     `json:"-" gorm:"size:36;index"`
	LastSKU           string     `json:"last_sku" gorm:"size:100;index"`
	TotalProducts     int        `json:"total_products"`
	ProcessedProducts int        `json:"processed_products"`
	CreatedProducts   int        `json:"created_products"`
	UpdatedProducts   int        `json:"updated_products"`
	SkippedProducts   int        `json:"skipped_products"`
	FailedProducts    int        `json:"failed_products"`
	RestoredFiles     int        `json:"restored_files"`
	Message           string     `json:"message" gorm:"size:255"`
	Error             string     `json:"error" gorm:"type:text"`
	CreatedByID       uint       `json:"created_by_id" gorm:"index"`
	CreatedAt         time.Time  `json:"created_at"`
	UpdatedAt         time.Time  `json:"updated_at"`
	StartedAt         *time.Time `json:"started_at"`
	CompletedAt       *time.Time `json:"completed_at"`
}

func (ProductCatalogImportJob) TableName() string { return "product_catalog_import_jobs" }
