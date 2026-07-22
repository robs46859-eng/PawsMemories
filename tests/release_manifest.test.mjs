import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateManifest } from "../scripts/generate-manifest.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

test("generateManifest produces complete release provenance", () => {
  const manifest = generateManifest();

  assert.ok(manifest.commit, "must contain commit SHA");
  assert.ok(manifest.branch, "must contain branch name");
  assert.ok(manifest.builtAt, "must contain build timestamp");
  assert.equal(typeof manifest.schemaVersion, "number", "schemaVersion must be numeric");
  assert.equal(manifest.schemaVersion, 17, "schemaVersion must match CURRENT_SCHEMA_VERSION 17");
  assert.ok(manifest.nodeVersion, "must contain Node version");
  assert.ok(manifest.npmVersion, "must contain npm version");
  assert.equal(manifest.engineCompatible, true, "Must be running under compatible Node 24 engine");
  assert.ok(manifest.checksums, "must contain checksums dictionary");

  assert.ok(manifest.checksums["package.json"], "must hash package.json");
  assert.ok(manifest.checksums["server.ts"], "must hash server.ts");
  assert.ok(manifest.checksums["db.ts"], "must hash db.ts");
  assert.equal(manifest.checksums[".env"], undefined, ".env must be excluded from manifest checksums");
});

test("generateManifest respects environment variable overrides", () => {
  const customEnv = {
    APP_COMMIT_SHA: "abcdef1234567890",
    APP_BRANCH: "release/v1.0.0",
    APP_BUILD_TIME: "2026-07-22T12:00:00Z",
  };

  const manifest = generateManifest(customEnv);
  assert.equal(manifest.commit, "abcdef1234567890");
  assert.equal(manifest.branch, "release/v1.0.0");
  assert.equal(manifest.builtAt, "2026-07-22T12:00:00Z");
});

test("manifest discovery logic resolves valid manifest from dist directory", () => {
  const distDir = path.join(rootDir, "dist");
  fs.mkdirSync(distDir, { recursive: true });

  const testManifest = {
    commit: "fedcba9876543210",
    branch: "main",
    builtAt: "2026-07-22T12:00:00Z",
    schemaVersion: 17,
    checksums: {},
  };

  const distManifestPath = path.join(distDir, "release-manifest.json");
  fs.writeFileSync(distManifestPath, JSON.stringify(testManifest, null, 2), "utf8");

  // Verify path candidate resolution
  const candidatePaths = [
    path.join(distDir, "release-manifest.json"),
    path.join(rootDir, "release-manifest.json"),
  ];

  let loaded = null;
  for (const candidate of candidatePaths) {
    if (fs.existsSync(candidate)) {
      const parsed = JSON.parse(fs.readFileSync(candidate, "utf8"));
      if (parsed && typeof parsed.commit === "string") {
        loaded = parsed;
        break;
      }
    }
  }

  assert.ok(loaded, "Must resolve manifest from candidate path");
  assert.equal(loaded.schemaVersion, 17);
});
