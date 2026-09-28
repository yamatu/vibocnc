package services

import (
	"errors"
	"fmt"
	"strings"

	"fanuc-backend/utils"

	"fanuc-backend/models"

	"gorm.io/gorm"
)

// DraftCategoryMode controls the catalogue branch used by an AI review.
// mixed keeps the existing brand > product-type taxonomy; source creates a
// separate eBay or B-Automation branch from the source site's own breadcrumb.
const (
	DraftCategoryModeMixed  = "mixed"
	DraftCategoryModeSource = "source"
)

func NormalizeDraftCategoryMode(value string) string {
	if strings.EqualFold(strings.TrimSpace(value), DraftCategoryModeSource) {
		return DraftCategoryModeSource
	}
	return DraftCategoryModeMixed
}

// EffectiveDraftCategoryMode keeps old rows safe: source mode is used when a
// legacy eBay/BAS payload carries a source breadcrumb, while rows without one
// fall back to the mixed brand/type taxonomy.
func EffectiveDraftCategoryMode(draft models.EbayImportDraft) string {
	mode := NormalizeDraftCategoryMode(draft.CategoryMode)
	if strings.TrimSpace(draft.CategoryMode) != "" {
		return mode
	}
	if strings.TrimSpace(draftReviewSourceCategory(draft.SourceSite, decodeRawPayload(draft.RawPayload))) != "" {
		return DraftCategoryModeSource
	}
	return DraftCategoryModeMixed
}

func sourceTaxonomyRootName(site string) (string, error) {
	switch normalizeDraftSourceSite(site) {
	case DraftSourceSiteEbay:
		return "eBay", nil
	case DraftSourceSiteBas:
		return "B-Automation", nil
	default:
		return "", fmt.Errorf("unknown source site %q", strings.TrimSpace(site))
	}
}

func sourceCategorySegments(site, rawPath string) ([]string, string, error) {
	root, err := sourceTaxonomyRootName(site)
	if err != nil {
		return nil, "", err
	}
	parts := make([]string, 0, 8)
	for _, raw := range strings.Split(rawPath, ">") {
		value := clampDraftSourceCategory(raw)
		if value == "" || strings.EqualFold(value, root) {
			continue
		}
		parts = append(parts, value)
		if len(parts) >= 8 {
			break
		}
	}
	if len(parts) == 0 {
		return nil, "", errors.New("source category path is empty")
	}
	return parts, root, nil
}

// ResolveOrCreateDraftSourceCategory creates/reuses an exact source taxonomy
// path below a dedicated root. The source path is evidence from the crawler,
// not a free-form AI category name, and is bounded before it reaches SQL.
func ResolveOrCreateDraftSourceCategory(db *gorm.DB, site, rawPath string) (uint, string, bool, error) {
	if db == nil {
		return 0, "", false, errors.New("database is nil")
	}
	segments, rootName, err := sourceCategorySegments(site, rawPath)
	if err != nil {
		return 0, "", false, err
	}

	var categoryID uint
	created := false
	err = withCategoryCreationLock(func() error {
		return db.Transaction(func(tx *gorm.DB) error {
			var parent models.Category
			rootQuery := tx.Where("LOWER(name) = LOWER(?)", rootName).
				Where("parent_id IS NULL OR parent_id = 0").
				Order("id ASC").First(&parent)
			if errors.Is(rootQuery.Error, gorm.ErrRecordNotFound) {
				slug, slugErr := uniqueCategorySlug(tx, utils.GenerateSlug(rootName)+"-source")
				if slugErr != nil {
					return slugErr
				}
				parent = models.Category{
					Name:        rootName,
					Slug:        slug,
					Description: rootName + " source taxonomy",
					IsActive:    true,
				}
				if err := tx.Create(&parent).Error; err != nil {
					return err
				}
				created = true
			} else if rootQuery.Error != nil {
				return rootQuery.Error
			} else if !parent.IsActive {
				if err := tx.Model(&models.Category{}).Where("id = ?", parent.ID).Update("is_active", true).Error; err != nil {
					return err
				}
				parent.IsActive = true
			}

			path := []string{parent.Name}
			for _, segment := range segments {
				var child models.Category
				lookup := tx.Where("parent_id = ? AND LOWER(name) = LOWER(?)", parent.ID, segment).First(&child)
				if errors.Is(lookup.Error, gorm.ErrRecordNotFound) {
					slug, slugErr := uniqueCategorySlug(tx, strings.Trim(strings.ToLower(parent.Slug+"-"+segment), "-"))
					if slugErr != nil {
						return slugErr
					}
					child = models.Category{
						Name:        segment,
						Slug:        slug,
						Description: rootName + " > " + strings.Join(append(path[1:], segment), " > "),
						ParentID:    uintPtrForCategoryOptimization(parent.ID),
						IsActive:    true,
					}
					if err := tx.Create(&child).Error; err != nil {
						return err
					}
					created = true
				} else if lookup.Error != nil {
					return lookup.Error
				} else if !child.IsActive {
					if err := tx.Model(&models.Category{}).Where("id = ?", child.ID).Update("is_active", true).Error; err != nil {
						return err
					}
					child.IsActive = true
				}
				parent = child
				path = append(path, child.Name)
			}
			categoryID = parent.ID
			return nil
		})
	})
	if err != nil {
		return 0, "", false, err
	}
	if categoryID == 0 {
		return 0, "", false, errors.New("source category creation did not produce a category")
	}
	path, err := draftCategoryPath(db, categoryID)
	if err != nil {
		return 0, "", created, err
	}
	return categoryID, path, created, nil
}

func draftCategoryPath(db *gorm.DB, categoryID uint) (string, error) {
	if db == nil || categoryID == 0 {
		return "", errors.New("category is required")
	}
	parts := []string{}
	seen := map[uint]bool{}
	current := categoryID
	for current > 0 && !seen[current] {
		seen[current] = true
		var category models.Category
		if err := db.Select("id", "name", "parent_id", "is_active").First(&category, current).Error; err != nil {
			return "", err
		}
		if !category.IsActive {
			return "", fmt.Errorf("category %d is inactive", category.ID)
		}
		parts = append([]string{category.Name}, parts...)
		if category.ParentID == nil || *category.ParentID == 0 {
			break
		}
		current = *category.ParentID
	}
	if len(parts) == 0 || len(seen) >= 8 && current > 0 {
		return "", errors.New("invalid category parent path")
	}
	return strings.Join(parts, " > "), nil
}

// ValidateDraftSourceCategoryForImport accepts only an active leaf below the
// source root. It deliberately does not apply the brand/type matcher because an
// eBay/BAS taxonomy path is the selected classification in source mode.
func ValidateDraftSourceCategoryForImport(db *gorm.DB, draft models.EbayImportDraft, categoryID uint) (string, error) {
	root, err := sourceTaxonomyRootName(draft.SourceSite)
	if err != nil {
		return "", err
	}
	path, err := draftCategoryPath(db, categoryID)
	if err != nil {
		return "", err
	}
	parts := strings.Split(path, " > ")
	if len(parts) < 2 || !strings.EqualFold(parts[0], root) {
		return "", fmt.Errorf("category %q is outside the %s source taxonomy", path, root)
	}
	var childCount int64
	if err := db.Model(&models.Category{}).Where("parent_id = ? AND is_active = ?", categoryID, true).Count(&childCount).Error; err != nil {
		return "", err
	}
	if childCount > 0 {
		return "", fmt.Errorf("category %d is a parent category; choose an active source leaf", categoryID)
	}
	return path, nil
}
