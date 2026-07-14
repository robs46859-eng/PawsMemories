export const SUPPORTED_IMAGE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export type SupportedImageMime = (typeof SUPPORTED_IMAGE_MIME_TYPES)[number];

export interface ImageInputLimits {
  maxEncodedBytes: number;
  maxDecodedBytes: number;
  maxWidth: number;
  maxHeight: number;
  maxPixels: number;
  maxAspectRatio: number;
}

export const DEFAULT_IMAGE_INPUT_LIMITS: Readonly<ImageInputLimits> = Object.freeze({
  maxEncodedBytes: 5 * 1024 * 1024,
  maxDecodedBytes: 10 * 1024 * 1024,
  maxWidth: 4096,
  maxHeight: 4096,
  maxPixels: 16_000_000,
  maxAspectRatio: 10,
});

export type ImageInputValidationCode =
  | "INVALID_TYPE"
  | "INVALID_DATA_URL"
  | "UNSUPPORTED_MIME"
  | "ENCODED_TOO_LARGE"
  | "INVALID_BASE64"
  | "DECODED_TOO_LARGE"
  | "INVALID_IMAGE_SIGNATURE"
  | "MIME_MISMATCH"
  | "TRUNCATED_IMAGE"
  | "INVALID_IMAGE"
  | "DIMENSIONS_TOO_LARGE"
  | "PIXEL_LIMIT_EXCEEDED"
  | "ASPECT_RATIO_EXCEEDED";

const ERROR_MESSAGES: Record<ImageInputValidationCode, string> = {
  INVALID_TYPE: "Image input must be a string.",
  INVALID_DATA_URL: "Image input must be a canonical base64 data URL.",
  UNSUPPORTED_MIME: "Image type is not supported.",
  ENCODED_TOO_LARGE: "Encoded image exceeds the size limit.",
  INVALID_BASE64: "Image data is not valid canonical base64.",
  DECODED_TOO_LARGE: "Decoded image exceeds the size limit.",
  INVALID_IMAGE_SIGNATURE: "Image signature is not recognized.",
  MIME_MISMATCH: "Image content does not match its declared type.",
  TRUNCATED_IMAGE: "Image data is truncated.",
  INVALID_IMAGE: "Image structure is invalid.",
  DIMENSIONS_TOO_LARGE: "Image dimensions exceed the limit.",
  PIXEL_LIMIT_EXCEEDED: "Image pixel count exceeds the limit.",
  ASPECT_RATIO_EXCEEDED: "Image aspect ratio exceeds the limit.",
};

export class ImageInputValidationError extends Error {
  readonly code: ImageInputValidationCode;
  readonly status: 400 | 413;

  constructor(code: ImageInputValidationCode) {
    super(ERROR_MESSAGES[code]);
    this.name = "ImageInputValidationError";
    this.code = code;
    this.status = code === "ENCODED_TOO_LARGE" ||
      code === "DECODED_TOO_LARGE" ||
      code === "DIMENSIONS_TOO_LARGE" ||
      code === "PIXEL_LIMIT_EXCEEDED"
      ? 413
      : 400;
  }
}

export interface ValidatedImageInput {
  mimeType: SupportedImageMime;
  data: Buffer;
  encodedBytes: number;
  decodedBytes: number;
  width: number;
  height: number;
  pixelCount: number;
}

interface Dimensions {
  width: number;
  height: number;
}

function fail(code: ImageInputValidationCode): never {
  throw new ImageInputValidationError(code);
}

function resolveLimits(overrides: Partial<ImageInputLimits>): ImageInputLimits {
  const limits = { ...DEFAULT_IMAGE_INPUT_LIMITS, ...overrides };
  for (const key of ["maxEncodedBytes", "maxDecodedBytes", "maxWidth", "maxHeight", "maxPixels"] as const) {
    if (!Number.isSafeInteger(limits[key]) || limits[key] <= 0) {
      throw new TypeError(`${key} must be a positive safe integer`);
    }
  }
  if (!Number.isFinite(limits.maxAspectRatio) || limits.maxAspectRatio < 1) {
    throw new TypeError("maxAspectRatio must be a finite number greater than or equal to 1");
  }
  return limits;
}

function isSupportedMime(value: string): value is SupportedImageMime {
  return (SUPPORTED_IMAGE_MIME_TYPES as readonly string[]).includes(value);
}

function decodedBase64Length(base64: string): number {
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return (base64.length / 4) * 3 - padding;
}

function parseCanonicalDataUrl(
  input: unknown,
  limits: ImageInputLimits,
): { mimeType: SupportedImageMime; base64: string; decodedBytes: number } {
  if (typeof input !== "string") fail("INVALID_TYPE");

  const comma = input.indexOf(",");
  if (comma < 0 || input.indexOf(",", comma + 1) >= 0) fail("INVALID_DATA_URL");

  const header = input.slice(0, comma);
  const mimeType = header.slice(5, -7);
  if (!header.startsWith("data:") || !header.endsWith(";base64") || mimeType.length === 0) {
    fail("INVALID_DATA_URL");
  }
  if (!isSupportedMime(mimeType)) fail("UNSUPPORTED_MIME");

  const base64 = input.slice(comma + 1);
  const encodedBytes = base64.length;
  if (encodedBytes > limits.maxEncodedBytes) fail("ENCODED_TOO_LARGE");
  if (
    encodedBytes === 0 ||
    encodedBytes % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)
  ) {
    fail("INVALID_BASE64");
  }

  const decodedBytes = decodedBase64Length(base64);
  if (decodedBytes > limits.maxDecodedBytes) fail("DECODED_TOO_LARGE");
  return { mimeType, base64, decodedBytes };
}

function hasPrefix(data: Buffer, bytes: readonly number[]): boolean {
  return bytes.every((byte, index) => data[index] === byte);
}

function detectMime(data: Buffer): SupportedImageMime | null {
  if (hasPrefix(data, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (hasPrefix(data, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (data.length >= 12 && data.toString("ascii", 0, 4) === "RIFF" && data.toString("ascii", 8, 12) === "WEBP") {
    return "image/webp";
  }
  return null;
}

function pngDimensions(data: Buffer): Dimensions {
  if (data.length < 24) fail("TRUNCATED_IMAGE");
  let offset = 8;
  let dimensions: Dimensions | null = null;
  let chunks = 0;

  while (offset < data.length) {
    if (data.length - offset < 12) fail("TRUNCATED_IMAGE");
    const length = data.readUInt32BE(offset);
    const type = data.toString("ascii", offset + 4, offset + 8);
    const chunkEnd = offset + 12 + length;
    if (!Number.isSafeInteger(chunkEnd) || chunkEnd > data.length) fail("TRUNCATED_IMAGE");
    if (chunks === 0 && (type !== "IHDR" || length !== 13)) fail("INVALID_IMAGE");
    if (type === "IHDR") {
      if (dimensions || length !== 13) fail("INVALID_IMAGE");
      dimensions = {
        width: data.readUInt32BE(offset + 8),
        height: data.readUInt32BE(offset + 12),
      };
    }
    if (type === "IEND") {
      if (length !== 0 || !dimensions) fail("INVALID_IMAGE");
      if (chunkEnd !== data.length) fail("INVALID_IMAGE");
      return dimensions;
    }
    offset = chunkEnd;
    chunks += 1;
  }
  fail("TRUNCATED_IMAGE");
}

const JPEG_SOF_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7,
  0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

function jpegDimensions(data: Buffer): Dimensions {
  if (data.length < 4) fail("TRUNCATED_IMAGE");
  let offset = 2;
  let dimensions: Dimensions | null = null;

  while (offset < data.length) {
    if (data[offset] !== 0xff) fail("INVALID_IMAGE");
    while (offset < data.length && data[offset] === 0xff) offset += 1;
    if (offset >= data.length) fail("TRUNCATED_IMAGE");
    const marker = data[offset++];

    if (marker === 0xd9) {
      if (!dimensions) fail("INVALID_IMAGE");
      if (offset !== data.length) fail("INVALID_IMAGE");
      return dimensions;
    }
    if (marker === 0x00 || marker === 0xd8) fail("INVALID_IMAGE");
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (data.length - offset < 2) fail("TRUNCATED_IMAGE");

    const segmentLength = data.readUInt16BE(offset);
    if (segmentLength < 2) fail("INVALID_IMAGE");
    const segmentEnd = offset + segmentLength;
    if (segmentEnd > data.length) fail("TRUNCATED_IMAGE");

    if (JPEG_SOF_MARKERS.has(marker)) {
      if (segmentLength < 8 || dimensions) fail("INVALID_IMAGE");
      dimensions = {
        height: data.readUInt16BE(offset + 3),
        width: data.readUInt16BE(offset + 5),
      };
    }

    offset = segmentEnd;
    if (marker === 0xda) {
      while (offset < data.length) {
        if (data[offset] !== 0xff) {
          offset += 1;
          continue;
        }
        const markerStart = offset;
        while (offset < data.length && data[offset] === 0xff) offset += 1;
        if (offset >= data.length) fail("TRUNCATED_IMAGE");
        const scanMarker = data[offset];
        if (scanMarker === 0x00 || (scanMarker >= 0xd0 && scanMarker <= 0xd7)) {
          offset += 1;
          continue;
        }
        offset = markerStart;
        break;
      }
    }
  }
  fail("TRUNCATED_IMAGE");
}

function readUInt24LE(data: Buffer, offset: number): number {
  return data[offset] | (data[offset + 1] << 8) | (data[offset + 2] << 16);
}

function webpDimensions(data: Buffer): Dimensions {
  if (data.length < 20) fail("TRUNCATED_IMAGE");
  const riffSize = data.readUInt32LE(4);
  if (riffSize < 12) fail("INVALID_IMAGE");
  if (riffSize + 8 > data.length) fail("TRUNCATED_IMAGE");
  if (riffSize + 8 !== data.length) fail("INVALID_IMAGE");

  let offset = 12;
  let dimensions: Dimensions | null = null;
  while (offset < data.length) {
    if (data.length - offset < 8) fail("TRUNCATED_IMAGE");
    const type = data.toString("ascii", offset, offset + 4);
    const length = data.readUInt32LE(offset + 4);
    const payload = offset + 8;
    const chunkEnd = payload + length;
    const paddedEnd = chunkEnd + (length & 1);
    if (chunkEnd > data.length || paddedEnd > data.length) fail("TRUNCATED_IMAGE");

    if (!dimensions && type === "VP8X") {
      if (length < 10) fail("TRUNCATED_IMAGE");
      dimensions = {
        width: readUInt24LE(data, payload + 4) + 1,
        height: readUInt24LE(data, payload + 7) + 1,
      };
    } else if (!dimensions && type === "VP8L") {
      if (length < 5) fail("TRUNCATED_IMAGE");
      if (data[payload] !== 0x2f) fail("INVALID_IMAGE");
      const bits = data.readUInt32LE(payload + 1);
      dimensions = {
        width: (bits & 0x3fff) + 1,
        height: ((bits >>> 14) & 0x3fff) + 1,
      };
    } else if (!dimensions && type === "VP8 ") {
      if (length < 10) fail("TRUNCATED_IMAGE");
      if (!hasPrefix(data.subarray(payload + 3), [0x9d, 0x01, 0x2a])) fail("INVALID_IMAGE");
      dimensions = {
        width: data.readUInt16LE(payload + 6) & 0x3fff,
        height: data.readUInt16LE(payload + 8) & 0x3fff,
      };
    }
    offset = paddedEnd;
  }
  if (offset !== data.length) fail("TRUNCATED_IMAGE");
  if (!dimensions) fail("INVALID_IMAGE");
  return dimensions;
}

function readDimensions(data: Buffer, mimeType: SupportedImageMime): Dimensions {
  switch (mimeType) {
    case "image/jpeg": return jpegDimensions(data);
    case "image/png": return pngDimensions(data);
    case "image/webp": return webpDimensions(data);
  }
}

export function validateImageDataUrl(
  input: unknown,
  limitOverrides: Partial<ImageInputLimits> = {},
): ValidatedImageInput {
  const limits = resolveLimits(limitOverrides);
  const parsed = parseCanonicalDataUrl(input, limits);
  const data = Buffer.from(parsed.base64, "base64");

  // Re-encoding closes permissive-decoder edge cases and makes canonical form explicit.
  if (data.length !== parsed.decodedBytes || data.toString("base64") !== parsed.base64) {
    fail("INVALID_BASE64");
  }

  const detectedMime = detectMime(data);
  if (!detectedMime) fail("INVALID_IMAGE_SIGNATURE");
  if (detectedMime !== parsed.mimeType) fail("MIME_MISMATCH");

  const { width, height } = readDimensions(data, detectedMime);
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    fail("INVALID_IMAGE");
  }
  if (width > limits.maxWidth || height > limits.maxHeight) fail("DIMENSIONS_TOO_LARGE");

  const pixelCount = width * height;
  if (!Number.isSafeInteger(pixelCount) || pixelCount > limits.maxPixels) fail("PIXEL_LIMIT_EXCEEDED");
  if (Math.max(width / height, height / width) > limits.maxAspectRatio) fail("ASPECT_RATIO_EXCEEDED");

  return {
    mimeType: detectedMime,
    data,
    encodedBytes: parsed.base64.length,
    decodedBytes: data.length,
    width,
    height,
    pixelCount,
  };
}
