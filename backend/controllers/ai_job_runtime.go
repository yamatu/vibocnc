package controllers

import (
	"sync"
	"time"

	"fanuc-backend/models"

	"gorm.io/gorm"
)

// Large catalogues produce jobs with 100k+ items. Statements that list every
// item id exceed MySQL's 65,535 placeholder limit, so bulk item work is done in
// bounded id batches.
const aiJobItemBatchSize = 2000

const aiJobConfigRefreshInterval = 15 * time.Second

// aiJobConfigSource lets a long job pick up a model or profile switch from the
// next product on, instead of keeping the configuration it started with.
type aiJobConfigSource struct {
	jobID    string
	mu       sync.Mutex
	setting  *models.AIAgentSetting
	apiKey   string
	loadedAt time.Time
}

func newAIJobConfigSource(jobID string, setting *models.AIAgentSetting, apiKey string) *aiJobConfigSource {
	return &aiJobConfigSource{jobID: jobID, setting: setting, apiKey: apiKey, loadedAt: time.Now()}
}

func (source *aiJobConfigSource) current(db *gorm.DB) (*models.AIAgentSetting, string) {
	source.mu.Lock()
	defer source.mu.Unlock()
	if time.Since(source.loadedAt) < aiJobConfigRefreshInterval {
		return source.setting, source.apiKey
	}
	source.loadedAt = time.Now()
	setting, profile, apiKey, err := loadAIAgentConfigWithProfile()
	if err != nil || setting == nil || !setting.Enabled || apiKey == "" {
		return source.setting, source.apiKey
	}
	changed := source.setting == nil || source.setting.Model != setting.Model || source.setting.BaseURL != setting.BaseURL ||
		source.setting.APIMode != setting.APIMode || source.apiKey != apiKey
	source.setting, source.apiKey = setting, apiKey
	if changed && db != nil {
		updates := map[string]any{"ai_model": setting.Model, "ai_api_mode": setting.APIMode, "ai_profile_id": setting.ActiveProfileID}
		if profile != nil {
			updates["ai_profile_name"] = profile.Name
		}
		db.Model(&models.AIAgentSEOJob{}).Where("id = ?", source.jobID).Updates(updates)
	}
	return source.setting, source.apiKey
}

// releaseEndedJobItems cancels every unfinished item of an ended job in
// batches and clears the "running" marker of products the job still held.
func releaseEndedJobItems(db *gorm.DB, jobID string) (int64, error) {
	var released int64
	for {
		var ids []uint
		if err := db.Model(&models.AIAgentSEOJobItem{}).
			Where("job_id = ? AND status IN ?", jobID, []string{"queued", "running"}).
			Order("id ASC").Limit(aiJobItemBatchSize).Pluck("id", &ids).Error; err != nil {
			return released, err
		}
		if len(ids) == 0 {
			break
		}
		result := db.Model(&models.AIAgentSEOJobItem{}).
			Where("id IN ? AND status IN ?", ids, []string{"queued", "running"}).
			Updates(map[string]any{"status": "cancelled", "error": "任务已被管理员结束 / Task ended by administrator"})
		if result.Error != nil {
			return released, result.Error
		}
		released += result.RowsAffected
	}
	err := db.Model(&models.Product{}).
		Where("ai_seo_optimization_job_id = ? AND ai_seo_status = ?", jobID, "running").
		Updates(map[string]any{"ai_seo_status": "", "ai_seo_optimization_job_id": ""}).Error
	return released, err
}

// forEachJobProductBatch walks the product ids of a job's items with the given
// status without loading them all at once.
func forEachJobProductBatch(db *gorm.DB, jobID, status string, fn func([]uint)) error {
	afterID := uint(0)
	for {
		var rows []models.AIAgentSEOJobItem
		if err := db.Select("id", "product_id").
			Where("job_id = ? AND status = ? AND id > ?", jobID, status, afterID).
			Order("id ASC").Limit(aiJobItemBatchSize).Find(&rows).Error; err != nil {
			return err
		}
		if len(rows) == 0 {
			return nil
		}
		ids := make([]uint, 0, len(rows))
		for _, row := range rows {
			ids = append(ids, row.ProductID)
		}
		afterID = rows[len(rows)-1].ID
		fn(ids)
	}
}
