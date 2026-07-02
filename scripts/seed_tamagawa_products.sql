-- Seed Tamagawa Seiki categories and representative Tamagawa products.
-- Safe to run repeatedly: categories are updated by slug and products are skipped by SKU/slug.

START TRANSACTION;

UPDATE categories
SET
  name = 'Tamagawa',
  description = 'Tamagawa Seiki rotary encoders, resolvers, synchros, servo motors, step motors, drivers, gyros, and IMU products for CNC, robotics, motion control, and industrial automation maintenance.',
  is_active = 1,
  updated_at = NOW()
WHERE slug = 'tamagawa';

DROP TEMPORARY TABLE IF EXISTS tamagawa_category_seed;
CREATE TEMPORARY TABLE tamagawa_category_seed (
  slug VARCHAR(100) NOT NULL,
  name VARCHAR(100) NOT NULL,
  description VARCHAR(1000) NOT NULL,
  official_url VARCHAR(500) NOT NULL,
  sort_order BIGINT NOT NULL,
  PRIMARY KEY (slug)
) ENGINE=MEMORY;

INSERT INTO tamagawa_category_seed (slug, name, description, official_url, sort_order)
VALUES
  ('tamagawa-rotary-encoders', 'Tamagawa Rotary Encoders', 'Tamagawa Seiki incremental and absolute rotary encoders, FA-CODER feedback sensors, PLG sensors, and position feedback parts for servo and CNC systems.', 'https://www.tamagawa-seiki.com/products/rotaryencoder/', 1),
  ('tamagawa-resolvers-synchros', 'Tamagawa Resolvers / Synchros', 'Tamagawa Seiki brushless resolvers, Smartsyn resolvers, FA-SOLVER units, synchros, and rotation angle sensors for harsh industrial environments.', 'https://www.tamagawa-seiki.com/products/resolver-synchro/', 2),
  ('tamagawa-servo-motors-drivers', 'Tamagawa Servo Motors / Drivers', 'Tamagawa Seiki TBL-i, TBL-V, servo motors, servo drivers, and motion control drive products for precision automation.', 'https://www.tamagawa-seiki.com/products/servomotor/', 3),
  ('tamagawa-step-motors-drivers', 'Tamagawa Step Motors / Drivers', 'Tamagawa Seiki 2-phase and 5-phase step motors and step motor drivers for positioning and automation systems.', 'https://www.tamagawa-seiki.com/products/stepmotor/', 4),
  ('tamagawa-gyros-imu', 'Tamagawa Gyros / IMU', 'Tamagawa Seiki fiber optic gyros, MEMS IMU products, FOG and MEMS combined inertial sensors, and motion sensing units.', 'https://www.tamagawa-seiki.com/products/gyro/', 5);

INSERT INTO categories (
  name,
  slug,
  description,
  image_url,
  parent_id,
  sort_order,
  is_active,
  created_at,
  updated_at
)
SELECT
  seed.name,
  seed.slug,
  seed.description,
  '',
  root.id,
  seed.sort_order,
  1,
  NOW(),
  NOW()
FROM tamagawa_category_seed seed
JOIN categories root ON root.slug = 'tamagawa'
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  description = VALUES(description),
  parent_id = VALUES(parent_id),
  sort_order = VALUES(sort_order),
  is_active = VALUES(is_active),
  updated_at = NOW();

SET @changed_tamagawa_categories = ROW_COUNT();

DROP TEMPORARY TABLE IF EXISTS tamagawa_product_seed;
CREATE TEMPORARY TABLE tamagawa_product_seed (
  category_slug VARCHAR(100) NOT NULL,
  sku VARCHAR(100) NOT NULL,
  series_name VARCHAR(120) NOT NULL,
  product_type VARCHAR(180) NOT NULL,
  price DECIMAL(10,2) NOT NULL,
  stock_quantity BIGINT NOT NULL DEFAULT 1,
  PRIMARY KEY (sku)
) ENGINE=MEMORY;

INSERT INTO tamagawa_product_seed
  (category_slug, sku, series_name, product_type, price, stock_quantity)
VALUES
  ('tamagawa-rotary-encoders', 'AU5589', 'FA-CODER / PLG Sensor', 'PLG sensor and encoder feedback unit', 669.00, 1),
  ('tamagawa-rotary-encoders', 'TS5291N100', 'Incremental Encoder Series', 'incremental rotary encoder', 320.00, 1),
  ('tamagawa-rotary-encoders', 'TS5291N500', 'Incremental Encoder Series', 'incremental rotary encoder', 360.00, 1),
  ('tamagawa-rotary-encoders', 'TS5723N140', 'Absolute Encoder Series', 'multi-turn absolute encoder', 920.00, 1),
  ('tamagawa-rotary-encoders', 'TS5723N143', 'Absolute Encoder Series', 'multi-turn absolute encoder', 960.00, 1),
  ('tamagawa-rotary-encoders', 'TS5966N1', 'SmartAbs Battery-Less Series', 'battery-less absolute encoder', 980.00, 1),
  ('tamagawa-rotary-encoders', 'TS5966N20', 'SmartAbs Battery-Less Series', 'battery-less absolute encoder', 1080.00, 1),
  ('tamagawa-rotary-encoders', 'TS5667N120', 'Absolute Encoder Series', 'multi-turn absolute encoder', 820.00, 1),
  ('tamagawa-rotary-encoders', 'TS5702N40', 'Absolute Encoder Series', 'high-resolution absolute encoder', 1180.00, 1),
  ('tamagawa-rotary-encoders', 'TS5667N420', 'Absolute Encoder Series', 'multi-turn absolute encoder', 880.00, 1),
  ('tamagawa-rotary-encoders', 'TS5964N102', 'SmartAbs Battery-Less Series', 'battery-less absolute encoder', 1250.00, 1),
  ('tamagawa-rotary-encoders', 'TS5667N650', 'Absolute Encoder Series', 'multi-turn absolute encoder', 980.00, 1),
  ('tamagawa-rotary-encoders', 'TS5214N500', 'FA-CODER Encoder Series', 'encoder feedback sensor', 420.00, 1),

  ('tamagawa-resolvers-synchros', 'TS2603N21E64', 'Smartsyn Resolver Series', 'brushless resolver', 280.00, 1),
  ('tamagawa-resolvers-synchros', 'TS2605N1E64', 'Smartsyn Resolver Series', 'brushless resolver', 320.00, 1),
  ('tamagawa-resolvers-synchros', 'TS2620N21E11', 'Smartsyn Resolver Series', 'brushless resolver', 360.00, 1),
  ('tamagawa-resolvers-synchros', 'TS2620N271E14', 'Smartsyn Resolver Series', 'brushless resolver', 420.00, 1),
  ('tamagawa-resolvers-synchros', 'TS2640N321E64', 'Smartsyn Resolver Series', 'brushless resolver', 520.00, 1),
  ('tamagawa-resolvers-synchros', 'TS2660N31E64', 'Smartsyn Resolver Series', 'brushless resolver', 620.00, 1),
  ('tamagawa-resolvers-synchros', 'TS2640N1E64', 'Smartsyn Resolver Series', 'brushless resolver', 480.00, 1),
  ('tamagawa-resolvers-synchros', 'TS2620N11E11', 'Smartsyn Resolver Series', 'brushless resolver', 340.00, 1),
  ('tamagawa-resolvers-synchros', 'TS2650N21E78', 'FA-SOLVER Resolver Series', 'brushless resolver', 560.00, 1),
  ('tamagawa-resolvers-synchros', 'TS2660N41E64', 'FA-SOLVER Resolver Series', 'brushless resolver', 680.00, 1),
  ('tamagawa-resolvers-synchros', 'TS2651N141E78', 'FA-SOLVER Resolver Series', 'brushless resolver', 590.00, 1),
  ('tamagawa-resolvers-synchros', 'TS2610N11E11', 'Smartsyn Resolver Series', 'brushless resolver', 300.00, 1),

  ('tamagawa-servo-motors-drivers', 'TSM3102N1005E200', 'TBL-i Servo Motor Series', 'AC servo motor', 860.00, 1),
  ('tamagawa-servo-motors-drivers', 'TSM3104N1301E200', 'TBL-i Servo Motor Series', 'AC servo motor', 920.00, 1),
  ('tamagawa-servo-motors-drivers', 'TSM3201N1307E200', 'TBL-i Servo Motor Series', 'AC servo motor', 980.00, 1),
  ('tamagawa-servo-motors-drivers', 'TSM3202N2305E040', 'TBL-i Servo Motor Series', 'AC servo motor', 1080.00, 1),
  ('tamagawa-servo-motors-drivers', 'TSM3301N1300E100', 'TBL-i Servo Motor Series', 'AC servo motor', 1180.00, 1),
  ('tamagawa-servo-motors-drivers', 'TSM3302N7007E200', 'TBL-i Servo Motor Series', 'AC servo motor', 1260.00, 1),
  ('tamagawa-servo-motors-drivers', 'TSM3412N2307E430', 'TBL-i Servo Motor Series', 'AC servo motor', 1480.00, 1),
  ('tamagawa-servo-motors-drivers', 'TSM3614N7007E420', 'TBL-i Servo Motor Series', 'AC servo motor', 1680.00, 1),
  ('tamagawa-servo-motors-drivers', 'TS4602N1507E620', 'TBL-iII Servo Motor Series', 'AC servo motor', 1320.00, 1),
  ('tamagawa-servo-motors-drivers', 'TS4603N6005E620', 'TBL-iII Servo Motor Series', 'AC servo motor', 1480.00, 1),
  ('tamagawa-servo-motors-drivers', 'TS4606N8301E620', 'TBL-iII Servo Motor Series', 'AC servo motor', 1880.00, 1),
  ('tamagawa-servo-motors-drivers', 'TS4609N3307E200', 'TBL-iII Servo Motor Series', 'AC servo motor', 2180.00, 1),
  ('tamagawa-servo-motors-drivers', 'TS4614N2005E200', 'TBL-iII Servo Motor Series', 'AC servo motor', 2480.00, 1),
  ('tamagawa-servo-motors-drivers', 'TSM4354N2302E200', 'TBL-i Servo Motor Series', 'AC servo motor', 1980.00, 1),
  ('tamagawa-servo-motors-drivers', 'TSM1814N9000E225', 'TBL-i Servo Motor Series', 'AC servo motor', 1180.00, 1),
  ('tamagawa-servo-motors-drivers', 'TAD8810', 'TAD88 Servo Driver Series', 'servo driver controller', 980.00, 1),
  ('tamagawa-servo-motors-drivers', 'TAD88-SV-NET', 'TAD88 Servo Driver Series', 'SV-NET servo driver controller', 1280.00, 1),
  ('tamagawa-servo-motors-drivers', 'TAD8810N0703E115', 'TAD8810 Servo Driver Series', 'DC power servo driver', 1180.00, 1),

  ('tamagawa-step-motors-drivers', 'TS3692N1', '2-Phase Step Motor Series', '2-phase step motor', 180.00, 1),
  ('tamagawa-step-motors-drivers', 'TS3692N11', '2-Phase Step Motor Series', '2-phase step motor', 190.00, 1),
  ('tamagawa-step-motors-drivers', 'TS3641N1E1', '2-Phase Step Motor Series', '2-phase step motor', 220.00, 1),
  ('tamagawa-step-motors-drivers', 'TS3617N502', '2-Phase Step Motor Series', '2-phase step motor', 260.00, 1),
  ('tamagawa-step-motors-drivers', 'TS3621N1', '2-Phase Step Motor Series', '2-phase step motor', 280.00, 1),
  ('tamagawa-step-motors-drivers', 'TS3690N1E1', '2-Phase Step Motor Series', '2-phase step motor', 320.00, 1),
  ('tamagawa-step-motors-drivers', 'TS3653N1E1', '2-Phase Step Motor Series', '2-phase step motor', 360.00, 1),
  ('tamagawa-step-motors-drivers', 'TS3606N1E1', '2-Phase Step Motor Series', '2-phase step motor', 380.00, 1),
  ('tamagawa-step-motors-drivers', 'TS3684N1E3', '2-Phase Step Motor Series', '2-phase step motor', 460.00, 1),
  ('tamagawa-step-motors-drivers', 'TS3682', '5-Phase Step Motor Series', '5-phase step motor', 240.00, 1),
  ('tamagawa-step-motors-drivers', 'TS3664', '5-Phase Step Motor Series', '5-phase step motor', 280.00, 1),
  ('tamagawa-step-motors-drivers', 'TS3667', '5-Phase Step Motor Series', '5-phase step motor', 360.00, 1),
  ('tamagawa-step-motors-drivers', 'TS3624', '5-Phase Step Motor Series', '5-phase step motor', 420.00, 1),

  ('tamagawa-gyros-imu', 'TA7774', 'i-FOG TA7774 Series', 'interferometric fiber optic gyro', 4200.00, 1),
  ('tamagawa-gyros-imu', 'TAG350', 'TAG350 Series', 'FOG and MEMS combined IMU', 5200.00, 1),
  ('tamagawa-gyros-imu', 'TAG320N1000', 'TAG320 Series', 'standard MEMS IMU', 1980.00, 1),
  ('tamagawa-gyros-imu', 'TAG320N2000', 'TAG320 Series', 'high-precision MEMS IMU', 2480.00, 1),
  ('tamagawa-gyros-imu', 'TAG310N1000', 'TAG310 Series', 'base model MEMS IMU', 1780.00, 1),
  ('tamagawa-gyros-imu', 'TAG300N1000', 'TAG300 Series', 'waterproof MEMS IMU', 1680.00, 1),
  ('tamagawa-gyros-imu', 'AU7684', 'MEMS IMU Sensor Series', 'MEMS inertial sensor unit', 2200.00, 1);

UPDATE products p
JOIN tamagawa_product_seed seed ON seed.sku = p.sku
JOIN categories c ON c.slug = seed.category_slug
JOIN categories parent ON parent.id = c.parent_id AND parent.slug = 'tamagawa'
JOIN tamagawa_category_seed cat_seed ON cat_seed.slug = seed.category_slug
SET
  p.category_id = c.id,
  p.brand = 'Tamagawa',
  p.model = seed.sku,
  p.part_number = seed.sku,
  p.manufacturer = 'Tamagawa Seiki Co., Ltd.',
  p.origin_country = 'Japan',
  p.datasheet_url = cat_seed.official_url,
  p.name = CASE
    WHEN p.name IS NULL OR p.name = '' OR p.name = p.sku OR p.name LIKE 'PLG SENSOR Tamagawa %'
      THEN CONCAT('Tamagawa ', seed.sku, ' ', seed.product_type)
    ELSE p.name
  END,
  p.short_description = CASE
    WHEN p.short_description IS NULL OR p.short_description = ''
      THEN CONCAT('Tamagawa ', seed.sku, ' ', seed.product_type, ' for CNC, motion control, industrial automation maintenance, repair, and replacement.')
    ELSE p.short_description
  END,
  p.updated_at = NOW()
WHERE
  p.category_id <> c.id
  OR p.brand IS NULL
  OR p.brand <> 'Tamagawa'
  OR p.model IS NULL
  OR p.model <> seed.sku
  OR p.part_number IS NULL
  OR p.part_number <> seed.sku
  OR p.manufacturer IS NULL
  OR p.manufacturer <> 'Tamagawa Seiki Co., Ltd.'
  OR p.origin_country IS NULL
  OR p.origin_country <> 'Japan'
  OR p.datasheet_url IS NULL
  OR p.datasheet_url = ''
  OR p.datasheet_url <> cat_seed.official_url
  OR p.name IS NULL
  OR p.name = ''
  OR p.name = p.sku
  OR p.name LIKE 'PLG SENSOR Tamagawa %'
  OR p.short_description IS NULL
  OR p.short_description = '';

SET @normalized_tamagawa_products = ROW_COUNT();

INSERT INTO products (
  sku,
  name,
  slug,
  short_description,
  description,
  price,
  stock_quantity,
  min_stock_level,
  brand,
  model,
  part_number,
  category_id,
  is_active,
  is_featured,
  meta_title,
  meta_description,
  meta_keywords,
  image_urls,
  warranty_period,
  condition_type,
  origin_country,
  manufacturer,
  lead_time,
  minimum_order_quantity,
  packaging_info,
  certifications,
  technical_specs,
  compatibility_info,
  installation_guide,
  maintenance_tips,
  datasheet_url,
  created_at,
  updated_at,
  disable_auto_seo
)
SELECT
  seed.sku,
  CONCAT('Tamagawa ', seed.sku, ' ', seed.product_type) AS name,
  seed.generated_slug AS slug,
  CONCAT(
    'Tamagawa ', seed.sku, ' ', seed.product_type,
    ' for CNC, robotics, motion control, industrial automation maintenance, repair, and replacement.'
  ) AS short_description,
  CONCAT(
    'Tamagawa ', seed.sku, ' ', seed.product_type, '\n\n',
    seed.sku, ' belongs to the ', seed.series_name,
    ' range and is listed for CNC maintenance, servo feedback, motion control, retrofit, repair, and replacement projects.\n\n',
    'Key details\n',
    '- Brand: Tamagawa\n',
    '- Manufacturer: Tamagawa Seiki Co., Ltd.\n',
    '- Part No.: ', seed.sku, '\n',
    '- Series: ', seed.series_name, '\n',
    '- Type: ', seed.product_type, '\n',
    '- Warranty: 12 months\n',
    '- Lead time: 3-7 days\n',
    '- Shipping: Worldwide\n\n',
    'Compatibility and ordering guidance\n',
    '- Confirm the exact part number, connector, encoder resolution, resolver ratio, motor frame, driver voltage, or IMU interface before ordering.\n',
    '- Send a nameplate photo if replacement compatibility needs to be confirmed.'
  ) AS description,
  seed.price,
  seed.stock_quantity,
  0 AS min_stock_level,
  'Tamagawa' AS brand,
  seed.sku AS model,
  seed.sku AS part_number,
  c.id AS category_id,
  1 AS is_active,
  0 AS is_featured,
  CONCAT('Tamagawa ', seed.sku, ' ', seed.product_type, ' | VIBO CNC') AS meta_title,
  CONCAT(
    'Tamagawa ', seed.sku, ' ', seed.product_type,
    ' for CNC and industrial automation repair and replacement. Compatibility support, 12-month warranty, and worldwide shipping from VIBO CNC.'
  ) AS meta_description,
  CONCAT(
    seed.sku, ', Tamagawa ', seed.series_name, ', ', seed.product_type,
    ', Tamagawa Seiki, encoder, resolver, servo, motion control, VIBO CNC'
  ) AS meta_keywords,
  JSON_ARRAY() AS image_urls,
  '12 months' AS warranty_period,
  CASE
    WHEN seed.category_slug IN ('tamagawa-rotary-encoders', 'tamagawa-resolvers-synchros') THEN 'refurbished'
    ELSE 'new'
  END AS condition_type,
  'Japan' AS origin_country,
  'Tamagawa Seiki Co., Ltd.' AS manufacturer,
  '3-7 days' AS lead_time,
  1 AS minimum_order_quantity,
  'Standard industrial packaging. Confirm packaging requirements before shipment.' AS packaging_info,
  'Confirm exact approvals, interface type, and compliance markings by model before ordering.' AS certifications,
  JSON_OBJECT(
    'brand', 'Tamagawa',
    'manufacturer', 'Tamagawa Seiki Co., Ltd.',
    'series', seed.series_name,
    'type', seed.product_type,
    'model', seed.sku
  ) AS technical_specs,
  CONCAT(
    'Use ', seed.sku,
    ' only with compatible CNC, servo, resolver, encoder, driver, or inertial sensing systems. Match the original nameplate before replacement.'
  ) AS compatibility_info,
  'Install and configure according to the applicable Tamagawa Seiki manual, machine builder documentation, and local electrical safety rules.' AS installation_guide,
  'Keep connectors clean, protect feedback cables from noise, check mounting alignment, and record machine alarms before replacing motion feedback components.' AS maintenance_tips,
  cat_seed.official_url AS datasheet_url,
  NOW() AS created_at,
  NOW() AS updated_at,
  0 AS disable_auto_seo
FROM (
  SELECT
    seed.*,
    TRIM(BOTH '-' FROM LOWER(REGEXP_REPLACE(CONCAT('tamagawa-', seed.sku), '[^0-9A-Za-z]+', '-'))) AS generated_slug
  FROM tamagawa_product_seed seed
) seed
JOIN tamagawa_category_seed cat_seed ON cat_seed.slug = seed.category_slug
JOIN categories c ON c.slug = seed.category_slug
JOIN categories parent ON parent.id = c.parent_id AND parent.slug = 'tamagawa'
LEFT JOIN products existing_sku ON existing_sku.sku = seed.sku
LEFT JOIN products existing_slug ON existing_slug.slug = seed.generated_slug
WHERE existing_sku.id IS NULL
  AND existing_slug.id IS NULL;

SET @inserted_tamagawa_products = ROW_COUNT();

SELECT
  @changed_tamagawa_categories AS changed_categories,
  @normalized_tamagawa_products AS normalized_existing_products,
  @inserted_tamagawa_products AS inserted_products,
  (SELECT COUNT(*) FROM tamagawa_category_seed) AS seed_categories,
  (SELECT COUNT(*) FROM tamagawa_product_seed) AS seed_products;

SELECT
  c.slug,
  c.name,
  COUNT(p.id) AS products
FROM categories c
LEFT JOIN products p ON p.category_id = c.id
WHERE c.parent_id = (SELECT id FROM categories WHERE slug = 'tamagawa')
GROUP BY c.id, c.slug, c.name
ORDER BY c.sort_order, c.id;

COMMIT;
