import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { viewsFromAvatarRow, RebakeRequestSchema } from "../server/textureSchemas.ts";

const repoRoot = path.resolve(import.meta.dirname, "..");
const read = (p) => readFileSync(path.join(repoRoot, p), "utf8");

/* ------------------------------------------------------------------ */
/* View assembly                                                       */
/* ------------------------------------------------------------------ */

test("front view comes from image_url, turnaround from multiview_json", () => {
  const views = viewsFromAvatarRow({
    image_url: "https://cdn.example.com/front.png",
    multiview_json: JSON.stringify({ left: "https://cdn.example.com/l.png", back: "https://cdn.example.com/b.png" }),
  });
  assert.deepEqual(views, {
    front: "https://cdn.example.com/front.png",
    left: "https://cdn.example.com/l.png",
    back: "https://cdn.example.com/b.png",
  });
});

test("an avatar with no usable views yields null, not an empty bake", () => {
  assert.equal(viewsFromAvatarRow({ image_url: null, multiview_json: null }), null);
  // data: URLs are not fetchable by the worker and must not count as views.
  assert.equal(viewsFromAvatarRow({ image_url: "data:image/png;base64,xxxx", multiview_json: null }), null);
});

test("malformed multiview_json degrades to front-only instead of throwing", () => {
  const views = viewsFromAvatarRow({
    image_url: "https://cdn.example.com/front.png",
    multiview_json: "{not json",
  });
  assert.deepEqual(views, { front: "https://cdn.example.com/front.png" });
});

test("rebake request schema bounds texture size to real tiers", () => {
  assert.equal(RebakeRequestSchema.safeParse({ avatar_id: 1 }).success, true);
  assert.equal(RebakeRequestSchema.safeParse({ avatar_id: 1, texture_size: 1024 }).success, true);
  assert.equal(RebakeRequestSchema.safeParse({ avatar_id: 1, texture_size: 4096 }).success, false);
  assert.equal(RebakeRequestSchema.safeParse({ avatar_id: 0 }).success, false);
  assert.equal(RebakeRequestSchema.safeParse({ avatar_id: 1, extra: true }).success, false);
});

/* ------------------------------------------------------------------ */
/* Worker job contracts (source-level — bpy is not importable in CI)   */
/* ------------------------------------------------------------------ */

const workerJob = read("blender-worker/jobs/rebake_texture.py");
const workerServer = read("blender-worker/server.js");

test("worker job preserves geometry and rig (plan rule D4)", () => {
  // The bake must never touch verts/edges or the armature. Guard the obvious
  // regressions: no decimate, no transform apply, no armature ops.
  assert.doesNotMatch(workerJob, /decimate|shade_smooth|transform_apply|armature/i);
  // And the original texture is the blend floor, not discarded.
  assert.match(workerJob, /BASE_WEIGHT/);
  assert.match(workerJob, /_find_base_color_image/);
});

test("worker job masks out-of-frame and behind-camera projections", () => {
  assert.match(workerJob, /ndc\.z <= 0\.0/);
  assert.match(workerJob, /\(-10\.0, -10\.0\)/);
  assert.match(workerJob, /_in_frame_mask/);
});

test("worker job normalizes weights with a NaN guard", () => {
  assert.match(workerJob, /MAXIMUM/);
  assert.match(workerJob, /1e-4/);
});

test("worker endpoint follows the bake-lod bridge pattern", () => {
  assert.match(workerServer, /app\.post\("\/texture\/rebake"/);
  assert.match(workerServer, /REBAKE_RESULT:/);
  assert.match(workerServer, /run_rebake\(json\.loads/);
  assert.match(workerServer, /bridge\.exportGlb\(\)/);
});

/* ------------------------------------------------------------------ */
/* App-side wiring                                                     */
/* ------------------------------------------------------------------ */

const server = read("server.ts");

test("rebake endpoints exist with auth, idempotency, and ownership checks", () => {
  assert.match(server, /app\.post\("\/api\/texture\/rebake", requireAuth, paidLimiter/);
  assert.match(server, /Idempotency-Key/);
  // Avatar lookup must be scoped to the requesting user.
  assert.match(server, /FROM avatars WHERE id = \? AND user_phone = \? LIMIT 1/);
  assert.match(server, /app\.get\("\/api\/texture\/jobs\/:id", requireAuth/);
});

test("rebake result goes to the public media bucket, never the private one", () => {
  const block = server.slice(server.indexOf('app.post("/api/texture/rebake"'), server.indexOf('app.get("/api/texture/jobs/:id"'));
  assert.match(block, /uploadBase64Binary\(result\.glb_base64, "model\/gltf-binary", "rebaked-models"\)/);
  assert.doesNotMatch(block, /putPrivateObject|MEDIA_PRIVATE_BUCKET/);
});

test("texture_jobs schema exists in both migration and db.ts", () => {
  const migration = read("server/migrations/012_texture_jobs.sql");
  const dbSource = read("db.ts");
  for (const src of [migration, dbSource]) {
    assert.ok(src.includes("CREATE TABLE IF NOT EXISTS texture_jobs"));
    assert.ok(src.includes("uniq_texture_idem"));
  }
});

test("viewer override is reversible — the original model is never replaced", () => {
  const screen = read("src/components/FidosStylesScreen.tsx");
  assert.match(screen, /rebakeOverrides\[selectedId\]/);
  assert.match(screen, /Use original/);
  // The override must layer OVER the derived url, not overwrite avatar state.
  assert.match(screen, /rebakeOverrides\[selectedId\]\)\s*\|\| selected\?\.rigged_model_url \|\| selected\?\.model_url/);
});
