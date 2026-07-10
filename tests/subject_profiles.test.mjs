import assert from "node:assert/strict";
import { test } from "node:test";

const {
  objectBuildProfile,
  normalizeObjectCategory,
  humanRigHints,
  CANONICAL_HUMAN,
} = await import("../server/subjectProfiles.ts");

// ─── Object profiles ─────────────────────────────────────────────────────────

test("structure is enterable and reconstructable", () => {
  const p = objectBuildProfile("structure");
  assert.equal(p.enterable, true);
  assert.equal(p.reconstructable, true);
  assert.equal(p.placement, "ground");
});

test("prop is usable but not enterable", () => {
  const p = objectBuildProfile("prop");
  assert.equal(p.enterable, false);
  assert.equal(p.reconstructable, true);
});

test("plant and food are distinct categories", () => {
  assert.equal(objectBuildProfile("plant").category, "plant");
  assert.equal(objectBuildProfile("food").category, "food");
  // food defaults to a surface, plant to the ground
  assert.equal(objectBuildProfile("food").placement, "surface");
  assert.equal(objectBuildProfile("plant").placement, "ground");
});

test("part keeps no forced upright orientation", () => {
  const p = objectBuildProfile("part");
  assert.equal(p.category, "part");
  assert.equal(p.keepUpright, false);
  assert.equal(p.reconstructable, true);
});

test("blueprint is NOT reconstructable and carries a reason", () => {
  const p = objectBuildProfile("blueprint");
  assert.equal(p.reconstructable, false);
  assert.match(p.reason, /2D|blueprint|plan/i);
});

test("unknown/legacy categories normalize to 'none' and still build", () => {
  assert.equal(normalizeObjectCategory("spaceship"), "none");
  assert.equal(normalizeObjectCategory(undefined), "none");
  const p = objectBuildProfile(null);
  assert.equal(p.category, "none");
  assert.equal(p.reconstructable, true); // fail-open: don't block on missing data
});

// ─── Human rig hints ─────────────────────────────────────────────────────────

test("a canonical human is safe to finger-rig", () => {
  const h = humanRigHints(CANONICAL_HUMAN);
  assert.equal(h.canonical, true);
  assert.equal(h.fingerRig, true);
  assert.deepEqual(h.anomalies, []);
});

test("missing anatomy defaults to canonical (fail-open)", () => {
  const h = humanRigHints(null);
  assert.equal(h.canonical, true);
  assert.equal(h.fingerRig, true);
});

test("a six-fingered hand blocks finger rigging and is flagged", () => {
  const h = humanRigHints({ ...CANONICAL_HUMAN, fingersPerHand: 6 });
  assert.equal(h.canonical, false);
  assert.equal(h.fingerRig, false);
  assert.match(h.anomalies.join(" "), /fingers-per-hand 6/);
});

test("a reported anomaly blocks finger rigging even with 5 fingers", () => {
  const h = humanRigHints({ ...CANONICAL_HUMAN, anomalies: ["fused fingers on left hand"] });
  assert.equal(h.canonical, false);
  assert.equal(h.fingerRig, false);
  assert.match(h.anomalies.join(" "), /fused fingers/);
});

test("a missing eye is surfaced as an anomaly", () => {
  const h = humanRigHints({ ...CANONICAL_HUMAN, eyeCount: 1 });
  assert.equal(h.canonical, false);
  assert.match(h.anomalies.join(" "), /eye count 1/);
});
