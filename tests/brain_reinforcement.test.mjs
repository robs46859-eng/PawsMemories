import assert from "node:assert/strict";
import { test } from "node:test";
import {
  classifyGesture,
  reinforceWeight,
  reinforceCompliance,
  decayCompliance,
  WEIGHT_MIN,
  WEIGHT_MAX,
} from "../src/brain/index.ts";

test("gesture classification: slap vs stroke vs tap", () => {
  assert.equal(classifyGesture(150, 2.0), "slap"); // fast + short
  assert.equal(classifyGesture(600, 0.4), "stroke"); // long + slow
  assert.equal(classifyGesture(200, 0.5), "tap"); // neither
});

test("stroke rewards, slap punishes; weights clamp to [0.2, 2.0]", () => {
  let w = { fetch: 1.99 };
  for (let i = 0; i < 10; i++) w = reinforceWeight(w, "fetch", "stroke");
  assert.ok(w.fetch <= WEIGHT_MAX, `<= max: ${w.fetch}`);
  assert.equal(w.fetch, WEIGHT_MAX);

  let w2 = { fetch: 0.22 };
  for (let i = 0; i < 10; i++) w2 = reinforceWeight(w2, "fetch", "slap");
  assert.ok(w2.fetch >= WEIGHT_MIN, `>= min: ${w2.fetch}`);
  assert.equal(w2.fetch, WEIGHT_MIN);
});

test("tap does not change weights", () => {
  const w = { fetch: 1 };
  assert.equal(reinforceWeight(w, "fetch", "tap").fetch, 1);
});

test("compliance stays within [0,1]", () => {
  let c = 0.95;
  for (let i = 0; i < 10; i++) c = reinforceCompliance(c, "stroke");
  assert.ok(c <= 1);
  let c2 = 0.05;
  for (let i = 0; i < 10; i++) c2 = reinforceCompliance(c2, "slap");
  assert.ok(c2 >= 0);
});

test("forgetting decays compliance toward baseline over days", () => {
  const start = 0.9;
  const after = decayCompliance(start, 30, 0.5, 0.05);
  assert.ok(after < start && after > 0.5, `decays toward baseline: ${after}`);
  assert.equal(decayCompliance(start, 0), start); // no time → unchanged
});
