import assert from "node:assert/strict";
import { test } from "node:test";
import { getExtensionFromMime, getFolderFromMime, getPublicObjectUrl } from "../storage.ts";

test("storage.ts getExtensionFromMime resolves deterministic extensions", () => {
  // Explicit map matches
  assert.equal(getExtensionFromMime("image/png"), "png");
  assert.equal(getExtensionFromMime("image/jpeg"), "jpg");
  assert.equal(getExtensionFromMime("video/mp4"), "mp4");
  assert.equal(getExtensionFromMime("model/gltf-binary"), "glb");
  assert.equal(getExtensionFromMime("audio/mpeg"), "mp3");
  assert.equal(getExtensionFromMime("audio/wav"), "wav");
  
  // Prefix fallbacks
  assert.equal(getExtensionFromMime("image/heic"), "png");
  assert.equal(getExtensionFromMime("video/quicktime"), "mp4");
  assert.equal(getExtensionFromMime("model/x-unknown"), "glb");
  assert.equal(getExtensionFromMime("audio/x-unknown"), "mp3");
  
  // Unknown fallback
  assert.equal(getExtensionFromMime("application/pdf"), "bin");
});

test("storage.ts getFolderFromMime routes to correct folders", () => {
  // Default routing
  assert.equal(getFolderFromMime("image/png"), "creations");
  assert.equal(getFolderFromMime("video/mp4"), "videos");
  assert.equal(getFolderFromMime("model/gltf-binary"), "models");
  assert.equal(getFolderFromMime("audio/mpeg"), "sounds");
  
  // Explicit override routing
  assert.equal(getFolderFromMime("image/png", "avatars"), "avatars");
  assert.equal(getFolderFromMime("model/gltf-binary", "avatars"), "avatars");
  assert.equal(getFolderFromMime("audio/wav", "system"), "system");
});

test("storage.ts getPublicObjectUrl uses virtual-hosted bucket URLs and escapes keys", () => {
  assert.equal(
    getPublicObjectUrl("models/pet photo.glb", {
      MEDIA_BUCKET_URL: "https://s3.us-west-004.backblazeb2.com",
      MEDIA_BUCKET_NAME: "paws-media",
    }),
    "https://paws-media.s3.us-west-004.backblazeb2.com/models/pet%20photo.glb",
  );
});
