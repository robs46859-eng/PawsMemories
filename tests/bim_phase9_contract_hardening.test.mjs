import assert from "node:assert/strict";
import { test } from "node:test";
import { BimProposalRequestSchema, buildBimProposalBinding, parseBimProposal } from "../server/bim/proposal.ts";
import { BIM_BUILD_CONTRACT_VERSION, canonicalBimJson, createBimBuildCommand, hashBimContract } from "../server/bim/contracts.ts";
import { BimCalibrationSchema, buildBimPostBuildVerification, buildBimPreBuildVerification } from "../server/bim/verification.ts";

const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const c = Math.SQRT1_2;
const rotated = [c, c, 0, 0, -c, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

const twoRoomModel = {
  name: "Rotated two-room fixture",
  siteName: "Calibrated site",
  buildingName: "Two rooms",
  levels: [{ id: "ground", name: "Ground", elevation: 0 }],
  elements: [
    { id: "slab", type: "slab", name: "Floor", levelId: "ground", position: [0, 0, 0], width: 10, depth: 8, height: 0.2 },
    { id: "space-a", type: "space", name: "Room A", levelId: "ground", position: [0, 0, 0], width: 5, depth: 8, height: 3 },
    { id: "space-b", type: "space", name: "Room B", levelId: "ground", position: [5, 0, 0], width: 5, depth: 8, height: 3 },
    { id: "wall-rotated", type: "wall", name: "Angled wall", levelId: "ground", position: [1, 1, 0], end: [3, 3], height: 3, thickness: 0.2 },
    { id: "opening", type: "opening", name: "Door opening", levelId: "ground", position: [1.4, 1.4, 0.1], width: 1, depth: 0.2, height: 2.2, hostId: "wall-rotated" },
    { id: "door", type: "door", name: "Door", levelId: "ground", position: [1.4, 1.4, 0.1], width: 1, depth: 0.05, height: 2.1, openingId: "opening" },
  ],
};

const calibration = {
  sourceKind: "image",
  sourceDescription: "Three observed views with independently supplied overall dimensions for a two-room fixture.",
  imageViews: ["front", "left", "plan"],
  synthesizedImageViews: ["rear"],
  measurements: [
    { id: "w", axis: "width", value: 10000, unit: "mm", source: "drawing", uncertainty: { plusMinus: 10, unit: "mm", confidence: "documented" } },
    { id: "d", axis: "depth", value: 800, unit: "cm", source: "drawing", uncertainty: { plusMinus: 1, unit: "cm", confidence: "documented" } },
    { id: "h", axis: "height", value: 118.11023622, unit: "in", source: "survey", uncertainty: { plusMinus: 0.25, unit: "in", confidence: "surveyed" } },
  ],
  coordinateReference: "EPSG:26913",
  coordinatePlacement: {
    easting: 500000,
    northing: 4400000,
    orthogonalHeight: 1600,
    xAxisAbscissa: c,
    xAxisOrdinate: c,
    scale: 1,
    source: "survey",
  },
  userConfirmedAssumptions: ["Room division follows the supplied plan", "Concealed systems are excluded"],
};

function semanticEvidence(pre) {
  const { source: _source, ...mapConversion } = calibration.coordinatePlacement;
  const semanticElements = pre.expectedSemanticElements.map((expected, index) => ({
    sourceElementId: expected.sourceElementId,
    globalId: `G${String(index + 1).padStart(21, "0")}`,
    ifcClass: expected.ifcClass,
    hasPropertySet: true,
    placementMatrix: expected.requiresRotatedPlacement ? rotated : identity,
  }));
  return {
    format: "ifc4-bim",
    outputSha256: "d".repeat(64),
    preBuildReportHash: pre.reportHash,
    modelHash: pre.modelHash,
    calibrationHash: pre.calibrationHash,
    axisConvention: "z-up-model",
    bounds: { min: [0, 0, 0], max: [10, 8, 3] },
    schema: "IFC4",
    sourceUnit: "mm",
    metersPerUnit: 0.001,
    elementCount: semanticElements.length,
    globalIdCount: semanticElements.length,
    uniqueGlobalIdCount: semanticElements.length,
    relationshipCount: semanticElements.length,
    voidRelationshipCount: 1,
    fillingRelationshipCount: 1,
    propertySetElementCount: semanticElements.length,
    storeyCount: 1,
    coordinateReference: calibration.coordinateReference,
    mapConversion,
    surveyControlVerified: true,
    placementsFinite: true,
    roundTripPassed: true,
    proxyCount: 0,
    semanticElements,
    spatialElementIds: twoRoomModel.elements.map((element) => element.id),
    openingRelationships: [{ openingSourceId: "opening", hostSourceId: "wall-rotated" }],
    fillingRelationships: [{ fillingSourceId: "door", openingSourceId: "opening" }],
  };
}

test("canonical contract hashing is key-order independent and rejects non-finite data", () => {
  assert.equal(canonicalBimJson({ b: 2, a: { y: 2, x: 1 } }), canonicalBimJson({ a: { x: 1, y: 2 }, b: 2 }));
  assert.equal(hashBimContract({ b: 2, a: 1 }), hashBimContract({ a: 1, b: 2 }));
  assert.throws(() => canonicalBimJson({ dimension: Number.NaN }), /non-finite/);
});

test("calibration separates observed and synthesized views and constrains units and placement", () => {
  assert.equal(BimCalibrationSchema.safeParse(calibration).success, true);
  assert.equal(BimCalibrationSchema.safeParse({ ...calibration, synthesizedImageViews: ["front"] }).success, false);
  assert.equal(BimCalibrationSchema.safeParse({ ...calibration, measurements: [...calibration.measurements, { ...calibration.measurements[0], id: "w2" }] }).success, false);
  assert.equal(BimCalibrationSchema.safeParse({ ...calibration, coordinatePlacement: { ...calibration.coordinatePlacement, xAxisAbscissa: 0.2 } }).success, false);
});

test("proposal binding is deterministic and provenance cannot promote hypotheses to observations", () => {
  const images = [
    { view: "front", mimeType: "image/jpeg", data: "A".repeat(32) },
    { view: "left", mimeType: "image/jpeg", data: "B".repeat(32) },
    { view: "plan", mimeType: "image/png", data: "C".repeat(32) },
  ];
  const request = BimProposalRequestSchema.parse({ mode: "shell", calibration: { ...calibration, synthesizedImageViews: [] }, images });
  assert.deepEqual(buildBimProposalBinding(request), buildBimProposalBinding(structuredClone(request)));
  const proposal = {
    name: "Evidence model", siteName: "Site", buildingName: "Building", levels: [{ id: "ground", name: "Ground", elevation: 0 }],
    elements: [
      { id: "slab", type: "slab", name: "Slab", levelId: "ground", position: [0, 0, 0], width: 10, depth: 8, height: 0.2, properties: { Provenance: "measured", EvidenceRef: "measurement:w" } },
      { id: "space", type: "space", name: "Room", levelId: "ground", position: [0, 0, 0], width: 10, depth: 8, height: 3, properties: { Provenance: "observed", EvidenceRef: "image:front" } },
    ],
  };
  const parsed = parseBimProposal(JSON.stringify(proposal), request);
  assert.equal(parsed.provenanceSummary.observed, 1);
  assert.equal(parsed.proposalHash, parsed.verification.modelHash);
  const promoted = structuredClone(proposal);
  promoted.elements[1].properties.EvidenceRef = "image:rear";
  assert.throws(() => parseBimProposal(JSON.stringify(promoted), request), /provenance validation failed/i);
  const semanticShell = structuredClone(proposal);
  semanticShell.elements[0].properties.GlobalId = "not-allowed";
  assert.throws(() => parseBimProposal(JSON.stringify(semanticShell), request), /cannot assert IFC/i);
});

test("pre-build report records uncertainty and stable model/calibration bindings", () => {
  const pre = buildBimPreBuildVerification(twoRoomModel, "ifc", calibration);
  assert.equal(pre.passed, true, pre.errors.join("\n"));
  assert.equal(pre.uncertainty.dimensionUncertaintyMeters.width, 0.01);
  assert.equal(pre.evidenceProvenance.observedViews.includes("rear"), false);
  assert.equal(pre.evidenceProvenance.synthesizedViews.includes("rear"), true);
  assert.match(pre.modelHash, /^[a-f0-9]{64}$/);
  assert.match(pre.calibrationHash, /^[a-f0-9]{64}$/);
  assert.match(pre.reportHash, /^[a-f0-9]{64}$/);
});

test("rotated, unit-converted, two-room IFC evidence passes all semantic checks", () => {
  const pre = buildBimPreBuildVerification(twoRoomModel, "ifc", calibration);
  const post = buildBimPostBuildVerification("ifc", pre, semanticEvidence(pre));
  assert.equal(post.passed, true, post.errors.join("\n"));
  assert.equal(post.claim, "verified_ifc4_semantic_model");
  assert.equal(post.semanticsVerified, true);
  assert.equal(post.coordinatePlacementVerified, true);
});

test("IFC verifier rejects unit, rotation, identity, properties, relationships, and CRS drift", () => {
  const pre = buildBimPreBuildVerification(twoRoomModel, "ifc", calibration);
  const base = semanticEvidence(pre);
  const cases = [
    [{ ...base, metersPerUnit: 1 }, /length units/i],
    [{ ...base, semanticElements: base.semanticElements.map((item) => item.sourceElementId === "wall-rotated" ? { ...item, placementMatrix: identity } : item) }, /lost its rotated placement/i],
    [{ ...base, semanticElements: base.semanticElements.map((item, index) => index === 1 ? { ...item, globalId: base.semanticElements[0].globalId } : item), uniqueGlobalIdCount: base.uniqueGlobalIdCount - 1 }, /unique GlobalId/i],
    [{ ...base, semanticElements: base.semanticElements.map((item) => item.sourceElementId === "door" ? { ...item, hasPropertySet: false } : item), propertySetElementCount: base.propertySetElementCount - 1 }, /missing its authored property set/i],
    [{ ...base, openingRelationships: [], voidRelationshipCount: 0 }, /opening\/host relationships/i],
    [{ ...base, mapConversion: { ...base.mapConversion, easting: base.mapConversion.easting + 1 } }, /preserve easting/i],
  ];
  for (const [evidence, pattern] of cases) {
    const post = buildBimPostBuildVerification("ifc", pre, evidence);
    assert.equal(post.passed, false);
    assert.match(post.errors.join("\n"), pattern);
    assert.equal(post.claim, "unverified_ifc_output");
  }
});

test("shell claims remain non-semantic and bind the exact pre-build and output hashes", () => {
  const pre = buildBimPreBuildVerification(twoRoomModel, "shell", calibration);
  const evidence = {
    format: "glb-shell", outputSha256: "e".repeat(64), preBuildReportHash: pre.reportHash,
    modelHash: pre.modelHash, calibrationHash: pre.calibrationHash, axisConvention: "y-up-glb",
    bounds: { min: [0, 0, 0], max: [10, 3, 8] }, geometryValid: true,
  };
  const pass = buildBimPostBuildVerification("shell", pre, evidence);
  assert.equal(pass.passed, true, pass.errors.join("\n"));
  assert.equal(pass.claim, "verified_scaled_visual_shell");
  assert.equal(pass.semanticsVerified, false);
  const tampered = buildBimPostBuildVerification("shell", pre, { ...evidence, preBuildReportHash: "f".repeat(64) });
  assert.equal(tampered.passed, false);
  assert.equal(tampered.claim, "unverified_shell_output");
  const semanticClaim = buildBimPostBuildVerification("shell", pre, { ...evidence, schema: "IFC4" });
  assert.ok(semanticClaim.errors.some((error) => error.includes("cannot assert IFC semantics")));
});

test("durable build command binds the accepted proposal before later SQL integration", () => {
  const pre = buildBimPreBuildVerification(twoRoomModel, "ifc", calibration);
  const base = {
    jobUuid: "11111111-1111-4111-8111-111111111111",
    attemptUuid: "22222222-2222-4222-8222-222222222222",
    ownerKey: "owner:42",
    mode: "ifc",
    idempotencyKey: "bim-build-owner-42-attempt-1",
    modelHash: pre.modelHash,
    calibrationHash: pre.calibrationHash,
    proposalHash: pre.modelHash,
    acceptedProposalHash: pre.modelHash,
    preBuildReportHash: pre.reportHash,
    requestedAt: "2026-07-22T12:00:00.000Z",
  };
  const command = createBimBuildCommand(base);
  assert.equal(command.contractVersion, BIM_BUILD_CONTRACT_VERSION);
  assert.throws(() => createBimBuildCommand({ ...base, acceptedProposalHash: "0".repeat(64) }), /accepted proposal/i);
});
