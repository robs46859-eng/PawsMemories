import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { generateManifest, loadPackagedProvenance } from "../scripts/generate-manifest.mjs";
import { loadReleaseManifest } from "../server/releaseManifest.ts";

const COMMIT = "a".repeat(40);

function withReleaseDirectory(run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "paws-release-manifest-"));
  try {
    fs.mkdirSync(path.join(directory, "nested"));
    fs.writeFileSync(path.join(directory, "package.json"), "{}\n");
    fs.writeFileSync(path.join(directory, "nested", "feature.ts"), "export {};\n");
    return run(directory);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

test("generateManifest records every staged regular file and complete provenance", () => {
  withReleaseDirectory((directory) => {
    const manifest = generateManifest({
      APP_COMMIT_SHA: COMMIT,
      APP_BRANCH: "release/v1",
      APP_BUILD_TIME: "2026-07-22T12:00:00.000Z",
      RELEASE_DIRTY: "false",
    }, directory);

    assert.equal(manifest.commit, COMMIT);
    assert.equal(manifest.branch, "release/v1");
    assert.equal(manifest.schemaVersion, 17);
    assert.equal(manifest.engineCompatible, true);
    assert.equal(manifest.dirty, false);
    assert.deepEqual(Object.keys(manifest.checksums), ["nested/feature.ts", "package.json"]);
  });
});

test("production manifest loader rejects malformed or dirty provenance", () => {
  withReleaseDirectory((directory) => {
    const manifestPath = path.join(directory, "release-manifest.json");
    fs.writeFileSync(manifestPath, JSON.stringify({ commit: COMMIT }));
    assert.throws(() => loadReleaseManifest([manifestPath], { production: true }), /No valid production release manifest/);

    const dirty = generateManifest({
      APP_COMMIT_SHA: COMMIT,
      APP_BRANCH: "main",
      APP_BUILD_TIME: "2026-07-22T12:00:00.000Z",
      RELEASE_DIRTY: "true",
    }, directory);
    fs.writeFileSync(manifestPath, JSON.stringify(dirty));
    assert.throws(() => loadReleaseManifest([manifestPath], { production: true }), /dirty/);
  });
});

test("manifest loader resolves a fully valid later candidate", () => {
  withReleaseDirectory((directory) => {
    const invalidPath = path.join(directory, "invalid.json");
    const validPath = path.join(directory, "release-manifest.json");
    fs.writeFileSync(invalidPath, "{}");
    const manifest = generateManifest({
      APP_COMMIT_SHA: COMMIT,
      APP_BRANCH: "main",
      APP_BUILD_TIME: "2026-07-22T12:00:00.000Z",
      RELEASE_DIRTY: "false",
    }, directory);
    fs.writeFileSync(validPath, JSON.stringify(manifest));

    assert.equal(loadReleaseManifest([invalidPath, validPath])?.commit, COMMIT);
  });
});

test("extracted deployment builds can inherit Git provenance from the packaged manifest", () => {
  withReleaseDirectory((directory) => {
    const manifestPath = path.join(directory, "release-manifest.json");
    fs.writeFileSync(manifestPath, JSON.stringify({ commit: COMMIT, branch: "release/hostinger" }));
    assert.deepEqual(loadPackagedProvenance(manifestPath), {
      commit: COMMIT,
      branch: "release/hostinger",
    });
  });
});
