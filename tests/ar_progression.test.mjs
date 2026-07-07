import assert from "node:assert/strict";
import { test } from "node:test";
import { simulateArc, catchCheck, planarDist, breedAgility, GRAVITY } from "../src/three/ar/trials/disc.ts";
import { prefabCourse, scoreRun } from "../src/three/ar/trials/agility.ts";
import {
  effectiveAgeDays, lifeStageForAge, stageModifiers, isDeceased, AGING_RATE, DEFAULT_AGING,
} from "../src/brain/aging.ts";
import { pointsForCare, pointsForTrial, creditsFromPoints, CARE_POINTS } from "../src/brain/progression.ts";

// ---- disc trial ----

test("simulateArc rises then lands on the ground (y=0)", () => {
  const path = simulateArc({ pos: { x: 0, y: 1, z: 0 }, vel: { x: 0, y: 5, z: 4 } });
  assert.ok(path.length > 2);
  const last = path[path.length - 1];
  assert.ok(Math.abs(last.y) < 1e-6, "ends on the ground");
  assert.ok(last.z > 0, "traveled forward in z");
});

test("catchCheck catches a disc passing over the pet within hitbox", () => {
  // low, flat throw so the arc stays under the 1m catch height
  const path = simulateArc({ pos: { x: 0, y: 0.5, z: 0 }, vel: { x: 0, y: 1.2, z: 3 } });
  const mid = path[Math.floor(path.length / 2)];
  assert.ok(mid.y <= 1.0, "mid stays catchable height");
  const r = catchCheck(path, { x: mid.x, z: mid.z }, 0.3);
  assert.equal(r.caught, true);
  assert.ok(r.atIndex >= 0);
});

test("catchCheck misses when the pet is far from the arc", () => {
  const path = simulateArc({ pos: { x: 0, y: 0.5, z: 0 }, vel: { x: 0, y: 1.2, z: 3 } });
  assert.equal(catchCheck(path, { x: 100, z: 100 }, 0.3).caught, false);
});

test("bigger breeds run faster with wider turns", () => {
  const small = breedAgility(0.6);
  const big = breedAgility(1.3);
  assert.ok(big.runSpeed > small.runSpeed);
  assert.ok(big.turnRadius > small.turnRadius);
});

test("GRAVITY is downward", () => assert.ok(GRAVITY < 0));

// ---- agility ----

test("prefabCourse lays out N obstacles down the z axis", () => {
  const c = prefabCourse(5, 1.2);
  assert.equal(c.length, 5);
  assert.ok(c[4].anchor.z > c[0].anchor.z);
});

test("scoreRun rewards speed + compliance, never negative", () => {
  const fast = scoreRun(10, 1.0, 20).points;
  const slow = scoreRun(40, 1.0, 20).points;
  assert.ok(fast > slow);
  assert.equal(scoreRun(999, 0, 20).points, 0);
});

// ---- aging ----

test("aging OFF never advances age", () => {
  assert.equal(AGING_RATE.off, 0);
  assert.equal(effectiveAgeDays(1000, "off"), 0);
  assert.ok(effectiveAgeDays(1000, "realistic") > effectiveAgeDays(1000, "slow"));
});

test("life stages progress puppy → adult → senior", () => {
  assert.equal(lifeStageForAge(10, 1000), "puppy");
  assert.equal(lifeStageForAge(400, 1000), "adult");
  assert.equal(lifeStageForAge(900, 1000), "senior");
});

test("stage modifiers: puppy energetic, senior slower", () => {
  assert.ok(stageModifiers("puppy").clipSpeed > 1);
  assert.ok(stageModifiers("senior").clipSpeed < 1);
  assert.equal(stageModifiers("adult").energyScale, 1);
});

test("mortality only applies when enabled", () => {
  assert.equal(isDeceased(9999, DEFAULT_AGING), false); // off + mortality disabled
  assert.equal(isDeceased(1000, { mode: "realistic", mortalityEnabled: true, lifespanDays: 1000 }), true);
  assert.equal(isDeceased(999, { mode: "realistic", mortalityEnabled: true, lifespanDays: 1000 }), false);
});

// ---- progression ----

test("care points + trial points + credit conversion", () => {
  assert.equal(pointsForCare("play"), CARE_POINTS.play);
  assert.equal(pointsForTrial("disc", { catches: 3 }), 15);
  assert.equal(pointsForTrial("disc", { catches: 999 }), 50); // capped
  assert.equal(pointsForTrial("agility", { score: 80 }), 20);
  assert.equal(creditsFromPoints(25), 2); // floor(25/10)*1
  assert.equal(creditsFromPoints(5), 0);
});
