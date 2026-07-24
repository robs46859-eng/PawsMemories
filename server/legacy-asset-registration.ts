import { createHash } from "node:crypto";
import { getPool } from "../db";
import { registerAsset } from "./assets/service";
import { recordPersistenceEvent } from "./model-persistence-events";

export interface LegacyGlbRegistration {
  ownerId: string;
  glbUrl: string;          // signed URL or object key that was stored
  sha256: string;
  sizeBytes: number;
  sourceImageUrl: string;
  mimeType?: string;
  jobId?: number;
  creationId?: number;
}

/**
 * Fetch the remote GLB and compute its SHA-256 hash and byte size.
 * Returns null if the URL is unreachable (callers gracefully fall back).
 */
async function computeSha256FromUrl(
  url: string,
): Promise<{ sha256: string; sizeBytes: number } | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(
        `[legacy-asset-registration] Cannot fetch ${url} for hash computation (HTTP ${res.status})`,
      );
      return null;
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    const hash = createHash("sha256").update(buffer).digest("hex");
    return { sha256: hash, sizeBytes: buffer.length };
  } catch (err: any) {
    console.warn(
      `[legacy-asset-registration] Failed to fetch ${url} for hash computation: ${err?.message}`,
    );
    return null;
  }
}

/**
 * Register a finished GLB from the legacy pipeline as a canonical
 * private asset with lineage back to the source image.
 *
 * When sha256 is "unknown" or sizeBytes is 0, attempts to fetch the
 * stored GLB URL and compute the real values. Falls back to
 * "unknown"/0 if the fetch fails (non-fatal — the model is already
 * stored in the creation row).
 *
 * Returns the registered asset UUID, or null if registration fails
 * (non-fatal).
 */
export async function registerLegacyModelAsset(
  input: LegacyGlbRegistration,
): Promise<string | null> {
  const pool = getPool();

  // Resolve real sha256/sizeBytes when placeholders are provided.
  let { sha256, sizeBytes } = input;
  if (
    !sha256 ||
    sha256 === "unknown" ||
    sizeBytes === 0
  ) {
    const computed = await computeSha256FromUrl(input.glbUrl);
    if (computed) {
      sha256 = computed.sha256;
      sizeBytes = computed.sizeBytes;
    }
    // else: keep the original values as-is
  }

  try {
    // The GLB is stored as a public URL (uploadBinaryFromUrl creates these).
    // We register it as a canonical asset in the private bucket.
    // Since the URL is already stored as creation.model_url, we register
    // a canonical reference pointing to that URL.
    const result = await registerAsset(
      {
        ownerId: input.ownerId,
        assetType: "model_glb",
        visibility: "private",
        mimeType: input.mimeType ?? "model/gltf-binary",
        sizeBytes,
        sha256,
        bucket: "public",  // legacy models are stored in public bucket
        objectKey: input.glbUrl,
        sourceProvider: "tripo",
        license: "proprietary",
        commercialUseEligible: false,
        metadata: {
          phase: "bo-0",
          role: "legacy_model",
          legacy: true,
          sourceImageUrl: input.sourceImageUrl,
        },
        legacyTable: input.creationId ? "creations" : undefined,
        legacyId: input.creationId ? String(input.creationId) : undefined,
      },
      { authorization: { internal: true }, pool },
    );

    const assetUuid = result.asset.asset_uuid;

    // Record audit event
    await recordPersistenceEvent("canonical_asset_registered", {
      jobId: input.jobId,
      assetUuid,
      detail: `Legacy model registered as canonical asset ${assetUuid}`,
    });

    return assetUuid;
  } catch (err: any) {
    console.error("[legacy-asset-registration] Failed to register canonical asset:", err?.message);
    return null;
  }
}
