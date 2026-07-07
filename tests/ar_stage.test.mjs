import assert from "node:assert/strict";
import { test } from "node:test";
import { zoneFadeOpacity, FURNITURE_FADE_OPACITY } from "../src/three/ar/shadows.ts";
import { pelvisHeightFromPaws, clampSlope, LEG_CHAINS, MAX_SLOPE_RAD } from "../src/three/ar/ik.ts";
import { chooseStageModelUrl, hasRiggedModel } from "../src/three/ar/stageModel.ts";

test("zoneFadeOpacity fades over furniture, full opacity otherwise", () => {
  assert.equal(zoneFadeOpacity(true), FURNITURE_FADE_OPACITY);
  assert.equal(zoneFadeOpacity(false), 1);
});

test("pelvisHeightFromPaws lowers pelvis to the deepest penetrating paw", () => {
  assert.equal(pelvisHeightFromPaws([0.1, 0.2, 0.05, 0.0], 0.5), 0.5); // all grounded → rest
  assert.equal(pelvisHeightFromPaws([-0.1, 0.2, 0.0, 0.05], 0.5), 0.4); // one paw 0.1 below
  assert.equal(pelvisHeightFromPaws([], 0.5), 0.5); // no paws → rest
});

test("clampSlope limits lean to +/- MAX_SLOPE_RAD", () => {
  assert.equal(clampSlope(2), MAX_SLOPE_RAD);
  assert.equal(clampSlope(-2), -MAX_SLOPE_RAD);
  assert.equal(clampSlope(0.1), 0.1);
});

test("LEG_CHAINS covers all four legs with 3 bones each", () => {
  assert.equal(LEG_CHAINS.length, 4);
  for (const chain of LEG_CHAINS) assert.equal(chain.length, 3);
  // paws are the effectors (last in each chain)
  const paws = LEG_CHAINS.map((c) => c[2]).sort();
  assert.deepEqual(paws, ["back_paw.L", "back_paw.R", "front_paw.L", "front_paw.R"]);
});

test("chooseStageModelUrl prefers LOD, then rigged, then fallback", () => {
  assert.equal(chooseStageModelUrl({ lodGlbUrl: "lod", riggedGlbUrl: "rig", fallbackUrl: "fb" }), "lod");
  assert.equal(chooseStageModelUrl({ riggedGlbUrl: "rig", fallbackUrl: "fb" }), "rig");
  assert.equal(chooseStageModelUrl({ fallbackUrl: "fb" }), "fb");
  assert.equal(chooseStageModelUrl({}), "");
});

test("hasRiggedModel true only when a rig-pipeline GLB exists", () => {
  assert.equal(hasRiggedModel({ lodGlbUrl: "lod" }), true);
  assert.equal(hasRiggedModel({ riggedGlbUrl: "rig" }), true);
  assert.equal(hasRiggedModel({ fallbackUrl: "legacy" }), false);
});
