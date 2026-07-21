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

/* ------------------------------------------------------------------ */
/* UV8 acceptance gate — likeness scoring                              */
/*                                                                     */
/* The plan's "done when" for UV8 is that a re-baked avatar scores      */
/* HIGHER LIKENESS than its original Tripo texture. Everything above    */
/* proves the bake runs; these prove we can tell whether it helped.     */
/* ------------------------------------------------------------------ */

/**
 * Conformance pairs from Sharma, Wu & Dalal (2005), the reference test data for
 * CIEDE2000. These specific pairs are the ones that expose the classic
 * implementation bugs — hue wraparound near 0/360, the blue-region rotation
 * term, and atan2 quadrant handling. A "simplified" delta-E will fail here.
 */
const SHARMA_PAIRS = [
  [[50, 2.6772, -79.7751], [50, 0, -82.7485], 2.0425],
  [[50, 3.1571, -77.2803], [50, 0, -82.7485], 2.8615],
  [[50, -1.3802, -84.2814], [50, 0, -82.7485], 1.0],
  [[50, 0, 0], [50, -1, 2], 2.3669],
  [[50, -1, 2], [50, 0, 0], 2.3669],
  [[50, 2.49, -0.001], [50, -2.49, 0.0009], 7.1792],
  [[50, 2.49, -0.001], [50, -2.49, 0.0011], 7.2195],
  [[50, -0.001, 2.49], [50, 0.0009, -2.49], 4.8045],
  [[50, -0.001, 2.49], [50, 0.0011, -2.49], 4.7461],
  [[50, 2.5, 0], [50, 0, -2.5], 4.3065],
  [[50, 2.5, 0], [73, 25, -18], 27.1492],
  [[50, 2.5, 0], [56, -27, -3], 31.903],
  [[60.2574, -34.0099, 36.2677], [60.4626, -34.1751, 39.4387], 1.2644],
  [[63.0109, -31.0961, -5.8663], [62.8187, -29.7946, -4.0864], 1.263],
  [[61.2901, 3.7196, -5.3901], [61.4292, 2.248, -4.962], 1.8731],
  [[35.0831, -44.1164, 3.7933], [35.0232, -40.0716, 1.5901], 1.8645],
  [[22.7233, 20.0904, -46.694], [23.0331, 14.973, -42.5619], 2.0373],
  [[90.8027, -2.0831, 1.441], [91.1528, -1.6435, 0.0447], 1.4441],
  [[6.7747, -0.2908, -2.4247], [5.8714, -0.0985, -2.2286], 0.6377],
  [[2.0776, 0.0795, -1.135], [0.9033, -0.0636, -0.5514], 0.9082],
];

test("CIEDE2000 matches the Sharma et al. reference implementation", async () => {
  const { ciede2000 } = await import("../server/textureLikeness.ts");
  for (const [a, b, expected] of SHARMA_PAIRS) {
    const got = ciede2000(a, b);
    assert.ok(
      Math.abs(got - expected) < 1e-4,
      `CIEDE2000(${JSON.stringify(a)}, ${JSON.stringify(b)}) = ${got.toFixed(4)}, expected ${expected}`,
    );
  }
});

test("sRGB to Lab lands on known anchors", async () => {
  const { rgbToLab } = await import("../server/textureLikeness.ts");
  const [wl, wa, wb] = rgbToLab(255, 255, 255);
  assert.ok(Math.abs(wl - 100) < 0.01 && Math.abs(wa) < 0.01 && Math.abs(wb) < 0.01, "white → L*=100, a=b=0");
  const [kl] = rgbToLab(0, 0, 0);
  assert.ok(Math.abs(kl) < 0.01, "black → L*=0");
});

/** Build a two-tone PNG so a palette has something to find. */
async function twoTone(c1, c2) {
  const sharp = (await import("sharp")).default;
  const half = (c) =>
    sharp({ create: { width: 128, height: 128, channels: 3, background: { r: c[0], g: c[1], b: c[2] } } })
      .png()
      .toBuffer();
  const [a, b] = await Promise.all([half(c1), half(c2)]);
  return sharp({ create: { width: 256, height: 128, channels: 3, background: { r: 0, g: 0, b: 0 } } })
    .composite([{ input: a, left: 0, top: 0 }, { input: b, left: 128, top: 0 }])
    .png()
    .toBuffer();
}

/** Minimal but real GLB carrying the given PNG as its base-color texture. */
async function glbWithTexture(png) {
  const { Document, NodeIO } = await import("@gltf-transform/core");
  const doc = new Document();
  const buffer = doc.createBuffer();
  const tex = doc.createTexture("albedo").setImage(new Uint8Array(png)).setMimeType("image/png");
  const mat = doc.createMaterial("m").setBaseColorTexture(tex);
  const position = doc.createAccessor().setType("VEC3")
    .setArray(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0])).setBuffer(buffer);
  const uv = doc.createAccessor().setType("VEC2")
    .setArray(new Float32Array([0, 0, 1, 0, 0, 1])).setBuffer(buffer);
  const prim = doc.createPrimitive()
    .setAttribute("POSITION", position).setAttribute("TEXCOORD_0", uv).setMaterial(mat);
  doc.createScene().addChild(doc.createNode().setMesh(doc.createMesh().addPrimitive(prim)));
  return Buffer.from(await new NodeIO().writeBinary(doc));
}

// A warm brown/tan coat, the muddy grey that palette-lock exists to catch, and
// a faithful re-bake sitting close to the reference.
const REF_COAT = [[120, 82, 48], [196, 160, 120]];
const MUDDY = [[104, 100, 96], [150, 148, 145]];
const FAITHFUL = [[124, 86, 52], [190, 156, 118]];

test("palette extraction recovers the dominant colours", async () => {
  const { extractPalette } = await import("../server/textureLikeness.ts");
  const palette = await extractPalette(await twoTone(...REF_COAT));
  assert.equal(palette.length, 2, "a two-tone image has two dominant colours");
  for (const expected of REF_COAT) {
    const hit = palette.find((p) => p.rgb.every((c, i) => Math.abs(c - expected[i]) < 6));
    assert.ok(hit, `expected a palette entry near ${expected.join(",")}`);
  }
});

test("base-color texture round-trips through a real GLB", async () => {
  const { extractBaseColorTexture } = await import("../server/textureLikeness.ts");
  const glb = await glbWithTexture(await twoTone(...REF_COAT));
  const atlas = await extractBaseColorTexture(glb);
  assert.ok(atlas && atlas.length > 0, "expected to recover the atlas from the GLB");
});

test("UV8 gate: a faithful re-bake scores closer to reference than a muddy original", async () => {
  const { scoreRebake } = await import("../server/textureLikeness.ts");
  const reference = await twoTone(...REF_COAT);
  const report = await scoreRebake(
    await glbWithTexture(await twoTone(...MUDDY)),
    await glbWithTexture(await twoTone(...FAITHFUL)),
    [reference],
  );
  assert.equal(report.improved, true, "the re-bake should score as an improvement");
  assert.ok(report.before > report.after, `before (${report.before}) should exceed after (${report.after})`);
  assert.ok(report.after < 5, `a faithful bake should land close to the reference, got ${report.after}`);
  assert.ok(report.delta > 0);
});

test("UV8 gate does not reward a re-bake that drifts away from reference", async () => {
  const { scoreRebake } = await import("../server/textureLikeness.ts");
  // Inverted: the "re-bake" is the muddy one. The gate must not call this a win.
  const report = await scoreRebake(
    await glbWithTexture(await twoTone(...FAITHFUL)),
    await glbWithTexture(await twoTone(...MUDDY)),
    [await twoTone(...REF_COAT)],
  );
  assert.equal(report.improved, false, "drifting away from the reference is not an improvement");
});

test("scoring degrades to a note instead of throwing", async () => {
  const { scoreRebake } = await import("../server/textureLikeness.ts");
  const good = await glbWithTexture(await twoTone(...REF_COAT));

  const noRefs = await scoreRebake(good, good, []);
  assert.equal(noRefs.improved, null);
  assert.match(noRefs.note, /no reference/i);

  const junk = await scoreRebake(Buffer.from("definitely not a glb"), good, [await twoTone(...REF_COAT)]);
  assert.equal(junk.improved, null);
  assert.ok(junk.note, "a malformed model should report a note, not throw");
});

test("the rebake route records likeness without being able to fail the job", () => {
  const block = server.slice(
    server.indexOf('app.post("/api/texture/rebake"'),
    server.indexOf('app.post("/api/texture/jobs"'),
  );
  assert.match(block, /scoreRebake/, "the route must score the result");
  assert.match(block, /likeness/, "likeness must reach stats_json");
  // Scoring must sit AFTER the upload, so a scoring failure cannot cost the
  // user a bake that already succeeded.
  assert.ok(
    block.indexOf("uploadBase64Binary") < block.indexOf("scoreRebake"),
    "scoring must run after the result is safely uploaded",
  );
  const scoringBlock = block.slice(block.indexOf("scoreRebake") - 800, block.indexOf("scoreRebake") + 800);
  assert.match(scoringBlock, /catch/, "scoring must be wrapped in its own catch");
});

/* ------------------------------------------------------------------ */
/* Stylize quarantine                                                  */
/*                                                                     */
/* The stylize orchestrator is written against tables, worker routes,   */
/* and an SDK call shape that do not exist. Until UV3 rewrites it, the  */
/* route must refuse before it can bill.                                */
/* ------------------------------------------------------------------ */

test("stylize route is disabled by default and returns before any work", () => {
  const block = server.slice(
    server.indexOf('app.post("/api/texture/jobs"'),
    server.indexOf('app.get("/api/texture/jobs/:id"'),
  );

  assert.match(block, /TEXTURE_STYLIZE_ENABLED/, "route must be behind the flag");
  assert.match(block, /res\.status\(503\)/, "disabled route answers 503");

  // The gate must precede every side effect. Ordering is the whole point: a
  // route that cannot succeed must not be able to charge for trying.
  const gate = block.indexOf("if (!TEXTURE_STYLIZE_ENABLED)");
  assert.ok(gate > -1, "expected an explicit disabled-path guard");
  for (const sideEffect of ["credit_ledger", "user_credits", "INSERT INTO texture_jobs", "processStylizationJob"]) {
    const at = block.indexOf(sideEffect);
    if (at > -1) {
      assert.ok(gate < at, `the 503 gate must run before ${sideEffect}`);
    }
  }
});

test("the flag defaults to off", () => {
  // Reading it as a strict "true" comparison means any unset/typo'd value keeps
  // the feature down. Defaulting on would be the dangerous direction here.
  assert.match(
    server,
    /TEXTURE_STYLIZE_ENABLED\s*=\s*\n?\s*String\(process\.env\.TEXTURE_STYLIZE_ENABLED \|\| ""\)\.toLowerCase\(\) === "true"/,
    "flag must default to disabled",
  );
});

test("quarantined module documents why it cannot be enabled", () => {
  const src = read("server/textureJob.ts");
  assert.match(src, /QUARANTINED/);
  // Each defect must stay named. A future reader who deletes this header will
  // otherwise re-enable a route that charges users for an impossible job.
  // These three live in the orchestrator itself.
  assert.match(src, /texture\/render-views/, "defect: missing worker endpoints");
  assert.match(src, /image-to-image|img2img/i, "defect: not image-conditioned");
  assert.match(src, /creations/, "defect: wrong creations columns");
});

test("the billing defect is documented where the billing code lives", () => {
  // The non-existent user_credits/credit_ledger queries are in the route in
  // server.ts, not in textureJob.ts — so that is where the warning has to be,
  // next to the code a future editor would actually be reading.
  const block = server.slice(
    server.indexOf("// POST /api/texture/jobs — Start a stylization"),
    server.indexOf('app.get("/api/texture/jobs/:id"'),
  );
  assert.match(block, /user_credits/, "must name the missing billing table");
  assert.match(block, /credit_ledger/);
  assert.match(block, /credit_transactions|deductCredits/, "must point at the real billing path");
});

test("the Coat panel does not offer a control that always fails", () => {
  const screen = read("src/components/FidosStylesScreen.tsx");
  assert.match(screen, /COAT_STYLIZE_AVAILABLE/);
  assert.match(screen, /VITE_TEXTURE_STYLIZE_ENABLED/, "client mirror of the server flag");
  // When gated, the panel must route users to the path that works today.
  assert.match(screen, /Texture repair/);
});
