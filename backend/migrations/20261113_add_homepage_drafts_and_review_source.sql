-- Visual homepage editor drafts and transcribed-review source. Only needed when
-- DB_AUTO_MIGRATE=false.
CREATE TABLE IF NOT EXISTS homepage_content_drafts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  section_key VARCHAR(255) NOT NULL,
  payload JSON NULL,
  created_at DATETIME(3) NULL,
  updated_at DATETIME(3) NULL,
  UNIQUE INDEX idx_homepage_draft_user_section (user_id, section_key)
);

ALTER TABLE product_reviews
  ADD COLUMN source VARCHAR(30) DEFAULT '',
  ADD COLUMN created_by_admin_id BIGINT UNSIGNED NULL,
  ADD INDEX idx_product_reviews_created_by_admin_id (created_by_admin_id);
