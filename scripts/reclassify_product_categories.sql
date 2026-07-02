-- Reclassify existing products into the current type-based category tree.
-- Target database: MySQL 8.x.

DROP TEMPORARY TABLE IF EXISTS product_reclassification_preview;

CREATE TEMPORARY TABLE product_reclassification_preview AS
SELECT
  base.id,
  base.current_category_id,
  base.current_slug,
  base.brand,
  base.brand_key,
  base.model_key,
  base.name_key,
  base.fanuc_like,
  CASE
    WHEN base.fanuc_like = 0 THEN base.current_slug
    WHEN base.model_key REGEXP '^A05B' OR base.model_key REGEXP '^18-MB' OR base.name_key LIKE '%OPERATOR PANEL%' OR base.name_key LIKE '%TEACH PENDANT%' OR base.name_key LIKE '%MDI%' THEN 'fanuc-operator-panel-mdi'
    WHEN base.name_key LIKE '%SPINDLE AMPLIFIER%' OR base.name_key LIKE '%SPINDLE DRIVE%' THEN 'fanuc-spindle-amplifier-drive'
    WHEN base.model_key REGEXP '^A61L' OR base.name_key LIKE '%DISPLAY%' OR base.name_key LIKE '%MONITOR%' OR base.name_key LIKE '%CRT%' OR base.name_key LIKE '%LCD%' THEN 'fanuc-display-monitor'
    WHEN base.model_key REGEXP '^A860' OR base.name_key LIKE '%ENCODER%' OR base.name_key LIKE '%PULSE CODER%' OR base.name_key LIKE '%PULSECODER%' THEN 'fanuc-encoder-feedback'
    WHEN base.model_key REGEXP '^(A660|A66L|CAB|CABLE|CONNECTOR|CONN)' OR base.name_key LIKE '%CABLE / CONNECTOR%' OR base.name_key LIKE '%CONNECTOR%' OR base.name_key LIKE '%HARNESS%' THEN 'fanuc-cables-connectors'
    WHEN base.model_key REGEXP '^A90L' OR base.name_key LIKE '% FAN %' OR base.name_key LIKE '%FILTER%' OR base.name_key LIKE '%COOL%' THEN 'fanuc-filters-fan-unit-cooling'
    WHEN base.name_key LIKE '%BATTERY%' THEN 'fanuc-battery'
    WHEN base.model_key REGEXP '^(A14B|A50L|A58L|A60L)' OR base.name_key LIKE '%POWER SUPPLY%' OR base.name_key LIKE '%FUSE%' OR base.name_key LIKE '%TRANSISTOR%' THEN 'fanuc-power-supply'
    WHEN base.model_key REGEXP '^(A03B|A04B)' OR base.name_key LIKE '%I/O MODULE%' OR base.name_key LIKE '% IO MODULE%' THEN 'fanuc-i-o-module'
    WHEN base.model_key REGEXP '^A06B-6' OR base.name_key LIKE '%SERVO AMPLIFIER%' OR base.name_key LIKE '%SERVO DRIVE%' OR base.name_key LIKE '%SERVO DRIVER%' THEN 'fanuc-servo-amplifier-drive'
    WHEN base.model_key REGEXP '^A06B-(0[78]|1[0-8])' OR base.name_key LIKE '%SPINDLE MOTOR%' THEN 'fanuc-spindle-motor'
    WHEN base.model_key REGEXP '^A06B' OR base.name_key LIKE '%SERVO MOTOR%' THEN 'fanuc-servo-motor'
    WHEN base.model_key REGEXP '^(A87L|A48L)' OR base.name_key LIKE '%MEMORY%' OR base.name_key LIKE '%STORAGE%' THEN 'fanuc-memory-storage'
    WHEN base.model_key REGEXP '^(A02B|A15B|A15L|A16B|A17B|A18B|A20B|F02B)' OR base.name_key LIKE '%PCB BOARD%' OR base.name_key LIKE '%CONTROL BOARD%' OR base.name_key LIKE '%MAIN BOARD%' OR base.name_key LIKE '%CPU BOARD%' THEN 'fanuc-pcb-control-board'
    WHEN base.model_key REGEXP '^(A08B|A13B|A230|A250|A300|A370|A980|A990|A028)' OR base.name_key LIKE '%CONTROL UNIT%' OR base.name_key LIKE '%CONTROLLER%' OR base.name_key LIKE '%CNC SYSTEM%' THEN 'fanuc-cnc-system-parts'
    ELSE 'fanuc-accessories-others'
  END AS target_slug
FROM (
  SELECT
    p.id,
    p.category_id AS current_category_id,
    c.slug AS current_slug,
    p.brand,
    UPPER(TRIM(COALESCE(p.brand, ''))) AS brand_key,
    UPPER(TRIM(COALESCE(NULLIF(TRIM(p.model), ''), NULLIF(TRIM(p.part_number), ''), NULLIF(TRIM(p.sku), ''), ''))) AS model_key,
    UPPER(TRIM(COALESCE(p.name, ''))) AS name_key,
    CASE
      WHEN UPPER(TRIM(COALESCE(p.brand, ''))) IN ('MITSUBISHI', 'MISUBISHI', 'MELSEC') THEN 0
      WHEN UPPER(TRIM(COALESCE(p.name, ''))) LIKE '%MITSUBISHI%' THEN 0
      WHEN UPPER(TRIM(COALESCE(p.brand, ''))) = 'FANUC' THEN 1
      WHEN UPPER(TRIM(COALESCE(p.brand, ''))) = 'UNKNOWN'
        AND UPPER(TRIM(COALESCE(NULLIF(TRIM(p.model), ''), NULLIF(TRIM(p.part_number), ''), NULLIF(TRIM(p.sku), ''), ''))) REGEXP '^(A0[234568]B|A1[34657]B|A20B|A230|A250|A290|A300|A370|A[0-9]{2}L|A660|A860|A980|A990|F0?6B|F660|CAB|CABLE|CONNECTOR|CONN|18-MB)' THEN 1
      WHEN UPPER(TRIM(COALESCE(p.brand, ''))) = ''
        AND UPPER(TRIM(COALESCE(NULLIF(TRIM(p.model), ''), NULLIF(TRIM(p.part_number), ''), NULLIF(TRIM(p.sku), ''), ''))) REGEXP '^(A0[234568]B|A1[34657]B|A20B|A230|A250|A290|A300|A370|A[0-9]{2}L|A660|A860|A980|A990|F0?6B|F660|CAB|CABLE|CONNECTOR|CONN|18-MB)' THEN 1
      WHEN UPPER(TRIM(COALESCE(p.name, ''))) LIKE '%FANUC%' THEN 1
      WHEN c.slug = 'fanuc' OR c.slug LIKE 'fanuc-%' THEN 1
      ELSE 0
    END AS fanuc_like
  FROM products p
  LEFT JOIN categories c ON c.id = p.category_id
) base;

SELECT
  'target_distribution' AS report,
  pr.target_slug,
  c.name AS target_category,
  COUNT(*) AS products
FROM product_reclassification_preview pr
LEFT JOIN categories c ON c.slug = pr.target_slug
GROUP BY pr.target_slug, c.name
ORDER BY products DESC, pr.target_slug;

SELECT
  'category_moves' AS report,
  COALESCE(pr.current_slug, '(none)') AS current_slug,
  pr.target_slug,
  COUNT(*) AS products
FROM product_reclassification_preview pr
WHERE COALESCE(pr.current_slug, '') <> COALESCE(pr.target_slug, '')
GROUP BY pr.current_slug, pr.target_slug
ORDER BY products DESC, pr.current_slug, pr.target_slug;

UPDATE products p
JOIN product_reclassification_preview pr ON pr.id = p.id
JOIN categories target_category ON target_category.slug = pr.target_slug
SET
  p.category_id = target_category.id,
  p.brand = CASE
    WHEN pr.fanuc_like = 1 AND (TRIM(COALESCE(p.brand, '')) = '' OR UPPER(TRIM(COALESCE(p.brand, ''))) IN ('UNKNOWN', 'FANUC')) THEN 'FANUC'
    WHEN UPPER(TRIM(COALESCE(p.brand, ''))) = 'MISUBISHI' THEN 'Mitsubishi'
    ELSE p.brand
  END,
  p.updated_at = NOW()
WHERE
  p.category_id <> target_category.id
  OR (pr.fanuc_like = 1 AND (TRIM(COALESCE(p.brand, '')) = '' OR UPPER(TRIM(COALESCE(p.brand, ''))) = 'UNKNOWN' OR (UPPER(TRIM(COALESCE(p.brand, ''))) = 'FANUC' AND p.brand <> 'FANUC')))
  OR UPPER(TRIM(COALESCE(p.brand, ''))) = 'MISUBISHI';

SELECT ROW_COUNT() AS updated_products;

SELECT
  c.id,
  c.name,
  c.slug,
  COUNT(p.id) AS products
FROM categories c
LEFT JOIN products p ON p.category_id = c.id
GROUP BY c.id, c.name, c.slug, c.parent_id, c.sort_order
ORDER BY c.parent_id IS NOT NULL, c.parent_id, c.sort_order, c.id;
