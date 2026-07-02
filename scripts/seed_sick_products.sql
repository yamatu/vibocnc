-- Seed SICK categories and representative SICK products.
-- Safe to run repeatedly: categories are updated by slug and products are skipped by SKU/slug.

START TRANSACTION;

UPDATE categories
SET
  name = 'SICK',
  description = 'SICK AG industrial sensors, safety systems, encoders, automatic identification, LiDAR, RFID, and machine vision products for factory automation and machine maintenance.',
  is_active = 1,
  updated_at = NOW()
WHERE slug = 'sick';

DROP TEMPORARY TABLE IF EXISTS sick_category_seed;
CREATE TEMPORARY TABLE sick_category_seed (
  slug VARCHAR(100) NOT NULL,
  name VARCHAR(100) NOT NULL,
  description VARCHAR(1000) NOT NULL,
  official_url VARCHAR(500) NOT NULL,
  sort_order BIGINT NOT NULL,
  PRIMARY KEY (slug)
) ENGINE=MEMORY;

INSERT INTO sick_category_seed (slug, name, description, official_url, sort_order)
VALUES
  ('sick-photoelectric-sensors', 'SICK Photoelectric Sensors', 'SICK photoelectric sensors for object detection, presence sensing, packaging, conveying, and factory automation applications.', 'https://www.sick.com/us/en/products/detection-sensors/photoelectric-sensors/c/g172752', 1),
  ('sick-proximity-sensors', 'SICK Proximity Sensors', 'SICK inductive and proximity sensors for non-contact detection of metal objects and machine position feedback.', 'https://www.sick.com/us/en/inductive-proximity-sensors/c/g187054', 2),
  ('sick-distance-sensors', 'SICK Distance Sensors', 'SICK distance measurement sensors for positioning, level, logistics, and industrial measurement applications.', 'https://www.sick.com/us/en/distance-sensors/c/g91900', 3),
  ('sick-encoders', 'SICK Encoders', 'SICK incremental and absolute encoders for speed, position, motion feedback, and machine control.', 'https://www.sick.com/us/en/encoders/c/g195206', 4),
  ('sick-safety-light-curtains', 'SICK Safety Light Curtains', 'SICK safety light curtains and multi-beam safety devices for machine guarding and personnel protection.', 'https://www.sick.com/us/en/safety-light-curtains/c/g187158', 5),
  ('sick-safety-laser-scanners', 'SICK Safety Laser Scanners', 'SICK safety laser scanners for area protection, access guarding, mobile platforms, and machine safety.', 'https://www.sick.com/us/en/safety-laser-scanners/c/g187152', 6),
  ('sick-lidar-sensors', 'SICK 2D LiDAR Sensors', 'SICK 2D LiDAR sensors and laser measurement scanners for navigation, detection, profiling, and area monitoring.', 'https://www.sick.com/us/en/2d-lidar-sensors/c/g91935', 7),
  ('sick-barcode-scanners', 'SICK Barcode Scanners', 'SICK fixed-mount and handheld barcode scanners for logistics, packaging, traceability, and automatic identification.', 'https://www.sick.com/us/en/bar-code-scanners/c/g91974', 8),
  ('sick-rfid', 'SICK RFID', 'SICK RFID read/write devices and transponders for identification, tracking, and industrial logistics.', 'https://www.sick.com/us/en/rfid/c/g91967', 9),
  ('sick-vision-sensors', 'SICK Vision Sensors', 'SICK vision sensors, smart cameras, and machine vision devices for inspection, measurement, and identification.', 'https://www.sick.com/us/en/machine-vision/c/g91958', 10);

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
FROM sick_category_seed seed
JOIN categories root ON root.slug = 'sick'
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  description = VALUES(description),
  parent_id = VALUES(parent_id),
  sort_order = VALUES(sort_order),
  is_active = VALUES(is_active),
  updated_at = NOW();

SET @changed_sick_categories = ROW_COUNT();

DROP TEMPORARY TABLE IF EXISTS sick_product_seed;
CREATE TEMPORARY TABLE sick_product_seed (
  category_slug VARCHAR(100) NOT NULL,
  sku VARCHAR(100) NOT NULL,
  series_name VARCHAR(120) NOT NULL,
  product_type VARCHAR(180) NOT NULL,
  price DECIMAL(10,2) NOT NULL,
  stock_quantity BIGINT NOT NULL DEFAULT 1,
  PRIMARY KEY (sku)
) ENGINE=MEMORY;

INSERT INTO sick_product_seed
  (category_slug, sku, series_name, product_type, price, stock_quantity)
VALUES
  ('sick-photoelectric-sensors', 'WTB4-3P3161', 'W4 Series', 'photoelectric proximity sensor', 120.00, 1),
  ('sick-photoelectric-sensors', 'WTB12-3P2431', 'W12 Series', 'photoelectric proximity sensor', 180.00, 1),
  ('sick-photoelectric-sensors', 'WTB27-3P2411', 'W27 Series', 'photoelectric proximity sensor', 220.00, 1),
  ('sick-photoelectric-sensors', 'WL12-3P2431', 'W12 Series', 'retro-reflective photoelectric sensor', 170.00, 1),
  ('sick-photoelectric-sensors', 'WL18-3P430', 'W18 Series', 'retro-reflective photoelectric sensor', 150.00, 1),
  ('sick-photoelectric-sensors', 'WSE12-3P2431', 'W12 Series', 'through-beam photoelectric sensor', 210.00, 1),
  ('sick-photoelectric-sensors', 'GRTE18-P2462', 'G18 Series', 'cylindrical photoelectric sensor', 95.00, 1),
  ('sick-photoelectric-sensors', 'GTE6-P4212', 'G6 Series', 'miniature photoelectric sensor', 85.00, 1),
  ('sick-photoelectric-sensors', 'WTB9-3P2461', 'W9 Series', 'photoelectric proximity sensor', 140.00, 1),
  ('sick-photoelectric-sensors', 'WLL180T-P434', 'WLL180T Series', 'fiber-optic sensor amplifier', 160.00, 1),

  ('sick-proximity-sensors', 'IME08-02BPSZW2S', 'IME Series', 'inductive proximity sensor', 58.00, 1),
  ('sick-proximity-sensors', 'IME12-04BPSZW2S', 'IME Series', 'inductive proximity sensor', 65.00, 1),
  ('sick-proximity-sensors', 'IME18-08BPSZW2S', 'IME Series', 'inductive proximity sensor', 78.00, 1),
  ('sick-proximity-sensors', 'IME30-15BPSZW2S', 'IME Series', 'inductive proximity sensor', 110.00, 1),
  ('sick-proximity-sensors', 'IMB12-08NPSVC0S', 'IMB Series', 'inductive proximity sensor', 95.00, 1),
  ('sick-proximity-sensors', 'IMB18-12NPSVC0S', 'IMB Series', 'inductive proximity sensor', 120.00, 1),
  ('sick-proximity-sensors', 'IMB30-15NPSVC0S', 'IMB Series', 'inductive proximity sensor', 145.00, 1),
  ('sick-proximity-sensors', 'IQ10-03BPSKW2S', 'IQ Series', 'rectangular inductive proximity sensor', 90.00, 1),
  ('sick-proximity-sensors', 'IQ40-20BPPKC0K', 'IQ Series', 'rectangular inductive proximity sensor', 160.00, 1),
  ('sick-proximity-sensors', 'MM12-60APS-ZC0', 'MM Series', 'magnetic proximity sensor', 75.00, 1),

  ('sick-distance-sensors', 'DT35-B15251', 'Dx35 Series', 'mid-range distance sensor', 520.00, 1),
  ('sick-distance-sensors', 'DT50-P1113', 'Dx50 Series', 'long-range distance sensor', 680.00, 1),
  ('sick-distance-sensors', 'DT20-P214B', 'Dx20 Series', 'distance sensor', 460.00, 1),
  ('sick-distance-sensors', 'DL100-23AA2102', 'DL100 Series', 'long-range distance sensor', 1380.00, 1),
  ('sick-distance-sensors', 'DL100-21AA2102', 'DL100 Series', 'long-range distance sensor', 1280.00, 1),
  ('sick-distance-sensors', 'DME4000-111', 'DME4000 Series', 'distance measuring device', 1680.00, 1),
  ('sick-distance-sensors', 'OD1000-6001T15', 'OD1000 Series', 'displacement measurement sensor', 1480.00, 1),
  ('sick-distance-sensors', 'OD5000-C85W12', 'OD5000 Series', 'high-precision displacement sensor', 1880.00, 1),
  ('sick-distance-sensors', 'UM30-213113', 'UM30 Series', 'ultrasonic distance sensor', 260.00, 1),
  ('sick-distance-sensors', 'UC30-21416A', 'UC30 Series', 'ultrasonic distance sensor', 320.00, 1),

  ('sick-encoders', 'DFS60B-S4PA10000', 'DFS60 Series', 'incremental encoder', 520.00, 1),
  ('sick-encoders', 'DFS60B-BDPC10000', 'DFS60 Series', 'incremental encoder', 560.00, 1),
  ('sick-encoders', 'DFS60E-S4PA65536', 'DFS60 Series', 'incremental encoder', 690.00, 1),
  ('sick-encoders', 'AFS60B-S4IB262144', 'AFS60 Series', 'absolute singleturn encoder', 920.00, 1),
  ('sick-encoders', 'AFM60A-S4NB018X12', 'AFM60 Series', 'absolute multiturn encoder', 1080.00, 1),
  ('sick-encoders', 'AHS36A-BBCC014X12', 'AHS/AHM36 Series', 'absolute encoder', 680.00, 1),
  ('sick-encoders', 'ARS60-F4A01024', 'ARS60 Series', 'absolute encoder', 760.00, 1),
  ('sick-encoders', 'DGS60-G4K01000', 'DGS60 Series', 'incremental encoder', 440.00, 1),
  ('sick-encoders', 'DBS36E-BBEK02000', 'DBS36 Series', 'incremental encoder', 280.00, 1),
  ('sick-encoders', 'TMS88D-MQT050', 'TMS/TMM Series', 'inclination sensor', 360.00, 1),

  ('sick-safety-light-curtains', 'C4C-SA03010A10000', 'deTec4 Core', 'safety light curtain', 880.00, 1),
  ('sick-safety-light-curtains', 'C4C-SA06010A10000', 'deTec4 Core', 'safety light curtain', 1180.00, 1),
  ('sick-safety-light-curtains', 'C4C-SA09010A10000', 'deTec4 Core', 'safety light curtain', 1480.00, 1),
  ('sick-safety-light-curtains', 'C4C-SA12010A10000', 'deTec4 Core', 'safety light curtain', 1880.00, 1),
  ('sick-safety-light-curtains', 'C4P-SA03010A00', 'deTec4 Prime', 'safety light curtain', 980.00, 1),
  ('sick-safety-light-curtains', 'C4P-SA06010A00', 'deTec4 Prime', 'safety light curtain', 1380.00, 1),
  ('sick-safety-light-curtains', 'C2C-SA03010A10000', 'deTec2 Core', 'safety light curtain', 720.00, 1),
  ('sick-safety-light-curtains', 'C2C-SA06010A10000', 'deTec2 Core', 'safety light curtain', 980.00, 1),
  ('sick-safety-light-curtains', 'M40E-034000RR0', 'M4000 Series', 'multiple light beam safety device', 1280.00, 1),
  ('sick-safety-light-curtains', 'M40S-034000AR0', 'M4000 Series', 'multiple light beam safety device', 1180.00, 1),

  ('sick-safety-laser-scanners', 'MICS3-AAAZ55AZ1P01', 'microScan3 Series', 'safety laser scanner', 3680.00, 1),
  ('sick-safety-laser-scanners', 'MICS3-AAAZ40AZ1P01', 'microScan3 Series', 'safety laser scanner', 3380.00, 1),
  ('sick-safety-laser-scanners', 'MICS3-CBAZ55AZ1P01', 'microScan3 Series', 'safety laser scanner', 4280.00, 1),
  ('sick-safety-laser-scanners', 'MICS3-CAAZ40AZ1P01', 'microScan3 Series', 'safety laser scanner', 3980.00, 1),
  ('sick-safety-laser-scanners', 'MICS3-ABAZ55AZ1P01', 'microScan3 Series', 'safety laser scanner', 3880.00, 1),
  ('sick-safety-laser-scanners', 'NANS3-AAAZ30AZ1P01', 'nanoScan3 Series', 'compact safety laser scanner', 2980.00, 1),
  ('sick-safety-laser-scanners', 'S30A-4011BA', 'S300 Series', 'safety laser scanner', 2380.00, 1),
  ('sick-safety-laser-scanners', 'S30B-3011BA', 'S300 Mini Series', 'safety laser scanner', 2180.00, 1),
  ('sick-safety-laser-scanners', 'S30B-2011BA', 'S300 Mini Series', 'safety laser scanner', 1980.00, 1),
  ('sick-safety-laser-scanners', 'S30A-6111BA', 'S3000 Series', 'safety laser scanner', 4480.00, 1),

  ('sick-lidar-sensors', 'TIM310-1030000', 'TiM3xx Series', '2D LiDAR sensor', 1180.00, 1),
  ('sick-lidar-sensors', 'TIM351-2134001', 'TiM3xx Series', '2D LiDAR sensor', 1380.00, 1),
  ('sick-lidar-sensors', 'TIM551-2050001', 'TiM5xx Series', '2D LiDAR sensor', 1680.00, 1),
  ('sick-lidar-sensors', 'TIM561-2050101', 'TiM5xx Series', '2D LiDAR sensor', 1880.00, 1),
  ('sick-lidar-sensors', 'TIM571-2050101', 'TiM5xx Series', '2D LiDAR sensor', 1980.00, 1),
  ('sick-lidar-sensors', 'LMS111-10100', 'LMS1xx Series', '2D LiDAR sensor', 2280.00, 1),
  ('sick-lidar-sensors', 'LMS511-10100', 'LMS5xx Series', '2D LiDAR sensor', 3280.00, 1),
  ('sick-lidar-sensors', 'LMS511-20100', 'LMS5xx Series', '2D LiDAR sensor', 3480.00, 1),
  ('sick-lidar-sensors', 'MRS1000P', 'MRS1000 Series', '3D LiDAR sensor', 4280.00, 1),
  ('sick-lidar-sensors', 'LD-MRS400001', 'LD-MRS Series', 'multi-layer LiDAR sensor', 4980.00, 1),

  ('sick-barcode-scanners', 'CLV620-0120', 'CLV62x Series', 'fixed-mount barcode scanner', 1280.00, 1),
  ('sick-barcode-scanners', 'CLV630-0120', 'CLV63x Series', 'fixed-mount barcode scanner', 1580.00, 1),
  ('sick-barcode-scanners', 'CLV650-0120', 'CLV65x Series', 'fixed-mount barcode scanner', 1980.00, 1),
  ('sick-barcode-scanners', 'CLV690-1000', 'CLV69x Series', 'fixed-mount barcode scanner', 2580.00, 1),
  ('sick-barcode-scanners', 'IDM140-300S', 'IDM14x Series', 'handheld barcode scanner', 420.00, 1),
  ('sick-barcode-scanners', 'IDM160-300S', 'IDM16x Series', 'handheld barcode scanner', 520.00, 1),
  ('sick-barcode-scanners', 'IDM260-311S', 'IDM26x Series', 'handheld barcode scanner', 680.00, 1),
  ('sick-barcode-scanners', 'LECTOR620-1000', 'Lector62x Series', 'image-based code reader', 1480.00, 1),
  ('sick-barcode-scanners', 'LECTOR630-1100', 'Lector63x Series', 'image-based code reader', 1780.00, 1),
  ('sick-barcode-scanners', 'LECTOR650-1000', 'Lector65x Series', 'image-based code reader', 2280.00, 1),

  ('sick-rfid', 'RFU610-10600', 'RFU61x Series', 'UHF RFID read/write device', 980.00, 1),
  ('sick-rfid', 'RFU620-10100', 'RFU62x Series', 'UHF RFID read/write device', 1280.00, 1),
  ('sick-rfid', 'RFU620-10400', 'RFU62x Series', 'UHF RFID read/write device', 1380.00, 1),
  ('sick-rfid', 'RFU630-13100', 'RFU63x Series', 'UHF RFID read/write device', 1680.00, 1),
  ('sick-rfid', 'RFU630-13101', 'RFU63x Series', 'UHF RFID read/write device', 1780.00, 1),
  ('sick-rfid', 'RFU650-10100', 'RFU65x Series', 'UHF RFID read/write device', 2480.00, 1),
  ('sick-rfid', 'RFU650-10101', 'RFU65x Series', 'UHF RFID read/write device', 2580.00, 1),
  ('sick-rfid', 'RFH620-1001201', 'RFH62x Series', 'HF RFID read/write device', 1080.00, 1),
  ('sick-rfid', 'RFH630-1102101', 'RFH63x Series', 'HF RFID read/write device', 1380.00, 1),
  ('sick-rfid', 'RFM630-1310001', 'RFM63x Series', 'RFID read/write device', 1580.00, 1),

  ('sick-vision-sensors', 'V2D611P-MLSCI5', 'InspectorP6xx Series', '2D vision sensor', 1280.00, 1),
  ('sick-vision-sensors', 'V2D621P-MLSCI5', 'InspectorP6xx Series', '2D vision sensor', 1480.00, 1),
  ('sick-vision-sensors', 'V2D631P-MLSCI5', 'InspectorP6xx Series', '2D vision sensor', 1780.00, 1),
  ('sick-vision-sensors', 'V2D654R-MMSCA1', 'InspectorP6xx Series', '2D vision sensor', 2280.00, 1),
  ('sick-vision-sensors', 'PIM60-IRP010000', 'InspectorPIM Series', 'programmable vision sensor', 1880.00, 1),
  ('sick-vision-sensors', 'PI50-IRP000', 'Inspector Series', 'vision sensor', 980.00, 1),
  ('sick-vision-sensors', 'SIM1012-0P000', 'SIM Series', 'sensor integration machine', 1280.00, 1),
  ('sick-vision-sensors', 'SIM2000-0A000', 'SIM Series', 'sensor integration machine', 1980.00, 1),
  ('sick-vision-sensors', 'RANGER3-40', 'Ranger3 Series', '3D vision camera', 4280.00, 1),
  ('sick-vision-sensors', 'IVC-3D-31111', 'IVC-3D Series', '3D smart camera', 3680.00, 1);

UPDATE products p
JOIN categories c ON c.id = p.category_id
JOIN categories parent ON parent.id = c.parent_id
JOIN sick_category_seed cat_seed ON cat_seed.slug = c.slug
SET
  p.brand = 'SICK',
  p.manufacturer = 'SICK AG',
  p.origin_country = 'Germany',
  p.datasheet_url = cat_seed.official_url,
  p.updated_at = NOW()
WHERE parent.slug = 'sick'
  AND (
    p.brand <> 'SICK'
    OR p.manufacturer IS NULL
    OR p.manufacturer <> 'SICK AG'
    OR p.origin_country IS NULL
    OR p.origin_country <> 'Germany'
    OR p.datasheet_url IS NULL
    OR p.datasheet_url = ''
  );

SET @normalized_sick_products = ROW_COUNT();

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
  CONCAT('SICK ', seed.sku, ' ', seed.product_type) AS name,
  seed.generated_slug AS slug,
  CONCAT(
    'SICK ', seed.sku, ' ', seed.product_type,
    ' for industrial sensing, machine safety, logistics, automation maintenance, and replacement.'
  ) AS short_description,
  CONCAT(
    'SICK ', seed.sku, ' ', seed.product_type, '\n\n',
    seed.sku, ' belongs to the ', seed.series_name,
    ' range and is listed for industrial automation, machine maintenance, retrofit, repair, and replacement projects.\n\n',
    'Key details\n',
    '- Brand: SICK\n',
    '- Manufacturer: SICK AG\n',
    '- Part No.: ', seed.sku, '\n',
    '- Series: ', seed.series_name, '\n',
    '- Type: ', seed.product_type, '\n',
    '- Warranty: 12 months\n',
    '- Lead time: 3-7 days\n',
    '- Shipping: Worldwide\n\n',
    'Compatibility and ordering guidance\n',
    '- Confirm the exact part number, connector, output type, sensing range, safety rating, or communication interface before ordering.\n',
    '- Send a nameplate photo if replacement compatibility needs to be confirmed.'
  ) AS description,
  seed.price,
  seed.stock_quantity,
  0 AS min_stock_level,
  'SICK' AS brand,
  seed.sku AS model,
  seed.sku AS part_number,
  c.id AS category_id,
  1 AS is_active,
  0 AS is_featured,
  CONCAT('SICK ', seed.sku, ' ', seed.product_type, ' | VIBO CNC') AS meta_title,
  CONCAT(
    'SICK ', seed.sku, ' ', seed.product_type,
    ' for industrial automation repair and replacement. Compatibility support, 12-month warranty, and worldwide shipping from VIBO CNC.'
  ) AS meta_description,
  CONCAT(
    seed.sku, ', SICK ', seed.series_name, ', ', seed.product_type,
    ', SICK AG, industrial sensors, machine safety, automation parts, VIBO CNC'
  ) AS meta_keywords,
  JSON_ARRAY() AS image_urls,
  '12 months' AS warranty_period,
  'new' AS condition_type,
  'Germany' AS origin_country,
  'SICK AG' AS manufacturer,
  '3-7 days' AS lead_time,
  1 AS minimum_order_quantity,
  'Standard industrial packaging. Confirm packaging requirements before shipment.' AS packaging_info,
  'Confirm exact approvals, safety ratings, and compliance markings by model before ordering.' AS certifications,
  JSON_OBJECT(
    'brand', 'SICK',
    'manufacturer', 'SICK AG',
    'series', seed.series_name,
    'type', seed.product_type,
    'model', seed.sku
  ) AS technical_specs,
  CONCAT(
    'Use ', seed.sku,
    ' only with compatible machine wiring, controller logic, safety configuration, mounting hardware, and application requirements.'
  ) AS compatibility_info,
  'Install and configure according to the applicable SICK manual, safety instructions, and local electrical regulations.' AS installation_guide,
  'Keep optics and housings clean, verify alignment and wiring, record diagnostic codes, and validate safety functions before returning equipment to service.' AS maintenance_tips,
  cat_seed.official_url AS datasheet_url,
  NOW() AS created_at,
  NOW() AS updated_at,
  0 AS disable_auto_seo
FROM (
  SELECT
    seed.*,
    TRIM(BOTH '-' FROM LOWER(REGEXP_REPLACE(CONCAT('sick-', seed.sku), '[^0-9A-Za-z]+', '-'))) AS generated_slug
  FROM sick_product_seed seed
) seed
JOIN sick_category_seed cat_seed ON cat_seed.slug = seed.category_slug
JOIN categories c ON c.slug = seed.category_slug
JOIN categories parent ON parent.id = c.parent_id AND parent.slug = 'sick'
LEFT JOIN products existing_sku ON existing_sku.sku = seed.sku
LEFT JOIN products existing_slug ON existing_slug.slug = seed.generated_slug
WHERE existing_sku.id IS NULL
  AND existing_slug.id IS NULL;

SET @inserted_sick_products = ROW_COUNT();

SELECT
  @changed_sick_categories AS changed_categories,
  @normalized_sick_products AS normalized_existing_products,
  @inserted_sick_products AS inserted_products,
  (SELECT COUNT(*) FROM sick_category_seed) AS seed_categories,
  (SELECT COUNT(*) FROM sick_product_seed) AS seed_products;

SELECT
  c.slug,
  c.name,
  COUNT(p.id) AS products
FROM categories c
LEFT JOIN products p ON p.category_id = c.id
WHERE c.parent_id = (SELECT id FROM categories WHERE slug = 'sick')
GROUP BY c.id, c.slug, c.name
ORDER BY c.sort_order, c.id;

COMMIT;
