import { createHash } from "node:crypto";
import {
  createMediaObject,
  getMediaObjectForOwner,
  type MediaObjectRow,
} from "../db";
import {
  createPrivateMediaGetUrl,
  uploadPrivateMediaObject,
  type PrivateMediaMimeType,
} from "../storage";

const MEDIA_REFERENCE_PREFIX = "paws-media://";
const MEDIA_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function mediaReferenceForId(id: string): string {
  if (!MEDIA_ID_PATTERN.test(id)) throw new Error("Invalid media object ID.");
  return `${MEDIA_REFERENCE_PREFIX}${id}`;
}

export function mediaIdFromReference(reference: string | null | undefined): string | null {
  if (!reference?.startsWith(MEDIA_REFERENCE_PREFIX)) return null;
  const id = reference.slice(MEDIA_REFERENCE_PREFIX.length);
  return MEDIA_ID_PATTERN.test(id) ? id : null;
}

export function mediaSignedUrlTtlSeconds(): number {
  const configured = Number(process.env.MEDIA_SIGNED_URL_TTL_SECONDS || 300);
  return Number.isSafeInteger(configured) && configured >= 60 && configured <= 900
    ? configured
    : 300;
}

export async function signedUrlForMediaObject(
  media: Pick<MediaObjectRow, "object_key" | "user_phone">,
): Promise<string> {
  return createPrivateMediaGetUrl({
    ownerId: media.user_phone,
    storageKey: media.object_key,
    expiresInSeconds: mediaSignedUrlTtlSeconds(),
  });
}

export async function resolveOwnedMediaReference(
  reference: string | null | undefined,
  owner: string,
): Promise<string | null> {
  if (!reference) return null;
  const id = mediaIdFromReference(reference);
  if (!id) return reference;
  const media = await getMediaObjectForOwner(id, owner);
  if (!media) return null;
  return signedUrlForMediaObject(media);
}

export async function storeGeneratedMedia(input: {
  owner: string;
  body: Uint8Array;
  mimeType: PrivateMediaMimeType;
  mediaKind: "video" | "image" | "audio" | "model" | "pawprint";
  folder?: string;
}): Promise<{ media: MediaObjectRow; reference: string; signedUrl: string }> {
  const body = Buffer.from(input.body);
  const uploaded = await uploadPrivateMediaObject({
    ownerId: input.owner,
    body,
    mimeType: input.mimeType,
    folder: input.folder || input.mediaKind,
  });
  const media = await createMediaObject({
    user_phone: input.owner,
    object_key: uploaded.storageKey,
    media_kind: input.mediaKind,
    mime_type: uploaded.contentType,
    byte_size: uploaded.sizeBytes,
    sha256: createHash("sha256").update(body).digest("hex"),
  });
  return {
    media,
    reference: mediaReferenceForId(media.id),
    signedUrl: await signedUrlForMediaObject(media),
  };
}
