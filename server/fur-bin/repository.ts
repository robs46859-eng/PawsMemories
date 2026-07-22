// ─── Phase 5: Fur Bin Repository ────────────────────────────────────────────
import type mysql from "mysql2/promise";
import type {
  FurBinItemRecord,
  FurBinCollectionRecord,
  ShowcaseRecord,
  ModerationHistoryRecord,
  ItemStatus,
  ModerationState,
} from "./types";

// ── Fur Bin Items ───────────────────────────────────────────────────────────

export async function insertFurBinItem(
  conn: mysql.PoolConnection,
  data: {
    itemUuid: string;
    ownerId: string;
    assetId: number;
    currentVersionId: number;
    title: string;
    description?: string;
    tagsJson: string[];
    dimensionsJson?: any;
    hasRig?: boolean;
    hasFacial?: boolean;
    hasAnimations?: boolean;
    storageBytes: number;
  },
): Promise<number> {
  const [res]: any = await conn.query(
    `INSERT INTO fur_bin_items
      (item_uuid, owner_id, asset_id, current_version_id, title, description, tags_json, dimensions_json, has_rig, has_facial, has_animations, storage_bytes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      data.itemUuid,
      data.ownerId,
      data.assetId,
      data.currentVersionId,
      data.title,
      data.description || null,
      JSON.stringify(data.tagsJson),
      data.dimensionsJson ? JSON.stringify(data.dimensionsJson) : null,
      data.hasRig ?? false,
      data.hasFacial ?? false,
      data.hasAnimations ?? false,
      data.storageBytes,
    ],
  );
  return res.insertId;
}

export async function findFurBinItemByUuid(
  pool: mysql.Pool | mysql.PoolConnection,
  itemUuid: string,
): Promise<FurBinItemRecord | null> {
  const [rows]: any = await pool.query("SELECT * FROM fur_bin_items WHERE item_uuid = ? AND status != 'deleted'", [itemUuid]);
  if (!rows[0]) return null;
  return parseItemRecord(rows[0]);
}

export async function findFurBinItemByUuidForUpdate(
  conn: mysql.PoolConnection,
  itemUuid: string,
): Promise<FurBinItemRecord | null> {
  const [rows]: any = await conn.query(
    "SELECT * FROM fur_bin_items WHERE item_uuid = ? AND status != 'deleted' FOR UPDATE",
    [itemUuid],
  );
  return rows[0] ? parseItemRecord(rows[0]) : null;
}

export async function findFurBinItemByOwnerAndAsset(
  pool: mysql.Pool | mysql.PoolConnection,
  ownerId: string,
  assetId: number,
): Promise<FurBinItemRecord | null> {
  const [rows]: any = await pool.query(
    "SELECT * FROM fur_bin_items WHERE owner_id = ? AND asset_id = ? AND status != 'deleted' LIMIT 1",
    [ownerId, assetId],
  );
  return rows[0] ? parseItemRecord(rows[0]) : null;
}

export async function sumAssetVersionStorageBytes(
  pool: mysql.Pool | mysql.PoolConnection,
  assetId: number,
): Promise<number> {
  const [rows]: any = await pool.query(
    "SELECT COALESCE(SUM(size_bytes), 0) AS total_bytes FROM asset_versions WHERE asset_id = ?",
    [assetId],
  );
  return Number(rows[0]?.total_bytes || 0);
}

export async function findFurBinItemById(
  pool: mysql.Pool | mysql.PoolConnection,
  id: number,
): Promise<FurBinItemRecord | null> {
  const [rows]: any = await pool.query("SELECT * FROM fur_bin_items WHERE id = ? AND status != 'deleted'", [id]);
  if (!rows[0]) return null;
  return parseItemRecord(rows[0]);
}

export async function searchFurBinItems(
  pool: mysql.Pool,
  params: {
    ownerId: string;
    query?: string;
    tag?: string;
    collectionUuid?: string;
    hasRig?: boolean;
    hasFacial?: boolean;
    hasAnimations?: boolean;
    page: number;
    limit: number;
  },
): Promise<{ items: FurBinItemRecord[]; total: number }> {
  const where: string[] = ["owner_id = ?", "status = 'active'"];
  const vals: any[] = [params.ownerId];

  if (params.query) {
    where.push("(title LIKE ? OR description LIKE ?)");
    vals.push(`%${params.query}%`, `%${params.query}%`);
  }

  if (params.tag) {
    where.push("JSON_CONTAINS(tags_json, ?)");
    vals.push(JSON.stringify(params.tag));
  }

  if (params.collectionUuid) {
    where.push(`EXISTS (
      SELECT 1 FROM fur_bin_collection_items fci
      JOIN fur_bin_collections fc ON fc.id = fci.collection_id
      WHERE fci.item_id = fur_bin_items.id
        AND fc.collection_uuid = ? AND fc.owner_id = ? AND fc.status = 'active'
    )`);
    vals.push(params.collectionUuid, params.ownerId);
  }

  if (params.hasRig !== undefined) {
    where.push("has_rig = ?");
    vals.push(params.hasRig);
  }

  if (params.hasFacial !== undefined) {
    where.push("has_facial = ?");
    vals.push(params.hasFacial);
  }

  if (params.hasAnimations !== undefined) {
    where.push("has_animations = ?");
    vals.push(params.hasAnimations);
  }

  const offset = (params.page - 1) * params.limit;
  const whereSql = where.join(" AND ");

  const [countRows]: any = await pool.query(`SELECT COUNT(*) as c FROM fur_bin_items WHERE ${whereSql}`, vals);
  const total = Number(countRows[0]?.c || 0);

  const [rows]: any = await pool.query(
    `SELECT * FROM fur_bin_items WHERE ${whereSql} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [...vals, params.limit, offset],
  );

  return { items: rows.map(parseItemRecord), total };
}

export async function updateItemVersionPointer(
  conn: mysql.PoolConnection,
  itemId: number,
  versionId: number,
): Promise<void> {
  await conn.query("UPDATE fur_bin_items SET current_version_id = ? WHERE id = ?", [versionId, itemId]);
}

// ── Collections ─────────────────────────────────────────────────────────────

export async function insertCollection(
  conn: mysql.PoolConnection,
  data: { collectionUuid: string; ownerId: string; name: string; description?: string },
): Promise<number> {
  const [res]: any = await conn.query(
    "INSERT INTO fur_bin_collections (collection_uuid, owner_id, name, description) VALUES (?, ?, ?, ?)",
    [data.collectionUuid, data.ownerId, data.name, data.description || null],
  );
  return res.insertId;
}

export async function findCollectionByUuid(pool: mysql.Pool | mysql.PoolConnection, uuid: string): Promise<FurBinCollectionRecord | null> {
  const [rows]: any = await pool.query("SELECT * FROM fur_bin_collections WHERE collection_uuid = ? AND status = 'active'", [uuid]);
  return rows[0] || null;
}

export async function addItemToCollection(conn: mysql.PoolConnection, collectionId: number, itemId: number): Promise<void> {
  await conn.query("INSERT IGNORE INTO fur_bin_collection_items (collection_id, item_id) VALUES (?, ?)", [collectionId, itemId]);
}

// ── Showcase Records ────────────────────────────────────────────────────────

export async function insertShowcaseRecord(
  conn: mysql.PoolConnection,
  data: {
    showcaseUuid: string;
    ownerId: string;
    furBinItemId: number;
    publishedVersionId: number;
    title: string;
    description?: string;
    tagsJson: string[];
    category: string;
    attribution?: string;
    rightsDeclaration: string;
    commercialEligible: boolean;
  },
): Promise<number> {
  const [res]: any = await conn.query(
    `INSERT INTO showcase_records
      (showcase_uuid, owner_id, fur_bin_item_id, published_version_id, title, description, tags_json, category, attribution, rights_declaration, commercial_eligible, moderation_state, published_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', NOW())`,
    [
      data.showcaseUuid,
      data.ownerId,
      data.furBinItemId,
      data.publishedVersionId,
      data.title,
      data.description || null,
      JSON.stringify(data.tagsJson),
      data.category,
      data.attribution || null,
      data.rightsDeclaration,
      data.commercialEligible,
    ],
  );
  return res.insertId;
}

export async function findShowcaseByUuid(pool: mysql.Pool | mysql.PoolConnection, showcaseUuid: string): Promise<ShowcaseRecord | null> {
  const [rows]: any = await pool.query("SELECT * FROM showcase_records WHERE showcase_uuid = ?", [showcaseUuid]);
  if (!rows[0]) return null;
  return parseShowcaseRecord(rows[0]);
}

export async function findShowcaseByUuidForUpdate(conn: mysql.PoolConnection, showcaseUuid: string): Promise<ShowcaseRecord | null> {
  const [rows]: any = await conn.query("SELECT * FROM showcase_records WHERE showcase_uuid = ? FOR UPDATE", [showcaseUuid]);
  return rows[0] ? parseShowcaseRecord(rows[0]) : null;
}

export async function findPublishedShowcaseByUuid(
  pool: mysql.Pool | mysql.PoolConnection,
  showcaseUuid: string,
): Promise<ShowcaseRecord | null> {
  const [rows]: any = await pool.query(
    `SELECT * FROM showcase_records
     WHERE showcase_uuid = ? AND moderation_state = 'approved'
       AND published_at IS NOT NULL AND unpublished_at IS NULL`,
    [showcaseUuid],
  );
  return rows[0] ? parseShowcaseRecord(rows[0]) : null;
}

export async function updateShowcaseModeration(
  conn: mysql.PoolConnection,
  showcaseId: number,
  newState: ModerationState,
  moderatorId: string,
  reason?: string,
): Promise<void> {
  const [current]: any = await conn.query("SELECT moderation_state FROM showcase_records WHERE id = ?", [showcaseId]);
  const prevState = current[0]?.moderation_state || "pending";

  await conn.query(
    "UPDATE showcase_records SET moderation_state = ?, moderation_notes = ? WHERE id = ?",
    [newState, reason || null, showcaseId],
  );

  await conn.query(
    "INSERT INTO moderation_history (showcase_id, previous_state, new_state, moderator_id, reason) VALUES (?, ?, ?, ?, ?)",
    [showcaseId, prevState, newState, moderatorId, reason || null],
  );
}

export async function markShowcaseUnpublished(conn: mysql.PoolConnection, showcaseId: number): Promise<void> {
  await conn.query("UPDATE showcase_records SET unpublished_at = NOW() WHERE id = ?", [showcaseId]);
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function parseItemRecord(r: any): FurBinItemRecord {
  return {
    ...r,
    tags_json: typeof r.tags_json === "string" ? JSON.parse(r.tags_json) : r.tags_json,
    dimensions_json: r.dimensions_json ? (typeof r.dimensions_json === "string" ? JSON.parse(r.dimensions_json) : r.dimensions_json) : null,
    has_rig: Boolean(r.has_rig),
    has_facial: Boolean(r.has_facial),
    has_animations: Boolean(r.has_animations),
  };
}

function parseShowcaseRecord(r: any): ShowcaseRecord {
  return {
    ...r,
    tags_json: typeof r.tags_json === "string" ? JSON.parse(r.tags_json) : r.tags_json,
    commercial_eligible: Boolean(r.commercial_eligible),
  };
}
