import assert from "node:assert/strict";
import { before, test } from "node:test";
import sharp from "sharp";
import {
  ImageInputValidationError,
  validateImageDataUrl,
} from "../../src/security/image-input.ts";

function dataUrl(mimeType, bytes) {
  return `data:${mimeType};base64,${Buffer.from(bytes).toString("base64")}`;
}

function png(width, height) {
  const bytes = Buffer.alloc(45);
  Buffer.from("89504e470d0a1a0a", "hex").copy(bytes);
  bytes.writeUInt32BE(13, 8);
  bytes.write("IHDR", 12, "ascii");
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  bytes[24] = 8;
  bytes[25] = 6;
  bytes.writeUInt32BE(0, 33);
  bytes.write("IEND", 37, "ascii");
  return bytes;
}

function jpeg(width, height) {
  return Buffer.from([
    0xff, 0xd8,
    0xff, 0xc0, 0x00, 0x0b, 0x08,
    (height >>> 8) & 0xff, height & 0xff,
    (width >>> 8) & 0xff, width & 0xff,
    0x01, 0x01, 0x11, 0x00,
    0xff, 0xd9,
  ]);
}

function webpChunk(type, payload) {
  const padding = payload.length & 1;
  const chunk = Buffer.alloc(8 + payload.length + padding);
  chunk.write(type, 0, "ascii");
  chunk.writeUInt32LE(payload.length, 4);
  payload.copy(chunk, 8);
  return chunk;
}

function webp(type, width, height) {
  let payload;
  if (type === "VP8X") {
    payload = Buffer.alloc(10);
    payload.writeUIntLE(width - 1, 4, 3);
    payload.writeUIntLE(height - 1, 7, 3);
  } else if (type === "VP8L") {
    payload = Buffer.alloc(5);
    payload[0] = 0x2f;
    payload.writeUInt32LE((width - 1) | ((height - 1) << 14), 1);
  } else {
    payload = Buffer.alloc(10);
    Buffer.from([0x9d, 0x01, 0x2a]).copy(payload, 3);
    payload.writeUInt16LE(width, 6);
    payload.writeUInt16LE(height, 8);
  }
  const chunk = webpChunk(type, payload);
  const bytes = Buffer.alloc(12 + chunk.length);
  bytes.write("RIFF", 0, "ascii");
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write("WEBP", 8, "ascii");
  chunk.copy(bytes, 12);
  return bytes;
}

async function expectCode(code, callback) {
  await assert.rejects(callback, (error) => {
    assert.ok(error instanceof ImageInputValidationError);
    assert.equal(error.code, code);
    assert.ok(!error.message.includes("data:"), "errors must not echo input");
    return true;
  });
}

let validJpeg;
let validPng;
let validWebp;

before(async () => {
  const input = {
    create: {
      width: 6,
      height: 5,
      channels: 4,
      background: { r: 24, g: 96, b: 180, alpha: 1 },
    },
  };
  validJpeg = await sharp(input).jpeg().toBuffer();
  validPng = await sharp(input).png().toBuffer();
  validWebp = await sharp(input).webp().toBuffer();
});

test("accepts fully decodable JPEG, PNG, and WebP images", async () => {
  const fixtures = [
    ["image/jpeg", validJpeg],
    ["image/png", validPng],
    ["image/webp", validWebp],
  ];

  for (const [mimeType, bytes] of fixtures) {
    const result = await validateImageDataUrl(dataUrl(mimeType, bytes));
    assert.equal(result.mimeType, mimeType);
    assert.equal(result.width, 6);
    assert.equal(result.height, 5);
    assert.equal(result.pixelCount, 30);
    assert.deepEqual(result.data, bytes);
  }
});

test("rejects a declared MIME that disagrees with the magic signature", async () => {
  await expectCode("MIME_MISMATCH", () => validateImageDataUrl(dataUrl("image/jpeg", validPng)));
});

test("requires strict data URL and canonical padded base64", async () => {
  await expectCode("INVALID_DATA_URL", () => validateImageDataUrl("not-a-data-url"));
  await expectCode("UNSUPPORTED_MIME", () => validateImageDataUrl(dataUrl("image/gif", validPng)));
  await expectCode("INVALID_BASE64", () => validateImageDataUrl("data:image/png;base64,AAAA A=="));
  await expectCode("INVALID_BASE64", () => validateImageDataUrl("data:image/png;base64,AAAA="));
  await expectCode("INVALID_BASE64", () => validateImageDataUrl("data:image/png;base64,AAAA===="));
  await expectCode("INVALID_BASE64", () => validateImageDataUrl("data:image/png;base64,AA==trailing"));
});

test("enforces encoded and decoded byte ceilings before image parsing", async () => {
  const input = dataUrl("image/png", validPng);
  await expectCode("ENCODED_TOO_LARGE", () => validateImageDataUrl(input, { maxEncodedBytes: 8 }));
  await expectCode("DECODED_TOO_LARGE", () => validateImageDataUrl(input, { maxDecodedBytes: 8 }));
});

test("rejects truncated containers and bytes after their terminal boundary", async () => {
  await expectCode("TRUNCATED_IMAGE", () => validateImageDataUrl(dataUrl("image/png", png(1, 1).subarray(0, 30))));
  await expectCode("TRUNCATED_IMAGE", () => validateImageDataUrl(dataUrl("image/jpeg", jpeg(1, 1).subarray(0, -1))));
  await expectCode("TRUNCATED_IMAGE", () => validateImageDataUrl(dataUrl("image/webp", webp("VP8X", 1, 1).subarray(0, -1))));

  await expectCode("INVALID_IMAGE", () => validateImageDataUrl(dataUrl("image/png", Buffer.concat([png(1, 1), Buffer.from([0])]))));
  await expectCode("INVALID_IMAGE", () => validateImageDataUrl(dataUrl("image/jpeg", Buffer.concat([jpeg(1, 1), Buffer.from([0])]))));
  await expectCode("INVALID_IMAGE", () => validateImageDataUrl(dataUrl("image/webp", Buffer.concat([webp("VP8X", 1, 1), Buffer.from([0])]))));
});

test("rejects header-only containers with no decodable image data", async () => {
  await expectCode("INVALID_IMAGE", () => validateImageDataUrl(dataUrl("image/png", png(2, 3))));
  await expectCode("INVALID_IMAGE", () => validateImageDataUrl(dataUrl("image/jpeg", jpeg(3, 2))));
});

test("enforces dimension, aspect-ratio, and decompression-bomb limits", async () => {
  await expectCode("DIMENSIONS_TOO_LARGE", () =>
    validateImageDataUrl(dataUrl("image/png", png(101, 1)), { maxWidth: 100 }),
  );
  await expectCode("ASPECT_RATIO_EXCEEDED", () =>
    validateImageDataUrl(dataUrl("image/jpeg", jpeg(11, 1)), { maxAspectRatio: 10 }),
  );
  await expectCode("PIXEL_LIMIT_EXCEEDED", () =>
    validateImageDataUrl(dataUrl("image/webp", webp("VP8X", 100, 100)), { maxPixels: 9_999 }),
  );
});

test("validation errors expose only typed, sanitized public details", async () => {
  let thrown;
  try {
    await validateImageDataUrl("data:image/png;base64,private-secret!!!");
  } catch (error) {
    thrown = error;
  }
  assert.ok(thrown instanceof ImageInputValidationError);
  assert.deepEqual(
    { name: thrown.name, code: thrown.code, status: thrown.status, message: thrown.message },
    {
      name: "ImageInputValidationError",
      code: "INVALID_BASE64",
      status: 400,
      message: "Image data is not valid canonical base64.",
    },
  );
});
