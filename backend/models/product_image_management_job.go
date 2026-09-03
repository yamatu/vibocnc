package models

import "time"

// ProductImageTrustedURL records an external URL explicitly approved through
// the administrator's product editor. Local /uploads URLs do not need rows.
type ProductImageTrustedURL struct {
	ID          uint      `json:"id" gorm:"primaryKey"`
	ProductID   uint      `json:"product_id" gorm:"index;uniqueIndex:idx_product_image_trusted_url"`
	URLHash     string    `json:"-" gorm:"size:64;uniqueIndex:idx_product_image_trusted_url"`
	URL         string    `json:"url" gorm:"type:text"`
	Source      string    `json:"source" gorm:"size:32;default:'admin_external'"`
	CreatedByID uint      `json:"created_by_id" gorm:"index"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

func (ProductImageTrustedURL) TableName() string { return "product_image_trusted_urls" }

type ProductImagePolicySetting struct {
	ID                 uint      `json:"id" gorm:"primaryKey"`
	TrustedDomainsJSON string    `json:"-" gorm:"type:text"`
	TrustedDomains     []string  `json:"trusted_domains" gorm:"-"`
	CreatedAt          time.Time `json:"created_at"`
	UpdatedAt          time.Time `json:"updated_at"`
}

// ProductImageCleanupJob removes only external image URLs that were not
// protected by the local/owned URL rules captured when the job was created.
type ProductImageCleanupJob struct {
	ID                 string     `json:"id" gorm:"primaryKey;size:36"`
	Status             string     `json:"status" gorm:"size:32;index;not null"`
	TrustedDomainsJSON string     `json:"-" gorm:"type:text"`
	TrustedDomains     []string   `json:"trusted_domains" gorm:"-"`
	Brand              string     `json:"brand" gorm:"size:100;index"`
	CategoryID         uint       `json:"category_id" gorm:"index"`
	IncludeDescendants bool       `json:"include_descendants"`
	ProductStatus      string     `json:"product_status" gorm:"size:16"`
	BatchSize          int        `json:"batch_size"`
	MaxProductID       uint       `json:"max_product_id"`
	LastProductID      uint       `json:"last_product_id"`
	WorkerToken        string     `json:"-" gorm:"size:36;index"`
	Total              int        `json:"total"`
	Processed          int        `json:"processed"`
	UpdatedProducts    int        `json:"updated_products"`
	SkippedProducts    int        `json:"skipped_products"`
	RemovedImages      int        `json:"removed_images"`
	Failed             int        `json:"failed"`
	Message            string     `json:"message" gorm:"size:255"`
	Error              string     `json:"error" gorm:"type:text"`
	CreatedByID        uint       `json:"created_by_id" gorm:"index"`
	CreatedAt          time.Time  `json:"created_at"`
	UpdatedAt          time.Time  `json:"updated_at"`
	StartedAt          *time.Time `json:"started_at"`
	CompletedAt        *time.Time `json:"completed_at"`
}

// ProductImageArchiveJob tracks both resumable ZIP upload and restart-safe SKU
// folder processing. TempPath never leaves the server response boundary.
type ProductImageArchiveJob struct {
	ID               string     `json:"id" gorm:"primaryKey;size:36"`
	Status           string     `json:"status" gorm:"size:32;index;not null"`
	FileName         string     `json:"file_name" gorm:"size:255"`
	FileSize         int64      `json:"file_size"`
	Fingerprint      string     `json:"-" gorm:"size:64;index"`
	UploadedBytes    int64      `json:"uploaded_bytes"`
	TempPath         string     `json:"-" gorm:"size:1024"`
	ChunkSize        int64      `json:"chunk_size"`
	WorkerToken      string     `json:"-" gorm:"size:36;index"`
	TotalFolders     int        `json:"total_folders"`
	ProcessedFolders int        `json:"processed_folders"`
	LastFolderIndex  int        `json:"last_folder_index"`
	MatchedProducts  int        `json:"matched_products"`
	UpdatedProducts  int        `json:"updated_products"`
	ImportedImages   int        `json:"imported_images"`
	DuplicateImages  int        `json:"duplicate_images"`
	SkippedFolders   int        `json:"skipped_folders"`
	FailedFolders    int        `json:"failed_folders"`
	Message          string     `json:"message" gorm:"size:255"`
	Error            string     `json:"error" gorm:"type:text"`
	CreatedByID      uint       `json:"created_by_id" gorm:"index"`
	CreatedAt        time.Time  `json:"created_at"`
	UpdatedAt        time.Time  `json:"updated_at"`
	StartedAt        *time.Time `json:"started_at"`
	CompletedAt      *time.Time `json:"completed_at"`
}
