import type mysql from "mysql2/promise";
import { getPool } from "../../db";
import { registerAsset } from "./service";
import { findLegacyLink } from "./repository";
import type { AssetRecord, AssetVersionRecord } from "./types";

export interface LegacyAdapterResult {
  asset: AssetRecord;
  version: AssetVersionRecord;
  isNewLink: boolean;
}

export async function registerLegacyCreation(
  creationId: number,
  ownerPhone: string,
  pool: mysql.Pool = getPool(),
): Promise<LegacyAdapterResult | null> {
  const legacyId = String(creationId);
  const existing = await findLegacyLink(pool, "creations", legacyId);
  if (existing) {
    const { asset, version } = await registerAsset(
      {
        ownerId: ownerPhone,
        assetType: "model_glb",
        visibility: "private",
        mimeType: "model/gltf-binary",
        sizeBytes: 1000,
        sha256: "0000000000000000000000000000000000000000000000000000000000000000",
        bucket: "public",
        objectKey: "legacy/placeholder.glb",
        legacyTable: "creations",
        legacyId,
      },
      { authorization: { internal: true }, isNewObjectUpload: false, pool },
    );
    return { asset, version, isNewLink: false };
  }

  const [rows]: any = await pool.query(
    `SELECT id, user_phone, image_url, model_url, video_url, prompt, created_at
     FROM creations WHERE id = ? LIMIT 1`,
    [creationId],
  );
  if (!rows || rows.length === 0) return null;
  const row = rows[0];

  const modelUrl = String(row.model_url || row.image_url || "");
  const objectKey = modelUrl.replace(/^https?:\/\/[^\/]+\//, "") || `creations/${row.id}.glb`;

  const { asset, version } = await registerAsset(
    {
      ownerId: String(row.user_phone || ownerPhone),
      assetType: row.model_url ? "model_glb" : "source_photo",
      visibility: "private",
      mimeType: row.model_url ? "model/gltf-binary" : "image/png",
      sizeBytes: 1000,
      sha256: "0000000000000000000000000000000000000000000000000000000000000000",
      bucket: "public",
      objectKey,
      metadata: { prompt: row.prompt, legacyCreationId: row.id },
      sourceProvider: "legacy_creations",
      legacyTable: "creations",
      legacyId,
    },
    { authorization: { internal: true }, isNewObjectUpload: false, pool },
  );

  return { asset, version, isNewLink: true };
}

export async function registerLegacyMarketplaceAsset(
  assetId: number,
  pool: mysql.Pool = getPool(),
): Promise<LegacyAdapterResult | null> {
  const legacyId = String(assetId);
  const existing = await findLegacyLink(pool, "marketplace_assets", legacyId);
  if (existing) {
    const { asset, version } = await registerAsset(
      {
        ownerId: "system_marketplace",
        assetType: "model_glb",
        visibility: "published",
        mimeType: "model/gltf-binary",
        sizeBytes: 1000,
        sha256: "0000000000000000000000000000000000000000000000000000000000000000",
        bucket: "private",
        objectKey: "legacy/placeholder.glb",
        legacyTable: "marketplace_assets",
        legacyId,
      },
      { authorization: { internal: true }, isNewObjectUpload: false, pool },
    );
    return { asset, version, isNewLink: false };
  }

  const [rows]: any = await pool.query(
    `SELECT id, listing_id, asset_uuid, kind, bucket, object_key, mime_type, size_bytes, sha256, status, derivative_height_mm
     FROM marketplace_assets WHERE id = ? LIMIT 1`,
    [assetId],
  );
  if (!rows || rows.length === 0) return null;
  const row = rows[0];

  const assetTypeMap: Record<string, string> = {
    source_glb: "model_glb",
    preview_image: "thumbnail",
    stl_derivative: "model_stl",
  };
  const assetType = assetTypeMap[row.kind] || "model_glb";

  const { asset, version } = await registerAsset(
    {
      ownerId: "system_marketplace",
      assetType,
      visibility: "published",
      mimeType: String(row.mime_type),
      sizeBytes: Number(row.size_bytes),
      sha256: String(row.sha256),
      bucket: row.bucket as any,
      objectKey: String(row.object_key),
      metadata: { listingId: row.listing_id, derivativeHeightMm: row.derivative_height_mm },
      sourceProvider: "marketplace",
      legacyTable: "marketplace_assets",
      legacyId,
    },
    { authorization: { internal: true }, isNewObjectUpload: false, pool },
  );

  return { asset, version, isNewLink: true };
}

/**
 * Safe Fur Bin Fallback Composition.
 * Fetches user assets cleanly from canonical registry while safely falling back to legacy creations table.
 */
export async function getFurBinCompositionForUser(
  userPhone: string,
  pool: mysql.Pool = getPool(),
): Promise<any[]> {
  const [legacyRows]: any = await pool.query(
    `SELECT id, user_phone, image_url, model_url, video_url, prompt, created_at
     FROM creations WHERE user_phone = ? ORDER BY id DESC`,
    [userPhone],
  );

  const canonicalAssets: any[] = [];
  const [assetRows]: any = await pool.query(
    `SELECT a.asset_uuid, a.asset_type, a.visibility, a.status, av.mime_type, av.size_bytes, av.object_key, av.metadata, a.created_at
     FROM assets a
     JOIN asset_versions av ON a.current_version_id = av.id
     WHERE a.owner_id = ? AND a.status != 'deleted'`,
    [userPhone],
  );

  for (const r of assetRows as any[]) {
    canonicalAssets.push({
      assetUuid: r.asset_uuid,
      assetType: r.asset_type,
      visibility: r.visibility,
      status: r.status,
      mimeType: r.mime_type,
      sizeBytes: Number(r.size_bytes),
      metadata: r.metadata ? (typeof r.metadata === "string" ? JSON.parse(r.metadata) : r.metadata) : null,
      createdAt: r.created_at,
    });
  }

  // Combine canonical assets and legacy creations
  return {
    canonical: canonicalAssets,
    legacyCreations: (legacyRows as any[]).map((r) => ({
      id: r.id,
      userPhone: r.user_phone,
      imageUrl: r.image_url,
      modelUrl: r.model_url,
      videoUrl: r.video_url,
      prompt: r.prompt,
      createdAt: r.created_at,
    })),
  };
}
