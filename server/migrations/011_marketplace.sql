-- 011_marketplace.sql
-- Marketplace catalog, versioned assets, digital orders, and entitlements.
-- Also widens print_orders.source_type so marketplace listings can be printed
-- through the existing Slant 3D fulfillment path.
--
-- Mirrored by guarded idempotent DDL in db.ts (initDb). This file is the
-- migration record; db.ts is what actually runs on boot.
--
-- Ref: IMPLEMENTATION_SPEC.md §4.3

-- ---------------------------------------------------------------------------
-- Listings: catalog metadata, pricing, publication state.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS marketplace_listings (
  id                    BIGINT AUTO_INCREMENT PRIMARY KEY,
  uuid                  CHAR(36)     NOT NULL,
  slug                  VARCHAR(140) NOT NULL,
  name                  VARCHAR(160) NOT NULL,
  breed                 VARCHAR(120) NULL,
  category              ENUM('breed','memorial','accessories','seasonal') NOT NULL,
  description           TEXT         NULL,
  tags_json             JSON         NULL,
  dimensions_json       JSON         NULL,   -- {x_mm, y_mm, z_mm}
  print_notes           TEXT         NULL,
  -- NULL disables digital download for this listing.
  digital_price_cents   INT          NULL,
  physical_enabled      TINYINT(1)   NOT NULL DEFAULT 0,
  print_size_min_mm     DECIMAL(8,2) NULL,
  print_size_max_mm     DECIMAL(8,2) NULL,
  status                ENUM('draft','published','archived') NOT NULL DEFAULT 'draft',
  sort_order            INT          NOT NULL DEFAULT 0,
  created_by            VARCHAR(32)  NOT NULL,
  created_at            TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  updated_at            TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_marketplace_uuid (uuid),
  UNIQUE KEY uniq_marketplace_slug (slug),
  INDEX idx_marketplace_status_sort (status, sort_order),
  INDEX idx_marketplace_category (category),
  -- RESTRICT, not CASCADE: deleting an admin must never delete the catalog.
  CONSTRAINT fk_marketplace_creator FOREIGN KEY (created_by)
    REFERENCES users(phone) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------------
-- Assets: versioned Backblaze objects belonging to a listing.
--
-- `bucket` records WHICH bucket the object lives in. On Backblaze that is the
-- entire access-control decision (no per-object ACLs), so it is data, not a hint.
-- Replacing a file inserts a new row with version+1 and marks the old one
-- 'superseded' — the old object is never deleted, so entitlements keep resolving
-- to the exact version that was purchased.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS marketplace_assets (
  id                BIGINT AUTO_INCREMENT PRIMARY KEY,
  listing_id        BIGINT       NOT NULL,
  asset_uuid        CHAR(36)     NOT NULL,
  kind              ENUM('source_glb','preview_image','stl_derivative') NOT NULL,
  bucket            ENUM('public','private') NOT NULL,
  object_key        VARCHAR(512) NOT NULL,
  mime_type         VARCHAR(120) NOT NULL,
  size_bytes        BIGINT       NOT NULL,
  sha256            CHAR(64)     NOT NULL,
  version           INT          NOT NULL DEFAULT 1,
  status            ENUM('active','superseded') NOT NULL DEFAULT 'active',
  sort_order        INT          NOT NULL DEFAULT 0,
  -- Height bucket in mm for cached STL derivatives; NULL for other kinds.
  derivative_height_mm DECIMAL(8,2) NULL,
  -- Provenance, populated when an asset is ingested from a third party.
  -- Present from the start so Sketchfab ingest needs no later migration.
  source_provider   ENUM('original','sketchfab') NOT NULL DEFAULT 'original',
  source_url        VARCHAR(512) NULL,
  source_author     VARCHAR(190) NULL,
  source_license    VARCHAR(40)  NULL,   -- 'CC0', 'CC-BY-4.0', ...
  attribution_text  VARCHAR(500) NULL,
  created_at        TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_marketplace_asset_uuid (asset_uuid),
  UNIQUE KEY uniq_marketplace_object_key (object_key),
  INDEX idx_marketplace_asset_listing (listing_id, kind, status, sort_order),
  CONSTRAINT fk_marketplace_asset_listing FOREIGN KEY (listing_id)
    REFERENCES marketplace_listings(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------------
-- Digital orders: Stripe state for download purchases.
-- asset_id pins the exact version bought, so a later file replacement cannot
-- retroactively change what a customer paid for.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS marketplace_digital_orders (
  id                    BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_phone            VARCHAR(32)  NOT NULL,
  listing_id            BIGINT       NOT NULL,
  asset_id              BIGINT       NOT NULL,
  price_cents           INT          NOT NULL,
  currency              CHAR(3)      NOT NULL DEFAULT 'usd',
  stripe_session_id     VARCHAR(128) NULL,
  stripe_payment_intent VARCHAR(128) NULL,
  idempotency_key       VARCHAR(128) NOT NULL,
  status                VARCHAR(40)  NOT NULL DEFAULT 'awaiting_payment',
  created_at            TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  updated_at            TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  -- Mirrors the print_orders idempotency contract: a retried checkout with the
  -- same key resumes rather than creating a second charge.
  UNIQUE KEY uniq_marketplace_digital_idem (user_phone, idempotency_key),
  INDEX idx_marketplace_digital_user (user_phone),
  INDEX idx_marketplace_digital_session (stripe_session_id),
  CONSTRAINT fk_marketplace_digital_user FOREIGN KEY (user_phone)
    REFERENCES users(phone) ON DELETE CASCADE,
  CONSTRAINT fk_marketplace_digital_listing FOREIGN KEY (listing_id)
    REFERENCES marketplace_listings(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------------
-- Entitlements: proof a user may download an asset.
--
-- The UNIQUE key is what makes webhook delivery safe. Stripe retries
-- checkout.session.completed on any non-2xx, so the handler uses
--   INSERT ... ON DUPLICATE KEY UPDATE id = id
-- and a replayed event is a no-op instead of a duplicate grant or a 500.
--
-- Revocation sets revoked_at rather than deleting, so refunds stay auditable.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS marketplace_entitlements (
  id                BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_phone        VARCHAR(32) NOT NULL,
  listing_id        BIGINT      NOT NULL,
  asset_id          BIGINT      NOT NULL,
  digital_order_id  BIGINT      NULL,
  granted_reason    ENUM('purchase','admin_grant','refund_reversal') NOT NULL DEFAULT 'purchase',
  revoked_at        TIMESTAMP   NULL,
  created_at        TIMESTAMP   DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_marketplace_entitlement (user_phone, listing_id, asset_id),
  INDEX idx_marketplace_entitlement_user (user_phone),
  CONSTRAINT fk_marketplace_ent_user FOREIGN KEY (user_phone)
    REFERENCES users(phone) ON DELETE CASCADE,
  CONSTRAINT fk_marketplace_ent_listing FOREIGN KEY (listing_id)
    REFERENCES marketplace_listings(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------------
-- Fido's Styles workspace persistence. Replaces localStorage-only saves.
-- Generation history is NOT duplicated here — it is read from hermes_jobs
-- filtered on job_type='looks' AND owner_key=user_phone.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fidos_projects (
  id                BIGINT       AUTO_INCREMENT PRIMARY KEY,
  user_phone        VARCHAR(32)  NOT NULL,
  avatar_id         INT          NULL,
  name              VARCHAR(160) NOT NULL,
  prompt            TEXT         NULL,
  wardrobe_json     JSON         NULL,   -- selected item ids, max 15, server-validated
  settings_json     JSON         NULL,   -- lighting, camera, materials
  quality_tier      ENUM('draft','standard','studio') NOT NULL DEFAULT 'standard',
  created_at        TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_fidos_user (user_phone, updated_at),
  CONSTRAINT fk_fidos_user FOREIGN KEY (user_phone)
    REFERENCES users(phone) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------------
-- Widen print_orders.source_type for marketplace listings.
-- Additive only: no existing row changes meaning, and every current read path
-- filters source_type explicitly. This lets marketplace prints reuse the
-- existing slant3d_print_order webhook branch rather than adding a parallel one.
-- ---------------------------------------------------------------------------
ALTER TABLE print_orders
  MODIFY COLUMN source_type ENUM('creation','avatar','marketplace_listing') NOT NULL;
