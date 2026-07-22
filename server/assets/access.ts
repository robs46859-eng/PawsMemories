import type { AssetRecord, AssetVersionRecord } from "./types";
import { getPrivateSignedUrl } from "../../storage.private";
import { getPublicObjectUrl } from "../../storage";
import { AssetServiceError } from "./service";

export interface AccessAuthorizationResult {
  allowed: boolean;
  reason?: string;
  isOwner: boolean;
  isAdmin: boolean;
}

export function authorizeAssetAccess(
  asset: AssetRecord,
  requestingUserPhone?: string,
  userIsAdmin: boolean = false,
): AccessAuthorizationResult {
  const isOwner = Boolean(requestingUserPhone && asset.owner_id === requestingUserPhone);

  if (userIsAdmin) {
    return { allowed: true, isOwner, isAdmin: true };
  }

  if (asset.visibility === "public" || asset.visibility === "published") {
    return { allowed: true, isOwner, isAdmin: false };
  }

  if (isOwner) {
    return { allowed: true, isOwner: true, isAdmin: false };
  }

  return {
    allowed: false,
    reason: "Private asset access denied for non-owner.",
    isOwner: false,
    isAdmin: false,
  };
}

export async function generateSignedUrlForVersion(
  asset: AssetRecord,
  version: AssetVersionRecord,
  requestingUserPhone?: string,
  userIsAdmin: boolean = false,
  ttlSeconds: number = 900,
): Promise<string> {
  const auth = authorizeAssetAccess(asset, requestingUserPhone, userIsAdmin);
  if (!auth.allowed) {
    throw new AssetServiceError(auth.reason || "Unauthorized asset access", "UNAUTHORIZED");
  }

  if (version.bucket === "public") {
    try {
      return getPublicObjectUrl(version.object_key);
    } catch {
      throw new AssetServiceError("Public storage bucket is not configured", "STORAGE_NOT_CONFIGURED");
    }
  }

  // Private storage bucket signed URL
  const signed = await getPrivateSignedUrl(version.object_key, ttlSeconds);
  return signed.url;
}
