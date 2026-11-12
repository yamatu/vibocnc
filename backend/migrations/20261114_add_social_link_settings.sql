-- Public social profile links (footer / Organization sameAs). The model was
-- never part of AutoMigrate, so /public/social-links failed on every install.

CREATE TABLE IF NOT EXISTS social_link_settings (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  show_in_footer TINYINT(1) DEFAULT 1,
  x_url VARCHAR(500) DEFAULT '',
  facebook_url VARCHAR(500) DEFAULT '',
  instagram_url VARCHAR(500) DEFAULT '',
  linked_in_url VARCHAR(500) DEFAULT '',
  created_at DATETIME(3) NULL,
  updated_at DATETIME(3) NULL,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
