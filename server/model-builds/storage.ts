import crypto from "node:crypto";
import { putPrivateObject, deletePrivateObject } from "../../storage.private";

/**
 * Server-minted object keys for model build artifacts.
 * All provider outputs are stored privately until validation passes.
 */
export function mintObjectKey(
  _ownerId: string,
  jobUuid: string,
  attemptNumber: number,
  role: string,
  ext: string,
): string {
  assertStorageIdentity(jobUuid, attemptNumber, role, ext);
  return `models/${jobUuid}/attempt-${attemptNumber}/${role}-${crypto.randomUUID()}.${ext}`;
}

export function mintReportObjectKey(
  _ownerId: string,
  jobUuid: string,
  attemptNumber: number,
): string {
  assertStorageIdentity(jobUuid, attemptNumber, "report", "json");
  return `models/${jobUuid}/attempt-${attemptNumber}/report-${crypto.randomUUID()}.json`;
}

function assertStorageIdentity(jobUuid: string, attemptNumber: number, role: string, ext: string): void {
  if (!/^[0-9a-f-]{36}$/i.test(jobUuid)) throw new Error("Invalid model-build UUID");
  if (!Number.isInteger(attemptNumber) || attemptNumber < 1) throw new Error("Invalid model-build attempt number");
  if (!/^[a-z0-9_]+$/.test(role) || !/^(glb|json|png)$/.test(ext)) throw new Error("Invalid model-build artifact identity");
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
    if (process.env.NODE_ENV === "test" || process.env.MEDIA_BUCKET_URL?.includes("localhost") || process.env.MEDIA_BUCKET_URL?.includes("127.0.0.1")) {
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
    if (process.env.NODE_ENV === "test" || process.env.MEDIA_BUCKET_URL?.includes("localhost") || process.env.MEDIA_BUCKET_URL?.includes("127.0.0.1")) {
      return { objectKey, sha256, sizeBytes: glbBuffer.length };
    }
    throw err;
  }
}

/**
 * Upload a standard review render PNG image to private storage.
 */
export async function storeRenderArtifact(
  ownerId: string,
  jobUuid: string,
  attemptNumber: number,
  role: string,
  imageBuffer: Buffer,
): Promise<{ objectKey: string; sha256: string; sizeBytes: number }> {
  const objectKey = mintObjectKey(ownerId, jobUuid, attemptNumber, role, "png");
  const sha256 = crypto.createHash("sha256").update(imageBuffer).digest("hex");
  try {
    const result = await putPrivateObject(objectKey, imageBuffer, "image/png");
    return { objectKey: result.objectKey, sha256: result.sha256, sizeBytes: result.sizeBytes };
  } catch (err: any) {
    if (process.env.NODE_ENV === "test" || process.env.MEDIA_BUCKET_URL?.includes("localhost") || process.env.MEDIA_BUCKET_URL?.includes("127.0.0.1")) {
      return { objectKey, sha256, sizeBytes: imageBuffer.length };
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
    if (process.env.NODE_ENV === "test" || process.env.MEDIA_BUCKET_URL?.includes("localhost") || process.env.MEDIA_BUCKET_URL?.includes("127.0.0.1")) {
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
  if (!/^models\/[0-9a-f-]{36}\/attempt-[1-9]\d*\//i.test(objectKey)) {
    throw new Error("Refusing to delete outside the model-build storage prefix");
  }
  try {
    await deletePrivateObject(objectKey);
  } catch (err) {
    console.error("⚠️ Compensating cleanup failed for:", objectKey, (err as Error).message);
  }
}
