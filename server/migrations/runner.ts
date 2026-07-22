import crypto from "node:crypto";
import type mysql from "mysql2/promise";

export const CURRENT_SCHEMA_VERSION = 21;

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
