package models

import "time"

// MediaAsset represents an uploaded image in the admin media library.
// Files are stored under UPLOAD_PATH (default ./uploads) and served via /uploads/*.
type MediaAsset struct {
	ID           uint   `json:"id" gorm:"primaryKey"`
	OriginalName string `json:"original_name" gorm:"size:255;not null"`
	FileName     string `json:"file_name" gorm:"size:255;not null"`
	// RelativePath is relative to the uploads dir, e.g. "media/<sha256>.jpg".
	RelativePath string    `json:"relative_path" gorm:"size:512;not null;uniqueIndex"`
	SHA256       string    `json:"sha256" gorm:"size:64;not null;uniqueIndex"`
	MimeType     string    `json:"mime_type" gorm:"size:100"`
	SizeBytes    int64     `json:"size_bytes"`
	Title        string    `json:"title" gorm:"size:255"`
	AltText      string    `json:"alt_text" gorm:"size:500"`
	Folder       string    `json:"folder" gorm:"size:255;index"`
	Tags         string    `json:"tags" gorm:"type:text"` // comma-separated
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

type MediaAssetResponse struct {
	ID           uint      `json:"id"`
	OriginalName string    `json:"original_name"`
	FileName     string    `json:"file_name"`
	RelativePath string    `json:"relative_path"`
	URL          string    `json:"url"`
	ThumbnailURL  string    `json:"thumbnail_url"`
	SHA256       string    `json:"sha256"`
	MimeType     string    `json:"mime_type"`
	SizeBytes    int64     `json:"size_bytes"`
	Title        string    `json:"title"`
	AltText      string    `json:"alt_text"`
	Folder       string    `json:"folder"`
	Tags         string    `json:"tags"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

func (m *MediaAsset) ToResponse() MediaAssetResponse {
	return MediaAssetResponse{
		ID:           m.ID,
		OriginalName: m.OriginalName,
		FileName:     m.FileName,
		RelativePath: m.RelativePath,
		URL:          "/uploads/" + m.RelativePath,
		ThumbnailURL: "/media-thumb/" + m.RelativePath,
		SHA256:       m.SHA256,
		MimeType:     m.MimeType,
		SizeBytes:    m.SizeBytes,
		Title:        m.Title,
		AltText:      m.AltText,
		Folder:       m.Folder,
		Tags:         m.Tags,
		CreatedAt:    m.CreatedAt,
		UpdatedAt:    m.UpdatedAt,
	}
}

type MediaListResponse struct {
	Items    []MediaAssetResponse `json:"items"`
	Total    int64                `json:"total"`
	Page     int                  `json:"page"`
	PageSize int                  `json:"page_size"`
}

type MediaBatchDeleteRequest struct {
	IDs []uint `json:"ids" binding:"required,min=1"`
}

type MediaBatchUpdateRequest struct {
	IDs []uint `json:"ids" binding:"required,min=1"`
	// Apply to all selected assets when non-empty.
	Folder  *string `json:"folder"`
	Tags    *string `json:"tags"`
	Title   *string `json:"title"`
	AltText *string `json:"alt_text"`
}
