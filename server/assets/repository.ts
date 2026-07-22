import type mysql from "mysql2/promise";
import { getPool } from "../../db";
import type {
  AssetRecord,
  AssetVersionRecord,
  AssetRelationRecord,
  AssetLegacyLinkRecord,
  AssetVisibility,
  AssetStatus,
  StorageBucket,
  RelationType,
  StorageUsageSummary,
} from "./types";

export async function insertAsset(
  connection: mysql.PoolConnection | mysql.Pool,
  data: {
    assetUuid: string;
    ownerId: string;
    assetType: string;
    visibility: AssetVisibility;
    status?: AssetStatus;
  },
): Promise<AssetRecord> {
  const status = data.status || "active";
  const [result]: any = await connection.query(
    `INSERT INTO assets (asset_uuid, owner_id, asset_type, visibility, status)
     VALUES (?, ?, ?, ?, ?)`,
    [data.assetUuid, data.ownerId, data.assetType, data.visibility, status],
  );

  const assetId = Number(result.insertId);
  const found = await findAssetById(connection, assetId);
  if (!found) throw new Error("Failed to insert asset record.");
  return found;
}

export async function findAssetById(
  connection: mysql.PoolConnection | mysql.Pool,
  id: number,
): Promise<AssetRecord | null> {
  const [rows]: any = await connection.query(
    `SELECT id, asset_uuid, owner_id, asset_type, visibility, status, current_version_id, created_at, updated_at
     FROM assets WHERE id = ? LIMIT 1`,
    [id],
  );
  if (!rows || rows.length === 0) return null;
  const r = rows[0];
  return {
    id: Number(r.id),
    asset_uuid: String(r.asset_uuid),
    owner_id: String(r.owner_id),
    asset_type: String(r.asset_type),
    visibility: r.visibility as AssetVisibility,
    status: r.status as AssetStatus,
    current_version_id: r.current_version_id ? Number(r.current_version_id) : null,
    created_at: new Date(r.created_at),
    updated_at: new Date(r.updated_at),
  };
}

export async function findAssetByUuid(
  connection: mysql.PoolConnection | mysql.Pool,
  assetUuid: string,
): Promise<AssetRecord | null> {
  const [rows]: any = await connection.query(
    `SELECT id, asset_uuid, owner_id, asset_type, visibility, status, current_version_id, created_at, updated_at
     FROM assets WHERE asset_uuid = ? LIMIT 1`,
    [assetUuid],
  );
  if (!rows || rows.length === 0) return null;
  const r = rows[0];
  return {
    id: Number(r.id),
    asset_uuid: String(r.asset_uuid),
    owner_id: String(r.owner_id),
    asset_type: String(r.asset_type),
    visibility: r.visibility as AssetVisibility,
    status: r.status as AssetStatus,
    current_version_id: r.current_version_id ? Number(r.current_version_id) : null,
    created_at: new Date(r.created_at),
    updated_at: new Date(r.updated_at),
  };
}

export async function findAssetByUuidForUpdate(
  connection: mysql.PoolConnection,
  assetUuid: string,
): Promise<AssetRecord | null> {
  const [rows]: any = await connection.query(
    `SELECT id, asset_uuid, owner_id, asset_type, visibility, status, current_version_id, created_at, updated_at
     FROM assets WHERE asset_uuid = ? LIMIT 1 FOR UPDATE`,
    [assetUuid],
  );
  if (!rows || rows.length === 0) return null;
  const r = rows[0];
  return {
    id: Number(r.id),
    asset_uuid: String(r.asset_uuid),
    owner_id: String(r.owner_id),
    asset_type: String(r.asset_type),
    visibility: r.visibility as AssetVisibility,
    status: r.status as AssetStatus,
    current_version_id: r.current_version_id ? Number(r.current_version_id) : null,
    created_at: new Date(r.created_at),
    updated_at: new Date(r.updated_at),
  };
}

export async function findAssetsByOwner(
  connection: mysql.PoolConnection | mysql.Pool,
  ownerId: string,
  options: { assetType?: string; visibility?: AssetVisibility; status?: AssetStatus; limit?: number; offset?: number } = {},
): Promise<AssetRecord[]> {
  const limit = options.limit || 20;
  const offset = options.offset || 0;
  const clauses: string[] = ["owner_id = ?"];
  const params: any[] = [ownerId];

  if (options.assetType) {
    clauses.push("asset_type = ?");
    params.push(options.assetType);
  }
  if (options.visibility) {
    clauses.push("visibility = ?");
    params.push(options.visibility);
  }
  if (options.status) {
    clauses.push("status = ?");
    params.push(options.status);
  }

  params.push(limit, offset);

  const [rows]: any = await connection.query(
    `SELECT id, asset_uuid, owner_id, asset_type, visibility, status, current_version_id, created_at, updated_at
     FROM assets WHERE ${clauses.join(" AND ")} ORDER BY id DESC LIMIT ? OFFSET ?`,
    params,
  );

  return (rows as any[]).map((r) => ({
    id: Number(r.id),
    asset_uuid: String(r.asset_uuid),
    owner_id: String(r.owner_id),
    asset_type: String(r.asset_type),
    visibility: r.visibility as AssetVisibility,
    status: r.status as AssetStatus,
    current_version_id: r.current_version_id ? Number(r.current_version_id) : null,
    created_at: new Date(r.created_at),
    updated_at: new Date(r.updated_at),
  }));
}

export async function updateAssetStatus(
  connection: mysql.PoolConnection | mysql.Pool,
  assetId: number,
  status: AssetStatus,
): Promise<void> {
  await connection.query("UPDATE assets SET status = ? WHERE id = ?", [status, assetId]);
}

export async function updateAssetCurrentVersion(
  connection: mysql.PoolConnection | mysql.Pool,
  assetId: number,
  currentVersionId: number | null,
): Promise<void> {
  await connection.query("UPDATE assets SET current_version_id = ? WHERE id = ?", [currentVersionId, assetId]);
}

export async function insertAssetVersion(
  connection: mysql.PoolConnection | mysql.Pool,
  data: {
    assetId: number;
    versionNumber: number;
    sha256: string;
    mimeType: string;
    sizeBytes: number;
    bucket: StorageBucket;
    objectKey: string;
    metadata?: Record<string, any> | null;
    sourceProvider?: string;
    license?: string;
    commercialUseEligible?: boolean;
  },
): Promise<AssetVersionRecord> {
  const metadataJson = data.metadata ? JSON.stringify(data.metadata) : null;
  const sourceProvider = data.sourceProvider || "original";
  const license = data.license || "proprietary";
  const commercial = data.commercialUseEligible ? 1 : 0;

  const [result]: any = await connection.query(
    `INSERT INTO asset_versions
       (asset_id, version_number, sha256, mime_type, size_bytes, bucket, object_key, metadata, source_provider, license, commercial_use_eligible)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      data.assetId,
      data.versionNumber,
      data.sha256,
      data.mimeType,
      data.sizeBytes,
      data.bucket,
      data.objectKey,
      metadataJson,
      sourceProvider,
      license,
      commercial,
    ],
  );

  const versionId = Number(result.insertId);
  const found = await findVersionById(connection, versionId);
  if (!found) throw new Error("Failed to insert asset version record.");
  return found;
}

export async function findVersionById(
  connection: mysql.PoolConnection | mysql.Pool,
  id: number,
): Promise<AssetVersionRecord | null> {
  const [rows]: any = await connection.query(
    `SELECT id, asset_id, version_number, sha256, mime_type, size_bytes, bucket, object_key, metadata, source_provider, license, commercial_use_eligible, created_at
     FROM asset_versions WHERE id = ? LIMIT 1`,
    [id],
  );
  if (!rows || rows.length === 0) return null;
  const r = rows[0];
  return {
    id: Number(r.id),
    asset_id: Number(r.asset_id),
    version_number: Number(r.version_number),
    sha256: String(r.sha256),
    mime_type: String(r.mime_type),
    size_bytes: Number(r.size_bytes),
    bucket: r.bucket as StorageBucket,
    object_key: String(r.object_key),
    metadata: typeof r.metadata === "string" ? JSON.parse(r.metadata) : r.metadata,
    source_provider: String(r.source_provider),
    license: String(r.license),
    commercial_use_eligible: Boolean(r.commercial_use_eligible),
    created_at: new Date(r.created_at),
  };
}

export async function findVersionByAssetAndNumber(
  connection: mysql.PoolConnection | mysql.Pool,
  assetId: number,
  versionNumber: number,
): Promise<AssetVersionRecord | null> {
  const [rows]: any = await connection.query(
    `SELECT id, asset_id, version_number, sha256, mime_type, size_bytes, bucket, object_key, metadata, source_provider, license, commercial_use_eligible, created_at
     FROM asset_versions WHERE asset_id = ? AND version_number = ? LIMIT 1`,
    [assetId, versionNumber],
  );
  if (!rows || rows.length === 0) return null;
  const r = rows[0];
  return {
    id: Number(r.id),
    asset_id: Number(r.asset_id),
    version_number: Number(r.version_number),
    sha256: String(r.sha256),
    mime_type: String(r.mime_type),
    size_bytes: Number(r.size_bytes),
    bucket: r.bucket as StorageBucket,
    object_key: String(r.object_key),
    metadata: typeof r.metadata === "string" ? JSON.parse(r.metadata) : r.metadata,
    source_provider: String(r.source_provider),
    license: String(r.license),
    commercial_use_eligible: Boolean(r.commercial_use_eligible),
    created_at: new Date(r.created_at),
  };
}

export async function findVersionsByAssetId(
  connection: mysql.PoolConnection | mysql.Pool,
  assetId: number,
): Promise<AssetVersionRecord[]> {
  const [rows]: any = await connection.query(
    `SELECT id, asset_id, version_number, sha256, mime_type, size_bytes, bucket, object_key, metadata, source_provider, license, commercial_use_eligible, created_at
     FROM asset_versions WHERE asset_id = ? ORDER BY version_number ASC`,
    [assetId],
  );
  return (rows as any[]).map((r) => ({
    id: Number(r.id),
    asset_id: Number(r.asset_id),
    version_number: Number(r.version_number),
    sha256: String(r.sha256),
    mime_type: String(r.mime_type),
    size_bytes: Number(r.size_bytes),
    bucket: r.bucket as StorageBucket,
    object_key: String(r.object_key),
    metadata: typeof r.metadata === "string" ? JSON.parse(r.metadata) : r.metadata,
    source_provider: String(r.source_provider),
    license: String(r.license),
    commercial_use_eligible: Boolean(r.commercial_use_eligible),
    created_at: new Date(r.created_at),
  }));
}

export async function insertAssetRelation(
  connection: mysql.PoolConnection | mysql.Pool,
  data: { parentVersionId: number; childVersionId: number; relationType: RelationType },
): Promise<AssetRelationRecord> {
  const [result]: any = await connection.query(
    `INSERT INTO asset_relations (parent_version_id, child_version_id, relation_type)
     VALUES (?, ?, ?)`,
    [data.parentVersionId, data.childVersionId, data.relationType],
  );

  const [rows]: any = await connection.query(
    `SELECT id, parent_version_id, child_version_id, relation_type, created_at
     FROM asset_relations WHERE id = ? LIMIT 1`,
    [result.insertId],
  );
  const r = rows[0];
  return {
    id: Number(r.id),
    parent_version_id: Number(r.parent_version_id),
    child_version_id: Number(r.child_version_id),
    relation_type: r.relation_type as RelationType,
    created_at: new Date(r.created_at),
  };
}

export async function findRelationsByVersionId(
  connection: mysql.PoolConnection | mysql.Pool,
  versionId: number,
): Promise<{ parents: AssetRelationRecord[]; children: AssetRelationRecord[] }> {
  const [parentRows]: any = await connection.query(
    `SELECT id, parent_version_id, child_version_id, relation_type, created_at
     FROM asset_relations WHERE child_version_id = ?`,
    [versionId],
  );

  const [childRows]: any = await connection.query(
    `SELECT id, parent_version_id, child_version_id, relation_type, created_at
     FROM asset_relations WHERE parent_version_id = ?`,
    [versionId],
  );

  return {
    parents: (parentRows as any[]).map((r) => ({
      id: Number(r.id),
      parent_version_id: Number(r.parent_version_id),
      child_version_id: Number(r.child_version_id),
      relation_type: r.relation_type as RelationType,
      created_at: new Date(r.created_at),
    })),
    children: (childRows as any[]).map((r) => ({
      id: Number(r.id),
      parent_version_id: Number(r.parent_version_id),
      child_version_id: Number(r.child_version_id),
      relation_type: r.relation_type as RelationType,
      created_at: new Date(r.created_at),
    })),
  };
}

export async function insertLegacyLink(
  connection: mysql.PoolConnection | mysql.Pool,
  data: { legacyTable: string; legacyId: string; assetId: number; assetVersionId: number },
): Promise<AssetLegacyLinkRecord> {
  const [result]: any = await connection.query(
    `INSERT INTO asset_legacy_links (legacy_table, legacy_id, asset_id, asset_version_id)
     VALUES (?, ?, ?, ?)`,
    [data.legacyTable, data.legacyId, data.assetId, data.assetVersionId],
  );

  const [rows]: any = await connection.query(
    `SELECT id, legacy_table, legacy_id, asset_id, asset_version_id, created_at
     FROM asset_legacy_links WHERE id = ? LIMIT 1`,
    [result.insertId],
  );
  const r = rows[0];
  return {
    id: Number(r.id),
    legacy_table: String(r.legacy_table),
    legacy_id: String(r.legacy_id),
    asset_id: Number(r.asset_id),
    asset_version_id: Number(r.asset_version_id),
    created_at: new Date(r.created_at),
  };
}

export async function findLegacyLink(
  connection: mysql.PoolConnection | mysql.Pool,
  legacyTable: string,
  legacyId: string,
): Promise<AssetLegacyLinkRecord | null> {
  const [rows]: any = await connection.query(
    `SELECT id, legacy_table, legacy_id, asset_id, asset_version_id, created_at
     FROM asset_legacy_links WHERE legacy_table = ? AND legacy_id = ? LIMIT 1`,
    [legacyTable, legacyId],
  );
  if (!rows || rows.length === 0) return null;
  const r = rows[0];
  return {
    id: Number(r.id),
    legacy_table: String(r.legacy_table),
    legacy_id: String(r.legacy_id),
    asset_id: Number(r.asset_id),
    asset_version_id: Number(r.asset_version_id),
    created_at: new Date(r.created_at),
  };
}

export async function getDistinctStorageAccountingByOwner(
  connection: mysql.PoolConnection | mysql.Pool,
  ownerId: string,
): Promise<StorageUsageSummary> {
  const [rows]: any = await connection.query(
    `SELECT 
       av.bucket,
       av.object_key,
       MAX(av.size_bytes) as max_bytes
     FROM assets a
     JOIN asset_versions av ON a.id = av.asset_id
     WHERE a.owner_id = ? AND a.status != 'deleted'
     GROUP BY av.bucket, av.object_key`,
    [ownerId],
  );

  let totalSizeBytes = 0;
  let publicSizeBytes = 0;
  let privateSizeBytes = 0;
  const distinctObjectsCount = (rows as any[]).length;

  for (const r of rows as any[]) {
    const bytes = Number(r.max_bytes || 0);
    totalSizeBytes += bytes;
    if (r.bucket === "public") publicSizeBytes += bytes;
    else if (r.bucket === "private") privateSizeBytes += bytes;
  }

  return {
    ownerId,
    totalSizeBytes,
    distinctObjectsCount,
    publicSizeBytes,
    privateSizeBytes,
  };
}
