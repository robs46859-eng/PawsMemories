# Phase 1: Canonical Asset Registry & Storage Accounting Contract Specification

## 1. Overview & Architecture

The Canonical Asset Registry provides a unified identity, versioning, lineage, storage authorization, accounting, and reconciliation layer for all digital assets across the Pawsome3D platform (photos, GLBs, STL derivatives, textures, animations, voice clips, print files, BIM models, and validation reports).

All assets adhere to three core invariants:
1. **Logical Identity**: An asset has a stable UUID, owner reference, asset type, visibility, and current-version pointer.
2. **Immutable Versions**: Once registered, an asset version (`asset_versions`) is immutable. Content modifications increment `version_number` and record sha256 checksums, MIME types, byte counts, storage locations, and metadata.
3. **Typed Lineage**: Revisions and derivative relationships (e.g. source photo -> reference sheet -> 3D mesh -> rig -> STL derivative -> print file) are tracked in a directed acyclic graph (`asset_relations`).

---

## 2. Database Schema (Migrations 18-19)

Migration 18 creates the registry. Forward-only migration 19 ensures the
current version belongs to the same asset and rejects self-lineage in MySQL.

### `assets` Table
- `id` BIGINT AUTO_INCREMENT PRIMARY KEY
- `asset_uuid` CHAR(36) NOT NULL UNIQUE
- `owner_id` VARCHAR(190) NOT NULL (maps to user phone/email identifier)
- `asset_type` VARCHAR(64) NOT NULL (e.g., `source_photo`, `model_glb`, `model_stl`, etc.)
- `visibility` ENUM('private', 'public', 'published') NOT NULL DEFAULT 'private'
- `status` ENUM('active', 'archived', 'deleted') NOT NULL DEFAULT 'active'
- `current_version_id` BIGINT NULL (references `asset_versions(id)`)
- `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
- `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
- INDEX `idx_assets_owner` (`owner_id`, `asset_type`, `status`)

### `asset_versions` Table
- `id` BIGINT AUTO_INCREMENT PRIMARY KEY
- `asset_id` BIGINT NOT NULL (FK to `assets(id)` ON DELETE CASCADE)
- `version_number` INT NOT NULL DEFAULT 1
- `sha256` CHAR(64) NOT NULL
- `mime_type` VARCHAR(120) NOT NULL
- `size_bytes` BIGINT NOT NULL
- `bucket` ENUM('public', 'private') NOT NULL
- `object_key` VARCHAR(512) NOT NULL
- `metadata` JSON NULL
- `source_provider` VARCHAR(64) NOT NULL DEFAULT 'original'
- `license` VARCHAR(64) NOT NULL DEFAULT 'proprietary'
- `commercial_use_eligible` TINYINT(1) NOT NULL DEFAULT 0
- `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
- UNIQUE KEY `uniq_asset_version` (`asset_id`, `version_number`)
- INDEX `idx_asset_version_checksum` (`sha256`)
- INDEX `idx_asset_version_storage` (`bucket`, `object_key`(191))

### `asset_relations` Table
- `id` BIGINT AUTO_INCREMENT PRIMARY KEY
- `parent_version_id` BIGINT NOT NULL (FK to `asset_versions(id)` ON DELETE CASCADE)
- `child_version_id` BIGINT NOT NULL (FK to `asset_versions(id)` ON DELETE CASCADE)
- `relation_type` ENUM('turnaround', 'mesh', 'rig', 'stl', 'render', 'print_file', 'derivative') NOT NULL
- `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
- UNIQUE KEY `uniq_asset_relation` (`parent_version_id`, `child_version_id`, `relation_type`)

### `asset_legacy_links` Table
- `id` BIGINT AUTO_INCREMENT PRIMARY KEY
- `legacy_table` VARCHAR(64) NOT NULL
- `legacy_id` VARCHAR(190) NOT NULL
- `asset_id` BIGINT NOT NULL (FK to `assets(id)` ON DELETE CASCADE)
- `asset_version_id` BIGINT NOT NULL (FK to `asset_versions(id)` ON DELETE CASCADE)
- `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
- UNIQUE KEY `uniq_legacy_mapping` (`legacy_table`, `legacy_id`)

---

## 3. Core Module Responsibilities (`server/assets/`)

- `schemas.ts`: Strict Zod request/response validation schemas for registration, versioning, lineage, and API routes.
- `types.ts`: TypeScript interfaces, asset types, visibility enums, and domain model definitions.
- `repository.ts`: SQL queries and database transactions for `assets`, `asset_versions`, `asset_relations`, and `asset_legacy_links`.
- `service.ts`: Core service logic for registering assets, creating versions, updating pointers, lineage tracking, and compensating storage cleanup.
- `access.ts`: Authorization checks (owner verification, public/published checks) and short-lived presigned URL generation (without leaking object keys in public metadata).
- `accounting.ts`: Distinct physical storage totals per owner to prevent double counting shared/versioned files.
- `reconciliation.ts`: Database/storage drift detection and optional administrative `--fix` execution.
- `legacyAdapters.ts`: Lazy and batch registration adapters for legacy tables (`creations`, `avatars`, `marketplace_assets`, `bim_builds`, `print_orders`, `wardrobe_wags`).
- `routes.ts`: Authenticated HTTP API mounted at `/api/assets`.

---

## 4. Storage Accounting & Security Controls

1. **Object Key Security**: Internal `object_key` strings are NEVER exposed in client-facing API responses. Access to private assets is granted exclusively through short-lived presigned URLs after owner authorization.
2. **Distinct Accounting**: Storage totals for an owner sum `size_bytes` over distinct physical `(bucket, object_key)` entries, so multiple versions pointing to the same storage object do not double count usage.
3. **Compensating Cleanup**: If a file is newly uploaded to S3/B2 but database registration fails, `service.ts` immediately deletes the newly created object. Pre-existing storage objects are never deleted on database failure.
4. **Reconciliation**:
   - `DB_VERSION_MISSING_OBJECT`: Database version references a non-existent S3/B2 object.
   - `OBJECT_WITHOUT_DB_REGISTRATION`: Storage object exists without a matching `asset_versions` record.
   - `SIZE_MISMATCH`: Recorded `size_bytes` differs from object storage `Content-Length`.
   - `INVALID_CURRENT_VERSION_POINTER`: `current_version_id` references a version belonging to another asset or non-existent version.
   - `CROSS_OWNER_PRIVATE_CONFLICT`: Private object key shared across different asset owners.
