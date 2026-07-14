import assert from "node:assert/strict";
import test from "node:test";
import {
  mediaIdFromReference,
  mediaReferenceForId,
} from "../server/generatedMedia.ts";

const id = "123e4567-e89b-42d3-a456-426614174000";

test("private media references round trip without exposing a storage key", () => {
  const reference = mediaReferenceForId(id);
  assert.equal(reference, `paws-media://${id}`);
  assert.equal(mediaIdFromReference(reference), id);
  assert.equal(reference.includes("owners/"), false);
});

test("invalid or legacy references are not treated as private IDs", () => {
  assert.equal(mediaIdFromReference("https://example.test/video.mp4"), null);
  assert.equal(mediaIdFromReference("paws-media://../../secret"), null);
  assert.throws(() => mediaReferenceForId("not-a-uuid"));
});
