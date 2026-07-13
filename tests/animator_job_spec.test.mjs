/**
 * Phase 0.1 hardening: JobSpec.preset may be absent through the pipeline.
 *
 * Verifies:
 *  • queue.ts enqueue/schemas accept a job without preset (it defaults to undefined).
 *  • worker.ts processJob does not assume preset is always truthy before passing to
 *    buildManifest / writeManifest.
 */
import test from "node:test";
import assert from "node:assert";
import fs from "fs";
import { fileURLToPath } from "url";
import path from "path";
import os from "os";
import { JobSpecSchema, parseJobFile, JobRecordSchema } from "../server/animator/queue.ts";
import { buildManifest } from "../server/animator/manifest.ts";
import { v4 as uuidv4 } from "uuid";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test("JobSpecSchema accepts preset absent", () => {
  const spec = {
    id: uuidv4(),
    userPhone: "+155****4567",
    assetId: uuidv4(),
    type: "rig",
    params: { profileId: "quadruped.dog.small" },
    createdAt: new Date().toISOString(),
  };

  // parseJobFile should accept a job without preset
  const json = JSON.stringify({ ...spec, state: "pending" });
  const parsed = parseJobFile(json);

  assert.strictEqual(parsed.type, "rig");
  assert.strictEqual(parsed.preset, undefined);
  assert.ok(parsed.params.profileId);
});

test("JobSpecSchema accepts all new job types without preset", () => {
  const newTypes = ["rig", "retarget", "repurpose", "lipsync", "reconstruct", "bake"];

  for (const type of newTypes) {
    const spec = {
      id: uuidv4(),
      userPhone: "+155****4567",
      assetId: uuidv4(),
      type,
      params: {},
      createdAt: new Date().toISOString(),
    };

    const json = JSON.stringify({ ...spec, state: "pending" });
    const parsed = parseJobFile(json);
    assert.strictEqual(parsed.type, type, `type ${type} should be accepted`);
    assert.strictEqual(parsed.preset, undefined, `type ${type} preset should be undefined`);
  }
});

test("JobRecordSchema accepts optional preset", () => {
  const record = {
    id: uuidv4(),
    userPhone: "+155****4567",
    assetId: uuidv4(),
    type: "lipsync",
    params: { audioUrl: "/uploads/tts.wav" },
    createdAt: new Date().toISOString(),
    state: "pending",
  };

  const result = JobRecordSchema.parse(record);
  assert.strictEqual(result.type, "lipsync");
  assert.strictEqual(result.preset, undefined);
  assert.strictEqual(result.state, "pending");
});

test("worker buildManifest handles missing preset without non-null assertion", () => {
  const workerSrc = fs.readFileSync(
    path.resolve(__dirname, "../server/animator/worker.ts"),
    "utf8"
  );

  // Verify worker doesn't assume preset is always present
  assert.ok(
    !workerSrc.includes("job.preset!"),
    "worker.ts must not use non-null assertion on job.preset"
  );

  // The manifest buildManifest call passes preset from job record
  assert.ok(
    workerSrc.includes("preset: job.preset"),
    "worker.ts passes preset from job record to buildManifest"
  );
});

test("manifest buildManifest degrades gracefully when preset is undefined", async (t) => {
  await t.test("buildManifest accepts undefined preset with real file", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "animator-manifest-"));
    const inputPath = path.join(tmpDir, "input.txt");
    fs.writeFileSync(inputPath, "test data for manifest");

    try {
      const manifest = buildManifest({
        jobId: uuidv4(),
        assetId: uuidv4(),
        preset: undefined,
        inputs: [{ path: inputPath }],
        outputs: [],
        operations: ["inspect"],
      });

      // Should not throw; preset is optional in the manifest
      assert.ok(manifest.jobId);
      assert.ok(manifest.createdAt);
      assert.strictEqual(manifest.operations[0], "inspect");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
