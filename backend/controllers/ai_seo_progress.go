package controllers

import (
	"fanuc-backend/models"
	"fmt"
	"gorm.io/gorm"
	"strings"
)

// Only IDs/SKUs are queued. Product bodies are read by a worker, never as one catalogue-sized allocation.
func streamAISEOItems(db *gorm.DB, jobID, token string, work chan<- models.AIAgentSEOJobItem) error {
	var after uint
	for isAISEOJobRunning(db, jobID, token) {
		var batch []models.AIAgentSEOJobItem
		if err := db.Where("job_id = ? AND status = ? AND id > ?", jobID, "queued", after).Order("id ASC").Limit(200).Find(&batch).Error; err != nil {
			return err
		}
		if len(batch) == 0 {
			return nil
		}
		for _, item := range batch {
			if !isAISEOJobRunning(db, jobID, token) {
				return nil
			}
			work <- item
			after = item.ID
		}
	}
	return nil
}

func setAISEOItemProgress(db *gorm.DB, id uint, detail string) {
	db.Model(&models.AIAgentSEOJobItem{}).Where("id = ? AND status = ?", id, "running").Update("error", detail)
}

func aiSEOChangeSummary(p models.Product, updates map[string]interface{}) []string {
	result := []string{"AI 校验完成 / AI validation completed"}
	fields := []struct{ key, old string }{{"name", p.Name}, {"short_description", p.ShortDescription}, {"description", p.Description}, {"meta_title", p.MetaTitle}, {"meta_description", p.MetaDescription}, {"meta_keywords", p.MetaKeywords}}
	for _, f := range fields {
		if value, ok := updates[f.key]; ok && fmt.Sprint(value) != f.old {
			result = append(result, f.key+": "+truncateRunes(strings.TrimSpace(f.old), 80)+" → "+truncateRunes(fmt.Sprint(value), 160))
		}
	}
	if value, ok := updates["category_id"]; ok {
		result = append(result, fmt.Sprintf("category_id: %d → %v", p.CategoryID, value))
	}
	if len(result) == 1 {
		result = append(result, "未改动已有内容 / Existing content retained")
	}
	return result
}

func itemIDForProduct(db *gorm.DB, job string, productID uint) uint {
	var item models.AIAgentSEOJobItem
	db.Select("id").Where("job_id = ? AND product_id = ?", job, productID).First(&item)
	return item.ID
}

type aiSEOProductRef struct {
	ID  uint
	SKU string
}
