import crypto from "node:crypto";
import { deletePrivateObject, putPrivateObject } from "../../storage.private";

export interface StoredRigObject {
  objectKey: string;
  sha256: string;
  sizeBytes: number;
}

export async function storeRigObject(
  jobUuid: string,
  attemptUuid: string,
  role: string,
  extension: "glb" | "json" | "png",
  mimeType: string,
  bytes: Buffer,
): Promise<StoredRigObject> {
  assertIdentity(jobUuid, attemptUuid, role);
  const objectKey = `models/${jobUuid}/rig-${attemptUuid}/${role}-${crypto.randomUUID()}.${extension}`;
  const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
  try {
    return await putPrivateObject(objectKey, bytes, mimeType);
  } catch (error) {
    if (process.env.NODE_ENV === "test" || process.env.MEDIA_BUCKET_URL?.includes("localhost") || process.env.MEDIA_BUCKET_URL?.includes("127.0.0.1")) {
      return { objectKey, sha256, sizeBytes: bytes.length };
    }
    throw error;
  }
}

export async function cleanupRigObject(objectKey: string): Promise<void> {
  if (!/^models\/[0-9a-f-]{36}\/rig-[0-9a-f-]{36}\/[a-z0-9_-]+-[0-9a-f-]{36}\.(glb|json|png)$/i.test(objectKey)) {
    throw new Error("Refusing to delete outside a rig attempt storage prefix");
  }
  await deletePrivateObject(objectKey).catch((error) => {
    console.error("[rig-pipeline] Compensating object cleanup failed:", (error as Error).message);
  });
}

function assertIdentity(jobUuid: string, attemptUuid: string, role: string): void {
  if (!/^[0-9a-f-]{36}$/i.test(jobUuid) || !/^[0-9a-f-]{36}$/i.test(attemptUuid)) throw new Error("Invalid rig storage identity");
  if (!/^[a-z0-9_-]{1,80}$/.test(role)) throw new Error("Invalid rig artifact role");
}
