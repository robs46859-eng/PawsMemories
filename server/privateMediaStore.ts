import { createHash, randomUUID } from "node:crypto";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const MEDIA_EXTENSIONS = {
  "application/json": "json",
  "application/octet-stream": "glb",
  "application/x-step": "ifc",
  "audio/mp4": "m4a",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/webm": "webm",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "model/gltf+json": "gltf",
  "model/gltf-binary": "glb",
  "video/mp4": "mp4",
  "video/webm": "webm",
} as const;

export type PrivateMediaMimeType = keyof typeof MEDIA_EXTENSIONS;

export const DEFAULT_MEDIA_MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
export const DEFAULT_MEDIA_GET_EXPIRY_SECONDS = 300;
export const MAX_MEDIA_GET_EXPIRY_SECONDS = 900;

export interface PrivateMediaConfig {
  bucketName: string;
  bucketEndpoint: string;
  bucketRegion: string;
  accessKeyId: string;
  secretAccessKey: string;
  maxUploadBytes?: number;
  maxGetExpirySeconds?: number;
}

export interface PrivateMediaObject {
  storageKey: string;
  contentType: PrivateMediaMimeType;
  sizeBytes: number;
}

export interface PrivateMediaUpload {
  ownerId: string;
  body: Uint8Array;
  mimeType: string;
  folder?: string;
}

export interface PrivateMediaGetRequest {
  ownerId: string;
  storageKey: string;
  expiresInSeconds?: number;
}

export interface PrivateMediaStore {
  uploadObject(input: PrivateMediaUpload): Promise<PrivateMediaObject>;
  createPresignedGetUrl(input: PrivateMediaGetRequest): Promise<string>;
}

export interface PrivateMediaStoreDependencies {
  sendPutObject?: (command: PutObjectCommand) => Promise<unknown>;
  signGetObject?: (command: GetObjectCommand, expiresInSeconds: number) => Promise<string>;
  now?: () => number;
  createId?: () => string;
}

interface ObjectKeyInput {
  ownerId: string;
  mimeType: PrivateMediaMimeType;
  folder?: string;
  timestampMs: number;
  id: string;
}

type Environment = Readonly<Record<string, string | undefined>>;

function requireConfigValue(env: Environment, name: string): string {
  const value = env[name]?.trim();
  if (!value) {
    throw new Error(`Object storage is not configured: ${name} is required.`);
  }
  return value;
}

function normalizePositiveInteger(value: number | undefined, fallback: number, name: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return resolved;
}

function normalizeConfig(config: PrivateMediaConfig): Required<PrivateMediaConfig> {
  const bucketName = config.bucketName.trim();
  const bucketEndpoint = config.bucketEndpoint.trim();
  const bucketRegion = config.bucketRegion.trim();
  const accessKeyId = config.accessKeyId.trim();
  const secretAccessKey = config.secretAccessKey.trim();

  if (!bucketName || !bucketEndpoint || !bucketRegion || !accessKeyId || !secretAccessKey) {
    throw new Error("Object storage configuration is incomplete.");
  }

  let endpoint: URL;
  try {
    endpoint = new URL(bucketEndpoint);
  } catch {
    throw new Error("PRIVATE_MEDIA_BUCKET_URL must be a valid URL.");
  }
  if (endpoint.protocol !== "https:" && endpoint.protocol !== "http:") {
    throw new Error("PRIVATE_MEDIA_BUCKET_URL must use HTTP or HTTPS.");
  }

  const maxGetExpirySeconds = normalizePositiveInteger(
    config.maxGetExpirySeconds,
    MAX_MEDIA_GET_EXPIRY_SECONDS,
    "maxGetExpirySeconds"
  );
  if (maxGetExpirySeconds > MAX_MEDIA_GET_EXPIRY_SECONDS) {
    throw new Error(`maxGetExpirySeconds cannot exceed ${MAX_MEDIA_GET_EXPIRY_SECONDS}.`);
  }

  return {
    bucketName,
    bucketEndpoint: endpoint.toString().replace(/\/$/, ""),
    bucketRegion,
    accessKeyId,
    secretAccessKey,
    maxUploadBytes: normalizePositiveInteger(
      config.maxUploadBytes,
      DEFAULT_MEDIA_MAX_UPLOAD_BYTES,
      "maxUploadBytes"
    ),
    maxGetExpirySeconds,
  };
}

export function readPrivateMediaConfig(env: Environment = process.env): PrivateMediaConfig {
  return {
    bucketName: requireConfigValue(env, "PRIVATE_MEDIA_BUCKET_NAME"),
    bucketEndpoint: requireConfigValue(env, "PRIVATE_MEDIA_BUCKET_URL"),
    bucketRegion: env.PRIVATE_MEDIA_BUCKET_REGION?.trim() || "us-east-1",
    accessKeyId: requireConfigValue(env, "PRIVATE_MEDIA_BUCKET_KEY"),
    secretAccessKey: requireConfigValue(env, "PRIVATE_MEDIA_BUCKET_SECRET"),
  };
}

export function validatePrivateMediaMimeType(mimeType: string): PrivateMediaMimeType {
  const normalized = mimeType.trim().toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(MEDIA_EXTENSIONS, normalized)) {
    throw new Error("Unsupported media MIME type.");
  }
  return normalized as PrivateMediaMimeType;
}

function ownerScope(ownerId: string): string {
  const normalizedOwnerId = ownerId.trim();
  if (!normalizedOwnerId || normalizedOwnerId.length > 256) {
    throw new Error("A valid media owner is required.");
  }
  return createHash("sha256").update(normalizedOwnerId, "utf8").digest("hex");
}

function normalizeFolder(folder: string | undefined): string {
  const resolved = folder?.trim() || "media";
  const segments = resolved.split("/");
  if (
    segments.some(
      (segment) => !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(segment) || segment === "." || segment === ".."
    )
  ) {
    throw new Error("Media folder contains an invalid path segment.");
  }
  return segments.join("/");
}

export function buildOwnerScopedObjectKey(input: ObjectKeyInput): string {
  if (!Number.isSafeInteger(input.timestampMs) || input.timestampMs < 0) {
    throw new Error("Media timestamp must be a non-negative integer.");
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(input.id)) {
    throw new Error("Media object ID contains invalid characters.");
  }

  const scope = ownerScope(input.ownerId);
  const folder = normalizeFolder(input.folder);
  const extension = MEDIA_EXTENSIONS[input.mimeType];
  return `owners/${scope}/${folder}/${input.timestampMs}-${input.id}.${extension}`;
}

export function storageKeyBelongsToOwner(storageKey: string, ownerId: string): boolean {
  const expectedPrefix = `owners/${ownerScope(ownerId)}/`;
  if (!storageKey.startsWith(expectedPrefix) || storageKey.length > 1024) return false;
  if (storageKey.includes("\\") || storageKey.includes("//")) return false;
  return storageKey.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

export function createPrivateMediaStore(
  inputConfig: PrivateMediaConfig,
  dependencies: PrivateMediaStoreDependencies = {}
): PrivateMediaStore {
  const config = normalizeConfig(inputConfig);
  let client: S3Client | undefined;
  const getClient = (): S3Client => {
    client ??= new S3Client({
      region: config.bucketRegion,
      endpoint: config.bucketEndpoint,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      forcePathStyle: true,
    });
    return client;
  };

  const sendPutObject =
    dependencies.sendPutObject ?? ((command: PutObjectCommand) => getClient().send(command));
  const signGetObject =
    dependencies.signGetObject ??
    ((command: GetObjectCommand, expiresInSeconds: number) =>
      getSignedUrl(getClient(), command, { expiresIn: expiresInSeconds }));
  const now = dependencies.now ?? Date.now;
  const createId = dependencies.createId ?? randomUUID;

  return {
    async uploadObject(input: PrivateMediaUpload): Promise<PrivateMediaObject> {
      const contentType = validatePrivateMediaMimeType(input.mimeType);
      const body = Buffer.from(input.body);
      if (body.byteLength === 0) {
        throw new Error("Media upload cannot be empty.");
      }
      if (body.byteLength > config.maxUploadBytes) {
        throw new Error(`Media upload exceeds the ${config.maxUploadBytes}-byte limit.`);
      }

      const storageKey = buildOwnerScopedObjectKey({
        ownerId: input.ownerId,
        mimeType: contentType,
        folder: input.folder,
        timestampMs: now(),
        id: createId(),
      });

      await sendPutObject(
        new PutObjectCommand({
          Bucket: config.bucketName,
          Key: storageKey,
          Body: body,
          ContentLength: body.byteLength,
          ContentType: contentType,
        })
      );

      return {
        storageKey,
        contentType,
        sizeBytes: body.byteLength,
      };
    },

    async createPresignedGetUrl(input: PrivateMediaGetRequest): Promise<string> {
      if (!storageKeyBelongsToOwner(input.storageKey, input.ownerId)) {
        throw new Error("Media object does not belong to the requested owner.");
      }

      const expiresInSeconds =
        input.expiresInSeconds ?? Math.min(DEFAULT_MEDIA_GET_EXPIRY_SECONDS, config.maxGetExpirySeconds);
      if (
        !Number.isSafeInteger(expiresInSeconds) ||
        expiresInSeconds <= 0 ||
        expiresInSeconds > config.maxGetExpirySeconds
      ) {
        throw new Error(`Signed media URL expiry must be between 1 and ${config.maxGetExpirySeconds} seconds.`);
      }

      return signGetObject(
        new GetObjectCommand({
          Bucket: config.bucketName,
          Key: input.storageKey,
        }),
        expiresInSeconds
      );
    },
  };
}

export function createPrivateMediaStoreFromEnv(
  env: Environment = process.env,
  dependencies: PrivateMediaStoreDependencies = {}
): PrivateMediaStore {
  return createPrivateMediaStore(readPrivateMediaConfig(env), dependencies);
}
