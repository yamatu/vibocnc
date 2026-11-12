-- Visual homepage editor drafts and transcribed-review source.
-- Idempotent: safe on databases where some of it already exists.

CREATE TABLE IF NOT EXISTS homepage_content_drafts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  section_key VARCHAR(255) NOT NULL,
  payload JSON NULL,
  created_at DATETIME(3) NULL,
  updated_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY idx_homepage_draft_user_section (user_id, section_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @ddl = (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE product_reviews ADD COLUMN source VARCHAR(30) DEFAULT ''''', 'DO 0')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'product_reviews' AND COLUMN_NAME = 'source');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @ddl = (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE product_reviews ADD COLUMN created_by_admin_id BIGINT UNSIGNED NULL', 'DO 0')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'product_reviews' AND COLUMN_NAME = 'created_by_admin_id');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @ddl = (SELECT IF(COUNT(*) = 0,
  'CREATE INDEX idx_product_reviews_created_by_admin_id ON product_reviews (created_by_admin_id)', 'DO 0')
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'product_reviews' AND INDEX_NAME = 'idx_product_reviews_created_by_admin_id');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
