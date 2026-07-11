import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import path from "node:path";

/**
 * §6.2 guard — ensure we never persist raw provider URLs (Tripo/Meshy)
 * without mirroring them to our durable storage first.
 */

const SERVER_CODE = fs.readFileSync(path.resolve("server.ts"), "utf8");

test("server.ts never persists a raw glbUrl without mirroring", () => {
  // Common error patterns to guard against:
  const rawPersistPatterns = [
    // B3/B4 regressions
    /finalModelUrl\s*=\s*glbUrl;/g,
    /finalModelUrl\s*=\s*poll\.glbUrl;/g,
    // B5 regressions
    /durableUrl\s*=\s*poll\.glbUrl;/g,
    /model_url:\s*poll\.glbUrl/g,
    /model_url:\s*result\.glbUrl/g,
    /model_url:\s*rig\.glbUrl/g,
  ];

  for (const pattern of rawPersistPatterns) {
    const matches = SERVER_CODE.match(pattern);
    assert.equal(
      matches,
      null,
      `Found forbidden pattern: ${pattern}. Raw provider URLs must be mirrored via uploadBinaryFromUrl before assignment/persistence.`
    );
  }
});

test("server.ts GLB uploads never use uploadBase64Image", () => {
  // B1/B2 regressions: make sure we don't use uploadBase64Image for riggedGlbBase64
  const wrongUploadPatterns = [
    /uploadBase64Image\s*\(\s*buildState\.riggedGlbBase64/g,
    /uploadBase64Image\s*\(\s*riggedGlbBase64/g,
  ];

  for (const pattern of wrongUploadPatterns) {
    const matches = SERVER_CODE.match(pattern);
    assert.equal(
      matches,
      null,
      `Found forbidden pattern: ${pattern}. GLBs must be uploaded with uploadBase64Binary(_, "model/gltf-binary"), not uploadBase64Image.`
    );
  }

  // Ensure uploadBase64Binary is actually used in those places
  assert.match(
    SERVER_CODE,
    /uploadBase64Binary\s*\(\s*buildState\.riggedGlbBase64\s*,\s*["']model\/gltf-binary["']\s*\)/,
    "Expected uploadBase64Binary for buildState.riggedGlbBase64"
  );
  
  assert.match(
    SERVER_CODE,
    /uploadBase64Binary\s*\(\s*riggedGlbBase64\s*,\s*["']model\/gltf-binary["']\s*\)/,
    "Expected uploadBase64Binary for riggedGlbBase64"
  );
});
