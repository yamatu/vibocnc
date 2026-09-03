CREATE TABLE IF NOT EXISTS product_image_cleanup_jobs (
    id VARCHAR(36) NOT NULL,
    status VARCHAR(32) NOT NULL,
    trusted_domains_json LONGTEXT,
    brand VARCHAR(100) NOT NULL DEFAULT '',
    category_id BIGINT UNSIGNED NOT NULL DEFAULT 0,
    include_descendants TINYINT(1) NOT NULL DEFAULT 0,
    product_status VARCHAR(16) NOT NULL DEFAULT 'all',
    batch_size BIGINT NOT NULL DEFAULT 250,
    max_product_id BIGINT UNSIGNED NOT NULL DEFAULT 0,
    last_product_id BIGINT UNSIGNED NOT NULL DEFAULT 0,
    worker_token VARCHAR(36) NOT NULL DEFAULT '',
    total BIGINT NOT NULL DEFAULT 0,
    processed BIGINT NOT NULL DEFAULT 0,
    updated_products BIGINT NOT NULL DEFAULT 0,
    skipped_products BIGINT NOT NULL DEFAULT 0,
    removed_images BIGINT NOT NULL DEFAULT 0,
    failed BIGINT NOT NULL DEFAULT 0,
    message VARCHAR(255) NOT NULL DEFAULT '',
    error LONGTEXT,
    created_by_id BIGINT UNSIGNED NOT NULL DEFAULT 0,
    created_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    started_at DATETIME(3) NULL,
    completed_at DATETIME(3) NULL,
    PRIMARY KEY (id),
    KEY idx_product_image_cleanup_jobs_status (status),
    KEY idx_product_image_cleanup_jobs_brand (brand),
    KEY idx_product_image_cleanup_jobs_category_id (category_id),
    KEY idx_product_image_cleanup_jobs_worker_token (worker_token),
    KEY idx_product_image_cleanup_jobs_created_by_id (created_by_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS product_image_policy_settings (
    id BIGINT UNSIGNED NOT NULL,
    trusted_domains_json LONGTEXT,
    created_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS product_image_trusted_urls (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    product_id BIGINT UNSIGNED NOT NULL,
    url_hash CHAR(64) NOT NULL,
    url LONGTEXT NOT NULL,
    source VARCHAR(32) NOT NULL DEFAULT 'admin_external',
    created_by_id BIGINT UNSIGNED NOT NULL DEFAULT 0,
    created_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY idx_product_image_trusted_url (product_id, url_hash),
    KEY idx_product_image_trusted_urls_product_id (product_id),
    KEY idx_product_image_trusted_urls_created_by_id (created_by_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS product_image_archive_jobs (
    id VARCHAR(36) NOT NULL,
    status VARCHAR(32) NOT NULL,
    file_name VARCHAR(255) NOT NULL DEFAULT '',
    file_size BIGINT NOT NULL DEFAULT 0,
    fingerprint CHAR(64) NOT NULL DEFAULT '',
    uploaded_bytes BIGINT NOT NULL DEFAULT 0,
    temp_path VARCHAR(1024) NOT NULL DEFAULT '',
    chunk_size BIGINT NOT NULL DEFAULT 0,
    worker_token VARCHAR(36) NOT NULL DEFAULT '',
    total_folders BIGINT NOT NULL DEFAULT 0,
    processed_folders BIGINT NOT NULL DEFAULT 0,
    last_folder_index BIGINT NOT NULL DEFAULT 0,
    matched_products BIGINT NOT NULL DEFAULT 0,
    updated_products BIGINT NOT NULL DEFAULT 0,
    imported_images BIGINT NOT NULL DEFAULT 0,
    duplicate_images BIGINT NOT NULL DEFAULT 0,
    skipped_folders BIGINT NOT NULL DEFAULT 0,
    failed_folders BIGINT NOT NULL DEFAULT 0,
    message VARCHAR(255) NOT NULL DEFAULT '',
    error LONGTEXT,
    created_by_id BIGINT UNSIGNED NOT NULL DEFAULT 0,
    created_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    started_at DATETIME(3) NULL,
    completed_at DATETIME(3) NULL,
    PRIMARY KEY (id),
    KEY idx_product_image_archive_jobs_status (status),
    KEY idx_product_image_archive_jobs_worker_token (worker_token),
    KEY idx_product_image_archive_jobs_created_by_id (created_by_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Additive compatibility for an archive table created by an earlier revision
-- of this migration before upload fingerprints were introduced.
SET @schema_name = DATABASE();
SET @column_exists = (
    SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = @schema_name AND table_name = 'product_image_archive_jobs' AND column_name = 'fingerprint'
);
SET @ddl = IF(
    @column_exists = 0,
    'ALTER TABLE product_image_archive_jobs ADD COLUMN fingerprint CHAR(64) NOT NULL DEFAULT '' AFTER file_size',
    'SELECT 1'
);
PREPARE migration_statement FROM @ddl;
EXECUTE migration_statement;
DEALLOCATE PREPARE migration_statement;
