export const ACTIVE_STL_DERIVATIVE_INDEX = "uniq_stl_active_derivative";

type Queryable = {
  query(sql: string, values?: unknown[]): Promise<any>;
};

export interface StoredStlObject {
  objectKey: string;
  sizeBytes: number;
  sha256: string;
}

export interface PersistStlDerivativeInput {
  db: Queryable;
  deleteObject: (objectKey: string) => Promise<void>;
  listingId: number;
  assetUuid: string;
  stored: StoredStlObject;
  targetHeightMm: number;
}

export function normalizeDerivativeHeightMm(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError("STL derivative height must be a positive finite number.");
  }
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function isActiveStlDerivativeConflict(error: unknown): boolean {
  const candidate = error as { code?: string; errno?: number; message?: string; sqlMessage?: string } | null;
  if (!candidate || (candidate.code !== "ER_DUP_ENTRY" && candidate.errno !== 1062)) {
    return false;
  }

  const detail = `${candidate.message || ""} ${candidate.sqlMessage || ""}`;
  return detail.includes(ACTIVE_STL_DERIVATIVE_INDEX);
}

export async function persistStlDerivativeOrResolveWinner(
  input: PersistStlDerivativeInput,
): Promise<{ objectKey: string; wonRace: boolean }> {
  const targetHeightMm = normalizeDerivativeHeightMm(input.targetHeightMm);

  try {
    await input.db.query(
      `INSERT INTO marketplace_assets
         (listing_id, asset_uuid, kind, bucket, object_key, mime_type, size_bytes,
          sha256, sort_order, derivative_height_mm, status)
       VALUES (?, ?, 'stl_derivative', 'private', ?, 'model/stl', ?, ?, ?, ?, 'active')`,
      [
        input.listingId,
        input.assetUuid,
        input.stored.objectKey,
        input.stored.sizeBytes,
        input.stored.sha256,
        Math.round(targetHeightMm),
        targetHeightMm,
      ],
    );
    return { objectKey: input.stored.objectKey, wonRace: true };
  } catch (error) {
    await input.deleteObject(input.stored.objectKey);

    if (!isActiveStlDerivativeConflict(error)) {
      throw error;
    }

    const [rows] = await input.db.query(
      `SELECT object_key
         FROM marketplace_assets
        WHERE listing_id = ?
          AND kind = 'stl_derivative'
          AND status = 'active'
          AND generated_active_height = ?
        LIMIT 1`,
      [input.listingId, targetHeightMm],
    );
    if (!rows?.[0]?.object_key) {
      throw error;
    }

    return { objectKey: String(rows[0].object_key), wonRace: false };
  }
}
