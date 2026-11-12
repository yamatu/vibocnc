-- Verified-buyer product reviews with moderation, plus Cloudflare Turnstile
-- settings. Only needed when DB_AUTO_MIGRATE=false.
ALTER TABLE product_reviews
  ADD COLUMN customer_id BIGINT UNSIGNED NULL,
  ADD COLUMN order_id BIGINT UNSIGNED NULL,
  ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT 'pending',
  ADD COLUMN ip_address VARCHAR(64) NULL,
  ADD COLUMN approved_at DATETIME(3) NULL,
  ADD UNIQUE INDEX idx_product_reviews_customer_product (customer_id, product_id),
  ADD INDEX idx_product_reviews_order_id (order_id),
  ADD INDEX idx_product_reviews_status (status),
  ADD INDEX idx_product_reviews_is_approved (is_approved);

UPDATE product_reviews SET status = 'approved' WHERE is_approved = 1;

CREATE TABLE IF NOT EXISTS turnstile_settings (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  enabled TINYINT(1) DEFAULT 0,
  site_key VARCHAR(255) DEFAULT '',
  secret_key_enc TEXT NULL,
  created_at DATETIME(3) NULL,
  updated_at DATETIME(3) NULL
);
