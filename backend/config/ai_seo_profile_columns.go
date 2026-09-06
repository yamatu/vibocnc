package config

import (
	"gorm.io/gorm"
)

// Preserve pinned profile identities from GORM's historical acronym spelling.
func repairAISEOProfileColumnNames(db *gorm.DB) error {
	for _, pair := range [][2]string{{"a_iprofile_id", "ai_profile_id"}, {"a_iprofile_name", "ai_profile_name"}} {
		var old, current int64
		query := "SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='ai_agent_seo_jobs' AND column_name=?"
		if err := db.Raw(query, pair[0]).Scan(&old).Error; err != nil {
			return err
		}
		if err := db.Raw(query, pair[1]).Scan(&current).Error; err != nil {
			return err
		}
		if old == 0 {
			continue
		}
		if current == 0 {
			if err := db.Exec("ALTER TABLE ai_agent_seo_jobs RENAME COLUMN `" + pair[0] + "` TO `" + pair[1] + "`").Error; err != nil {
				return err
			}
		} else {
			if err := db.Exec("UPDATE ai_agent_seo_jobs SET `" + pair[1] + "` = `" + pair[0] + "` WHERE `" + pair[1] + "` IS NULL AND `" + pair[0] + "` IS NOT NULL").Error; err != nil {
				return err
			}
		}
	}
	return nil
}
