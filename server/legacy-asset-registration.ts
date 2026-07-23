import { getPool } from "../db";
import { registerAsset, addLineage } from "./assets/service";
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
 * Register a finished GLB from the legacy pipeline as a canonical
 * private asset with lineage back to the source image.
 *
 * Returns the registered asset UUID, or null if registration fails
 * (non-fatal — the model is already in the creation row).
 */
export async function registerLegacyModelAsset(
  input: LegacyGlbRegistration,
): Promise<string | null> {
  const pool = getPool();
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
        sizeBytes: input.sizeBytes,
        sha256: input.sha256,
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
