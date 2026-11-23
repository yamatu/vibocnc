package services

import (
	"sync"
	"time"

	"fanuc-backend/models"

	"gorm.io/gorm"
)

const categoryDescendantsCacheTTL = 60 * time.Second

type categoryDescendantsSnapshot struct {
	children  map[uint][]uint
	fetchedAt time.Time
}

var (
	categoryDescMu       sync.RWMutex
	categoryDescSnapshot *categoryDescendantsSnapshot
)

// InvalidateCategoryDescendantsCache clears the in-memory parent->children map
// so category hierarchy edits take effect immediately.
func InvalidateCategoryDescendantsCache() {
	categoryDescMu.Lock()
	categoryDescSnapshot = nil
	categoryDescMu.Unlock()
}

// GetDescendantCategoryIDsCached returns rootID and all descendant category IDs
// using a short-lived in-memory snapshot instead of scanning the entire
// categories table on every product listing query.
func GetDescendantCategoryIDsCached(db *gorm.DB, rootID uint) ([]uint, error) {
	if db == nil {
		return []uint{rootID}, nil
	}

	now := time.Now()
	categoryDescMu.RLock()
	snap := categoryDescSnapshot
	categoryDescMu.RUnlock()

	if snap == nil || now.Sub(snap.fetchedAt) > categoryDescendantsCacheTTL {
		type row struct {
			ID       uint  `gorm:"column:id"`
			ParentID *uint `gorm:"column:parent_id"`
		}
		var rows []row
		if err := db.Model(&models.Category{}).Select("id,parent_id").Find(&rows).Error; err != nil {
			return nil, err
		}
		children := make(map[uint][]uint, len(rows)/2+1)
		for _, r := range rows {
			if r.ParentID == nil {
				continue
			}
			children[*r.ParentID] = append(children[*r.ParentID], r.ID)
		}
		snap = &categoryDescendantsSnapshot{
			children:  children,
			fetchedAt: time.Now(),
		}
		categoryDescMu.Lock()
		categoryDescSnapshot = snap
		categoryDescMu.Unlock()
	}

	visited := make(map[uint]bool, 8)
	out := make([]uint, 0, 8)
	var walk func(id uint)
	walk = func(id uint) {
		if visited[id] {
			return
		}
		visited[id] = true
		out = append(out, id)
		for _, child := range snap.children[id] {
			walk(child)
		}
	}
	walk(rootID)
	return out, nil
}
