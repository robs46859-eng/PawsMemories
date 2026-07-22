import crypto from "node:crypto";
import type mysql from "mysql2/promise";

export const CURRENT_SCHEMA_VERSION = 24;

export interface Migration {
  version: number;
  name: string;
  statements: string[];
}

export interface AppliedMigration {
  version: number;
  name: string;
  checksum: string;
  applied_at: Date;
  duration_ms: number;
}

export function sha256(content: string): string {
  return crypto.createHash("sha256").update(content.trim()).digest("hex");
}

/**
 * Single Authoritative TypeScript Migration Registry.
 * Baseline versions 001..015 correspond to legacy boot DDL (server/migrations/001_... to 015_...).
 * First managed migrations are 16, 17, and 18.
 */
export const MIGRATIONS: Migration[] = [
  {
    version: 16,
    name: "wags_stripe_customer_id",
    statements: [
      `SELECT COUNT(*) INTO @tbl_exists FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'`,
      `SELECT COUNT(*) INTO @col_exists FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'stripe_customer_id'`,
      `SET @stmt = IF(@tbl_exists > 0 AND @col_exists = 0, 'ALTER TABLE users ADD COLUMN stripe_customer_id VARCHAR(128) NULL', 'SELECT 1')`,
      `PREPARE stmt FROM @stmt`,
      `EXECUTE stmt`,
      `DEALLOCATE PREPARE stmt`,
    ],
  },
  {
    version: 17,
    name: "stl_derivatives_unique_constraint",
    statements: [
      // 1. Reconcile existing duplicate active STL derivatives to 'superseded' (if table exists)
      `SELECT COUNT(*) INTO @ma_exists FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'marketplace_assets'`,
      `SET @stmt = IF(@ma_exists > 0, 'UPDATE marketplace_assets ma JOIN (SELECT listing_id, ROUND(derivative_height_mm, 2) as norm_height, MAX(id) as max_id FROM marketplace_assets WHERE kind = \\'stl_derivative\\' AND status = \\'active\\' AND derivative_height_mm IS NOT NULL GROUP BY listing_id, ROUND(derivative_height_mm, 2) HAVING COUNT(*) > 1) dupes ON ma.listing_id = dupes.listing_id AND ROUND(ma.derivative_height_mm, 2) = dupes.norm_height AND ma.id < dupes.max_id SET ma.status = \\'superseded\\' WHERE ma.kind = \\'stl_derivative\\' AND ma.status = \\'active\\'', 'SELECT 1')`,
      `PREPARE stmt FROM @stmt`,
      `EXECUTE stmt`,
      `DEALLOCATE PREPARE stmt`,

      // 2. Add generated active height stored column (evaluates to height if active, NULL otherwise)
      `SELECT COUNT(*) INTO @tbl_exists FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'marketplace_assets'`,
      `SELECT COUNT(*) INTO @col_exists FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'marketplace_assets' AND COLUMN_NAME = 'generated_active_height'`,
      `SET @stmt = IF(@tbl_exists > 0 AND @col_exists = 0, 'ALTER TABLE marketplace_assets ADD COLUMN generated_active_height DECIMAL(8,2) GENERATED ALWAYS AS (CASE WHEN kind=\\'stl_derivative\\' AND status=\\'active\\' THEN ROUND(derivative_height_mm, 2) ELSE NULL END) STORED', 'SELECT 1')`,
      `PREPARE stmt FROM @stmt`,
      `EXECUTE stmt`,
      `DEALLOCATE PREPARE stmt`,

      // 3. Add active-only unique index on (listing_id, generated_active_height)
      `SELECT COUNT(*) INTO @tbl_exists FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'marketplace_assets'`,
      `SELECT COUNT(*) INTO @idx_exists FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'marketplace_assets' AND INDEX_NAME = 'uniq_stl_active_derivative'`,
      `SET @stmt = IF(@tbl_exists > 0 AND @idx_exists = 0, 'ALTER TABLE marketplace_assets ADD UNIQUE INDEX uniq_stl_active_derivative (listing_id, generated_active_height)', 'SELECT 1')`,
      `PREPARE stmt FROM @stmt`,
      `EXECUTE stmt`,
      `DEALLOCATE PREPARE stmt`,
    ],
  },
  {
    version: 18,
    name: "canonical_asset_registry",
    statements: [
      `CREATE TABLE IF NOT EXISTS assets (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        asset_uuid CHAR(36) NOT NULL,
        owner_id VARCHAR(190) NOT NULL,
        asset_type VARCHAR(64) NOT NULL,
        visibility ENUM('private', 'public', 'published') NOT NULL DEFAULT 'private',
        status ENUM('active', 'archived', 'deleted') NOT NULL DEFAULT 'active',
        current_version_id BIGINT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_asset_uuid (asset_uuid),
        INDEX idx_assets_owner (owner_id, asset_type, status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

      `CREATE TABLE IF NOT EXISTS asset_versions (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        asset_id BIGINT NOT NULL,
        version_number INT NOT NULL DEFAULT 1,
        sha256 CHAR(64) NOT NULL,
        mime_type VARCHAR(120) NOT NULL,
        size_bytes BIGINT NOT NULL,
        bucket ENUM('public', 'private') NOT NULL,
        object_key VARCHAR(512) NOT NULL,
        metadata JSON NULL,
        source_provider VARCHAR(64) NOT NULL DEFAULT 'original',
        license VARCHAR(64) NOT NULL DEFAULT 'proprietary',
        commercial_use_eligible TINYINT(1) NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_asset_version (asset_id, version_number),
        INDEX idx_asset_version_checksum (sha256),
        INDEX idx_asset_version_storage (bucket, object_key(191)),
        CONSTRAINT fk_asset_version_asset FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

      `CREATE TABLE IF NOT EXISTS asset_relations (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        parent_version_id BIGINT NOT NULL,
        child_version_id BIGINT NOT NULL,
        relation_type ENUM('turnaround', 'mesh', 'rig', 'stl', 'render', 'print_file', 'derivative') NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_asset_relation (parent_version_id, child_version_id, relation_type),
        CONSTRAINT fk_asset_relation_parent FOREIGN KEY (parent_version_id) REFERENCES asset_versions(id) ON DELETE CASCADE,
        CONSTRAINT fk_asset_relation_child FOREIGN KEY (child_version_id) REFERENCES asset_versions(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

      `CREATE TABLE IF NOT EXISTS asset_legacy_links (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        legacy_table VARCHAR(64) NOT NULL,
        legacy_id VARCHAR(190) NOT NULL,
        asset_id BIGINT NOT NULL,
        asset_version_id BIGINT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_legacy_mapping (legacy_table, legacy_id),
        CONSTRAINT fk_legacy_link_asset FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE,
        CONSTRAINT fk_legacy_link_version FOREIGN KEY (asset_version_id) REFERENCES asset_versions(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

      // Add FK constraint on assets.current_version_id after asset_versions table creation
      `SELECT COUNT(*) INTO @fk_exists FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'assets' AND CONSTRAINT_NAME = 'fk_asset_current_version'`,
      `SET @stmt = IF(@fk_exists = 0, 'ALTER TABLE assets ADD CONSTRAINT fk_asset_current_version FOREIGN KEY (current_version_id) REFERENCES asset_versions(id) ON DELETE SET NULL', 'SELECT 1')`,
      `PREPARE stmt FROM @stmt`,
      `EXECUTE stmt`,
      `DEALLOCATE PREPARE stmt`,
    ],
  },
  {
    version: 19,
    name: "canonical_asset_integrity_hardening",
    statements: [
      // Repair any pre-existing cross-asset pointers before tightening the FK.
      `UPDATE assets a
       LEFT JOIN asset_versions av ON av.id = a.current_version_id AND av.asset_id = a.id
       SET a.current_version_id = (
         SELECT replacement.id FROM asset_versions replacement
         WHERE replacement.asset_id = a.id
         ORDER BY replacement.version_number DESC LIMIT 1
       )
       WHERE a.current_version_id IS NOT NULL AND av.id IS NULL`,

      `SELECT COUNT(*) INTO @idx_exists FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'asset_versions' AND INDEX_NAME = 'uniq_asset_version_identity'`,
      `SET @stmt = IF(@idx_exists = 0, 'ALTER TABLE asset_versions ADD UNIQUE KEY uniq_asset_version_identity (asset_id, id)', 'SELECT 1')`,
      `PREPARE stmt FROM @stmt`,
      `EXECUTE stmt`,
      `DEALLOCATE PREPARE stmt`,

      `SELECT COUNT(*) INTO @fk_exists FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'assets' AND CONSTRAINT_NAME = 'fk_asset_current_version'`,
      `SET @stmt = IF(@fk_exists > 0, 'ALTER TABLE assets DROP FOREIGN KEY fk_asset_current_version', 'SELECT 1')`,
      `PREPARE stmt FROM @stmt`,
      `EXECUTE stmt`,
      `DEALLOCATE PREPARE stmt`,

      `SELECT COUNT(*) INTO @fk_exists FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'assets' AND CONSTRAINT_NAME = 'fk_asset_current_version_owned'`,
      `SET @stmt = IF(@fk_exists = 0, 'ALTER TABLE assets ADD CONSTRAINT fk_asset_current_version_owned FOREIGN KEY (id, current_version_id) REFERENCES asset_versions(asset_id, id) ON DELETE RESTRICT', 'SELECT 1')`,
      `PREPARE stmt FROM @stmt`,
      `EXECUTE stmt`,
      `DEALLOCATE PREPARE stmt`,

      `SELECT COUNT(*) INTO @check_exists FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'asset_relations' AND CONSTRAINT_NAME = 'chk_asset_relation_not_self'`,
      `SET @stmt = IF(@check_exists = 0, 'ALTER TABLE asset_relations ADD CONSTRAINT chk_asset_relation_not_self CHECK (parent_version_id <> child_version_id)', 'SELECT 1')`,
      `PREPARE stmt FROM @stmt`,
      `EXECUTE stmt`,
      `DEALLOCATE PREPARE stmt`,
    ],
  },
  {
    version: 20,
    name: "multiview_reference_approval",
    statements: [
      `CREATE TABLE IF NOT EXISTS reference_sessions (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        session_uuid CHAR(36) NOT NULL UNIQUE,
        owner_id VARCHAR(190) NOT NULL,
        input_mode ENUM('text', 'photo') NOT NULL,
        subject_class VARCHAR(64) NOT NULL DEFAULT 'pet',
        prompt TEXT NULL,
        source_asset_id BIGINT NULL,
        source_asset_version_id BIGINT NULL,
        state ENUM('draft', 'queued', 'generating', 'ready', 'approved', 'failed', 'cancelled') NOT NULL DEFAULT 'draft',
        current_attempt_id BIGINT NULL,
        approved_attempt_id BIGINT NULL,
        retry_count INT NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_ref_sessions_owner (owner_id),
        INDEX idx_ref_sessions_state (state)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

      `CREATE TABLE IF NOT EXISTS reference_attempts (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        session_id BIGINT NOT NULL,
        attempt_number INT NOT NULL,
        idempotency_key VARCHAR(190) NOT NULL,
        provider VARCHAR(64) NOT NULL DEFAULT 'gemini',
        model VARCHAR(120) NOT NULL,
        prompt_config_hash CHAR(64) NOT NULL,
        retry_notes TEXT NULL,
        state ENUM('queued', 'generating', 'ready', 'failed', 'cancelled') NOT NULL DEFAULT 'queued',
        failure_code VARCHAR(64) NULL,
        error_message TEXT NULL,
        started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        completed_at TIMESTAMP NULL,
        UNIQUE KEY uniq_ref_attempt_number (session_id, attempt_number),
        UNIQUE KEY uniq_ref_attempt_idempotency (session_id, idempotency_key),
        FOREIGN KEY (session_id) REFERENCES reference_sessions(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

      `CREATE TABLE IF NOT EXISTS reference_views (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        attempt_id BIGINT NOT NULL,
        view_kind ENUM('front', 'left', 'right', 'rear', 'front_three_quarter') NOT NULL,
        asset_id BIGINT NOT NULL,
        asset_version_id BIGINT NOT NULL,
        width_px INT NOT NULL,
        height_px INT NOT NULL,
        is_synthesized TINYINT(1) NOT NULL DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_ref_view_kind (attempt_id, view_kind),
        FOREIGN KEY (attempt_id) REFERENCES reference_attempts(id) ON DELETE CASCADE,
        FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE RESTRICT,
        FOREIGN KEY (asset_version_id) REFERENCES asset_versions(id) ON DELETE RESTRICT
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

      `CREATE TABLE IF NOT EXISTS reference_reports (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        attempt_id BIGINT NOT NULL UNIQUE,
        report_asset_version_id BIGINT NULL,
        status ENUM('pass', 'warn', 'fail') NOT NULL DEFAULT 'pass',
        scale_confidence ENUM('unknown', 'declared', 'calibrated') NOT NULL DEFAULT 'unknown',
        report_hash CHAR(64) NOT NULL,
        metrics_json JSON NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (attempt_id) REFERENCES reference_attempts(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

      `CREATE TABLE IF NOT EXISTS reference_approvals (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        session_id BIGINT NOT NULL UNIQUE,
        attempt_id BIGINT NOT NULL,
        manifest_hash CHAR(64) NOT NULL,
        approved_by_user VARCHAR(190) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (session_id) REFERENCES reference_sessions(id) ON DELETE RESTRICT,
        FOREIGN KEY (attempt_id) REFERENCES reference_attempts(id) ON DELETE RESTRICT
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    ],
  },
  {
    version: 21,
    name: "multiview_reference_integrity_hardening",
    statements: [
      `SELECT COUNT(*) INTO @col_exists FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'reference_reports' AND COLUMN_NAME = 'report_asset_id'`,
      `SET @stmt = IF(@col_exists = 0, 'ALTER TABLE reference_reports ADD COLUMN report_asset_id BIGINT NULL AFTER attempt_id', 'SELECT 1')`,
      `PREPARE stmt FROM @stmt`, `EXECUTE stmt`, `DEALLOCATE PREPARE stmt`,

      `SELECT COUNT(*) INTO @col_exists FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'reference_approvals' AND COLUMN_NAME = 'manifest_asset_id'`,
      `SET @stmt = IF(@col_exists = 0, 'ALTER TABLE reference_approvals ADD COLUMN manifest_asset_id BIGINT NULL AFTER attempt_id', 'SELECT 1')`,
      `PREPARE stmt FROM @stmt`, `EXECUTE stmt`, `DEALLOCATE PREPARE stmt`,
      `SELECT COUNT(*) INTO @col_exists FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'reference_approvals' AND COLUMN_NAME = 'manifest_asset_version_id'`,
      `SET @stmt = IF(@col_exists = 0, 'ALTER TABLE reference_approvals ADD COLUMN manifest_asset_version_id BIGINT NULL AFTER manifest_asset_id', 'SELECT 1')`,
      `PREPARE stmt FROM @stmt`, `EXECUTE stmt`, `DEALLOCATE PREPARE stmt`,

      `SELECT COUNT(*) INTO @idx_exists FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'reference_attempts' AND INDEX_NAME = 'uniq_ref_attempt_identity'`,
      `SET @stmt = IF(@idx_exists = 0, 'ALTER TABLE reference_attempts ADD UNIQUE KEY uniq_ref_attempt_identity (session_id, id)', 'SELECT 1')`,
      `PREPARE stmt FROM @stmt`, `EXECUTE stmt`, `DEALLOCATE PREPARE stmt`,

      `SELECT COUNT(*) INTO @fk_exists FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'reference_sessions' AND CONSTRAINT_NAME = 'fk_ref_session_current_attempt_owned'`,
      `SET @stmt = IF(@fk_exists = 0, 'ALTER TABLE reference_sessions ADD CONSTRAINT fk_ref_session_current_attempt_owned FOREIGN KEY (id, current_attempt_id) REFERENCES reference_attempts(session_id, id) ON DELETE RESTRICT', 'SELECT 1')`,
      `PREPARE stmt FROM @stmt`, `EXECUTE stmt`, `DEALLOCATE PREPARE stmt`,
      `SELECT COUNT(*) INTO @fk_exists FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'reference_sessions' AND CONSTRAINT_NAME = 'fk_ref_session_approved_attempt_owned'`,
      `SET @stmt = IF(@fk_exists = 0, 'ALTER TABLE reference_sessions ADD CONSTRAINT fk_ref_session_approved_attempt_owned FOREIGN KEY (id, approved_attempt_id) REFERENCES reference_attempts(session_id, id) ON DELETE RESTRICT', 'SELECT 1')`,
      `PREPARE stmt FROM @stmt`, `EXECUTE stmt`, `DEALLOCATE PREPARE stmt`,

      `SELECT COUNT(*) INTO @fk_exists FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'reference_sessions' AND CONSTRAINT_NAME = 'fk_ref_session_source_version_owned'`,
      `SET @stmt = IF(@fk_exists = 0, 'ALTER TABLE reference_sessions ADD CONSTRAINT fk_ref_session_source_version_owned FOREIGN KEY (source_asset_id, source_asset_version_id) REFERENCES asset_versions(asset_id, id) ON DELETE RESTRICT', 'SELECT 1')`,
      `PREPARE stmt FROM @stmt`, `EXECUTE stmt`, `DEALLOCATE PREPARE stmt`,
      `SELECT COUNT(*) INTO @fk_exists FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'reference_views' AND CONSTRAINT_NAME = 'fk_ref_view_version_owned'`,
      `SET @stmt = IF(@fk_exists = 0, 'ALTER TABLE reference_views ADD CONSTRAINT fk_ref_view_version_owned FOREIGN KEY (asset_id, asset_version_id) REFERENCES asset_versions(asset_id, id) ON DELETE RESTRICT', 'SELECT 1')`,
      `PREPARE stmt FROM @stmt`, `EXECUTE stmt`, `DEALLOCATE PREPARE stmt`,
      `SELECT COUNT(*) INTO @fk_exists FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'reference_reports' AND CONSTRAINT_NAME = 'fk_ref_report_version_owned'`,
      `SET @stmt = IF(@fk_exists = 0, 'ALTER TABLE reference_reports ADD CONSTRAINT fk_ref_report_version_owned FOREIGN KEY (report_asset_id, report_asset_version_id) REFERENCES asset_versions(asset_id, id) ON DELETE RESTRICT', 'SELECT 1')`,
      `PREPARE stmt FROM @stmt`, `EXECUTE stmt`, `DEALLOCATE PREPARE stmt`,
      `SELECT COUNT(*) INTO @fk_exists FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'reference_approvals' AND CONSTRAINT_NAME = 'fk_ref_approval_attempt_owned'`,
      `SET @stmt = IF(@fk_exists = 0, 'ALTER TABLE reference_approvals ADD CONSTRAINT fk_ref_approval_attempt_owned FOREIGN KEY (session_id, attempt_id) REFERENCES reference_attempts(session_id, id) ON DELETE RESTRICT', 'SELECT 1')`,
      `PREPARE stmt FROM @stmt`, `EXECUTE stmt`, `DEALLOCATE PREPARE stmt`,
      `SELECT COUNT(*) INTO @fk_exists FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'reference_approvals' AND CONSTRAINT_NAME = 'fk_ref_approval_manifest_version_owned'`,
      `SET @stmt = IF(@fk_exists = 0, 'ALTER TABLE reference_approvals ADD CONSTRAINT fk_ref_approval_manifest_version_owned FOREIGN KEY (manifest_asset_id, manifest_asset_version_id) REFERENCES asset_versions(asset_id, id) ON DELETE RESTRICT', 'SELECT 1')`,
      `PREPARE stmt FROM @stmt`, `EXECUTE stmt`, `DEALLOCATE PREPARE stmt`,

      `SELECT COUNT(*) INTO @check_exists FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'reference_views' AND CONSTRAINT_NAME = 'chk_ref_view_min_dimensions'`,
      `SET @stmt = IF(@check_exists = 0, 'ALTER TABLE reference_views ADD CONSTRAINT chk_ref_view_min_dimensions CHECK (width_px >= 1024 AND height_px >= 1024)', 'SELECT 1')`,
      `PREPARE stmt FROM @stmt`, `EXECUTE stmt`, `DEALLOCATE PREPARE stmt`,
    ],
  },
  {
    version: 22,
    name: "durable_model_build",
    statements: [
      `CREATE TABLE IF NOT EXISTS model_build_jobs (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        job_uuid CHAR(36) NOT NULL,
        owner_id VARCHAR(190) NOT NULL,
        reference_session_id BIGINT NOT NULL,
        reference_attempt_id BIGINT NOT NULL,
        manifest_asset_id BIGINT NOT NULL,
        manifest_asset_version_id BIGINT NOT NULL,
        manifest_hash CHAR(64) NOT NULL,
        requested_output VARCHAR(20) NOT NULL DEFAULT 'glb',
        pricing_key VARCHAR(64) NOT NULL,
        quoted_credits INT NOT NULL,
        state VARCHAR(30) NOT NULL DEFAULT 'draft',
        current_attempt_id BIGINT NULL,
        accepted_artifact_id BIGINT NULL,
        accepted_report_id BIGINT NULL,
        credit_correlation_id VARCHAR(120) NULL,
        refund_correlation_id VARCHAR(120) NULL,
        failure_code VARCHAR(120) NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_job_uuid (job_uuid),
        UNIQUE KEY uniq_job_reference_owner (reference_session_id, owner_id),
        INDEX idx_job_owner (owner_id, state),
        CONSTRAINT chk_job_quoted_credits CHECK (quoted_credits >= 0),
        FOREIGN KEY (reference_session_id) REFERENCES reference_sessions(id) ON DELETE RESTRICT,
        FOREIGN KEY (reference_session_id, reference_attempt_id) REFERENCES reference_attempts(session_id, id) ON DELETE RESTRICT,
        FOREIGN KEY (manifest_asset_id) REFERENCES assets(id) ON DELETE RESTRICT,
        FOREIGN KEY (manifest_asset_id, manifest_asset_version_id) REFERENCES asset_versions(asset_id, id) ON DELETE RESTRICT
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

      `CREATE TABLE IF NOT EXISTS model_build_attempts (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        job_id BIGINT NOT NULL,
        attempt_number INT NOT NULL,
        idempotency_key CHAR(36) NOT NULL,
        provider VARCHAR(64) NOT NULL DEFAULT 'tripo',
        model VARCHAR(64) NOT NULL DEFAULT 'default',
        provider_task_handle VARCHAR(255) NULL,
        input_config_hash CHAR(64) NOT NULL,
        lease_owner VARCHAR(120) NULL,
        lease_expires_at TIMESTAMP NULL,
        state VARCHAR(30) NOT NULL DEFAULT 'queued',
        failure_code VARCHAR(120) NULL,
        error_message VARCHAR(500) NULL,
        started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        completed_at TIMESTAMP NULL,
        UNIQUE KEY uniq_attempt_idempotency (idempotency_key),
        UNIQUE KEY uniq_attempt_job_number (job_id, attempt_number),
        UNIQUE KEY uniq_model_attempt_identity (job_id, id),
        CONSTRAINT chk_attempt_number CHECK (attempt_number >= 1),
        FOREIGN KEY (job_id) REFERENCES model_build_jobs(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

      `CREATE TABLE IF NOT EXISTS model_provider_events (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        provider VARCHAR(64) NOT NULL,
        event_hash CHAR(64) NOT NULL,
        attempt_id BIGINT NOT NULL,
        event_type VARCHAR(30) NOT NULL,
        received_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        processed_at TIMESTAMP NULL,
        payload_metadata JSON NULL,
        UNIQUE KEY uniq_provider_event (event_hash),
        FOREIGN KEY (attempt_id) REFERENCES model_build_attempts(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

      `CREATE TABLE IF NOT EXISTS model_build_artifacts (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        attempt_id BIGINT NOT NULL,
        asset_id BIGINT NOT NULL,
        asset_version_id BIGINT NOT NULL,
        role VARCHAR(30) NOT NULL,
        computed_hash CHAR(64) NOT NULL,
        size_bytes BIGINT NOT NULL,
        mime_type VARCHAR(120) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_artifact_role (attempt_id, role),
        UNIQUE KEY uniq_model_artifact_identity (attempt_id, id),
        CONSTRAINT chk_artifact_size CHECK (size_bytes >= 0),
        FOREIGN KEY (attempt_id) REFERENCES model_build_attempts(id) ON DELETE CASCADE,
        FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE RESTRICT,
        FOREIGN KEY (asset_id, asset_version_id) REFERENCES asset_versions(asset_id, id) ON DELETE RESTRICT
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

      `CREATE TABLE IF NOT EXISTS model_post_build_reports (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        attempt_id BIGINT NOT NULL UNIQUE,
        report_asset_id BIGINT NOT NULL,
        report_asset_version_id BIGINT NOT NULL,
        status ENUM('pass', 'warn', 'fail') NOT NULL DEFAULT 'pass',
        validator_versions VARCHAR(255) NOT NULL,
        metrics_hash CHAR(64) NOT NULL,
        metrics_json JSON NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (attempt_id) REFERENCES model_build_attempts(id) ON DELETE CASCADE,
        FOREIGN KEY (report_asset_id) REFERENCES assets(id) ON DELETE RESTRICT,
        UNIQUE KEY uniq_model_report_identity (attempt_id, id),
        FOREIGN KEY (report_asset_id, report_asset_version_id) REFERENCES asset_versions(asset_id, id) ON DELETE RESTRICT
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

      `CREATE TABLE IF NOT EXISTS model_build_acceptances (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        job_id BIGINT NOT NULL UNIQUE,
        attempt_id BIGINT NOT NULL,
        artifact_id BIGINT NOT NULL,
        report_id BIGINT NOT NULL,
        accepted_by_user VARCHAR(190) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (job_id) REFERENCES model_build_jobs(id) ON DELETE RESTRICT,
        FOREIGN KEY (job_id, attempt_id) REFERENCES model_build_attempts(job_id, id) ON DELETE RESTRICT,
        FOREIGN KEY (attempt_id, artifact_id) REFERENCES model_build_artifacts(attempt_id, id) ON DELETE RESTRICT,
        FOREIGN KEY (attempt_id, report_id) REFERENCES model_post_build_reports(attempt_id, id) ON DELETE RESTRICT
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

      `CREATE TABLE IF NOT EXISTS model_build_credit_events (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        job_id BIGINT NOT NULL,
        attempt_id BIGINT NOT NULL,
        owner_id VARCHAR(190) NOT NULL,
        correlation_id VARCHAR(120) NOT NULL,
        event_type ENUM('charge', 'refund') NOT NULL,
        delta INT NOT NULL,
        balance_after INT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_model_credit_correlation (correlation_id),
        INDEX idx_model_credit_job (job_id, attempt_id),
        CONSTRAINT chk_model_credit_delta CHECK (delta <> 0),
        FOREIGN KEY (job_id, attempt_id) REFERENCES model_build_attempts(job_id, id) ON DELETE RESTRICT
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    ],
  },
  {
    version: 23,
    name: "rig_pipeline",
    statements: [
      `CREATE TABLE IF NOT EXISTS rig_classifications (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        model_build_job_id BIGINT NOT NULL,
        accepted_artifact_id BIGINT NOT NULL,
        classification ENUM('biped', 'quadruped', 'unsupported') NOT NULL,
        classifier_version VARCHAR(50) NOT NULL,
        confidence DECIMAL(5,4) NOT NULL DEFAULT 0.0,
        evidence_json JSON NOT NULL,
        override_by VARCHAR(190) NULL,
        override_reason TEXT NULL,
        override_at TIMESTAMP NULL,
        selected_profile_id VARCHAR(120) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_rig_class_job (model_build_job_id),
        INDEX idx_rig_class_artifact (accepted_artifact_id),
        FOREIGN KEY (model_build_job_id) REFERENCES model_build_jobs(id) ON DELETE RESTRICT,
        FOREIGN KEY (accepted_artifact_id) REFERENCES model_build_artifacts(id) ON DELETE RESTRICT
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

      `CREATE TABLE IF NOT EXISTS rig_jobs (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        job_uuid CHAR(36) NOT NULL,
        owner_id VARCHAR(190) NOT NULL,
        model_build_job_id BIGINT NOT NULL,
        classification_id BIGINT NOT NULL,
        source_artifact_id BIGINT NOT NULL,
        source_version_id BIGINT NOT NULL,
        state ENUM('draft','classifying','classified','queued','submitted','rigging','validating_rig','inventorying_facial','fitting_accessories','ready','accepted','failed_classification','failed_rig','failed_validation','cancelled') NOT NULL DEFAULT 'draft',
        current_attempt_id BIGINT NULL,
        request_facial BOOLEAN NOT NULL DEFAULT TRUE,
        failure_code VARCHAR(60) NULL,
        accepted_artifact_id BIGINT NULL,
        idempotency_key VARCHAR(128) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_rig_job_uuid (job_uuid),
        UNIQUE KEY uniq_rig_idempotency (idempotency_key),
        UNIQUE KEY uniq_rig_model_job (model_build_job_id),
        UNIQUE KEY uniq_rig_job_current_attempt (id, current_attempt_id),
        INDEX idx_rig_job_owner (owner_id),
        INDEX idx_rig_job_model (model_build_job_id),
        FOREIGN KEY (model_build_job_id) REFERENCES model_build_jobs(id) ON DELETE RESTRICT,
        FOREIGN KEY (classification_id) REFERENCES rig_classifications(id) ON DELETE RESTRICT,
        FOREIGN KEY (source_artifact_id) REFERENCES model_build_artifacts(id) ON DELETE RESTRICT,
        FOREIGN KEY (source_version_id) REFERENCES asset_versions(id) ON DELETE RESTRICT
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

      `CREATE TABLE IF NOT EXISTS rig_attempts (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        job_id BIGINT NOT NULL,
        attempt_number TINYINT UNSIGNED NOT NULL DEFAULT 1,
        state ENUM('queued','submitted','rigging','validating','ready','failed','cancelled') NOT NULL DEFAULT 'queued',
        provider VARCHAR(50) NULL,
        provider_task_handle VARCHAR(255) NULL,
        worker_lease_owner VARCHAR(120) NULL,
        worker_lease_expiry TIMESTAMP NULL,
        idempotency_key VARCHAR(128) NOT NULL,
        started_at TIMESTAMP NULL,
        completed_at TIMESTAMP NULL,
        failure_code VARCHAR(60) NULL,
        failure_detail TEXT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_rig_attempt_idemp (idempotency_key),
        UNIQUE KEY uniq_rig_attempt_job_num (job_id, attempt_number),
        UNIQUE KEY uniq_rig_attempt_identity (job_id, id),
        INDEX idx_rig_attempt_state (state),
        FOREIGN KEY (job_id) REFERENCES rig_jobs(id) ON DELETE RESTRICT
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

      `CREATE TABLE IF NOT EXISTS rig_validation_manifests (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        rig_attempt_id BIGINT NOT NULL,
        validator_version VARCHAR(50) NOT NULL,
        bone_count SMALLINT UNSIGNED NOT NULL DEFAULT 0,
        skinned_vertex_count INT UNSIGNED NOT NULL DEFAULT 0,
        max_influences TINYINT UNSIGNED NOT NULL DEFAULT 0,
        unweighted_islands SMALLINT UNSIGNED NOT NULL DEFAULT 0,
        bind_matrix_valid BOOLEAN NOT NULL DEFAULT FALSE,
        animation_sweep_pass BOOLEAN NOT NULL DEFAULT FALSE,
        silhouette_deviation DECIMAL(8,4) NOT NULL DEFAULT 0.0,
        mobile_budget_pass BOOLEAN NOT NULL DEFAULT FALSE,
        triangle_count INT UNSIGNED NOT NULL DEFAULT 0,
        texture_max_dimension SMALLINT UNSIGNED NOT NULL DEFAULT 0,
        joint_count SMALLINT UNSIGNED NOT NULL DEFAULT 0,
        rules_json JSON NOT NULL,
        metrics_hash CHAR(64) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_rig_manifest_attempt (rig_attempt_id),
        FOREIGN KEY (rig_attempt_id) REFERENCES rig_attempts(id) ON DELETE RESTRICT
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

      `CREATE TABLE IF NOT EXISTS facial_inventories (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        rig_job_id BIGINT NOT NULL,
        rig_attempt_id BIGINT NOT NULL,
        capability ENUM('full', 'partial', 'body_only', 'unsupported') NOT NULL,
        morph_count SMALLINT UNSIGNED NOT NULL DEFAULT 0,
        viseme_coverage DECIMAL(5,4) NOT NULL DEFAULT 0.0,
        has_blink BOOLEAN NOT NULL DEFAULT FALSE,
        has_jaw BOOLEAN NOT NULL DEFAULT FALSE,
        has_eye_controls BOOLEAN NOT NULL DEFAULT FALSE,
        morph_names_json JSON NOT NULL,
        canonical_map_json JSON NOT NULL,
        deformation_pass BOOLEAN NOT NULL DEFAULT FALSE,
        notes TEXT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_facial_inv_attempt (rig_attempt_id),
        INDEX idx_facial_inv_job (rig_job_id),
        FOREIGN KEY (rig_job_id) REFERENCES rig_jobs(id) ON DELETE RESTRICT,
        FOREIGN KEY (rig_attempt_id) REFERENCES rig_attempts(id) ON DELETE RESTRICT
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

      `CREATE TABLE IF NOT EXISTS accessory_catalog (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        accessory_uuid CHAR(36) NOT NULL,
        owner_id VARCHAR(190) NOT NULL,
        name VARCHAR(200) NOT NULL,
        asset_id BIGINT NOT NULL,
        asset_version_id BIGINT NOT NULL,
        compatible_profiles JSON NOT NULL,
        attachment_bone VARCHAR(100) NOT NULL,
        fit_bounds_json JSON NOT NULL,
        collision_bounds_json JSON NOT NULL,
        license VARCHAR(500) NOT NULL DEFAULT 'proprietary',
        commercial_use_eligible BOOLEAN NOT NULL DEFAULT FALSE,
        export_policy ENUM('allowed', 'preview_only', 'derivative_only') NOT NULL DEFAULT 'allowed',
        preview_asset_id BIGINT NULL,
        status ENUM('active', 'archived', 'deleted') NOT NULL DEFAULT 'active',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_accessory_uuid (accessory_uuid),
        INDEX idx_accessory_owner (owner_id),
        INDEX idx_accessory_status (status),
        FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE RESTRICT,
        FOREIGN KEY (asset_id, asset_version_id) REFERENCES asset_versions(asset_id, id) ON DELETE RESTRICT,
        FOREIGN KEY (preview_asset_id) REFERENCES assets(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

      `CREATE TABLE IF NOT EXISTS accessory_fits (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        fit_uuid CHAR(36) NOT NULL,
        rig_job_id BIGINT NOT NULL,
        accessory_id BIGINT NOT NULL,
        derivative_asset_id BIGINT NULL,
        derivative_version_id BIGINT NULL,
        attachment_bone VARCHAR(100) NOT NULL,
        transform_json JSON NOT NULL,
        floating_distance DECIMAL(8,4) NOT NULL DEFAULT 0.0,
        penetration_depth DECIMAL(8,4) NOT NULL DEFAULT 0.0,
        animation_sweep_pass BOOLEAN NOT NULL DEFAULT FALSE,
        polygon_budget_pass BOOLEAN NOT NULL DEFAULT FALSE,
        print_clearance_mm DECIMAL(8,4) NOT NULL DEFAULT 0.0,
        status ENUM('pending', 'fitted', 'failed', 'accepted') NOT NULL DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_fit_uuid (fit_uuid),
        INDEX idx_fit_rig_job (rig_job_id),
        INDEX idx_fit_accessory (accessory_id),
        FOREIGN KEY (rig_job_id) REFERENCES rig_jobs(id) ON DELETE RESTRICT,
        FOREIGN KEY (accessory_id) REFERENCES accessory_catalog(id) ON DELETE RESTRICT,
        FOREIGN KEY (derivative_asset_id) REFERENCES assets(id) ON DELETE RESTRICT,
        FOREIGN KEY (derivative_asset_id, derivative_version_id) REFERENCES asset_versions(asset_id, id) ON DELETE RESTRICT
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

      `CREATE TABLE IF NOT EXISTS rig_acceptances (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        rig_job_id BIGINT NOT NULL,
        rig_attempt_id BIGINT NOT NULL,
        manifest_id BIGINT NOT NULL,
        accepted_by_user VARCHAR(190) NOT NULL,
        manifest_hash CHAR(64) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_rig_acceptance_job (rig_job_id),
        FOREIGN KEY (rig_job_id) REFERENCES rig_jobs(id) ON DELETE RESTRICT,
        FOREIGN KEY (rig_attempt_id) REFERENCES rig_attempts(id) ON DELETE RESTRICT,
        FOREIGN KEY (manifest_id) REFERENCES rig_validation_manifests(id) ON DELETE RESTRICT
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

      `SELECT COUNT(*) INTO @fk_exists FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'rig_jobs' AND CONSTRAINT_NAME = 'fk_rig_job_current_attempt'`,
      `SET @stmt = IF(@fk_exists = 0, 'ALTER TABLE rig_jobs ADD CONSTRAINT fk_rig_job_current_attempt FOREIGN KEY (id, current_attempt_id) REFERENCES rig_attempts(job_id, id) ON DELETE RESTRICT', 'SELECT 1')`,
      `PREPARE stmt FROM @stmt`, `EXECUTE stmt`, `DEALLOCATE PREPARE stmt`,
    ],
  },
  {
    version: 24,
    name: "fur_bin_showcase",
    statements: [
      `CREATE TABLE IF NOT EXISTS fur_bin_items (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        item_uuid CHAR(36) NOT NULL,
        owner_id VARCHAR(190) NOT NULL,
        asset_id BIGINT NOT NULL,
        current_version_id BIGINT NULL,
        title VARCHAR(300) NOT NULL DEFAULT '',
        description TEXT NULL,
        cover_asset_id BIGINT NULL,
        tags_json JSON NOT NULL DEFAULT (JSON_ARRAY()),
        dimensions_json JSON NULL,
        has_rig BOOLEAN NOT NULL DEFAULT FALSE,
        has_facial BOOLEAN NOT NULL DEFAULT FALSE,
        has_animations BOOLEAN NOT NULL DEFAULT FALSE,
        accessory_count SMALLINT UNSIGNED NOT NULL DEFAULT 0,
        derivative_count SMALLINT UNSIGNED NOT NULL DEFAULT 0,
        storage_bytes BIGINT UNSIGNED NOT NULL DEFAULT 0,
        status ENUM('active', 'archived', 'deleted') NOT NULL DEFAULT 'active',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_furbin_item_uuid (item_uuid),
        UNIQUE KEY uniq_furbin_owner_asset (owner_id, asset_id),
        INDEX idx_furbin_owner (owner_id),
        INDEX idx_furbin_status (status),
        FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE RESTRICT,
        FOREIGN KEY (asset_id, current_version_id) REFERENCES asset_versions(asset_id, id) ON DELETE RESTRICT,
        FOREIGN KEY (cover_asset_id) REFERENCES assets(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

      `CREATE TABLE IF NOT EXISTS fur_bin_collections (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        collection_uuid CHAR(36) NOT NULL,
        owner_id VARCHAR(190) NOT NULL,
        name VARCHAR(200) NOT NULL,
        description TEXT NULL,
        cover_asset_id BIGINT NULL,
        sort_order SMALLINT NOT NULL DEFAULT 0,
        status ENUM('active', 'archived', 'deleted') NOT NULL DEFAULT 'active',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_collection_uuid (collection_uuid),
        INDEX idx_collection_owner (owner_id),
        FOREIGN KEY (cover_asset_id) REFERENCES assets(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

      `CREATE TABLE IF NOT EXISTS fur_bin_collection_items (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        collection_id BIGINT NOT NULL,
        item_id BIGINT NOT NULL,
        sort_order SMALLINT NOT NULL DEFAULT 0,
        added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_collection_item (collection_id, item_id),
        FOREIGN KEY (collection_id) REFERENCES fur_bin_collections(id) ON DELETE CASCADE,
        FOREIGN KEY (item_id) REFERENCES fur_bin_items(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

      `CREATE TABLE IF NOT EXISTS fur_bin_tags (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        tag_name VARCHAR(100) NOT NULL,
        owner_id VARCHAR(190) NOT NULL,
        usage_count INT UNSIGNED NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_tag_owner (tag_name, owner_id),
        INDEX idx_tag_owner (owner_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

      `CREATE TABLE IF NOT EXISTS showcase_records (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        showcase_uuid CHAR(36) NOT NULL,
        owner_id VARCHAR(190) NOT NULL,
        fur_bin_item_id BIGINT NOT NULL,
        published_version_id BIGINT NOT NULL,
        title VARCHAR(300) NOT NULL,
        description TEXT NULL,
        tags_json JSON NOT NULL DEFAULT (JSON_ARRAY()),
        category VARCHAR(100) NOT NULL DEFAULT 'general',
        cover_asset_id BIGINT NULL,
        attribution TEXT NULL,
        rights_declaration VARCHAR(200) NOT NULL DEFAULT 'all_rights_reserved',
        commercial_eligible BOOLEAN NOT NULL DEFAULT FALSE,
        moderation_state ENUM('pending', 'approved', 'rejected', 'suspended') NOT NULL DEFAULT 'pending',
        moderation_notes TEXT NULL,
        view_count INT UNSIGNED NOT NULL DEFAULT 0,
        published_at TIMESTAMP NULL,
        unpublished_at TIMESTAMP NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_showcase_uuid (showcase_uuid),
        UNIQUE KEY uniq_showcase_item_version (fur_bin_item_id, published_version_id),
        INDEX idx_showcase_owner (owner_id),
        INDEX idx_showcase_moderation (moderation_state),
        INDEX idx_showcase_category (category),
        FOREIGN KEY (fur_bin_item_id) REFERENCES fur_bin_items(id) ON DELETE RESTRICT,
        FOREIGN KEY (published_version_id) REFERENCES asset_versions(id) ON DELETE RESTRICT,
        FOREIGN KEY (cover_asset_id) REFERENCES assets(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

      `CREATE TABLE IF NOT EXISTS moderation_history (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        showcase_id BIGINT NOT NULL,
        previous_state ENUM('pending', 'approved', 'rejected', 'suspended') NOT NULL,
        new_state ENUM('pending', 'approved', 'rejected', 'suspended') NOT NULL,
        moderator_id VARCHAR(190) NOT NULL,
        reason TEXT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (showcase_id) REFERENCES showcase_records(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    ],
  },
];

export async function ensureMigrationTable(conn: mysql.PoolConnection | mysql.Pool): Promise<void> {
  await conn.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INT NOT NULL PRIMARY KEY,
      name VARCHAR(190) NOT NULL,
      checksum VARCHAR(64) NOT NULL,
      applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      duration_ms INT NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // Record baseline transition versions 1..15 if users table exists and ledger is empty
  const [ledgerCountRows]: any = await conn.query("SELECT COUNT(*) AS c FROM schema_migrations");
  const count = Number(ledgerCountRows?.[0]?.c || 0);

  if (count === 0) {
    const [usersTableRows]: any = await conn.query(
      "SELECT COUNT(*) AS c FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'",
    );
    const usersExist = Number(usersTableRows?.[0]?.c || 0) > 0;
    if (usersExist) {
      // Pre-existing legacy schema: record baseline versions 1..15
      for (let v = 1; v <= 15; v++) {
        const vPad = String(v).padStart(3, "0");
        const name = `baseline_${vPad}`;
        const checksum = sha256(`BASELINE_TRANSITION_${vPad}`);
        await conn.query(
          "INSERT IGNORE INTO schema_migrations (version, name, checksum, applied_at, duration_ms) VALUES (?, ?, ?, NOW(), 0)",
          [v, name, checksum],
        );
      }
    }
  }
}

export async function runMigrations(
  pool: mysql.Pool,
  migrations: Migration[] = MIGRATIONS,
): Promise<{ applied: number; durationMs: number }> {
  const startAll = Date.now();

  // 1. Validate migration definitions before acquiring connection
  const versionsSeen = new Set<number>();
  const namesSeen = new Set<string>();
  for (const mig of migrations) {
    if (versionsSeen.has(mig.version)) {
      throw new Error(`Duplicate migration version detected: ${mig.version}`);
    }
    if (namesSeen.has(mig.name)) {
      throw new Error(`Duplicate migration name detected: ${mig.name}`);
    }
    if (!Array.isArray(mig.statements) || mig.statements.length === 0) {
      throw new Error(`Migration v${mig.version} (${mig.name}) must define explicit statements.`);
    }
    versionsSeen.add(mig.version);
    namesSeen.add(mig.name);
  }

  // 2. Acquire single dedicated PoolConnection
  const connection = await pool.getConnection();

  // 3. Acquire connection-scoped named lock
  const lockName = "paws_schema_migrations_lock";
  let lockAcquired = false;

  try {
    const [lockRes]: any = await connection.query("SELECT GET_LOCK(?, 10) AS lock_acquired", [lockName]);
    lockAcquired = lockRes?.[0]?.lock_acquired === 1;

    if (!lockAcquired) {
      throw new Error("Could not acquire schema migration lock within 10 seconds.");
    }

    await ensureMigrationTable(connection);

    const [rows]: any = await connection.query(
      "SELECT version, name, checksum, applied_at, duration_ms FROM schema_migrations ORDER BY version ASC",
    );
    const appliedMap = new Map<number, AppliedMigration>(
      (rows as any[]).map((r) => [
        Number(r.version),
        {
          version: Number(r.version),
          name: String(r.name),
          checksum: String(r.checksum),
          applied_at: new Date(r.applied_at),
          duration_ms: Number(r.duration_ms),
        },
      ]),
    );

    let appliedCount = 0;
    const sorted = [...migrations].sort((a, b) => a.version - b.version);

    for (const mig of sorted) {
      const rawSql = mig.statements.map((s) => s.trim()).join(";\n");
      const checksum = sha256(rawSql);
      const existing = appliedMap.get(mig.version);

      if (existing) {
        if (existing.checksum !== checksum) {
          throw new Error(
            `Migration checksum mismatch for version ${mig.version} (${mig.name}). Recorded: ${existing.checksum}, Current: ${checksum}`,
          );
        }
        if (existing.name !== mig.name) {
          throw new Error(
            `Migration name mismatch for version ${mig.version}. Recorded: ${existing.name}, Current: ${mig.name}`,
          );
        }
        continue;
      }

      const migStart = Date.now();

      for (const statement of mig.statements) {
        await connection.query(statement);
      }

      const durationMs = Date.now() - migStart;

      await connection.query(
        "INSERT INTO schema_migrations (version, name, checksum, applied_at, duration_ms) VALUES (?, ?, ?, NOW(), ?)",
        [mig.version, mig.name, checksum, durationMs],
      );

      appliedCount++;
      console.log(`✅ Applied migration v${mig.version} (${mig.name}) in ${durationMs}ms`);
    }

    return { applied: appliedCount, durationMs: Date.now() - startAll };
  } finally {
    if (lockAcquired) {
      await connection.query("SELECT RELEASE_LOCK(?)", [lockName]).catch(() => {});
    }
    connection.release();
  }
}
