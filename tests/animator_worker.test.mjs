import test from "node:test";
import assert from "node:assert";
import fs from "fs";
import path from "path";
import os from "os";
import { Document, NodeIO } from "@gltf-transform/core";
import { enqueue } from "../server/animator/queue.ts";
import { importAsset } from "../server/animator/assets.ts";
import { startWorker, stopWorker } from "../server/animator/worker.ts";
import { ANIMATOR_DATA_DIR, initializeWorkspace, resolveWithinWorkspace } from "../server/animator/paths.ts";

test("animator_worker end-to-end", async (t) => {
  // Override ANIMATOR_DATA_DIR logic for test
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "animator-worker-"));
  process.env.ANIMATOR_DATA_DIR = tmpDir;
  initializeWorkspace();

  // Create a minimal glb fixture
  const docPath = path.join(tmpDir, "fixture.glb");
  const doc = new Document();
  doc.createScene();
  const io = new NodeIO();
  await io.write(docPath, doc);

  await t.test("enqueue and process a safe conversion job", async () => {
    // Import asset
    const sourceBuffer = fs.readFileSync(docPath);
    const meta = await importAsset({
      userPhone: "+123",
      sourceBuffer,
      originalFilename: "fixture.glb"
    });
    
    assert.ok(meta.id, "Asset imported successfully");
    
    // Store original hash
    const inAbs = resolveWithinWorkspace(`originals/${meta.id}/fixture.glb`);
    const originalContent = fs.readFileSync(inAbs);

    // Enqueue job
    const job = enqueue({
      userPhone: "+123",
      assetId: meta.id,
      type: "convert", // will map to unpack for glb
      preset: "safe",
      params: {}
    });

    // Start worker
    startWorker();
    
    // Wait for job to complete
    await new Promise(r => setTimeout(r, 2500));
    stopWorker();
    
    // Verify job is done
    const donePath = resolveWithinWorkspace(`jobs/done/${job.id}.json`);
    assert.ok(fs.existsSync(donePath), "Job should be in done/ state");
    
    const record = JSON.parse(fs.readFileSync(donePath, "utf8"));
    assert.strictEqual(record.state, "done");
    assert.ok(record.manifestPath, "Manifest path should be recorded");
    
    // Verify manifest
    const manifestContent = fs.readFileSync(record.manifestPath, "utf8");
    const manifest = JSON.parse(manifestContent);
    assert.strictEqual(manifest.lossless, true);
    assert.ok(manifest.outputs.length > 0, "Outputs generated");
    
    // Verify output file exists
    const outAbs = resolveWithinWorkspace(manifest.outputs[0].path);
    assert.ok(fs.existsSync(outAbs), "Output file exists");
    
    // Verify original is untouched
    const afterContent = fs.readFileSync(inAbs);
    assert.strictEqual(originalContent.equals(afterContent), true, "Original file mutated");
  });

  fs.rmSync(tmpDir, { recursive: true, force: true });
});
