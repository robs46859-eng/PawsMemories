-- SnapGen tables (Phase 0). Prefix sg_ keeps them isolated from PawsMemories tables.
-- Run once against the existing MySQL database.

CREATE TABLE IF NOT EXISTS sg_tiers (
  code          VARCHAR(24) PRIMARY KEY,
  name          VARCHAR(64) NOT NULL,
  price_cents   INT NOT NULL,
  face_limit    INT NOT NULL DEFAULT 10000,
  pbr           TINYINT(1) NOT NULL DEFAULT 0,
  rig           TINYINT(1) NOT NULL DEFAULT 0,
  texture_res   VARCHAR(8) NOT NULL DEFAULT '1K',
  sort_order    INT NOT NULL DEFAULT 0,
  active        TINYINT(1) NOT NULL DEFAULT 1
);

INSERT INTO sg_tiers (code, name, price_cents, face_limit, pbr, rig, texture_res, sort_order) VALUES
  ('basic',    'Basic',    299,  10000, 0, 0, '1K', 1),
  ('standard', 'Standard', 699,  30000, 0, 0, '2K', 2),
  ('detailed', 'Detailed', 1499, 80000, 1, 0, '4K', 3),
  ('pro',      'Pro',      2999, 120000, 1, 1, '4K', 4)
ON DUPLICATE KEY UPDATE name = VALUES(name);

CREATE TABLE IF NOT EXISTS sg_categories (
  code   VARCHAR(24) PRIMARY KEY,
  name   VARCHAR(64) NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  active TINYINT(1) NOT NULL DEFAULT 1
);

INSERT INTO sg_categories (code, name, sort_order) VALUES
  ('people',    'People',            1),
  ('pets',      'Pets & Animals',    2),
  ('vehicles',  'Vehicles',          3),
  ('objects',   'Objects & Props',   4),
  ('landmarks', 'Landmarks & Scenes',5),
  ('figurines', 'Toys & Figurines',  6)
ON DUPLICATE KEY UPDATE name = VALUES(name);

CREATE TABLE IF NOT EXISTS sg_orders (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  user_key         VARCHAR(32) NOT NULL,
  tier_code        VARCHAR(24) NOT NULL,
  category_code    VARCHAR(24) NOT NULL,
  status           ENUM('pending','processing','completed','failed') NOT NULL DEFAULT 'pending',
  tripo_op         VARCHAR(128) NULL,
  source_image_url TEXT NULL,
  options_json     JSON NULL,
  purchase_token   VARCHAR(512) NULL,
  price_cents      INT NOT NULL,
  is_remake        TINYINT(1) NOT NULL DEFAULT 0,
  original_order_id INT NULL,
  model_url        TEXT NULL,
  progress         INT NOT NULL DEFAULT 0,
  error            TEXT NULL,
  created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_sg_orders_user (user_key),
  INDEX idx_sg_orders_status (status)
);

CREATE TABLE IF NOT EXISTS sg_purchases (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  user_key       VARCHAR(32) NOT NULL,
  platform       ENUM('play','appstore','dev') NOT NULL DEFAULT 'play',
  product_id     VARCHAR(128) NOT NULL,
  purchase_token VARCHAR(512) NOT NULL,
  price_cents    INT NOT NULL DEFAULT 0,
  consumed       TINYINT(1) NOT NULL DEFAULT 0,
  raw_json       JSON NULL,
  created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_sg_purchase_token (purchase_token(191)),
  INDEX idx_sg_purchases_user (user_key)
);

CREATE TABLE IF NOT EXISTS sg_photobooks (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  user_key         VARCHAR(32) NOT NULL,
  order_id         INT NULL,
  source_image_url TEXT NOT NULL,
  background_code  VARCHAR(48) NOT NULL DEFAULT 'studio',
  layout           VARCHAR(24) NOT NULL DEFAULT 'classic',
  kind             ENUM('digital','physical') NOT NULL DEFAULT 'digital',
  status           ENUM('pending','rendering','ready','shipped','failed') NOT NULL DEFAULT 'pending',
  price_cents      INT NOT NULL DEFAULT 499,
  pdf_url          TEXT NULL,
  created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_sg_photobooks_user (user_key)
);
