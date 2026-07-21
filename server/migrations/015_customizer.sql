-- Reference SQL for MARKETPLACE_CUSTOMIZER_SPEC.md §3 (P1)
-- Applied via the idempotent CREATE TABLE IF NOT EXISTS path in db.ts.
-- Do NOT run this file directly against production.

-- A Printful blank exposed as a customizable marketplace product.
-- One row per (listing, printful variant). The admin authors the placement geometry.
CREATE TABLE IF NOT EXISTS customizable_products (
  id                  BIGINT PRIMARY KEY AUTO_INCREMENT,
  listing_id          BIGINT NOT NULL,              -- FK marketplace_listings
  printful_product_id INT    NOT NULL,              -- catalogue product
  printful_variant_id INT    NOT NULL,              -- specific variant (size/colour)
  placement           VARCHAR(32) NOT NULL DEFAULT 'default', -- front/back/…
  -- Print-file spec cached from Printful, governs composite resolution.
  printfile_width_px  INT    NOT NULL,
  printfile_height_px INT    NOT NULL,
  printfile_dpi       INT    NOT NULL DEFAULT 150,
  -- Admin-defined box the buyer photo fills, in FRACTIONS of the print file
  -- (0..1) so it is resolution-independent. This is the "pre-placed template".
  box_x               DECIMAL(6,5) NOT NULL,
  box_y               DECIMAL(6,5) NOT NULL,
  box_w               DECIMAL(6,5) NOT NULL,
  box_h               DECIMAL(6,5) NOT NULL,
  box_shape           ENUM('rect','circle','arch') NOT NULL DEFAULT 'rect',
  -- Optional fixed overlay art placed above/below the photo (logos, frames).
  overlay_asset_uuid  CHAR(36) NULL,
  retail_price_cents  INT    NOT NULL,              -- what the buyer pays
  status              ENUM('draft','published','archived') NOT NULL DEFAULT 'draft',
  created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_custprod_listing (listing_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- One buyer customisation → one fulfilment lifecycle. Mirrors pawprint_print_orders.
CREATE TABLE IF NOT EXISTS customize_orders (
  id                    BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_phone            VARCHAR(32) NOT NULL,
  customizable_id       BIGINT NOT NULL,              -- FK customizable_products
  source_photo_url      TEXT   NOT NULL,              -- buyer upload / FurBin asset
  source_kind           ENUM('upload','furbin') NOT NULL,
  print_file_url        TEXT   NULL,                  -- composited, hosted in B2
  recipient_json        JSON   NOT NULL,              -- shipping address
  retail_price_cents    INT    NOT NULL,
  checkout_url          TEXT   NULL,                  -- Stripe checkout URL (cached)
  stripe_session_id     VARCHAR(255) NULL,
  provider_order_id     VARCHAR(64)  NULL,            -- Printful draft/live id
  provider_payload_json JSON   NULL,
  status ENUM('draft','awaiting_payment','payment_received','submitting',
              'submitted','failed','refunded') NOT NULL DEFAULT 'draft',
  idempotency_key       VARCHAR(128) NOT NULL,
  created_at            TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at            TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_custorder_idem (user_phone, idempotency_key),
  INDEX idx_custorder_status (status),
  INDEX idx_custorder_user (user_phone, created_at DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
