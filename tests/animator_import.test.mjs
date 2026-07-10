import test from "node:test";
import assert from "node:assert";
import fs from "fs";
import path from "path";
import os from "os";
import { Document, NodeIO } from "@gltf-transform/core";
import { importAsset } from "../server/animator/assets.ts";
import { enqueue } from "../server/animator/queue.ts";
import { ANIMATOR_DATA_DIR, initializeWorkspace, resolveWithinWorkspace } from "../server/animator/paths.ts";

test("animator_import", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "animator-import-"));
  process.env.ANIMATOR_DATA_DIR = tmpDir;
  initializeWorkspace();

  const docPath = path.join(tmpDir, "fixture.glb");
  const doc = new Document();
  doc.createScene();
  const io = new NodeIO();
  await io.write(docPath, doc);
  const validBuffer = fs.readFileSync(docPath);

  await t.test("valid .glb imports and inspects", async () => {
    const meta = await importAsset({
      userPhone: "+123",
      sourceBuffer: validBuffer,
      originalFilename: "fixture.glb"
    });
    
    assert.ok(meta.id);
    assert.strictEqual(meta.originalFilename, "fixture.glb");
    
    // Check files
    const metaPath = resolveWithinWorkspace(`originals/${meta.id}/metadata.json`);
    assert.ok(fs.existsSync(metaPath));
    const absPath = resolveWithinWorkspace(`originals/${meta.id}/fixture.glb`);
    assert.ok(fs.existsSync(absPath));
  });

  await t.test("invalid non-glTF yields typed error", async () => {
    const invalidBuffer = Buffer.from("this is not a glb file");
    await assert.rejects(
      importAsset({
        userPhone: "+123",
        sourceBuffer: invalidBuffer,
        originalFilename: "bad.glb"
      }),
      /Invalid model input/
    );
  });

  await t.test("job preset:optimize is rejected by worker", async () => {
    const job = enqueue({
      userPhone: "+123",
      assetId: "123e4567-e89b-12d3-a456-426614174000",
      type: "optimize",
      preset: "optimize",
      params: {}
    });
    
    // Process it with worker
    const { startWorker, stopWorker } = await import("../server/animator/worker.ts");
    startWorker();
    await new Promise(r => setTimeout(r, 2500));
    stopWorker();
    
    const failedPath = resolveWithinWorkspace(`jobs/failed/${job.id}.json`);
    assert.ok(fs.existsSync(failedPath));
    const record = JSON.parse(fs.readFileSync(failedPath, "utf8"));
    assert.strictEqual(record.error, "optimize preset not available yet");
  });

  fs.rmSync(tmpDir, { recursive: true, force: true });
});
