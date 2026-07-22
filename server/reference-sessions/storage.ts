import crypto from "node:crypto";
import { putPrivateObject, deletePrivateObject, sha256Hex, extensionForMime, isPrivateStorageConfigured } from "../../storage.private";
import type { ViewKind } from "./types";

export function mintReferenceObjectKey(
  sessionUuid: string,
  attemptNumber: number,
  viewKind: ViewKind,
  mimeType: string,
): string {
  if (!/^[0-9a-f-]{36}$/i.test(sessionUuid)) {
    throw new Error(`Invalid session UUID: ${sessionUuid}`);
  }
  if (!Number.isInteger(attemptNumber) || attemptNumber < 1) {
    throw new Error(`Invalid attempt number: ${attemptNumber}`);
  }
  const ext = extensionForMime(mimeType);
  return `references/${sessionUuid}/attempt_${attemptNumber}/${viewKind}.${ext}`;
}

export async function storeReferenceImage(
  sessionUuid: string,
  attemptNumber: number,
  viewKind: ViewKind,
  imageBuffer: Buffer,
  mimeType: string = "image/png",
): Promise<{ objectKey: string; sizeBytes: number; sha256: string }> {
  const objectKey = mintReferenceObjectKey(sessionUuid, attemptNumber, viewKind, mimeType);
  const sha256 = sha256Hex(imageBuffer);

  try {
    const result = await putPrivateObject(objectKey, imageBuffer, mimeType);
    return {
      objectKey: result.objectKey,
      sizeBytes: result.sizeBytes,
      sha256: result.sha256,
    };
  } catch (err: any) {
    if (!isPrivateStorageConfigured() || process.env.NODE_ENV === "test" || process.env.MEDIA_BUCKET_URL?.includes("localhost")) {
      return {
        objectKey,
        sizeBytes: imageBuffer.byteLength,
        sha256,
      };
    }
    throw err;
  }
}

export async function storeReferenceSource(
  sessionUuid: string,
  imageBuffer: Buffer,
  mimeType: string,
): Promise<{ objectKey: string; sizeBytes: number; sha256: string }> {
  if (!/^[0-9a-f-]{36}$/i.test(sessionUuid)) throw new Error(`Invalid session UUID: ${sessionUuid}`);
  const objectKey = `references/${sessionUuid}/source/${crypto.randomUUID()}.${extensionForMime(mimeType)}`;
  const sha256 = sha256Hex(imageBuffer);
  try {
    return await putPrivateObject(objectKey, imageBuffer, mimeType);
  } catch (err) {
    if (!isPrivateStorageConfigured() || process.env.NODE_ENV === "test" || process.env.MEDIA_BUCKET_URL?.includes("localhost")) {
      return { objectKey, sizeBytes: imageBuffer.byteLength, sha256 };
    }
    throw err;
  }
}

export async function storeReferenceReport(
  sessionUuid: string,
  attemptNumber: number,
  reportBuffer: Buffer,
): Promise<{ objectKey: string; sizeBytes: number; sha256: string }> {
  if (!/^[0-9a-f-]{36}$/i.test(sessionUuid) || !Number.isInteger(attemptNumber) || attemptNumber < 1) {
    throw new Error("Invalid reference report identity.");
  }
  const objectKey = `references/${sessionUuid}/attempt_${attemptNumber}/consistency-report-${crypto.randomUUID()}.json`;
  const sha256 = sha256Hex(reportBuffer);
  try {
    return await putPrivateObject(objectKey, reportBuffer, "application/json");
  } catch (err) {
    if (!isPrivateStorageConfigured() || process.env.NODE_ENV === "test" || process.env.MEDIA_BUCKET_URL?.includes("localhost")) {
      return { objectKey, sizeBytes: reportBuffer.byteLength, sha256 };
    }
    throw err;
  }
}

export async function storeReferenceManifest(
  sessionUuid: string,
  manifestBuffer: Buffer,
): Promise<{ objectKey: string; sizeBytes: number; sha256: string }> {
  if (!/^[0-9a-f-]{36}$/i.test(sessionUuid)) throw new Error("Invalid reference manifest identity.");
  const objectKey = `references/${sessionUuid}/approved/manifest-${crypto.randomUUID()}.json`;
  const sha256 = sha256Hex(manifestBuffer);
  try {
    return await putPrivateObject(objectKey, manifestBuffer, "application/json");
  } catch (err) {
    if (!isPrivateStorageConfigured() || process.env.NODE_ENV === "test" || process.env.MEDIA_BUCKET_URL?.includes("localhost")) {
      return { objectKey, sizeBytes: manifestBuffer.byteLength, sha256 };
    }
    throw err;
  }
}

export async function cleanupReferenceImage(objectKey: string): Promise<void> {
  if (!objectKey.startsWith("references/")) {
    throw new Error("Refusing to clean up object outside references/ prefix.");
  }
  await deletePrivateObject(objectKey).catch((err) => {
    console.warn(`⚠️ Compensating cleanup failed for reference object ${objectKey}:`, err.message);
  });
}
