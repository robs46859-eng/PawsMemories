import test from "node:test";
import assert from "node:assert";
import { ANIMATION_SETS } from "../src/animator/controller/animationSets.ts";
import { SKELETON_CONTRACTS } from "../skeletonContract.ts";

test("animation_sets", async (t) => {
  await t.test("all animation sets match a skeleton contract", () => {
    for (const key of Object.keys(ANIMATION_SETS)) {
      assert.ok(SKELETON_CONTRACTS[key], `Missing skeleton contract for ${key}`);
    }
  });

  await t.test("quadruped expected clips are present", () => {
    const quadruped = ANIMATION_SETS.quadruped.expectedClips;
    assert.ok(quadruped.includes("idle"));
    assert.ok(quadruped.includes("walk"));
    assert.ok(quadruped.includes("run"));
  });

  await t.test("biped expected clips are present", () => {
    const biped = ANIMATION_SETS.biped.expectedClips;
    assert.ok(biped.includes("idle"));
    assert.ok(biped.includes("wave"));
  });
});
