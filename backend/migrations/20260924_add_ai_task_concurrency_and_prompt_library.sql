-- Global AI task concurrency, a larger assistant context window and the prompt
-- library. Additive only: existing rows keep their current values and the new
-- columns fall back to safe defaults.
--
-- AutoMigrate creates the same structures at startup (DB_AUTO_MIGRATE=true, the
-- default). This file exists for installations that run with
-- DB_AUTO_MIGRATE=false, and is written for MySQL 8, which has no
-- "ADD COLUMN IF NOT EXISTS", so the columns are guarded through
-- INFORMATION_SCHEMA below.

DELIMITER $$
DROP PROCEDURE IF EXISTS vibocnc_add_ai_task_columns$$
CREATE PROCEDURE vibocnc_add_ai_task_columns()
BEGIN
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ai_agent_settings'
                   AND COLUMN_NAME = 'max_concurrent_jobs') THEN
    ALTER TABLE ai_agent_settings
      ADD COLUMN max_concurrent_jobs INT NOT NULL DEFAULT 4;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ai_agent_settings'
                   AND COLUMN_NAME = 'agent_history_limit') THEN
    ALTER TABLE ai_agent_settings
      ADD COLUMN agent_history_limit INT NOT NULL DEFAULT 24;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ai_agent_settings'
                   AND COLUMN_NAME = 'auto_publish_new_products') THEN
    ALTER TABLE ai_agent_settings
      ADD COLUMN auto_publish_new_products TINYINT(1) NOT NULL DEFAULT 1;
  END IF;
END$$
DELIMITER ;

CALL vibocnc_add_ai_task_columns();
DROP PROCEDURE vibocnc_add_ai_task_columns;

CREATE TABLE IF NOT EXISTS ai_agent_prompt_presets (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(120) NOT NULL,
  content TEXT NOT NULL,
  tags VARCHAR(200) NULL,
  sort_order INT NOT NULL DEFAULT 0,
  is_favorite TINYINT(1) NOT NULL DEFAULT 0,
  usage_count INT NOT NULL DEFAULT 0,
  created_at DATETIME(3) NULL,
  updated_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  KEY idx_ai_prompt_presets_order (is_favorite, sort_order, usage_count)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
