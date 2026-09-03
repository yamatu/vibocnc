package models

import "time"

// EbayImportJSONTask is the durable state for a large JSON draft import.
// Uploaded files live below UPLOAD_PATH/.imports/ebay-json so a container
// restart does not discard an upload that has not finished yet.
type EbayImportJSONTask struct {
	ID            string     `json:"id" gorm:"primaryKey;size:36"`
	Status        string     `json:"status" gorm:"size:32;not null;index"`
	Filename      string     `json:"filename" gorm:"size:255"`
	FileSize      int64      `json:"file_size"`
	UploadedBytes int64      `json:"uploaded_bytes"`
	ChunkSize     int64      `json:"chunk_size"`
	Fingerprint   string     `json:"-" gorm:"size:64;index"`
	FilePath      string     `json:"-" gorm:"size:1024"`
	InputOffset   int64      `json:"input_offset"`
	Processed     int        `json:"processed"`
	Created       int        `json:"created"`
	Skipped       int        `json:"skipped"`
	Failed        int        `json:"failed"`
	ProgressPct   float64    `json:"progress_pct"`
	WorkerToken   string     `json:"-" gorm:"size:36;index"`
	Message       string     `json:"message" gorm:"size:255"`
	Error         string     `json:"error" gorm:"type:text"`
	ErrorsJSON    string     `json:"-" gorm:"type:longtext"`
	CreatedByID   uint       `json:"created_by_id" gorm:"index"`
	CreatedAt     time.Time  `json:"created_at"`
	UpdatedAt     time.Time  `json:"updated_at"`
	StartedAt     *time.Time `json:"started_at"`
	CompletedAt   *time.Time `json:"completed_at"`
}

func (EbayImportJSONTask) TableName() string { return "ebay_import_json_tasks" }
