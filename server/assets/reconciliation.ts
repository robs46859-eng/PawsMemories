import type mysql from "mysql2/promise";
import { getPool } from "../../db";
import type { ReconciliationFinding, ReconciliationReport } from "./types";
import { updateAssetCurrentVersion } from "./repository";

export async function runAssetReconciliation(
  options: { fixMode?: boolean; pool?: mysql.Pool } = {},
): Promise<ReconciliationReport> {
  const fixMode = options.fixMode ?? false;
  const pool = options.pool || getPool();
  const findings: ReconciliationFinding[] = [];

  // 1. Check for Invalid Current Version Pointers
  const [invalidPointers]: any = await pool.query(`
    SELECT a.id as asset_id, a.asset_uuid, a.current_version_id, av.asset_id as version_asset_id
    FROM assets a
    LEFT JOIN asset_versions av ON a.current_version_id = av.id
    WHERE a.current_version_id IS NOT NULL AND (av.id IS NULL OR av.asset_id != a.id)
  `);

  for (const row of invalidPointers as any[]) {
    const finding: ReconciliationFinding = {
      type: "INVALID_CURRENT_VERSION_POINTER",
      severity: "error",
      details: {
        assetId: row.asset_id,
        assetUuid: row.asset_uuid,
        invalidCurrentVersionId: row.current_version_id,
      },
      fixed: false,
    };

    if (fixMode) {
      // Find latest version for this asset
      const [latestVersions]: any = await pool.query(
        `SELECT id FROM asset_versions WHERE asset_id = ? ORDER BY version_number DESC LIMIT 1`,
        [row.asset_id],
      );
      const latestId = latestVersions?.[0]?.id ? Number(latestVersions[0].id) : null;
      await updateAssetCurrentVersion(pool, row.asset_id, latestId);
      finding.fixed = true;
      finding.details.reconciledVersionId = latestId;
    }

    findings.push(finding);
  }

  // 2. Check for Cross-Owner Private Object Conflicts
  const [crossOwnerRows]: any = await pool.query(`
    SELECT av.bucket, av.object_key, COUNT(DISTINCT a.owner_id) as owner_count, GROUP_CONCAT(DISTINCT a.owner_id) as owner_ids
    FROM asset_versions av
    JOIN assets a ON av.asset_id = a.id
    WHERE av.bucket = 'private'
    GROUP BY av.bucket, av.object_key
    HAVING owner_count > 1
  `);

  for (const row of crossOwnerRows as any[]) {
    findings.push({
      type: "CROSS_OWNER_PRIVATE_CONFLICT",
      severity: "error",
      details: {
        objectKey: row.object_key,
        ownerIds: String(row.owner_ids).split(","),
      },
      fixed: false,
    });
  }

  // 3. Check for Duplicate Legacy Links
  const [dupeLinks]: any = await pool.query(`
    SELECT legacy_table, legacy_id, COUNT(*) as link_count
    FROM asset_legacy_links
    GROUP BY legacy_table, legacy_id
    HAVING link_count > 1
  `);

  for (const row of dupeLinks as any[]) {
    findings.push({
      type: "DUPLICATE_LEGACY_LINK",
      severity: "warning",
      details: {
        legacyTable: row.legacy_table,
        legacyId: row.legacy_id,
        linkCount: Number(row.link_count),
      },
      fixed: false,
    });
  }

  return {
    timestamp: new Date().toISOString(),
    fixMode,
    totalFindings: findings.length,
    findings,
  };
}
