package services

import (
	"errors"
	"strings"
	"unicode"

	"fanuc-backend/models"
	"fanuc-backend/utils"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const maxCategoryPathDepth = 4

// CategoryPathResolution describes how a Brand > Product line > Product type
// path maps onto the category tree.
type CategoryPathResolution struct {
	CategoryID uint     `json:"category_id"`
	Path       []string `json:"path"`
	Existing   []string `json:"existing"`
	Missing    []string `json:"missing"`
	Created    bool     `json:"created"`
}

// CategoryNameKey compares category names loosely: case, punctuation, "&" vs
// "and" and a trailing plural "s" are ignored.
func CategoryNameKey(name string) string {
	name = strings.ToLower(strings.ReplaceAll(name, "&", " and "))
	var builder strings.Builder
	for _, r := range name {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			builder.WriteRune(r)
		}
	}
	key := builder.String()
	if len(key) > 3 && strings.HasSuffix(key, "s") && !strings.HasSuffix(key, "ss") {
		key = strings.TrimSuffix(key, "s")
	}
	return key
}

// SanitizeCategoryPath trims names, drops empty or repeated levels and caps the depth.
func SanitizeCategoryPath(names []string) []string {
	path := make([]string, 0, len(names))
	lastKey := ""
	for _, name := range names {
		name = truncateListingText(strings.Join(strings.Fields(name), " "), 100)
		key := CategoryNameKey(name)
		if key == "" || key == lastKey {
			continue
		}
		path = append(path, name)
		lastKey = key
		if len(path) == maxCategoryPathDepth {
			break
		}
	}
	return path
}

func matchCategoryChild(categories []models.Category, parentID *uint, name string, root bool) (models.Category, bool) {
	key := CategoryNameKey(name)
	slug := utils.GenerateSlug(name)
	brandKey := NormalizeBrandKey(name)
	var fallback *models.Category
	for index := range categories {
		category := categories[index]
		sameParent := (parentID == nil && (category.ParentID == nil || *category.ParentID == 0)) ||
			(parentID != nil && category.ParentID != nil && *category.ParentID == *parentID)
		if !sameParent {
			continue
		}
		if CategoryNameKey(category.Name) == key || (slug != "" && category.Slug == slug) {
			if category.IsActive {
				return category, true
			}
			if fallback == nil {
				fallback = &categories[index]
			}
			continue
		}
		if root && brandKey != "" && NormalizeBrandKey(category.Name) == brandKey && fallback == nil {
			fallback = &categories[index]
		}
	}
	if fallback != nil {
		return *fallback, true
	}
	return models.Category{}, false
}

func walkCategoryPath(categories []models.Category, path []string) (CategoryPathResolution, []models.Category) {
	result := CategoryPathResolution{Path: make([]string, 0, len(path)), Existing: []string{}, Missing: []string{}}
	matched := make([]models.Category, 0, len(path))
	var parentID *uint
	for index, name := range path {
		category, ok := matchCategoryChild(categories, parentID, name, index == 0)
		if !ok {
			result.Missing = append(result.Missing, path[index:]...)
			result.Path = append(result.Path, path[index:]...)
			return result, matched
		}
		matched = append(matched, category)
		result.Existing = append(result.Existing, category.Name)
		result.Path = append(result.Path, category.Name)
		id := category.ID
		parentID = &id
		result.CategoryID = category.ID
	}
	return result, matched
}

// PlanCategoryPath reports which levels of the path already exist without writing.
func PlanCategoryPath(db *gorm.DB, names []string) (CategoryPathResolution, error) {
	path := SanitizeCategoryPath(names)
	if len(path) == 0 {
		return CategoryPathResolution{Path: []string{}, Existing: []string{}, Missing: []string{}}, errors.New("category path is empty")
	}
	var categories []models.Category
	if err := db.Select("id", "name", "slug", "parent_id", "is_active").Find(&categories).Error; err != nil {
		return CategoryPathResolution{}, err
	}
	result, _ := walkCategoryPath(categories, path)
	if len(result.Missing) > 0 {
		result.CategoryID = 0
	}
	return result, nil
}

// ResolveOrCreateCategoryPath reuses every existing level of the path and
// creates the missing tail under the deepest match. Inactive matches are
// reactivated so the product becomes reachable.
func ResolveOrCreateCategoryPath(db *gorm.DB, names []string) (CategoryPathResolution, error) {
	path := SanitizeCategoryPath(names)
	if len(path) == 0 {
		return CategoryPathResolution{}, errors.New("category path is empty")
	}
	var result CategoryPathResolution
	err := withCategoryCreationLock(func() error {
		return db.Transaction(func(tx *gorm.DB) error {
			var categories []models.Category
			if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Select("id", "name", "slug", "parent_id", "is_active").Order("id ASC").Find(&categories).Error; err != nil {
				return err
			}
			resolution, matched := walkCategoryPath(categories, path)
			for _, category := range matched {
				if !category.IsActive {
					if err := tx.Model(&models.Category{}).Where("id = ?", category.ID).Update("is_active", true).Error; err != nil {
						return err
					}
				}
			}
			var parentID *uint
			if len(matched) > 0 {
				id := matched[len(matched)-1].ID
				parentID = &id
			}
			for index, name := range resolution.Missing {
				level := len(matched) + index
				slug, err := uniqueCategorySlug(tx, utils.GenerateSlug(strings.Join(resolution.Path[:level+1], " ")))
				if err != nil {
					return err
				}
				category := models.Category{
					Name:        name,
					Slug:        slug,
					Description: strings.Join(resolution.Path[:level+1], " "),
					ParentID:    parentID,
					IsActive:    true,
				}
				if err := tx.Create(&category).Error; err != nil {
					return err
				}
				id := category.ID
				parentID = &id
				resolution.CategoryID = category.ID
				resolution.Created = true
			}
			result = resolution
			return nil
		})
	})
	if err != nil {
		return CategoryPathResolution{}, err
	}
	if result.CategoryID == 0 {
		return CategoryPathResolution{}, errors.New("category path did not resolve to a category")
	}
	return result, nil
}

// CategoryPathNames returns the root-to-node names of a category.
func CategoryPathNames(db *gorm.DB, categoryID uint) []string {
	names := make([]string, 0, 4)
	visited := map[uint]bool{}
	for categoryID != 0 && !visited[categoryID] && len(names) < 8 {
		visited[categoryID] = true
		var category models.Category
		if err := db.Select("id", "name", "parent_id").First(&category, categoryID).Error; err != nil {
			break
		}
		names = append([]string{category.Name}, names...)
		if category.ParentID == nil {
			break
		}
		categoryID = *category.ParentID
	}
	return names
}
