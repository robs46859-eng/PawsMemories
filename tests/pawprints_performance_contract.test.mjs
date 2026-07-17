import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";

const studio = fs.readFileSync("src/components/PawprintsStudio.tsx", "utf8");
const worker = fs.readFileSync("src/pawprints/photoWorker.ts", "utf8");
const gpu = fs.readFileSync("src/pawprints/gpuCompositor.ts", "utf8");

test("photo scaling is bounded and offloaded with a safe fallback", () => {
  assert.match(studio, /maxPixels: mobile \? 3_200_000 : 7_000_000/);
  assert.match(studio, /for \(const file of accepted\) prepared\.push\(await preparePhoto\(file\)\)/);
  assert.match(worker, /OffscreenCanvas/);
  assert.match(worker, /createImageBitmap/);
  assert.match(worker, /bitmap\?\.close\(\)/);
  assert.match(studio, /return normalizePhoto\(file\)/);
});

test("selected exports prefer WebP and release large canvases", () => {
  assert.match(studio, /canvasDataUrl\(canvas, "image\/webp", 0\.92\)/);
  assert.match(studio, /canvas\.width = 1; canvas\.height = 1/);
});

test("WebGL2 compositor is progressive and never removes the 2D fallback", () => {
  assert.match(gpu, /getContext\("webgl2"/);
  assert.match(gpu, /powerPreference: "high-performance"/);
  assert.match(studio, /if \(gpuLayer\)/);
  assert.match(studio, /else \{[\s\S]*cover\(ctx, image/);
});
