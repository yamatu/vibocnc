-- Verified-buyer product reviews with moderation, plus Cloudflare Turnstile
-- settings. Idempotent: safe on databases where some of it already exists.

CREATE TABLE IF NOT EXISTS product_reviews (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  product_id BIGINT UNSIGNED NOT NULL,
  customer_name VARCHAR(100) NOT NULL,
  customer_email VARCHAR(255) NULL,
  rating BIGINT NOT NULL,
  review_title VARCHAR(255) NULL,
  review_content TEXT NULL,
  is_verified TINYINT(1) DEFAULT 0,
  is_approved TINYINT(1) DEFAULT 0,
  helpful_count BIGINT DEFAULT 0,
  created_at DATETIME(3) NULL,
  updated_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  KEY idx_product_reviews_product_id (product_id),
  CONSTRAINT chk_product_reviews_rating CHECK (rating >= 1 AND rating <= 5)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @ddl = (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE product_reviews ADD COLUMN customer_id BIGINT UNSIGNED NULL', 'DO 0')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'product_reviews' AND COLUMN_NAME = 'customer_id');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @ddl = (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE product_reviews ADD COLUMN order_id BIGINT UNSIGNED NULL', 'DO 0')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'product_reviews' AND COLUMN_NAME = 'order_id');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @ddl = (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE product_reviews ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT ''pending''', 'DO 0')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'product_reviews' AND COLUMN_NAME = 'status');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @ddl = (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE product_reviews ADD COLUMN ip_address VARCHAR(64) NULL', 'DO 0')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'product_reviews' AND COLUMN_NAME = 'ip_address');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @ddl = (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE product_reviews ADD COLUMN approved_at DATETIME(3) NULL', 'DO 0')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'product_reviews' AND COLUMN_NAME = 'approved_at');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @ddl = (SELECT IF(COUNT(*) = 0,
  'CREATE UNIQUE INDEX idx_product_reviews_customer_product ON product_reviews (customer_id, product_id)', 'DO 0')
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'product_reviews' AND INDEX_NAME = 'idx_product_reviews_customer_product');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @ddl = (SELECT IF(COUNT(*) = 0,
  'CREATE INDEX idx_product_reviews_order_id ON product_reviews (order_id)', 'DO 0')
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'product_reviews' AND INDEX_NAME = 'idx_product_reviews_order_id');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @ddl = (SELECT IF(COUNT(*) = 0,
  'CREATE INDEX idx_product_reviews_status ON product_reviews (status)', 'DO 0')
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'product_reviews' AND INDEX_NAME = 'idx_product_reviews_status');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @ddl = (SELECT IF(COUNT(*) = 0,
  'CREATE INDEX idx_product_reviews_is_approved ON product_reviews (is_approved)', 'DO 0')
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'product_reviews' AND INDEX_NAME = 'idx_product_reviews_is_approved');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Reviews approved before moderation states existed keep their public status.
UPDATE product_reviews SET status = 'approved' WHERE is_approved = 1 AND status <> 'approved';

CREATE TABLE IF NOT EXISTS turnstile_settings (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  enabled TINYINT(1) DEFAULT 0,
  site_key VARCHAR(255) DEFAULT '',
  secret_key_enc TEXT NULL,
  created_at DATETIME(3) NULL,
  updated_at DATETIME(3) NULL,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
