-- 添加 customer_id 到 orders 表
-- 这个迁移脚本添加客户关联到订单表

USE fanuc_sales;

-- 检查列是否已存在，如果不存在则添加
SET @column_exists = (
    SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = 'fanuc_sales'
    AND TABLE_NAME = 'orders'
    AND COLUMN_NAME = 'customer_id'
);

SET @sql = IF(@column_exists = 0,
    'ALTER TABLE orders ADD COLUMN customer_id BIGINT UNSIGNED NULL AFTER order_number, ADD INDEX idx_customer_id (customer_id)',
    'SELECT "Column customer_id already exists" AS message'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 显示结果
SELECT 'Migration completed: customer_id added to orders table' AS status;
