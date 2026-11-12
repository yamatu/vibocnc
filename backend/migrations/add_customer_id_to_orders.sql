-- 添加 customer_id 到 orders 表（客户与订单关联）。
-- Idempotent and schema-agnostic: runs against the currently selected database.

SET @ddl = (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE orders ADD COLUMN customer_id BIGINT UNSIGNED NULL AFTER order_number', 'DO 0')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders' AND COLUMN_NAME = 'customer_id');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- AutoMigrate names this index idx_orders_customer_id; older manual runs used idx_customer_id.
SET @ddl = (SELECT IF(COUNT(*) = 0,
  'CREATE INDEX idx_orders_customer_id ON orders (customer_id)', 'DO 0')
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders' AND COLUMN_NAME = 'customer_id' AND SEQ_IN_INDEX = 1);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
