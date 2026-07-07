import assert from "node:assert/strict";
import { test } from "node:test";
import { disposeObject3D, disposeMaterial } from "../src/three/ar/dispose.ts";
import { degradationPlan } from "../src/three/ar/capabilities.ts";
import { checkBudget, BUDGET } from "../server/rigBudget.ts";

// ---- disposal (duck-typed mocks, no WebGL) ----

function spy() {
  const f = () => (f.calls += 1);
  f.calls = 0;
  return f;
}

test("disposeObject3D frees geometry, material, and its textures", () => {
  const geoDispose = spy();
  const matDispose = spy();
  const mapDispose = spy();
  const mesh = {
    geometry: { dispose: geoDispose },
    material: { dispose: matDispose, map: { dispose: mapDispose }, normalMap: { dispose: spy() } },
  };
  const root = { traverse: (cb) => cb(mesh) };
  const freed = disposeObject3D(root);
  assert.equal(geoDispose.calls, 1);
  assert.equal(matDispose.calls, 1);
  assert.equal(mapDispose.calls, 1);
  assert.ok(freed >= 3);
});

test("disposeObject3D handles material arrays and is null-safe", () => {
  const d1 = spy();
  const d2 = spy();
  const mesh = { material: [{ dispose: d1 }, { dispose: d2 }] };
  const root = { traverse: (cb) => cb(mesh) };
  disposeObject3D(root);
  assert.equal(d1.calls, 1);
  assert.equal(d2.calls, 1);
  assert.equal(disposeObject3D(null), 0);
  assert.equal(disposeMaterial(null), 0);
});

// ---- capability degradation plan ----

test("full-capability device uses the premium path", () => {
  const plan = degradationPlan({ webxr: true, webxrDepth: true, webxrLighting: true, webSpeech: true, xr8: false });
  assert.deepEqual(plan, {
    tracking: "webxr",
    occlusion: "webxr-depth",
    lighting: "webxr-estimation",
    voice: "web-speech",
  });
});

test("iOS-ish device degrades to shadow/luminance/buttons via XR8", () => {
  const plan = degradationPlan({ webxr: false, webxrDepth: false, webxrLighting: false, webSpeech: false, xr8: true });
  assert.equal(plan.tracking, "xr8");
  assert.equal(plan.occlusion, "shadow-fade");
  assert.equal(plan.lighting, "luminance-sample");
  assert.equal(plan.voice, "buttons-only");
});

test("no-AR device reports tracking none", () => {
  assert.equal(degradationPlan({ webxr: false, webxrDepth: false, webxrLighting: false, webSpeech: true, xr8: false }).tracking, "none");
});

// ---- budget audit (§3.3/§9) ----

test("GLB over 4MB / 30k tris / 40 bones fails the budget", () => {
  assert.equal(checkBudget({ tris: 20000, bones: 30, bytes: 3_000_000, retarget_confidence: 1, leg_chains_ok: true }).ok, true);
  const over = checkBudget({ tris: 20000, bones: 30, bytes: BUDGET.maxBytes + 1, retarget_confidence: 1, leg_chains_ok: true });
  assert.equal(over.ok, false);
  assert.ok(over.reasons[0].includes("bytes"));
});
