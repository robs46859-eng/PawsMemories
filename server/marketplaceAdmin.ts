import type { Pool } from "mysql2/promise";
import { randomUUID } from "node:crypto";
import {
  createPresignedUpload,
  getPrivateSignedUrl,
  headPrivateObject,
  mintObjectKey,
  validateUploadClaim,
  PRESIGNED_UPLOAD_TTL_SECONDS,
} from "../storage.private";
import {
  assertCommercialLicence,
  type ConfirmAssetInput,
  type CreateListingInput,
  type UpdateListingInput,
  type UploadUrlRequest,
} from "./marketplaceSchemas";

/**
 * Phase 3 core — admin catalog management logic.
 *
 * Kept out of server.ts (route glue only there) so the security-critical parts
 * are unit-testable and reviewable in one place, mirroring server/wags/delivery.ts.
 *
 * The three invariants this module owns:
 *   1. Nothing claimed by a browser is trusted: every upload is verified with
 *      HeadObject against the private bucket before an asset row exists.
 *   2. Assets are append-only versions: replacement supersedes, never deletes.
 *      Existing entitlements keep resolving to the version purchased.
 *   3. A listing cannot reach 'published' with unlicensed third-party assets,
 *      without a preview image, or (if digitally priced) without a source GLB.
 */

export class MarketplaceAdminError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "MarketplaceAdminError";
  }
}

/* ------------------------------------------------------------------ */
/* Listings                                                            */
/* ------------------------------------------------------------------ */

export async function listListingsWithCounts(
  pool: Pool,
  opts: { status?: string; limit?: number; offset?: number } = {},
): Promise<any[]> {
  const limit = Math.min(Math.max(Number(opts.limit ?? 50), 1), 200);
  const offset = Math.max(Number(opts.offset ?? 0), 0);
  const where = opts.status ? "WHERE l.status = ?" : "";
  const params: any[] = opts.status ? [opts.status, limit, offset] : [limit, offset];

  const [rows] = await pool.query(
    `SELECT l.*,
            COALESCE(SUM(a.kind = 'source_glb'    AND a.status = 'active'), 0) AS glb_count,
            COALESCE(SUM(a.kind = 'preview_image' AND a.status = 'active'), 0) AS preview_count,
            COALESCE(SUM(a.kind = 'stl_derivative' AND a.status = 'active'), 0) AS stl_count
     FROM marketplace_listings l
     LEFT JOIN marketplace_assets a ON a.listing_id = l.id
     ${where}
     GROUP BY l.id
     ORDER BY l.sort_order ASC, l.created_at DESC
     LIMIT ? OFFSET ?`,
    params,
  ) as any;
  return rows as any[];
}

/** Active preview images for one listing, with short-lived signed URLs for the
 *  admin UI. Private keys never leave the server unsigned. */
export async function listingPreviews(pool: Pool, listingId: number): Promise<
  Array<{ id: number; sort_order: number; url: string; expiresAt: string }>
> {
  const [rows] = await pool.query(
    `SELECT id, object_key, sort_order FROM marketplace_assets
     WHERE listing_id = ? AND kind = 'preview_image' AND status = 'active'
     ORDER BY sort_order, id`,
    [listingId],
  ) as any;
  const out = [] as Array<{ id: number; sort_order: number; url: string; expiresAt: string }>;
  for (const row of rows as any[]) {
    const signed = await getPrivateSignedUrl(String(row.object_key));
    out.push({ id: row.id, sort_order: row.sort_order, url: signed.url, expiresAt: signed.expiresAt });
  }
  return out;
}

/** All assets for a listing — editor needs GLB version history + preview images.
 *  Private object_keys are NOT returned; preview images get short-lived signed
 *  URLs and GLBs expose only id/version/status/size metadata. */
export async function listingAssets(pool: Pool, listingId: number): Promise<{
  previews: Array<{ id: number; sort_order: number; url: string; expiresAt: string; size_bytes: number; mime_type: string }>;
  glbs: Array<{ id: number; version: number; status: string; size_bytes: number; mime_type: string; created_at: string }>;
}> {
  const [rows] = await pool.query(
    `SELECT id, kind, status, object_key, sort_order, size_bytes, mime_type, version, created_at
     FROM marketplace_assets WHERE listing_id = ?
     ORDER BY kind, sort_order, version DESC`,
    [listingId],
  ) as any;

  const previews: Array<{ id: number; sort_order: number; url: string; expiresAt: string; size_bytes: number; mime_type: string }> = [];
  const glbs: Array<{ id: number; version: number; status: string; size_bytes: number; mime_type: string; created_at: string }> = [];

  for (const row of rows as any[]) {
    if (row.kind === "preview_image" && row.status === "active") {
      const signed = await getPrivateSignedUrl(String(row.object_key));
      previews.push({
        id: row.id,
        sort_order: row.sort_order,
        url: signed.url,
        expiresAt: signed.expiresAt,
        size_bytes: row.size_bytes,
        mime_type: row.mime_type,
      });
    } else if (row.kind === "source_glb") {
      glbs.push({
        id: row.id,
        version: row.version,
        status: row.status,
        size_bytes: row.size_bytes,
        mime_type: row.mime_type,
        created_at: row.created_at,
      });
    }
  }
  return { previews, glbs };
}

export async function createListing(
  pool: Pool,
  adminPhone: string,
  input: CreateListingInput,
): Promise<{ id: number; uuid: string }> {
  const uuid = randomUUID();
  try {
    const [result]: any = await pool.query(
      `INSERT INTO marketplace_listings
         (uuid, slug, name, breed, category, description, tags_json, dimensions_json,
          print_notes, digital_price_cents, physical_enabled, print_size_min_mm,
          print_size_max_mm, status, sort_order, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)`,
      [
        uuid, input.slug, input.name, input.breed ?? null, input.category,
        input.description ?? null,
        input.tags ? JSON.stringify(input.tags) : null,
        input.dimensions ? JSON.stringify(input.dimensions) : null,
        input.print_notes ?? null,
        input.digital_price_cents ?? null,
        input.physical_enabled ? 1 : 0,
        input.print_size_min_mm ?? null,
        input.print_size_max_mm ?? null,
        input.sort_order ?? 0,
        adminPhone,
      ],
    );
    return { id: Number(result.insertId), uuid };
  } catch (err: any) {
    if (err?.code === "ER_DUP_ENTRY") {
      throw new MarketplaceAdminError(409, `A listing with slug "${input.slug}" already exists.`);
    }
    throw err;
  }
}

/**
 * Publish gate. Everything that must be true before a listing goes live is
 * checked HERE, in one place, so no route can publish around it.
 */
export async function assertPublishable(pool: Pool, listingId: number): Promise<void> {
  const [listingRows]: any = await pool.query(
    `SELECT id, digital_price_cents FROM marketplace_listings WHERE id = ? LIMIT 1`,
    [listingId],
  );
  const listing = listingRows?.[0];
  if (!listing) throw new MarketplaceAdminError(404, "Listing not found.");

  const [assets]: any = await pool.query(
    `SELECT id, kind, status, source_provider, source_license
     FROM marketplace_assets WHERE listing_id = ?`,
    [listingId],
  );
  const active = (assets as any[]).filter((a) => a.status === "active");

  if (!active.some((a) => a.kind === "preview_image")) {
    throw new MarketplaceAdminError(422, "Cannot publish: the listing needs at least one preview image.");
  }
  if (listing.digital_price_cents != null && !active.some((a) => a.kind === "source_glb")) {
    throw new MarketplaceAdminError(422, "Cannot publish: a digitally priced listing needs a source GLB.");
  }
  try {
    assertCommercialLicence(active.map((a) => ({
      id: a.id,
      source_provider: String(a.source_provider),
      source_license: a.source_license ? String(a.source_license) : null,
    })));
  } catch (err: any) {
    throw new MarketplaceAdminError(422, String(err?.message || "Licence check failed."));
  }
}

export async function updateListing(
  pool: Pool,
  listingId: number,
  input: UpdateListingInput,
): Promise<void> {
  // The publish gate runs BEFORE any write, so a failed publish leaves the
  // listing exactly as it was — no half-applied status flips.
  if (input.status === "published") {
    await assertPublishable(pool, listingId);
  }

  const sets: string[] = [];
  const params: any[] = [];
  const push = (sql: string, value: any) => { sets.push(sql); params.push(value); };

  if (input.name !== undefined) push("name = ?", input.name);
  if (input.slug !== undefined) push("slug = ?", input.slug);
  if (input.breed !== undefined) push("breed = ?", input.breed ?? null);
  if (input.category !== undefined) push("category = ?", input.category);
  if (input.description !== undefined) push("description = ?", input.description ?? null);
  if (input.tags !== undefined) push("tags_json = ?", input.tags ? JSON.stringify(input.tags) : null);
  if (input.dimensions !== undefined) push("dimensions_json = ?", input.dimensions ? JSON.stringify(input.dimensions) : null);
  if (input.print_notes !== undefined) push("print_notes = ?", input.print_notes ?? null);
  if (input.digital_price_cents !== undefined) push("digital_price_cents = ?", input.digital_price_cents ?? null);
  if (input.physical_enabled !== undefined) push("physical_enabled = ?", input.physical_enabled ? 1 : 0);
  if (input.print_size_min_mm !== undefined) push("print_size_min_mm = ?", input.print_size_min_mm ?? null);
  if (input.print_size_max_mm !== undefined) push("print_size_max_mm = ?", input.print_size_max_mm ?? null);
  if (input.sort_order !== undefined) push("sort_order = ?", input.sort_order);
  if (input.status !== undefined) push("status = ?", input.status);
  if (!sets.length) throw new MarketplaceAdminError(400, "No changes supplied.");

  params.push(listingId);
  try {
    const [result]: any = await pool.query(
      `UPDATE marketplace_listings SET ${sets.join(", ")} WHERE id = ?`,
      params,
    );
    if (!result.affectedRows) throw new MarketplaceAdminError(404, "Listing not found.");
  } catch (err: any) {
    if (err?.code === "ER_DUP_ENTRY") {
      throw new MarketplaceAdminError(409, "That slug is already in use.");
    }
    throw err;
  }
  // NOTE deliberately absent: archiving performs NO entitlement writes.
  // Existing owners keep download access to what they bought (spec §5.2).
}

export async function reorderListings(
  pool: Pool,
  order: Array<{ id: number; sort_order: number }>,
): Promise<void> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    for (const { id, sort_order } of order) {
      await conn.query(`UPDATE marketplace_listings SET sort_order = ? WHERE id = ?`, [sort_order, id]);
    }
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/* ------------------------------------------------------------------ */
/* Uploads                                                             */
/* ------------------------------------------------------------------ */

export async function mintUploadUrl(
  pool: Pool,
  input: UploadUrlRequest,
): Promise<{ uploadUrl: string; objectKey: string; expiresAt: string }> {
  const [rows]: any = await pool.query(
    `SELECT id FROM marketplace_listings WHERE uuid = ? LIMIT 1`,
    [input.listing_uuid],
  );
  if (!rows?.[0]) throw new MarketplaceAdminError(404, "Listing not found.");

  const claim = validateUploadClaim(input.kind, input.mime_type, input.size_bytes);
  if (claim.ok === false) throw new MarketplaceAdminError(422, claim.error);

  // Key is minted HERE — the client's filename is display metadata only and
  // never influences the object path.
  const objectKey = mintObjectKey(input.listing_uuid, input.mime_type);
  return createPresignedUpload(objectKey, input.mime_type, PRESIGNED_UPLOAD_TTL_SECONDS);
}

/**
 * Confirm an upload landed, verify it, and write the asset row.
 *
 * TRUST BOUNDARY. The claim (size/mime/sha) came from the browser; the only
 * authority is what HeadObject reports about the stored object. Size and MIME
 * must agree exactly. (Backblaze's S3 HeadObject does not return a sha256, so
 * the claimed hash is recorded for provenance/dedup — the size+mime+key checks
 * are what stop a swapped payload.)
 */
export async function confirmAsset(
  pool: Pool,
  input: ConfirmAssetInput,
): Promise<{ assetId: number; version: number }> {
  const [listingRows]: any = await pool.query(
    `SELECT id FROM marketplace_listings WHERE uuid = ? LIMIT 1`,
    [input.listing_uuid],
  );
  const listing = listingRows?.[0];
  if (!listing) throw new MarketplaceAdminError(404, "Listing not found.");

  // The minted key embeds the listing UUID; a confirm against some other
  // listing's key must fail even if the object exists.
  if (!input.object_key.includes(input.listing_uuid)) {
    throw new MarketplaceAdminError(422, "Object key does not belong to this listing.");
  }

  const head = await headPrivateObject(input.object_key);
  if (!head) {
    throw new MarketplaceAdminError(422, "No object found at that key — the upload did not complete.");
  }
  if (head.sizeBytes !== input.size_bytes) {
    throw new MarketplaceAdminError(422,
      `Stored object is ${head.sizeBytes} bytes but ${input.size_bytes} were claimed.`);
  }
  if (head.mimeType !== input.mime_type) {
    throw new MarketplaceAdminError(422,
      `Stored object is ${head.mimeType} but ${input.mime_type} was claimed.`);
  }

  let version = 1;
  if (input.replaces_asset_id) {
    const [oldRows]: any = await pool.query(
      `SELECT id, version, kind FROM marketplace_assets WHERE id = ? AND listing_id = ? LIMIT 1`,
      [input.replaces_asset_id, listing.id],
    );
    const old = oldRows?.[0];
    if (!old) throw new MarketplaceAdminError(404, "Asset to replace was not found on this listing.");
    if (String(old.kind) !== input.kind) {
      throw new MarketplaceAdminError(422, "Replacement must be the same kind as the asset it replaces.");
    }
    version = Number(old.version) + 1;
    // Supersede, never delete: entitlements pinned to the old version keep
    // resolving, and the old object stays in the bucket.
    await pool.query(
      `UPDATE marketplace_assets SET status = 'superseded' WHERE id = ?`,
      [old.id],
    );
  }

  const provenance = input.provenance ?? { source_provider: "original" as const };
  const [result]: any = await pool.query(
    `INSERT INTO marketplace_assets
       (listing_id, asset_uuid, kind, bucket, object_key, mime_type, size_bytes, sha256,
        version, status, sort_order, source_provider, source_url, source_author,
        source_license, attribution_text)
     VALUES (?, ?, ?, 'private', ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?)`,
    [
      listing.id, randomUUID(), input.kind, input.object_key, input.mime_type,
      input.size_bytes, input.sha256.toLowerCase(), version, input.sort_order ?? 0,
      provenance.source_provider, provenance.source_url ?? null,
      provenance.source_author ?? null, provenance.source_license ?? null,
      provenance.attribution_text ?? null,
    ],
  );
  return { assetId: Number(result.insertId), version };
}

export async function updateAsset(
  pool: Pool,
  assetId: number,
  changes: { sort_order?: number; status?: "active" | "superseded" },
): Promise<void> {
  const sets: string[] = [];
  const params: any[] = [];
  if (changes.sort_order !== undefined) { sets.push("sort_order = ?"); params.push(changes.sort_order); }
  if (changes.status !== undefined) { sets.push("status = ?"); params.push(changes.status); }
  if (!sets.length) throw new MarketplaceAdminError(400, "No changes supplied.");
  params.push(assetId);
  const [result]: any = await pool.query(
    `UPDATE marketplace_assets SET ${sets.join(", ")} WHERE id = ?`,
    params,
  );
  if (!result.affectedRows) throw new MarketplaceAdminError(404, "Asset not found.");
}
