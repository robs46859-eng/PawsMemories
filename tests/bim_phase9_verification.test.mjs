import assert from "node:assert/strict";
import { test } from "node:test";
import { buildBimPostBuildVerification, buildBimPreBuildVerification } from "../server/bim/verification.ts";
import { isBimV2Enabled } from "../server/bim/featureFlag.ts";

const model = {
  name: "Two room fixture", siteName: "Site", buildingName: "Building",
  levels: [{ id: "ground", name: "Ground", elevation: 0 }],
  elements: [
    { id: "wall-1", type: "wall", name: "North wall", levelId: "ground", position: [0, 0, 0], end: [10, 0], height: 3, thickness: 0.2 },
    { id: "slab-1", type: "slab", name: "Floor", levelId: "ground", position: [0, 0, 0], width: 10, depth: 8, height: 0.2 },
    { id: "space-1", type: "space", name: "Room one", levelId: "ground", position: [0, 0, 0], width: 5, depth: 8, height: 3 },
    { id: "space-2", type: "space", name: "Room two", levelId: "ground", position: [5, 0, 0], width: 5, depth: 8, height: 3 },
  ],
};

const calibration = {
  sourceKind: "image",
  sourceDescription: "Measured exterior image set for a two-room single-storey building.",
  imageViews: ["front", "left", "right"],
  synthesizedImageViews: [],
  measurements: [
    { id: "overall-width", axis: "width", value: 10, unit: "m", source: "user_measurement" },
    { id: "overall-depth", axis: "depth", value: 8, unit: "m", source: "user_measurement" },
    { id: "wall-height", axis: "height", value: 3, unit: "m", source: "user_measurement" },
  ],
  userConfirmedAssumptions: ["No concealed services are represented", "Room division follows the supplied plan"],
};

test("BIM v2 server feature flag fails closed", () => {
  const original = process.env.BIM_V2_ENABLED;
  delete process.env.BIM_V2_ENABLED;
  assert.equal(isBimV2Enabled(), false);
  process.env.BIM_V2_ENABLED = "true";
  assert.equal(isBimV2Enabled(), true);
  if (original === undefined) delete process.env.BIM_V2_ENABLED;
  else process.env.BIM_V2_ENABLED = original;
});

test("pre-build verification requires calibrated image coverage and records uncertainty", () => {
  const report = buildBimPreBuildVerification(model, "shell", calibration);
  assert.equal(report.passed, true);
  assert.equal(report.trustedMeasurements.length, 3);
  assert.ok(report.unknownFacts.includes("concealed systems"));
  assert.match(report.disclosures[0], /no BIM semantics/i);
  assert.match(report.reportHash, /^[a-f0-9]{64}$/);
});

test("image input fails without front and second exterior view", () => {
  const report = buildBimPreBuildVerification(model, "shell", { ...calibration, imageViews: ["detail"] });
  assert.equal(report.passed, false);
  assert.ok(report.errors.some((item) => item.includes("front view")));
  assert.ok(report.errors.some((item) => item.includes("second exterior")));
});

test("IFC pre-build requires confirmed assumptions", () => {
  const report = buildBimPreBuildVerification(model, "ifc", { ...calibration, userConfirmedAssumptions: [] });
  assert.equal(report.passed, false);
  assert.ok(report.errors.some((item) => item.includes("explicit confirmation")));
});

test("pre-build rejects authored dimensions that contradict trusted scale", () => {
  const report = buildBimPreBuildVerification(model, "shell", {
    ...calibration,
    measurements: calibration.measurements.map((item) => item.axis === "width" ? { ...item, value: 12 } : item),
  });
  assert.equal(report.passed, false);
  assert.ok(report.errors.some((item) => item.includes("trusted measurements")));
});

test("shell post-build verifies trusted dimensions without semantic claims", () => {
  const pre = buildBimPreBuildVerification(model, "shell", calibration);
  const post = buildBimPostBuildVerification("shell", pre, {
    format: "glb-shell", bounds: { min: [0, 0, 0], max: [10, 8, 3] },
  });
  assert.equal(post.passed, true);
  assert.equal(post.semanticsVerified, false);
  assert.equal(post.claim, "verified_scaled_visual_shell");
});

test("post-build rejects output dimensions outside tolerance", () => {
  const pre = buildBimPreBuildVerification(model, "shell", calibration);
  const post = buildBimPostBuildVerification("shell", pre, {
    format: "glb-shell", bounds: { min: [0, 0, 0], max: [8, 8, 3] },
  });
  assert.equal(post.passed, false);
  assert.ok(post.errors.some((item) => item.includes("outside tolerance")));
});

test("IFC post-build requires schema, units, GlobalIds, relationships, placements, and round-trip", () => {
  const pre = buildBimPreBuildVerification(model, "ifc", calibration);
  const passing = buildBimPostBuildVerification("ifc", pre, {
    format: "ifc4-bim", bounds: { min: [0, 0, 0], max: [10, 8, 3] }, schema: "IFC4",
    sourceUnit: "m", metersPerUnit: 1, elementCount: 4, globalIdCount: 4,
    uniqueGlobalIdCount: 4, relationshipCount: 4, voidRelationshipCount: 0, fillingRelationshipCount: 0,
    propertySetElementCount: 4, storeyCount: 1, placementsFinite: true, roundTripPassed: true, proxyCount: 0,
  });
  assert.equal(passing.passed, true);
  assert.equal(passing.semanticsVerified, true);

  const failing = buildBimPostBuildVerification("ifc", pre, {
    format: "ifc4-bim", bounds: { min: [0, 0, 0], max: [10, 8, 3] }, schema: "IFC4X3",
    sourceUnit: "m", metersPerUnit: 1, elementCount: 4, globalIdCount: 4, uniqueGlobalIdCount: 3,
    relationshipCount: 0, voidRelationshipCount: 1, fillingRelationshipCount: 1,
    propertySetElementCount: 2, storeyCount: 0, placementsFinite: false, roundTripPassed: false,
  });
  assert.equal(failing.passed, false);
  assert.ok(failing.errors.length >= 5);
});

test("report hashes change when evidence changes", () => {
  const pre = buildBimPreBuildVerification(model, "shell", calibration);
  const a = buildBimPostBuildVerification("shell", pre, { format: "glb-shell", bounds: { min: [0, 0, 0], max: [10, 8, 3] } });
  const b = buildBimPostBuildVerification("shell", pre, { format: "glb-shell", bounds: { min: [0, 0, 0], max: [10.1, 8, 3] } });
  assert.notEqual(a.reportHash, b.reportHash);
});
