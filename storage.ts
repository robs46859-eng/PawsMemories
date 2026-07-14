import { randomUUID } from "node:crypto";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import {
  createPrivateMediaStoreFromEnv,
  type PrivateMediaGetRequest,
  type PrivateMediaObject,
  type PrivateMediaStore,
  type PrivateMediaUpload,
} from "./server/privateMediaStore.ts";

export type {
  PrivateMediaConfig,
  PrivateMediaGetRequest,
  PrivateMediaMimeType,
  PrivateMediaObject,
  PrivateMediaStore,
  PrivateMediaStoreDependencies,
  PrivateMediaUpload,
} from "./server/privateMediaStore.ts";

let defaultPrivateMediaStore: PrivateMediaStore | undefined;
let legacyPublicClient: S3Client | undefined;

function getDefaultPrivateMediaStore(): PrivateMediaStore {
  defaultPrivateMediaStore ??= createPrivateMediaStoreFromEnv();
  return defaultPrivateMediaStore;
}

function getLegacyPublicClient(): S3Client {
  const endpoint = process.env.MEDIA_BUCKET_URL;
  const accessKeyId = process.env.MEDIA_BUCKET_KEY;
  const secretAccessKey = process.env.MEDIA_BUCKET_SECRET;
  if (!endpoint || !accessKeyId || !secretAccessKey) {
    throw new Error("Legacy public object storage is not configured.");
  }
  legacyPublicClient ??= new S3Client({
    region: process.env.MEDIA_BUCKET_REGION || "us-east-1",
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: true,
  });
  return legacyPublicClient;
}

/**
 * Uploads a validated object privately and returns only its opaque storage
 * metadata. New owner-aware call sites should use this instead of the legacy
 * string-returning helpers below.
 */
export async function uploadPrivateMediaObject(input: PrivateMediaUpload): Promise<PrivateMediaObject> {
  return getDefaultPrivateMediaStore().uploadObject(input);
}

/** Creates a short-lived read URL after checking the object's owner scope. */
export async function createPrivateMediaGetUrl(input: PrivateMediaGetRequest): Promise<string> {
  return getDefaultPrivateMediaStore().createPresignedGetUrl(input);
}

/** Maps a MIME type to an appropriate file extension for legacy callers. */
export function getExtensionFromMime(mimeType: string): string {
  const map: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/webp": "webp",
    "video/mp4": "mp4",
    "video/webm": "webm",
    "model/gltf-binary": "glb",
    "model/gltf+json": "gltf",
    "application/octet-stream": "glb",
    "audio/webm": "webm",
    "audio/mpeg": "mp3",
    "audio/mp4": "m4a",
    "audio/wav": "wav",
    "application/x-step": "ifc",
    "application/json": "json",
  };
  if (map[mimeType]) return map[mimeType];

  if (mimeType.startsWith("image/")) return "png";
  if (mimeType.startsWith("video/")) return "mp4";
  if (mimeType.startsWith("model/")) return "glb";
  if (mimeType.startsWith("audio/")) return "mp3";

  return "bin";
}

/** Selects a legacy object folder unless the caller supplies one. */
export function getFolderFromMime(mimeType: string, folderOverride?: string): string {
  if (folderOverride) return folderOverride;
  if (mimeType.startsWith("video/")) return "videos";
  if (mimeType.startsWith("model/")) return "models";
  if (mimeType.startsWith("audio/")) return "sounds";
  return "creations";
}

function decodeBase64(base64: string): Buffer {
  const compact = base64.replace(/\s/g, "");
  if (!compact || !/^[A-Za-z0-9+/]*={0,2}$/.test(compact)) {
    throw new Error("Invalid base64 media payload.");
  }
  return Buffer.from(compact, "base64");
}

function parseDataUrl(base64String: string): { mimeType: string; body: Buffer } {
  let value = base64String.trim();
  if (value.startsWith("Z2xURg")) {
    value = `data:model/gltf-binary;base64,${value}`;
  }

  const match = value.match(/^data:([A-Za-z0-9+./-]+);base64,([\s\S]+)$/);
  if (!match) {
    throw new Error("Invalid base64 data URL.");
  }

  return {
    mimeType: match[1],
    body: decodeBase64(match[2]),
  };
}

async function uploadForLegacyCaller(body: Uint8Array, mimeType: string, folder?: string): Promise<string> {
  const bucket = process.env.MEDIA_BUCKET_NAME;
  const endpoint = process.env.MEDIA_BUCKET_URL;
  if (!bucket || !endpoint) throw new Error("Legacy public object storage is not configured.");
  const extension = getExtensionFromMime(mimeType);
  const objectFolder = getFolderFromMime(mimeType, folder);
  const storageKey = `${objectFolder}/${Date.now()}-${randomUUID()}.${extension}`;
  await getLegacyPublicClient().send(new PutObjectCommand({
    Bucket: bucket,
    Key: storageKey,
    Body: body,
    ContentLength: body.byteLength,
    ContentType: mimeType,
    ACL: "public-read",
  }));
  const url = new URL(endpoint);
  return `${url.protocol}//${bucket}.${url.host}/${storageKey}`;
}

/**
 * Compatibility wrapper for server.ts while its URL fields are migrated. It
 * continues to use the legacy public bucket so persisted URLs do not expire.
 * New generated media must use uploadPrivateMediaObject instead.
 */
export async function uploadBase64Image(base64String: string, folderOverride?: string): Promise<string> {
  const { mimeType, body } = parseDataUrl(base64String);
  return uploadForLegacyCaller(body, mimeType, getFolderFromMime(mimeType, folderOverride));
}

/**
 * Compatibility wrapper for raw base64 uploads in the legacy public bucket.
 */
export async function uploadBase64Binary(
  base64: string,
  mimeType: string = "model/gltf-binary",
  folderOverride?: string
): Promise<string> {
  const raw = base64.startsWith("data:") ? base64.slice(base64.indexOf(",") + 1) : base64;
  return uploadForLegacyCaller(
    decodeBase64(raw),
    mimeType,
    getFolderFromMime(mimeType, folderOverride)
  );
}

/**
 * Compatibility wrapper for mirroring an existing remote asset. Remote fetch
 * behavior is intentionally unchanged in this private-storage foundation slice.
 */
export async function uploadBinaryFromUrl(
  sourceUrl: string,
  mimeType: string = "model/gltf-binary",
  folderOverride?: string
): Promise<string> {
  const res = await fetch(sourceUrl);
  if (!res.ok) {
    throw new Error(`Failed to download remote asset (${res.status}) from ${sourceUrl}`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  return uploadForLegacyCaller(buffer, mimeType, getFolderFromMime(mimeType, folderOverride));
}

/** Fetches a URL and converts it to a data URI base64 string. */
export async function fetchUrlAsBase64(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url} for base64 conversion: ${res.status}`);
  const arrayBuffer = await res.arrayBuffer();
  const base64 = Buffer.from(arrayBuffer).toString("base64");
  const mime = res.headers.get("content-type") || "application/octet-stream";
  return `data:${mime};base64,${base64}`;
}
