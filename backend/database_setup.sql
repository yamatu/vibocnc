-- =====================================================
-- FANUC 后端项目数据库创建脚本
-- 数据库类型: MySQL 8.0+
-- 字符集: utf8mb4
-- 排序规则: utf8mb4_unicode_ci
-- =====================================================

-- 创建数据库
CREATE DATABASE IF NOT EXISTS fanuc_sales
CHARACTER SET utf8mb4
COLLATE utf8mb4_unicode_ci;

USE fanuc_sales;

-- =====================================================
-- 1. 管理员用户表
-- =====================================================
CREATE TABLE IF NOT EXISTS admin_users (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(50) NOT NULL UNIQUE,
    email VARCHAR(100) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(100) NOT NULL,
    role ENUM('admin', 'editor', 'viewer') DEFAULT 'editor',
    is_active BOOLEAN DEFAULT TRUE,
    last_login TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_username (username),
    INDEX idx_email (email),
    INDEX idx_role (role),
    INDEX idx_is_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- 2. 语言表
-- =====================================================
CREATE TABLE IF NOT EXISTS languages (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    code VARCHAR(5) NOT NULL UNIQUE,
    name VARCHAR(50) NOT NULL,
    native_name VARCHAR(50) NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    is_default BOOLEAN DEFAULT FALSE,
    sort_order INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    INDEX idx_code (code),
    INDEX idx_is_active (is_active),
    INDEX idx_is_default (is_default)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- 3. 产品分类表
-- =====================================================
CREATE TABLE IF NOT EXISTS categories (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    slug VARCHAR(100) NOT NULL UNIQUE,
    description TEXT,
    image_url TEXT,
    parent_id BIGINT UNSIGNED NULL,
    sort_order INT DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_slug (slug),
    INDEX idx_parent_id (parent_id),
    INDEX idx_sort_order (sort_order),
    INDEX idx_is_active (is_active),

    FOREIGN KEY (parent_id) REFERENCES categories(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- 4. 分类翻译表
-- =====================================================
CREATE TABLE IF NOT EXISTS category_translations (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    category_id BIGINT UNSIGNED NOT NULL,
    language_code VARCHAR(5) NOT NULL,
    name VARCHAR(100) NOT NULL,
    slug VARCHAR(100) NOT NULL,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_category_id (category_id),
    INDEX idx_language_code (language_code),
    UNIQUE KEY unique_category_language (category_id, language_code),

    FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- 5. 产品表
-- =====================================================
CREATE TABLE IF NOT EXISTS products (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    sku VARCHAR(100) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(255) NOT NULL UNIQUE,
    short_description TEXT,
    description LONGTEXT,
    price DECIMAL(10,2) DEFAULT 0.00,
    compare_price DECIMAL(10,2) NULL,
    cost_price DECIMAL(10,2) NULL,
    stock_quantity INT DEFAULT 0,
    min_stock_level INT DEFAULT 0,
    weight DECIMAL(8,2) NULL,
    dimensions VARCHAR(100),
    brand VARCHAR(100) DEFAULT 'FANUC',
    model VARCHAR(100),
    part_number VARCHAR(100),
    category_id BIGINT UNSIGNED NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    is_featured BOOLEAN DEFAULT FALSE,
    meta_title VARCHAR(255),
    meta_description TEXT,
    meta_keywords TEXT,
    image_urls JSON,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_sku (sku),
    INDEX idx_slug (slug),
    INDEX idx_brand (brand),
    INDEX idx_category_id (category_id),
    INDEX idx_is_active (is_active),
    INDEX idx_is_featured (is_featured),
    INDEX idx_stock_quantity (stock_quantity),

    FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- 6. 产品图片表
-- =====================================================
CREATE TABLE IF NOT EXISTS product_images (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    product_id BIGINT UNSIGNED NOT NULL,
    url TEXT NOT NULL,
    filename VARCHAR(255) DEFAULT '',
    original_name VARCHAR(255) DEFAULT '',
    alt_text VARCHAR(255),
    sort_order INT DEFAULT 0,
    is_primary BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_product_id (product_id),
    INDEX idx_is_primary (is_primary),
    INDEX idx_sort_order (sort_order),

    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- 7. 产品属性表
-- =====================================================
CREATE TABLE IF NOT EXISTS product_attributes (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    product_id BIGINT UNSIGNED NOT NULL,
    attribute_name VARCHAR(100) NOT NULL,
    attribute_value TEXT NOT NULL,
    sort_order INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    INDEX idx_product_id (product_id),
    INDEX idx_attribute_name (attribute_name),
    INDEX idx_sort_order (sort_order),

    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- 8. 产品翻译表
-- =====================================================
CREATE TABLE IF NOT EXISTS product_translations (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    product_id BIGINT UNSIGNED NOT NULL,
    language_code VARCHAR(5) NOT NULL,
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(255) NOT NULL,
    short_description TEXT,
    description LONGTEXT,
    meta_title VARCHAR(255),
    meta_description TEXT,
    meta_keywords TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_product_id (product_id),
    INDEX idx_language_code (language_code),
    UNIQUE KEY unique_product_language (product_id, language_code),

    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- 9. 购买链接表
-- =====================================================
CREATE TABLE IF NOT EXISTS purchase_links (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    product_id BIGINT UNSIGNED NOT NULL,
    platform VARCHAR(100) NOT NULL,
    url TEXT NOT NULL,
    price DECIMAL(10,2) NULL,
    currency VARCHAR(10) DEFAULT 'USD',
    is_active BOOLEAN DEFAULT TRUE,
    sort_order INT DEFAULT 0,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_product_id (product_id),
    INDEX idx_platform (platform),
    INDEX idx_is_active (is_active),

    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- 10. SEO重定向表
-- =====================================================
CREATE TABLE IF NOT EXISTS seo_redirects (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    old_url VARCHAR(500) NOT NULL,
    new_url VARCHAR(500) NOT NULL,
    redirect_type ENUM('301', '302') DEFAULT '301',
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    INDEX idx_old_url (old_url(255)),
    INDEX idx_is_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- 11. 订单表
-- =====================================================
CREATE TABLE IF NOT EXISTS orders (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    order_number VARCHAR(100) NOT NULL UNIQUE,
    user_id BIGINT UNSIGNED NULL,
    customer_email VARCHAR(255) NOT NULL,
    customer_name VARCHAR(255) NOT NULL,
    customer_phone VARCHAR(50),
    shipping_address TEXT,
    billing_address TEXT,
    status VARCHAR(50) DEFAULT 'pending',
    payment_status VARCHAR(50) DEFAULT 'pending',
    payment_method VARCHAR(50),
    payment_id VARCHAR(255),
    total_amount DECIMAL(10,2) NOT NULL,
    currency VARCHAR(10) DEFAULT 'USD',
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_order_number (order_number),
    INDEX idx_user_id (user_id),
    INDEX idx_customer_email (customer_email),
    INDEX idx_status (status),
    INDEX idx_payment_status (payment_status),
    INDEX idx_created_at (created_at),

    FOREIGN KEY (user_id) REFERENCES admin_users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- 12. 订单项目表
-- =====================================================
CREATE TABLE IF NOT EXISTS order_items (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    order_id BIGINT UNSIGNED NOT NULL,
    product_id BIGINT UNSIGNED NOT NULL,
    quantity INT NOT NULL,
    unit_price DECIMAL(10,2) NOT NULL,
    total_price DECIMAL(10,2) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_order_id (order_id),
    INDEX idx_product_id (product_id),

    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- 13. 支付交易表
-- =====================================================
CREATE TABLE IF NOT EXISTS payment_transactions (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    order_id BIGINT UNSIGNED NOT NULL,
    transaction_id VARCHAR(255) NOT NULL UNIQUE,
    payment_method VARCHAR(50) NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    currency VARCHAR(10) DEFAULT 'USD',
    status VARCHAR(50) NOT NULL,
    payer_id VARCHAR(255),
    payer_email VARCHAR(255),
    payment_data TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_order_id (order_id),
    INDEX idx_transaction_id (transaction_id),
    INDEX idx_status (status),
    INDEX idx_payment_method (payment_method),

    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- 14. 横幅广告表
-- =====================================================
CREATE TABLE IF NOT EXISTS banners (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    subtitle VARCHAR(500),
    description TEXT,
    image_url TEXT NOT NULL,
    link_url VARCHAR(500),
    link_text VARCHAR(100),
    position VARCHAR(50) DEFAULT 'home',
    content_type VARCHAR(50) DEFAULT 'hero',
    category_key VARCHAR(100),
    sort_order INT DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    start_date TIMESTAMP NULL,
    end_date TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_position (position),
    INDEX idx_content_type (content_type),
    INDEX idx_is_active (is_active),
    INDEX idx_sort_order (sort_order),
    INDEX idx_start_date (start_date),
    INDEX idx_end_date (end_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- 15. 首页内容表
-- =====================================================
CREATE TABLE IF NOT EXISTS homepage_contents (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    section_key VARCHAR(255) NOT NULL UNIQUE,
    title VARCHAR(255),
    subtitle VARCHAR(255),
    description TEXT,
    image_url VARCHAR(500),
    button_text VARCHAR(100),
    button_url VARCHAR(500),
    data JSON,
    sort_order INT DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_section_key (section_key),
    INDEX idx_is_active (is_active),
    INDEX idx_sort_order (sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- 16. 公司简介表
-- =====================================================
CREATE TABLE IF NOT EXISTS company_profiles (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    company_name VARCHAR(100) NOT NULL,
    company_subtitle VARCHAR(200),
    establishment_year VARCHAR(10),
    location VARCHAR(200),
    workshop_size VARCHAR(50),
    description_1 TEXT,
    description_2 TEXT,
    achievement VARCHAR(200),
    stats JSON,
    expertise JSON,
    workshop_facilities JSON,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- 17. 联系消息表
-- =====================================================
CREATE TABLE IF NOT EXISTS contact_messages (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(100) NOT NULL,
    phone VARCHAR(50),
    company VARCHAR(100),
    subject VARCHAR(200) NOT NULL,
    message TEXT NOT NULL,
    inquiry_type VARCHAR(20) DEFAULT 'general',
    status VARCHAR(20) DEFAULT 'new',
    priority VARCHAR(20) DEFAULT 'medium',
    ip_address VARCHAR(45),
    user_agent TEXT,
    replied_at TIMESTAMP NULL,
    replied_by BIGINT UNSIGNED NULL,
    admin_notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_email (email),
    INDEX idx_inquiry_type (inquiry_type),
    INDEX idx_status (status),
    INDEX idx_priority (priority),
    INDEX idx_created_at (created_at),

    FOREIGN KEY (replied_by) REFERENCES admin_users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- 插入初始数据
-- =====================================================

-- 插入默认管理员用户 (密码: admin123)
INSERT IGNORE INTO admin_users (username, email, password_hash, full_name, role, is_active)
VALUES ('admin', 'admin@vibocnc.com', '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'System Administrator', 'admin', TRUE);

-- 插入默认语言
INSERT IGNORE INTO languages (code, name, native_name, is_active, is_default, sort_order) VALUES
('en', 'English', 'English', TRUE, TRUE, 1),
('zh', 'Chinese', '中文', TRUE, FALSE, 2),
('ja', 'Japanese', '日本語', TRUE, FALSE, 3),
('ko', 'Korean', '한국어', TRUE, FALSE, 4);

-- 插入默认产品分类
INSERT IGNORE INTO categories (name, slug, description, sort_order, is_active) VALUES
('PCB Boards', 'pcb-boards', 'FANUC PCB Boards and Circuit Boards', 1, TRUE),
('I/O Modules', 'io-modules', 'FANUC Input/Output Modules', 2, TRUE),
('Servo Motors', 'servo-motors', 'FANUC Servo Motors and Drives', 3, TRUE),
('Control Units', 'control-units', 'FANUC Control Units and Controllers', 4, TRUE),
('Power Supplies', 'power-supplies', 'FANUC Power Supply Units', 5, TRUE),
('Cables & Connectors', 'cables-connectors', 'FANUC Cables and Connector Components', 6, TRUE);

-- 插入默认公司简介
INSERT IGNORE INTO company_profiles (
    company_name, company_subtitle, establishment_year, location, workshop_size,
    description_1, description_2, achievement,
    stats, expertise, workshop_facilities
) VALUES (
    'VIBO CNC',
    'Industrial Automation Specialists',
    '2005',
    'Kunshan, China',
    '5,000sqm',
    'VIBO CNC established in 2005 in Kunshan, China. We are selling automation components like System unit, Circuit board, PLC, HMI, Inverter, Encoder, Amplifier, Servomotor, Servodrive etc of AB ABB, Fanuc, Mitsubishi, Siemens and other manufacturers in our own 5,000sqm workshop.',
    'Especially Fanuc, We are one of the top three suppliers in China. We now have 27 workers, 10 sales and 100,000 items regularly stocked. Daily parcel around 50-100pcs, yearly turnover around 200 million.',
    'Top 3 FANUC Supplier in China',
    '[{"icon":"CalendarIcon","value":"2005","label":"Established","description":"Years of experience"},{"icon":"UserGroupIcon","value":"27","label":"Workers","description":"Professional team"},{"icon":"UserGroupIcon","value":"10","label":"Sales Staff","description":"Dedicated sales team"},{"icon":"ArchiveBoxIcon","value":"100,000","label":"Items Stocked","description":"Regular inventory"},{"icon":"TruckIcon","value":"50-100","label":"Daily Parcels","description":"Shipments per day"},{"icon":"CurrencyDollarIcon","value":"200M","label":"Yearly Turnover","description":"Annual revenue"}]',
    '["AB & ABB Components","FANUC Systems","Mitsubishi Parts","Siemens Solutions","Quality Testing","Global Shipping"]',
    '[{"id":"1","title":"Modern Facility","description":"State-of-the-art workshop with advanced equipment","image_url":"/api/placeholder/300/200"},{"id":"2","title":"Inventory Management","description":"Organized storage for 100,000+ items","image_url":"/api/placeholder/300/200"},{"id":"3","title":"Quality Control","description":"Rigorous testing and quality assurance","image_url":"/api/placeholder/300/200"}]'
);

-- =====================================================
-- 创建视图和存储过程 (可选)
-- =====================================================

-- 产品库存视图
CREATE OR REPLACE VIEW product_inventory_view AS
SELECT
    p.id,
    p.sku,
    p.name,
    p.stock_quantity,
    p.min_stock_level,
    CASE
        WHEN p.stock_quantity <= p.min_stock_level THEN 'Low Stock'
        WHEN p.stock_quantity = 0 THEN 'Out of Stock'
        ELSE 'In Stock'
    END as stock_status,
    c.name as category_name
FROM products p
LEFT JOIN categories c ON p.category_id = c.id
WHERE p.is_active = TRUE;

-- 订单统计视图
CREATE OR REPLACE VIEW order_statistics_view AS
SELECT
    DATE(created_at) as order_date,
    COUNT(*) as total_orders,
    SUM(total_amount) as total_revenue,
    AVG(total_amount) as avg_order_value
FROM orders
WHERE status != 'cancelled'
GROUP BY DATE(created_at)
ORDER BY order_date DESC;

-- =====================================================
-- 数据库优化建议
-- =====================================================

-- 设置 MySQL 配置优化 (在 my.cnf 中添加)
/*
[mysqld]
# 字符集设置
character-set-server = utf8mb4
collation-server = utf8mb4_unicode_ci

# InnoDB 设置
innodb_buffer_pool_size = 1G
innodb_log_file_size = 256M
innodb_flush_log_at_trx_commit = 2
innodb_flush_method = O_DIRECT

# 查询缓存
query_cache_type = 1
query_cache_size = 128M

# 连接设置
max_connections = 200
wait_timeout = 28800
interactive_timeout = 28800
*/

-- =====================================================
-- 完成提示
-- =====================================================
SELECT 'Database setup completed successfully!' as message;
SELECT 'Default admin user: admin / admin123' as login_info;
SELECT 'Database name: fanuc_sales' as database_info;
