-- Seed representative Mitsubishi Electric products into the existing Mitsubishi category tree.
-- Safe to run repeatedly: products are matched by SKU/slug and existing rows are skipped.

START TRANSACTION;

DROP TEMPORARY TABLE IF EXISTS mitsubishi_product_seed;
CREATE TEMPORARY TABLE mitsubishi_product_seed (
  category_slug VARCHAR(100) NOT NULL,
  sku VARCHAR(100) NOT NULL,
  series_name VARCHAR(120) NOT NULL,
  product_type VARCHAR(160) NOT NULL,
  price DECIMAL(10,2) NOT NULL,
  stock_quantity BIGINT NOT NULL DEFAULT 1,
  PRIMARY KEY (sku)
) ENGINE=MEMORY;

INSERT INTO mitsubishi_product_seed
  (category_slug, sku, series_name, product_type, price, stock_quantity)
VALUES
  ('a-series', 'A1SJCPU', 'MELSEC-A Series', 'A Series PLC CPU module', 260.00, 1),
  ('a-series', 'A1SJHCPU-S8', 'MELSEC-A Series', 'A Series PLC CPU module', 320.00, 1),
  ('a-series', 'A2CCPU', 'MELSEC-A Series', 'A Series PLC CPU module', 420.00, 1),
  ('a-series', 'A2NCPUP21', 'MELSEC-A Series', 'A Series PLC CPU module', 680.00, 1),
  ('a-series', 'A3ACPU', 'MELSEC-A Series', 'A Series PLC CPU module', 520.00, 1),
  ('a-series', 'A3UCPU', 'MELSEC-A Series', 'A Series PLC CPU module', 720.00, 1),
  ('a-series', 'A61P', 'MELSEC-A Series', 'A Series power supply module', 180.00, 1),
  ('a-series', 'A62P', 'MELSEC-A Series', 'A Series power supply module', 210.00, 1),
  ('a-series', 'A68B', 'MELSEC-A Series', 'A Series base unit', 240.00, 1),
  ('a-series', 'A1SX40', 'MELSEC-A Series', 'A Series digital input module', 120.00, 1),
  ('a-series', 'A1SX41', 'MELSEC-A Series', 'A Series digital input module', 140.00, 1),
  ('a-series', 'A1SY40', 'MELSEC-A Series', 'A Series digital output module', 130.00, 1),

  ('fx-series', 'FX1N-24MR-ES/UL', 'MELSEC-F FX Series', 'FX Series compact PLC main unit', 180.00, 1),
  ('fx-series', 'FX1N-40MR-ES/UL', 'MELSEC-F FX Series', 'FX Series compact PLC main unit', 240.00, 1),
  ('fx-series', 'FX2N-32MR-ES/UL', 'MELSEC-F FX Series', 'FX Series compact PLC main unit', 260.00, 1),
  ('fx-series', 'FX2N-48MR-ES/UL', 'MELSEC-F FX Series', 'FX Series compact PLC main unit', 340.00, 1),
  ('fx-series', 'FX3U-16MR/ES-A', 'MELSEC-F FX Series', 'FX Series compact PLC main unit', 290.00, 1),
  ('fx-series', 'FX3U-32MR/ES-A', 'MELSEC-F FX Series', 'FX Series compact PLC main unit', 420.00, 1),
  ('fx-series', 'FX3U-64MR/ES-A', 'MELSEC-F FX Series', 'FX Series compact PLC main unit', 680.00, 1),
  ('fx-series', 'FX3G-24MR/ES-A', 'MELSEC-F FX Series', 'FX Series compact PLC main unit', 260.00, 1),
  ('fx-series', 'FX5U-32MR/ES', 'MELSEC iQ-F / FX Series', 'FX5U compact PLC CPU module', 520.00, 1),
  ('fx-series', 'FX5U-64MR/ES', 'MELSEC iQ-F / FX Series', 'FX5U compact PLC CPU module', 820.00, 1),
  ('fx-series', 'FX5UC-32MT/D', 'MELSEC iQ-F / FX Series', 'FX5UC compact PLC CPU module', 620.00, 1),
  ('fx-series', 'FX5-16EX/ES', 'MELSEC iQ-F / FX Series', 'FX Series input extension module', 150.00, 1),

  ('melservo-hc', 'HC-KFS13', 'MELSERVO HC Series', 'HC low-inertia servo motor', 280.00, 1),
  ('melservo-hc', 'HC-KFS23', 'MELSERVO HC Series', 'HC low-inertia servo motor', 320.00, 1),
  ('melservo-hc', 'HC-KFS43', 'MELSERVO HC Series', 'HC low-inertia servo motor', 410.00, 1),
  ('melservo-hc', 'HC-KFS73', 'MELSERVO HC Series', 'HC low-inertia servo motor', 560.00, 1),
  ('melservo-hc', 'HC-MFS13', 'MELSERVO HC Series', 'HC ultra-low inertia servo motor', 300.00, 1),
  ('melservo-hc', 'HC-MFS23', 'MELSERVO HC Series', 'HC ultra-low inertia servo motor', 360.00, 1),
  ('melservo-hc', 'HC-MFS43', 'MELSERVO HC Series', 'HC ultra-low inertia servo motor', 480.00, 1),
  ('melservo-hc', 'HC-SFS52', 'MELSERVO HC Series', 'HC medium-inertia servo motor', 650.00, 1),
  ('melservo-hc', 'HC-SFS102', 'MELSERVO HC Series', 'HC medium-inertia servo motor', 780.00, 1),
  ('melservo-hc', 'HC-SFS152', 'MELSERVO HC Series', 'HC medium-inertia servo motor', 980.00, 1),
  ('melservo-hc', 'HC-RFS103', 'MELSERVO HC Series', 'HC low-inertia medium-capacity servo motor', 920.00, 1),
  ('melservo-hc', 'HC-UFS72', 'MELSERVO HC Series', 'HC flat servo motor', 720.00, 1),

  ('hf-series', 'HF-KP13', 'MELSERVO HF Series', 'HF low-inertia servo motor', 320.00, 1),
  ('hf-series', 'HF-KP23', 'MELSERVO HF Series', 'HF low-inertia servo motor', 380.00, 1),
  ('hf-series', 'HF-KP43', 'MELSERVO HF Series', 'HF low-inertia servo motor', 480.00, 1),
  ('hf-series', 'HF-KP73', 'MELSERVO HF Series', 'HF low-inertia servo motor', 620.00, 1),
  ('hf-series', 'HF-MP13', 'MELSERVO HF Series', 'HF ultra-low inertia servo motor', 340.00, 1),
  ('hf-series', 'HF-MP23', 'MELSERVO HF Series', 'HF ultra-low inertia servo motor', 400.00, 1),
  ('hf-series', 'HF-MP43', 'MELSERVO HF Series', 'HF ultra-low inertia servo motor', 520.00, 1),
  ('hf-series', 'HF-SP52', 'MELSERVO HF Series', 'HF medium-inertia servo motor', 760.00, 1),
  ('hf-series', 'HF-SP102', 'MELSERVO HF Series', 'HF medium-inertia servo motor', 880.00, 1),
  ('hf-series', 'HF-SP152', 'MELSERVO HF Series', 'HF medium-inertia servo motor', 1180.00, 1),
  ('hf-series', 'HF-JP103', 'MELSERVO HF Series', 'HF low-inertia medium-capacity servo motor', 950.00, 1),
  ('hf-series', 'HF-JP203', 'MELSERVO HF Series', 'HF low-inertia medium-capacity servo motor', 1450.00, 1),

  ('hg-series', 'HG-KR13', 'MELSERVO HG Series', 'HG low-inertia servo motor', 360.00, 1),
  ('hg-series', 'HG-KR23', 'MELSERVO HG Series', 'HG low-inertia servo motor', 430.00, 1),
  ('hg-series', 'HG-KR43', 'MELSERVO HG Series', 'HG low-inertia servo motor', 540.00, 1),
  ('hg-series', 'HG-KR73', 'MELSERVO HG Series', 'HG low-inertia servo motor', 690.00, 1),
  ('hg-series', 'HG-MR13', 'MELSERVO HG Series', 'HG ultra-low inertia servo motor', 380.00, 1),
  ('hg-series', 'HG-MR23', 'MELSERVO HG Series', 'HG ultra-low inertia servo motor', 450.00, 1),
  ('hg-series', 'HG-MR43', 'MELSERVO HG Series', 'HG ultra-low inertia servo motor', 580.00, 1),
  ('hg-series', 'HG-SR52', 'MELSERVO HG Series', 'HG medium-inertia servo motor', 820.00, 1),
  ('hg-series', 'HG-SR102', 'MELSERVO HG Series', 'HG medium-inertia servo motor', 980.00, 1),
  ('hg-series', 'HG-SR152', 'MELSERVO HG Series', 'HG medium-inertia servo motor', 1280.00, 1),
  ('hg-series', 'HG-JR103', 'MELSERVO HG Series', 'HG low-inertia medium-capacity servo motor', 1050.00, 1),
  ('hg-series', 'HG-JR203', 'MELSERVO HG Series', 'HG low-inertia medium-capacity servo motor', 1650.00, 1),

  ('melservo-mr-j2', 'MR-J2S-10A', 'MELSERVO MR-J2 Series', 'MR-J2S general-purpose servo amplifier', 450.00, 1),
  ('melservo-mr-j2', 'MR-J2S-20A', 'MELSERVO MR-J2 Series', 'MR-J2S general-purpose servo amplifier', 520.00, 1),
  ('melservo-mr-j2', 'MR-J2S-40A', 'MELSERVO MR-J2 Series', 'MR-J2S general-purpose servo amplifier', 640.00, 1),
  ('melservo-mr-j2', 'MR-J2S-70A', 'MELSERVO MR-J2 Series', 'MR-J2S general-purpose servo amplifier', 780.00, 1),
  ('melservo-mr-j2', 'MR-J2S-100A', 'MELSERVO MR-J2 Series', 'MR-J2S general-purpose servo amplifier', 920.00, 1),
  ('melservo-mr-j2', 'MR-J2S-200A', 'MELSERVO MR-J2 Series', 'MR-J2S general-purpose servo amplifier', 1280.00, 1),
  ('melservo-mr-j2', 'MR-J2S-350A', 'MELSERVO MR-J2 Series', 'MR-J2S general-purpose servo amplifier', 1680.00, 1),
  ('melservo-mr-j2', 'MR-J2S-500A', 'MELSERVO MR-J2 Series', 'MR-J2S general-purpose servo amplifier', 2100.00, 1),
  ('melservo-mr-j2', 'MR-J2S-700A', 'MELSERVO MR-J2 Series', 'MR-J2S general-purpose servo amplifier', 2400.00, 1),
  ('melservo-mr-j2', 'MR-J2S-10B', 'MELSERVO MR-J2 Series', 'MR-J2S SSCNET servo amplifier', 470.00, 1),
  ('melservo-mr-j2', 'MR-J2S-20B', 'MELSERVO MR-J2 Series', 'MR-J2S SSCNET servo amplifier', 540.00, 1),
  ('melservo-mr-j2', 'MR-J2S-40B', 'MELSERVO MR-J2 Series', 'MR-J2S SSCNET servo amplifier', 660.00, 1),

  ('freqrol-fr', 'FR-A840-00023-2-60', 'FREQROL FR Series', 'FR-A800 inverter drive', 520.00, 1),
  ('freqrol-fr', 'FR-A840-00038-2-60', 'FREQROL FR Series', 'FR-A800 inverter drive', 650.00, 1),
  ('freqrol-fr', 'FR-A840-00052-2-60', 'FREQROL FR Series', 'FR-A800 inverter drive', 760.00, 1),
  ('freqrol-fr', 'FR-A840-00083-2-60', 'FREQROL FR Series', 'FR-A800 inverter drive', 920.00, 1),
  ('freqrol-fr', 'FR-A840-00126-2-60', 'FREQROL FR Series', 'FR-A800 inverter drive', 1180.00, 1),
  ('freqrol-fr', 'FR-A840-00250-2-60', 'FREQROL FR Series', 'FR-A800 inverter drive', 1780.00, 1),
  ('freqrol-fr', 'FR-F840-00023-2-60', 'FREQROL FR Series', 'FR-F800 inverter drive', 480.00, 1),
  ('freqrol-fr', 'FR-F840-00038-2-60', 'FREQROL FR Series', 'FR-F800 inverter drive', 610.00, 1),
  ('freqrol-fr', 'FR-F840-00083-2-60', 'FREQROL FR Series', 'FR-F800 inverter drive', 850.00, 1),
  ('freqrol-fr', 'FR-E840-0016-4-60', 'FREQROL FR Series', 'FR-E800 inverter drive', 310.00, 1),
  ('freqrol-fr', 'FR-E840-0026-4-60', 'FREQROL FR Series', 'FR-E800 inverter drive', 370.00, 1),
  ('freqrol-fr', 'FR-E840-0040-4-60', 'FREQROL FR Series', 'FR-E800 inverter drive', 460.00, 1),

  ('melservo-mr-j3', 'MR-J3-10A', 'MELSERVO MR-J3 Series', 'MR-J3 general-purpose servo amplifier', 520.00, 1),
  ('melservo-mr-j3', 'MR-J3-20A', 'MELSERVO MR-J3 Series', 'MR-J3 general-purpose servo amplifier', 590.00, 1),
  ('melservo-mr-j3', 'MR-J3-40A', 'MELSERVO MR-J3 Series', 'MR-J3 general-purpose servo amplifier', 720.00, 1),
  ('melservo-mr-j3', 'MR-J3-70A', 'MELSERVO MR-J3 Series', 'MR-J3 general-purpose servo amplifier', 860.00, 1),
  ('melservo-mr-j3', 'MR-J3-100A', 'MELSERVO MR-J3 Series', 'MR-J3 general-purpose servo amplifier', 1020.00, 1),
  ('melservo-mr-j3', 'MR-J3-200A', 'MELSERVO MR-J3 Series', 'MR-J3 general-purpose servo amplifier', 1420.00, 1),
  ('melservo-mr-j3', 'MR-J3-350A', 'MELSERVO MR-J3 Series', 'MR-J3 general-purpose servo amplifier', 1860.00, 1),
  ('melservo-mr-j3', 'MR-J3-500A', 'MELSERVO MR-J3 Series', 'MR-J3 general-purpose servo amplifier', 2260.00, 1),
  ('melservo-mr-j3', 'MR-J3-700A', 'MELSERVO MR-J3 Series', 'MR-J3 general-purpose servo amplifier', 2600.00, 1),
  ('melservo-mr-j3', 'MR-J3-10B', 'MELSERVO MR-J3 Series', 'MR-J3 SSCNET III servo amplifier', 540.00, 1),
  ('melservo-mr-j3', 'MR-J3-20B', 'MELSERVO MR-J3 Series', 'MR-J3 SSCNET III servo amplifier', 610.00, 1),
  ('melservo-mr-j3', 'MR-J3-40B', 'MELSERVO MR-J3 Series', 'MR-J3 SSCNET III servo amplifier', 740.00, 1),

  ('melsec-q', 'Q00JCPU', 'MELSEC-Q Series', 'Q Series PLC CPU module', 260.00, 1),
  ('melsec-q', 'Q00CPU', 'MELSEC-Q Series', 'Q Series PLC CPU module', 300.00, 1),
  ('melsec-q', 'Q01CPU', 'MELSEC-Q Series', 'Q Series PLC CPU module', 360.00, 1),
  ('melsec-q', 'Q02HCPU', 'MELSEC-Q Series', 'Q Series PLC CPU module', 520.00, 1),
  ('melsec-q', 'Q06HCPU', 'MELSEC-Q Series', 'Q Series PLC CPU module', 720.00, 1),
  ('melsec-q', 'Q12HCPU', 'MELSEC-Q Series', 'Q Series PLC CPU module', 860.00, 1),
  ('melsec-q', 'Q25HCPU', 'MELSEC-Q Series', 'Q Series PLC CPU module', 980.00, 1),
  ('melsec-q', 'Q61P', 'MELSEC-Q Series', 'Q Series power supply module', 160.00, 1),
  ('melsec-q', 'Q62P', 'MELSEC-Q Series', 'Q Series power supply module', 180.00, 1),
  ('melsec-q', 'Q35B', 'MELSEC-Q Series', 'Q Series base unit', 180.00, 1),
  ('melsec-q', 'Q38B', 'MELSEC-Q Series', 'Q Series base unit', 220.00, 1),
  ('melsec-q', 'QX40', 'MELSEC-Q Series', 'Q Series digital input module', 150.00, 1),
  ('melsec-q', 'QY40P', 'MELSEC-Q Series', 'Q Series transistor output module', 170.00, 1),
  ('melsec-q', 'Q64AD', 'MELSEC-Q Series', 'Q Series analog input module', 420.00, 1),
  ('melsec-q', 'Q62DA', 'MELSEC-Q Series', 'Q Series analog output module', 460.00, 1),
  ('melsec-q', 'QJ71E71-100', 'MELSEC-Q Series', 'Q Series Ethernet interface module', 520.00, 1),

  ('mds-servo-drives', 'MDS-D-SVJ3-10', 'MDS CNC Drive Series', 'MDS-D CNC servo drive unit', 900.00, 1),
  ('mds-servo-drives', 'MDS-D-SVJ3-20', 'MDS CNC Drive Series', 'MDS-D CNC servo drive unit', 1150.00, 1),
  ('mds-servo-drives', 'MDS-D-SVJ3-40', 'MDS CNC Drive Series', 'MDS-D CNC servo drive unit', 1450.00, 1),
  ('mds-servo-drives', 'MDS-D-SVJ3-80', 'MDS CNC Drive Series', 'MDS-D CNC servo drive unit', 1900.00, 1),
  ('mds-servo-drives', 'MDS-D2-V1-20', 'MDS CNC Drive Series', 'MDS-D2 CNC servo drive unit', 1250.00, 1),
  ('mds-servo-drives', 'MDS-D2-V1-40', 'MDS CNC Drive Series', 'MDS-D2 CNC servo drive unit', 1600.00, 1),
  ('mds-servo-drives', 'MDS-D2-V2-2020', 'MDS CNC Drive Series', 'MDS-D2 dual-axis CNC servo drive unit', 2300.00, 1),
  ('mds-servo-drives', 'MDS-D2-SP-110', 'MDS CNC Drive Series', 'MDS-D2 CNC spindle drive unit', 3200.00, 1),
  ('mds-servo-drives', 'MDS-DH-CV-185', 'MDS CNC Drive Series', 'MDS-DH CNC converter unit', 2800.00, 1),
  ('mds-servo-drives', 'MDS-C1-V1-20', 'MDS CNC Drive Series', 'MDS-C1 CNC servo drive unit', 950.00, 1),
  ('mds-servo-drives', 'MDS-C1-V2-3520', 'MDS CNC Drive Series', 'MDS-C1 dual-axis CNC servo drive unit', 2100.00, 1),
  ('mds-servo-drives', 'MDS-C1-SP-75', 'MDS CNC Drive Series', 'MDS-C1 CNC spindle drive unit', 2600.00, 1),

  ('got1000', 'GT1020-LBD', 'GOT1000 Series', 'GOT1000 HMI operator terminal', 260.00, 1),
  ('got1000', 'GT1020-LBD2', 'GOT1000 Series', 'GOT1000 HMI operator terminal', 280.00, 1),
  ('got1000', 'GT1030-LBD', 'GOT1000 Series', 'GOT1000 HMI operator terminal', 320.00, 1),
  ('got1000', 'GT1030-HBD', 'GOT1000 Series', 'GOT1000 HMI operator terminal', 360.00, 1),
  ('got1000', 'GT1055-QSBD', 'GOT1000 Series', 'GOT1000 HMI operator terminal', 520.00, 1),
  ('got1000', 'GT1155-QSBD', 'GOT1000 Series', 'GOT1000 HMI operator terminal', 640.00, 1),
  ('got1000', 'GT1150-QLBD', 'GOT1000 Series', 'GOT1000 HMI operator terminal', 580.00, 1),
  ('got1000', 'GT1265-VNBA', 'GOT1000 Series', 'GOT1000 HMI operator terminal', 780.00, 1),
  ('got1000', 'GT1455-QSBD', 'GOT1000 Series', 'GOT1000 HMI operator terminal', 920.00, 1),
  ('got1000', 'GT1555-QSBD', 'GOT1000 Series', 'GOT1000 HMI operator terminal', 1180.00, 1),
  ('got1000', 'GT1575-VNBA', 'GOT1000 Series', 'GOT1000 HMI operator terminal', 1450.00, 1),
  ('got1000', 'GT1675M-STBA', 'GOT1000 Series', 'GOT1000 HMI operator terminal', 1680.00, 1),

  ('melservo-mr-j4', 'MR-J4-10A', 'MELSERVO MR-J4 Series', 'MR-J4 general-purpose servo amplifier', 620.00, 1),
  ('melservo-mr-j4', 'MR-J4-20A', 'MELSERVO MR-J4 Series', 'MR-J4 general-purpose servo amplifier', 700.00, 1),
  ('melservo-mr-j4', 'MR-J4-40A', 'MELSERVO MR-J4 Series', 'MR-J4 general-purpose servo amplifier', 840.00, 1),
  ('melservo-mr-j4', 'MR-J4-70A', 'MELSERVO MR-J4 Series', 'MR-J4 general-purpose servo amplifier', 980.00, 1),
  ('melservo-mr-j4', 'MR-J4-100A', 'MELSERVO MR-J4 Series', 'MR-J4 general-purpose servo amplifier', 1180.00, 1),
  ('melservo-mr-j4', 'MR-J4-200A', 'MELSERVO MR-J4 Series', 'MR-J4 general-purpose servo amplifier', 1580.00, 1),
  ('melservo-mr-j4', 'MR-J4-350A', 'MELSERVO MR-J4 Series', 'MR-J4 general-purpose servo amplifier', 2100.00, 1),
  ('melservo-mr-j4', 'MR-J4-500A', 'MELSERVO MR-J4 Series', 'MR-J4 general-purpose servo amplifier', 2600.00, 1),
  ('melservo-mr-j4', 'MR-J4-700A', 'MELSERVO MR-J4 Series', 'MR-J4 general-purpose servo amplifier', 3200.00, 1),
  ('melservo-mr-j4', 'MR-J4-10B', 'MELSERVO MR-J4 Series', 'MR-J4 SSCNET III/H servo amplifier', 650.00, 1),
  ('melservo-mr-j4', 'MR-J4-20B', 'MELSERVO MR-J4 Series', 'MR-J4 SSCNET III/H servo amplifier', 730.00, 1),
  ('melservo-mr-j4', 'MR-J4-40B', 'MELSERVO MR-J4 Series', 'MR-J4 SSCNET III/H servo amplifier', 870.00, 1);

UPDATE products p
JOIN categories c ON c.id = p.category_id
JOIN categories parent ON parent.id = c.parent_id
SET
  p.manufacturer = 'Mitsubishi Electric',
  p.origin_country = 'Japan',
  p.name = CASE
    WHEN p.name = p.sku THEN CONCAT('Mitsubishi ', p.sku)
    ELSE p.name
  END,
  p.updated_at = NOW()
WHERE parent.slug = 'mitsubishi'
  AND p.brand = 'Mitsubishi'
  AND (
    p.manufacturer IS NULL
    OR p.manufacturer <> 'Mitsubishi Electric'
    OR p.origin_country IS NULL
    OR p.origin_country <> 'Japan'
    OR p.name = p.sku
  );

SET @normalized_mitsubishi_products = ROW_COUNT();

UPDATE products p
JOIN categories c ON c.id = p.category_id
JOIN categories parent ON parent.id = c.parent_id
SET
  p.datasheet_url = CASE
    WHEN c.slug IN ('a-series', 'fx-series', 'melsec-q') THEN 'https://www.mitsubishielectric.com/fa/products/cnt/plc/'
    WHEN c.slug = 'got1000' THEN 'https://www.mitsubishielectric.com/fa/products/hmi/got/'
    WHEN c.slug = 'freqrol-fr' THEN 'https://www.mitsubishielectric.com/fa/products/drv/inv/'
    WHEN c.slug = 'mds-servo-drives' THEN 'https://www.mitsubishielectric.com/fa/products/cnt/cnc/'
    ELSE 'https://www.mitsubishielectric.com/fa/products/drv/servo/'
  END,
  p.updated_at = NOW()
WHERE parent.slug = 'mitsubishi'
  AND p.brand = 'Mitsubishi'
  AND (
    p.datasheet_url IS NULL
    OR p.datasheet_url = ''
    OR p.datasheet_url IN (
      'https://www.mitsubishielectric.com/fa/products/cnt/plca/',
      'https://www.mitsubishielectric.com/fa/products/cnt/plcf/',
      'https://www.mitsubishielectric.com/fa/products/cnt/plcq/'
    )
  );

SET @normalized_datasheet_urls = ROW_COUNT();

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
  CONCAT('Mitsubishi ', seed.sku, ' ', seed.product_type) AS name,
  seed.generated_slug AS slug,
  CONCAT(
    'Mitsubishi ', seed.sku, ' ', seed.product_type,
    ' for industrial automation, CNC maintenance, repair, and replacement.'
  ) AS short_description,
  CONCAT(
    'Mitsubishi ', seed.sku, ' ', seed.product_type, '\n\n',
    seed.sku, ' belongs to the ', seed.series_name,
    ' range and is listed for industrial automation maintenance, retrofit, repair, and replacement projects.\n\n',
    'Key details\n',
    '- Brand: Mitsubishi Electric\n',
    '- Part No.: ', seed.sku, '\n',
    '- Series: ', seed.series_name, '\n',
    '- Type: ', seed.product_type, '\n',
    '- Warranty: 12 months\n',
    '- Lead time: 3-7 days\n',
    '- Shipping: Worldwide\n\n',
    'Compatibility and ordering guidance\n',
    '- Confirm compatibility against the original nameplate, controller, drive, motor, HMI, or machine model.\n',
    '- Send a nameplate photo before ordering if interchangeability confirmation is needed.'
  ) AS description,
  seed.price,
  seed.stock_quantity,
  0 AS min_stock_level,
  'Mitsubishi' AS brand,
  seed.sku AS model,
  seed.sku AS part_number,
  c.id AS category_id,
  1 AS is_active,
  0 AS is_featured,
  CONCAT('Mitsubishi ', seed.sku, ' ', seed.product_type, ' | VIBO CNC') AS meta_title,
  CONCAT(
    'Mitsubishi ', seed.sku, ' ', seed.product_type,
    ' for automation repair and replacement. Compatibility support, 12-month warranty, and worldwide shipping from VIBO CNC.'
  ) AS meta_description,
  CONCAT(
    seed.sku, ', Mitsubishi ', seed.series_name, ', ', seed.product_type,
    ', Mitsubishi Electric, industrial automation parts, VIBO CNC'
  ) AS meta_keywords,
  JSON_ARRAY() AS image_urls,
  '12 months' AS warranty_period,
  CASE
    WHEN seed.category_slug IN ('a-series', 'got1000', 'melservo-hc', 'melservo-mr-j2', 'melservo-mr-j3') THEN 'refurbished'
    ELSE 'new'
  END AS condition_type,
  'Japan' AS origin_country,
  'Mitsubishi Electric' AS manufacturer,
  '3-7 days' AS lead_time,
  1 AS minimum_order_quantity,
  'Standard industrial packaging. Confirm packaging requirements before shipment.' AS packaging_info,
  'Confirm exact approvals and compliance markings by model before ordering.' AS certifications,
  JSON_OBJECT(
    'brand', 'Mitsubishi Electric',
    'series', seed.series_name,
    'type', seed.product_type,
    'model', seed.sku
  ) AS technical_specs,
  CONCAT(
    'Use ', seed.sku,
    ' only with compatible Mitsubishi Electric systems. Match the original part number and machine configuration before replacement.'
  ) AS compatibility_info,
  'Install according to the applicable Mitsubishi Electric manual and local electrical safety rules.' AS installation_guide,
  'Keep the cabinet clean and dry, check connectors and cooling paths, and record fault codes before replacing automation parts.' AS maintenance_tips,
  CASE
    WHEN seed.category_slug IN ('a-series', 'fx-series', 'melsec-q') THEN 'https://www.mitsubishielectric.com/fa/products/cnt/plc/'
    WHEN seed.category_slug = 'got1000' THEN 'https://www.mitsubishielectric.com/fa/products/hmi/got/'
    WHEN seed.category_slug = 'freqrol-fr' THEN 'https://www.mitsubishielectric.com/fa/products/drv/inv/'
    WHEN seed.category_slug = 'mds-servo-drives' THEN 'https://www.mitsubishielectric.com/fa/products/cnt/cnc/'
    ELSE 'https://www.mitsubishielectric.com/fa/products/drv/servo/'
  END AS datasheet_url,
  NOW() AS created_at,
  NOW() AS updated_at,
  0 AS disable_auto_seo
FROM (
  SELECT
    seed.*,
    TRIM(BOTH '-' FROM LOWER(REGEXP_REPLACE(CONCAT('mitsubishi-', seed.sku), '[^0-9A-Za-z]+', '-'))) AS generated_slug
  FROM mitsubishi_product_seed seed
) seed
JOIN categories c ON c.slug = seed.category_slug
JOIN categories parent ON parent.id = c.parent_id AND parent.slug = 'mitsubishi'
LEFT JOIN products existing_sku ON existing_sku.sku = seed.sku
LEFT JOIN products existing_slug ON existing_slug.slug = seed.generated_slug
WHERE existing_sku.id IS NULL
  AND existing_slug.id IS NULL;

SET @inserted_mitsubishi_products = ROW_COUNT();

SELECT
  @normalized_mitsubishi_products AS normalized_existing_products,
  @normalized_datasheet_urls AS normalized_datasheet_urls,
  @inserted_mitsubishi_products AS inserted_products,
  (SELECT COUNT(*) FROM mitsubishi_product_seed) AS seed_rows;

SELECT
  c.slug,
  c.name,
  COUNT(p.id) AS products
FROM categories c
LEFT JOIN products p ON p.category_id = c.id
WHERE c.parent_id = (SELECT id FROM categories WHERE slug = 'mitsubishi')
GROUP BY c.id, c.slug, c.name
ORDER BY c.sort_order, c.id;

COMMIT;
