import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { checkBudget, needsRetargetFallback, BUDGET } from "../server/rigBudget.ts";
import { SKELETON_CONTRACTS } from "../skeletonContract.ts";

const ok = {
  tris: 24000,
  bones: 32,
  bytes: 3 * 1024 * 1024,
  retarget_confidence: 0.9,
  leg_chains_ok: true,
};

test("checkBudget passes a within-budget bake", () => {
  const v = checkBudget(ok);
  assert.equal(v.ok, true);
  assert.deepEqual(v.reasons, []);
});

test("checkBudget flags each over-budget dimension", () => {
  const v = checkBudget({ ...ok, tris: BUDGET.maxTris + 1, bones: BUDGET.maxBones + 1, bytes: BUDGET.maxBytes + 1 });
  assert.equal(v.ok, false);
  assert.equal(v.reasons.length, 3);
});

test("needsRetargetFallback true when confidence below threshold", () => {
  assert.equal(needsRetargetFallback({ ...ok, retarget_confidence: 0.5 }), true);
  assert.equal(needsRetargetFallback({ ...ok, retarget_confidence: 0.9 }), false);
});

test("needsRetargetFallback true when a leg chain is missing", () => {
  assert.equal(needsRetargetFallback({ ...ok, leg_chains_ok: false }), true);
});

test("threshold is configurable", () => {
  assert.equal(needsRetargetFallback({ ...ok, retarget_confidence: 0.8 }, 0.85), true);
  assert.equal(needsRetargetFallback({ ...ok, retarget_confidence: 0.8 }, 0.75), false);
});

test("humanoid bonemap has both .L and .R for every limb", () => {
  const path = join(process.cwd(), "blender-worker", "bonemap.human.json");
  const data = JSON.parse(readFileSync(path, "utf8"));
  const canonical = data.canonical;

  const limbs = ["shoulder", "upperarm", "forearm", "hand", "thigh", "shin", "foot"];
  for (const limb of limbs) {
    assert.ok(canonical[`${limb}.L`], `Missing ${limb}.L in canonical humanoid bonemap`);
    assert.ok(canonical[`${limb}.R`], `Missing ${limb}.R in canonical humanoid bonemap`);
  }
});

const drivenBipedBones = [
  "chest", "spine", "head", "upperarm.L", "upperarm.R",
  "thigh.L", "thigh.R", "shin.L", "shin.R", "foot.L",
  "foot.R", "forearm.L", "forearm.R", "hips", "neck"
];

test("skeletonContract biped bones is a superset of driven skeletal-clips-human bones", () => {
  const bipedAllBones = SKELETON_CONTRACTS.biped.allBones;
  for (const bone of drivenBipedBones) {
    assert.ok(bipedAllBones.includes(bone), `biped.allBones is missing driven bone: ${bone}`);
  }
});

test("skeletonContract quadruped bones equals original dog set", () => {
  const originalDogBones = [
    "hips", "spine", "chest", "neck", "head",
    "front_leg_upper.L", "front_leg_lower.L", "front_paw.L",
    "front_leg_upper.R", "front_leg_lower.R", "front_paw.R",
    "back_leg_upper.L", "back_leg_lower.L", "back_paw.L",
    "back_leg_upper.R", "back_leg_lower.R", "back_paw.R",
    "tail_01", "tail_02", "tail_03"
  ];
  assert.deepEqual(SKELETON_CONTRACTS.quadruped.allBones, originalDogBones);
});
