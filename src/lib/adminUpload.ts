import { authedFetch } from "../api";

/**
 * Direct-to-Backblaze admin upload pipeline (Phase 3).
 *
 * The file body NEVER touches the app server:
 *   1. ask the server for a presigned PUT (it validates the claim and mints
 *      the object key — the filename here is display metadata only)
 *   2. PUT the bytes straight to Backblaze (XMLHttpRequest, because fetch
 *      still has no upload-progress events)
 *   3. sha-256 the bytes locally with WebCrypto
 *   4. confirm with the server, which re-verifies size+MIME via HeadObject
 *      before any asset row exists — nothing from this module is trusted.
 *
 * Every step reports through onProgress so the UI can show exactly where a
 * failure happened instead of a generic "upload failed".
 */

export type UploadStage =
  | { stage: "requesting-url" }
  | { stage: "uploading"; percent: number }
  | { stage: "hashing" }
  | { stage: "confirming" }
  | { stage: "done"; assetId: number; version: number }
  | { stage: "error"; at: "requesting-url" | "uploading" | "hashing" | "confirming"; message: string };

export interface UploadResult {
  assetId: number;
  version: number;
  objectKey: string;
}

async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function putWithProgress(
  url: string,
  body: ArrayBuffer,
  contentType: string,
  onPercent: (percent: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    // Content-Type must match what the presign was minted for — a mismatch is
    // a signature error at Backblaze, which surfaces here as a 403.
    xhr.setRequestHeader("Content-Type", contentType);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onPercent(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`Storage rejected the upload (HTTP ${xhr.status}).`));
    };
    xhr.onerror = () => reject(new Error("Network error during upload."));
    xhr.ontimeout = () => reject(new Error("Upload timed out."));
    xhr.timeout = 10 * 60 * 1000; // 100 MB on slow admin uplinks is legitimate
    xhr.send(body);
  });
}

export async function uploadMarketplaceAsset(opts: {
  listingUuid: string;
  kind: "source_glb" | "preview_image";
  file: File;
  replacesAssetId?: number;
  sortOrder?: number;
  provenance?: {
    source_provider: "original" | "sketchfab";
    source_url?: string;
    source_author?: string;
    source_license?: string;
    attribution_text?: string;
  };
  onProgress?: (s: UploadStage) => void;
}): Promise<UploadResult> {
  const progress = opts.onProgress ?? (() => {});
  const mimeType = opts.file.type || (opts.kind === "source_glb" ? "model/gltf-binary" : "application/octet-stream");

  // -- 1: presigned URL ------------------------------------------------------
  progress({ stage: "requesting-url" });
  let uploadUrl: string;
  let objectKey: string;
  try {
    const res = await authedFetch("/api/admin/marketplace/upload-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        listing_uuid: opts.listingUuid,
        kind: opts.kind,
        filename: opts.file.name,
        mime_type: mimeType,
        size_bytes: opts.file.size,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || `Upload URL request failed (${res.status}).`);
    uploadUrl = data.uploadUrl;
    objectKey = data.objectKey;
  } catch (e: any) {
    progress({ stage: "error", at: "requesting-url", message: e?.message || "Could not start the upload." });
    throw e;
  }

  // -- 2: direct PUT to Backblaze -------------------------------------------
  const bytes = await opts.file.arrayBuffer();
  try {
    progress({ stage: "uploading", percent: 0 });
    await putWithProgress(uploadUrl, bytes, mimeType, (percent) => progress({ stage: "uploading", percent }));
  } catch (e: any) {
    progress({ stage: "error", at: "uploading", message: e?.message || "Upload failed." });
    throw e;
  }

  // -- 3: local hash ---------------------------------------------------------
  progress({ stage: "hashing" });
  let sha256: string;
  try {
    sha256 = await sha256Hex(bytes);
  } catch (e: any) {
    progress({ stage: "error", at: "hashing", message: "Could not hash the file locally." });
    throw e;
  }

  // -- 4: confirm (server re-verifies via HeadObject) ------------------------
  progress({ stage: "confirming" });
  try {
    const res = await authedFetch("/api/admin/marketplace/assets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        listing_uuid: opts.listingUuid,
        kind: opts.kind,
        object_key: objectKey,
        sha256,
        size_bytes: opts.file.size,
        mime_type: mimeType,
        ...(opts.sortOrder !== undefined ? { sort_order: opts.sortOrder } : {}),
        ...(opts.replacesAssetId ? { replaces_asset_id: opts.replacesAssetId } : {}),
        ...(opts.provenance ? { provenance: opts.provenance } : {}),
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || `Confirmation failed (${res.status}).`);
    progress({ stage: "done", assetId: data.assetId, version: data.version });
    return { assetId: data.assetId, version: data.version, objectKey };
  } catch (e: any) {
    progress({ stage: "error", at: "confirming", message: e?.message || "Could not confirm the upload." });
    throw e;
  }
}
