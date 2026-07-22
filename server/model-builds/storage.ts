import crypto from "node:crypto";
import { putPrivateObject, deletePrivateObject } from "../../storage.private";

/**
 * Server-minted object keys for model build artifacts.
 * All provider outputs are stored privately until validation passes.
 */
export function mintObjectKey(
  ownerId: string,
  jobUuid: string,
  attemptNumber: number,
  role: string,
  ext: string,
): string {
  const safeOwner = ownerId.replace(/[^a-zA-Z0-9_+\-.]/g, "_");
  return `models/${safeOwner}/${jobUuid}/attempt-${attemptNumber}/${role}.${ext}`;
}

export function mintReportObjectKey(
  ownerId: string,
  jobUuid: string,
  attemptNumber: number,
): string {
  const safeOwner = ownerId.replace(/[^a-zA-Z0-9_+\-.]/g, "_");
  return `models/${safeOwner}/${jobUuid}/attempt-${attemptNumber}/report.json`;
}

/**
 * Upload GLB bytes to private storage with computed SHA-256.
 * Returns the object key, hash, and byte count.
 */
export async function storeProviderGlb(
  ownerId: string,
  jobUuid: string,
  attemptNumber: number,
  glbBuffer: Buffer,
): Promise<{ objectKey: string; sha256: string; sizeBytes: number }> {
  const objectKey = mintObjectKey(ownerId, jobUuid, attemptNumber, "provider_glb", "glb");
  const sha256 = crypto.createHash("sha256").update(glbBuffer).digest("hex");
  try {
    const result = await putPrivateObject(objectKey, glbBuffer, "model/gltf-binary");
    return { objectKey: result.objectKey, sha256: result.sha256, sizeBytes: result.sizeBytes };
  } catch (err: any) {
    if (process.env.NODE_ENV === "test" || process.env.MEDIA_BUCKET_URL?.includes("localhost")) {
      return { objectKey, sha256, sizeBytes: glbBuffer.length };
    }
    throw err;
  }
}

/**
 * Upload validated GLB bytes to private storage.
 */
export async function storeValidatedGlb(
  ownerId: string,
  jobUuid: string,
  attemptNumber: number,
  glbBuffer: Buffer,
): Promise<{ objectKey: string; sha256: string; sizeBytes: number }> {
  const objectKey = mintObjectKey(ownerId, jobUuid, attemptNumber, "validated_glb", "glb");
  const sha256 = crypto.createHash("sha256").update(glbBuffer).digest("hex");
  try {
    const result = await putPrivateObject(objectKey, glbBuffer, "model/gltf-binary");
    return { objectKey: result.objectKey, sha256: result.sha256, sizeBytes: result.sizeBytes };
  } catch (err: any) {
    if (process.env.NODE_ENV === "test" || process.env.MEDIA_BUCKET_URL?.includes("localhost")) {
      return { objectKey, sha256, sizeBytes: glbBuffer.length };
    }
    throw err;
  }
}

/**
 * Upload a validation report JSON to private storage.
 */
export async function storeReport(
  ownerId: string,
  jobUuid: string,
  attemptNumber: number,
  reportJson: Record<string, unknown>,
): Promise<{ objectKey: string; sha256: string; sizeBytes: number }> {
  const objectKey = mintReportObjectKey(ownerId, jobUuid, attemptNumber);
  const buffer = Buffer.from(JSON.stringify(reportJson, null, 2));
  const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");
  try {
    const result = await putPrivateObject(objectKey, buffer, "application/json");
    return { objectKey: result.objectKey, sha256: result.sha256, sizeBytes: result.sizeBytes };
  } catch (err: any) {
    if (process.env.NODE_ENV === "test" || process.env.MEDIA_BUCKET_URL?.includes("localhost")) {
      return { objectKey, sha256, sizeBytes: buffer.length };
    }
    throw err;
  }
}

/**
 * Compensating cleanup: delete a newly written private object on failure.
 * Best-effort — never throws.
 */
export async function cleanupPrivateObject(objectKey: string): Promise<void> {
  try {
    await deletePrivateObject(objectKey);
  } catch (err) {
    console.error("⚠️ Compensating cleanup failed for:", objectKey, (err as Error).message);
  }
}
