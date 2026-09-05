package config

import (
	"errors"
	"fmt"
	"strings"

	"fanuc-backend/models"

	"gorm.io/gorm"
)

// aiAgentSchemaColumn describes the additive columns introduced with named AI
// profiles. Keeping this list explicit lets startup repair a partially applied
// AutoMigrate without changing unrelated tables or existing column types.
type aiAgentSchemaColumn struct {
	model  any
	field  string
	column string
	table  string
}

func requiredAIAgentSchemaColumns() []aiAgentSchemaColumn {
	return []aiAgentSchemaColumn{
		{model: &models.AIAgentProfile{}, field: "APIMode", column: "api_mode", table: "ai_agent_profiles"},
		{model: &models.AIAgentSetting{}, field: "ActiveProfileID", column: "active_profile_id", table: "ai_agent_settings"},
		{model: &models.AIAgentSetting{}, field: "APIMode", column: "api_mode", table: "ai_agent_settings"},
		{model: &models.AIAgentSEOJob{}, field: "AIProfileID", column: "ai_profile_id", table: "ai_agent_seo_jobs"},
		{model: &models.AIAgentSEOJob{}, field: "AIProfileName", column: "ai_profile_name", table: "ai_agent_seo_jobs"},
		{model: &models.AIAgentSEOJob{}, field: "AIModel", column: "ai_model", table: "ai_agent_seo_jobs"},
		{model: &models.AIAgentSEOJob{}, field: "AIAPIMode", column: "ai_api_mode", table: "ai_agent_seo_jobs"},
	}
}

func requiredAIAgentSchemaModels() []any {
	return []any{
		&models.AIAgentProfile{},
		&models.AIAgentSetting{},
		&models.AIAgentSEOJob{},
	}
}

// migrateAIAgentProfileSchema is intentionally additive. It runs only when
// DB_AUTO_MIGRATE is enabled and repairs the exact profile fields needed by the
// controllers before the broader per-model AutoMigrate loop runs.
func migrateAIAgentProfileSchema(db *gorm.DB) error {
	if db == nil {
		return errors.New("database is nil")
	}
	migrator := db.Migrator()
	if err := repairLegacyAIAgentSEOJobColumns(db); err != nil {
		return err
	}
	for _, model := range requiredAIAgentSchemaModels() {
		if migrator.HasTable(model) {
			continue
		}
		if err := migrator.CreateTable(model); err != nil {
			return fmt.Errorf("create required AI table for %T: %w", model, err)
		}
	}
	for _, requirement := range requiredAIAgentSchemaColumns() {
		if migrator.HasColumn(requirement.model, requirement.field) {
			continue
		}
		if err := migrator.AddColumn(requirement.model, requirement.field); err != nil {
			return fmt.Errorf("add required AI column %s.%s: %w", requirement.table, requirement.column, err)
		}
	}
	if missing := missingAIAgentProfileSchema(db); len(missing) > 0 {
		return fmt.Errorf("required AI profile schema is still incomplete: %s", strings.Join(missing, ", "))
	}
	return nil
}

// repairLegacyAIAgentSEOJobColumns fixes a migration typo from an older image
// that created a_iprofile_* instead of ai_profile_*. Keep this repair additive
// and data-preserving so existing queued/completed jobs remain readable.
func repairLegacyAIAgentSEOJobColumns(db *gorm.DB) error {
	const table = "ai_agent_seo_jobs"
	for _, pair := range [][2]string{{"a_iprofile_id", "ai_profile_id"}, {"a_iprofile_name", "ai_profile_name"}} {
		var legacy, current int
		if err := db.Raw("SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?", table, pair[0]).Scan(&legacy).Error; err != nil {
			return fmt.Errorf("check legacy AI SEO column %s: %w", pair[0], err)
		}
		if err := db.Raw("SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?", table, pair[1]).Scan(&current).Error; err != nil {
			return fmt.Errorf("check AI SEO column %s: %w", pair[1], err)
		}
		if legacy == 0 || current > 0 {
			continue
		}
		if err := db.Exec("ALTER TABLE `ai_agent_seo_jobs` RENAME COLUMN `" + pair[0] + "` TO `" + pair[1] + "`").Error; err != nil {
			return fmt.Errorf("repair legacy AI SEO column %s: %w", pair[0], err)
		}
	}
	return nil
}

func missingAIAgentProfileSchema(db *gorm.DB) []string {
	if db == nil {
		return []string{"database connection"}
	}
	migrator := db.Migrator()
	missing := make([]string, 0)
	for _, model := range requiredAIAgentSchemaModels() {
		if migrator.HasTable(model) {
			continue
		}
		statement := &gorm.Statement{DB: db}
		if err := statement.Parse(model); err == nil && statement.Schema != nil {
			missing = append(missing, statement.Schema.Table)
		} else {
			missing = append(missing, fmt.Sprintf("table for %T", model))
		}
	}
	for _, requirement := range requiredAIAgentSchemaColumns() {
		if migrator.HasTable(requirement.model) && !migrator.HasColumn(requirement.model, requirement.field) {
			missing = append(missing, requirement.table+"."+requirement.column)
		}
	}
	return missing
}
