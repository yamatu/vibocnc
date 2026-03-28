package utils

import (
	"fmt"
	"math"
	"os"
	"regexp"
	"strconv"
	"strings"
	"unicode"

	"golang.org/x/text/runes"
	"golang.org/x/text/transform"
	"golang.org/x/text/unicode/norm"
)

// GenerateSlug creates a URL-friendly slug from a string
func GenerateSlug(text string) string {
	// Convert to lowercase
	text = strings.ToLower(text)

	// Remove accents and normalize
	t := transform.Chain(norm.NFD, runes.Remove(runes.In(unicode.Mn)), norm.NFC)
	text, _, _ = transform.String(t, text)

	// Replace spaces and special characters with hyphens
	reg := regexp.MustCompile(`[^a-z0-9]+`)
	text = reg.ReplaceAllString(text, "-")

	// Remove leading and trailing hyphens
	text = strings.Trim(text, "-")

	return text
}

// GenerateUniqueSlug generates a unique slug by appending numbers if needed
func GenerateUniqueSlug(baseSlug string, checkExists func(string) bool) string {
	slug := baseSlug
	counter := 1

	for checkExists(slug) {
		slug = fmt.Sprintf("%s-%d", baseSlug, counter)
		counter++
	}

	return slug
}

// ParsePagination parses pagination parameters from query strings
func ParsePagination(pageStr, pageSizeStr string) (int, int) {
	page := 1
	pageSize := 20 // default

	// Get max page size from environment variable
	maxPageSize := 100 // fallback default
	if maxPageSizeStr := os.Getenv("MAX_PAGE_SIZE"); maxPageSizeStr != "" {
		if mps, err := strconv.Atoi(maxPageSizeStr); err == nil && mps > 0 {
			maxPageSize = mps
		}
	}

	if pageStr != "" {
		if p, err := strconv.Atoi(pageStr); err == nil && p > 0 {
			page = p
		}
	}

	if pageSizeStr != "" {
		if ps, err := strconv.Atoi(pageSizeStr); err == nil && ps > 0 && ps <= maxPageSize {
			pageSize = ps
		}
	}

	return page, pageSize
}

// ParsePaginationWithMax parses pagination parameters with an explicit max page size.
func ParsePaginationWithMax(pageStr, pageSizeStr string, maxPageSize int) (int, int) {
	page := 1
	pageSize := 20

	if maxPageSize <= 0 {
		maxPageSize = 20
	}

	if pageStr != "" {
		if p, err := strconv.Atoi(pageStr); err == nil && p > 0 {
			page = p
		}
	}

	if pageSizeStr != "" {
		if ps, err := strconv.Atoi(pageSizeStr); err == nil && ps > 0 && ps <= maxPageSize {
			pageSize = ps
		}
	}

	return page, pageSize
}

// CalculateOffset calculates database offset for pagination
func CalculateOffset(page, pageSize int) int {
	return (page - 1) * pageSize
}

// CalculateTotalPages calculates total pages for pagination
func CalculateTotalPages(total int64, pageSize int) int {
	return int(math.Ceil(float64(total) / float64(pageSize)))
}

// ValidateImageExtension checks if file extension is allowed for images
func ValidateImageExtension(filename string) bool {
	// Keep this list conservative but practical for real-world uploads.
	// Note: SVG can contain scripts; when used via <img> it's generally safe, but avoid inline embedding.
	allowedExts := []string{
		".jpg", ".jpeg", ".png", ".gif", ".webp",
		".svg",
		".avif",
		".bmp",
		".tif", ".tiff",
		".heic", ".heif",
	}

	filename = strings.ToLower(filename)
	for _, ext := range allowedExts {
		if strings.HasSuffix(filename, ext) {
			return true
		}
	}

	return false
}

// SanitizeFilename removes dangerous characters from filename
func SanitizeFilename(filename string) string {
	// Remove path separators and dangerous characters
	reg := regexp.MustCompile(`[<>:"/\\|?*\x00-\x1f]`)
	filename = reg.ReplaceAllString(filename, "")

	// Limit length
	if len(filename) > 255 {
		filename = filename[:255]
	}

	return filename
}

// TruncateText truncates text to specified length with ellipsis
func TruncateText(text string, length int) string {
	if len(text) <= length {
		return text
	}

	return text[:length-3] + "..."
}

// Contains checks if a string slice contains a specific string
func Contains(slice []string, item string) bool {
	for _, s := range slice {
		if s == item {
			return true
		}
	}
	return false
}

// RemoveEmpty removes empty strings from a slice
func RemoveEmpty(slice []string) []string {
	var result []string
	for _, s := range slice {
		if strings.TrimSpace(s) != "" {
			result = append(result, strings.TrimSpace(s))
		}
	}
	return result
}
