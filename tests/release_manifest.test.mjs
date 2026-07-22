import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { generateManifest, loadPackagedProvenance } from "../scripts/generate-manifest.mjs";
import { loadReleaseManifest } from "../server/releaseManifest.ts";
import { CURRENT_SCHEMA_VERSION } from "../server/migrations/runner.ts";

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
    assert.equal(manifest.schemaVersion, CURRENT_SCHEMA_VERSION);
    assert.equal(manifest.engineCompatible, true);
    assert.equal(manifest.dirty, false);
    assert.deepEqual(Object.keys(manifest.checksums), ["nested/feature.ts", "package.json"]);
  });
});

test("loadReleaseManifest enforces engine version and expected schema version in production", () => {
  withReleaseDirectory((directory) => {
    const manifestPath = path.join(directory, "release-manifest.json");
    const manifest = generateManifest({
      APP_COMMIT_SHA: COMMIT,
      APP_BRANCH: "main",
      APP_BUILD_TIME: "2026-07-22T12:00:00.000Z",
      RELEASE_DIRTY: "false",
    }, directory);
    fs.writeFileSync(manifestPath, JSON.stringify(manifest));

    const loaded = loadReleaseManifest([manifestPath], { production: true });
    assert.equal(loaded.commit, COMMIT);
    assert.equal(loaded.schemaVersion, CURRENT_SCHEMA_VERSION);

    fs.writeFileSync(manifestPath, JSON.stringify({ ...manifest, schemaVersion: 999 }));
    assert.throws(
      () => loadReleaseManifest([manifestPath], { production: true }),
      /schemaVersion/i,
    );
  });
});

test("loadPackagedProvenance reads built manifest fallback safely", () => {
  withReleaseDirectory((directory) => {
    const manifestPath = path.join(directory, "release-manifest.json");
    fs.writeFileSync(manifestPath, JSON.stringify({ commit: COMMIT, branch: "release/v1" }));

    const provenance = loadPackagedProvenance(manifestPath);
    assert.deepEqual(provenance, { commit: COMMIT, branch: "release/v1" });
  });
});
