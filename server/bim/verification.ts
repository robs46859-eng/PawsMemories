import { z } from "zod";
import { preflightBimModel, type BimElementType, type BimModel, type Point3 } from "../../src/bim/model";
import { BIM_BUILD_CONTRACT_VERSION, Sha256Schema, hashBimCalibration, hashBimContract, hashBimModel } from "./contracts";

export const BIM_VERIFIER_VERSION = "phase9-v2.0.0";
export type BimProductMode = "shell" | "ifc";

const finite = z.number().finite();
const finitePositive = finite.positive();
const ImageViewSchema = z.enum(["front", "rear", "left", "right", "interior", "plan", "detail"]);
const MeasurementUnitSchema = z.enum(["m", "cm", "mm", "ft", "in"]);

const MeasurementSchema = z.object({
  id: z.string().trim().min(1).max(80),
  axis: z.enum(["width", "depth", "height"]),
  value: finitePositive,
  unit: MeasurementUnitSchema,
  source: z.enum(["user_measurement", "drawing", "survey", "known_object"]),
  evidenceRef: z.string().trim().min(1).max(160).optional(),
  uncertainty: z.object({
    plusMinus: finitePositive,
    unit: MeasurementUnitSchema,
    confidence: z.enum(["estimated", "documented", "surveyed"]),
  }).strict().optional(),
}).strict();

export const BimCalibrationSchema = z.object({
  sourceKind: z.enum(["text", "image"]),
  sourceDescription: z.string().trim().min(10).max(4000),
  imageViews: z.array(ImageViewSchema).max(20).default([]),
  synthesizedImageViews: z.array(ImageViewSchema).max(20).default([]),
  measurements: z.array(MeasurementSchema).min(1).max(50),
  coordinateReference: z.string().trim().max(200).optional(),
  coordinatePlacement: z.object({
    easting: finite,
    northing: finite,
    orthogonalHeight: finite,
    xAxisAbscissa: finite,
    xAxisOrdinate: finite,
    scale: finitePositive.default(1),
    source: z.enum(["survey", "drawing", "user"]),
  }).strict().optional(),
  userConfirmedAssumptions: z.array(z.string().trim().min(1).max(500)).max(50).default([]),
}).strict().superRefine((value, context) => {
  const observed = new Set(value.imageViews);
  const synthesized = new Set(value.synthesizedImageViews);
  if (observed.size !== value.imageViews.length) context.addIssue({ code: "custom", path: ["imageViews"], message: "Observed image views must be unique" });
  if (synthesized.size !== value.synthesizedImageViews.length) context.addIssue({ code: "custom", path: ["synthesizedImageViews"], message: "Synthesized image views must be unique" });
  for (const view of synthesized) {
    if (observed.has(view)) context.addIssue({ code: "custom", path: ["synthesizedImageViews"], message: `${view} cannot be both observed and synthesized` });
  }
  if (value.sourceKind === "text" && (observed.size || synthesized.size)) context.addIssue({ code: "custom", path: ["imageViews"], message: "Text calibration cannot claim image evidence" });
  const ids = new Set(value.measurements.map((measurement) => measurement.id));
  if (ids.size !== value.measurements.length) context.addIssue({ code: "custom", path: ["measurements"], message: "Measurement IDs must be unique" });
  const axes = new Set(value.measurements.map((measurement) => measurement.axis));
  if (axes.size !== value.measurements.length) context.addIssue({ code: "custom", path: ["measurements"], message: "Overall calibration accepts one authoritative measurement per axis" });
  if (value.coordinatePlacement && !value.coordinateReference) context.addIssue({ code: "custom", path: ["coordinateReference"], message: "Coordinate placement requires a CRS reference" });
  if (value.coordinatePlacement && Math.abs(Math.hypot(value.coordinatePlacement.xAxisAbscissa, value.coordinatePlacement.xAxisOrdinate) - 1) > 1e-6) {
    context.addIssue({ code: "custom", path: ["coordinatePlacement"], message: "Coordinate X-axis direction must be a unit vector" });
  }
});

export type BimCalibration = z.infer<typeof BimCalibrationSchema>;

const METERS: Record<z.infer<typeof MeasurementUnitSchema>, number> = {
  m: 1, cm: 0.01, mm: 0.001, ft: 0.3048, in: 0.0254,
};

const IFC_CLASS: Record<BimElementType, string> = {
  wall: "IfcWall", slab: "IfcSlab", roof: "IfcRoof", opening: "IfcOpeningElement",
  door: "IfcDoor", window: "IfcWindow", space: "IfcSpace", column: "IfcColumn", beam: "IfcBeam",
};

function dimensions(bounds: { min: Point3; max: Point3 } | null, convention: "z-up-model" | "y-up-glb" = "z-up-model"): Point3 | null {
  if (!bounds) return null;
  const raw = bounds.max.map((value, axis) => value - bounds.min[axis]) as Point3;
  return convention === "y-up-glb" ? [raw[0], raw[2], raw[1]] : raw;
}

function toleranceFor(mode: BimProductMode, expectedMeters: number, uncertaintyMeters: number | null): number {
  const policyTolerance = mode === "ifc" ? Math.max(0.025, expectedMeters * 0.01) : Math.max(0.05, expectedMeters * 0.02);
  return Math.max(policyTolerance, uncertaintyMeters || 0);
}

function wallIsRotated(model: BimModel, id: string): boolean {
  const wall = model.elements.find((element) => element.id === id);
  if (!wall?.end) return false;
  const dx = wall.end[0] - wall.position[0];
  const dy = wall.end[1] - wall.position[1];
  return Math.abs(dx) > 1e-8 && Math.abs(dy) > 1e-8;
}

export function buildBimPreBuildVerification(model: BimModel, mode: BimProductMode, input: unknown) {
  const parsed = BimCalibrationSchema.safeParse(input);
  const modelReport = preflightBimModel(model);
  const errors = [...modelReport.errors];
  const warnings = [...modelReport.warnings];
  if (!parsed.success) errors.push(...parsed.error.issues.map((issue) => `Calibration ${issue.path.join(".")}: ${issue.message}`));

  const calibration = parsed.success ? parsed.data : null;
  if (calibration?.sourceKind === "image") {
    const unique = new Set(calibration.imageViews);
    if (!unique.has("front")) errors.push("Image calibration requires a front view.");
    if (!["left", "right", "rear", "plan"].some((view) => unique.has(view as z.infer<typeof ImageViewSchema>))) errors.push("Image calibration requires a second exterior or plan view.");
    if (unique.size < 3) warnings.push("Fewer than three distinct observed image views increases concealed-geometry uncertainty.");
    if (calibration.synthesizedImageViews.length) warnings.push("Synthesized views are hypotheses and do not count as observed coverage.");
  }
  const measuredAxes = new Set(calibration?.measurements.map((item) => item.axis) || []);
  for (const axis of ["width", "depth", "height"] as const) {
    if (!measuredAxes.has(axis)) {
      const message = `No trusted ${axis} measurement was supplied; that axis remains inferred.`;
      if (mode === "ifc") errors.push(message);
      else warnings.push(message);
    }
  }
  if (mode === "ifc" && !calibration?.userConfirmedAssumptions.length) errors.push("IFC authoring requires explicit confirmation of inferred assumptions.");
  if (calibration?.coordinateReference && !calibration.coordinatePlacement) warnings.push("A CRS label was supplied without map-conversion control; no surveyed placement is claimed.");
  if (calibration?.measurements.some((item) => !item.uncertainty)) warnings.push("One or more measurements omit uncertainty; the verifier policy tolerance is used instead.");

  const trustedMeasurements = (calibration?.measurements || []).map((item) => {
    const uncertaintyMeters = item.uncertainty ? item.uncertainty.plusMinus * METERS[item.uncertainty.unit] : null;
    return { ...item, meters: item.value * METERS[item.unit], uncertaintyMeters };
  });
  const modelDimensions = dimensions(modelReport.bounds);
  const dimensionComparisons = trustedMeasurements.map((item) => {
    const axisIndex = item.axis === "width" ? 0 : item.axis === "depth" ? 1 : 2;
    const actual = modelDimensions?.[axisIndex] ?? null;
    const tolerance = toleranceFor(mode, item.meters, item.uncertaintyMeters);
    const delta = actual === null ? null : Math.abs(actual - item.meters);
    return { id: item.id, axis: item.axis, expectedMeters: item.meters, actualMeters: actual, uncertaintyMeters: item.uncertaintyMeters, toleranceMeters: tolerance, deltaMeters: delta, passed: delta !== null && delta <= tolerance };
  });
  if (dimensionComparisons.some((item) => !item.passed)) errors.push("Authored dimensions do not match one or more trusted measurements.");

  const modelHash = hashBimModel(model);
  const calibrationHash = hashBimCalibration(calibration || input);
  const inputHash = hashBimContract({ contractVersion: BIM_BUILD_CONTRACT_VERSION, mode, modelHash, calibrationHash });
  const expectedSemanticElements = model.elements.map((element) => ({
    sourceElementId: element.id,
    ifcClass: IFC_CLASS[element.type],
    requiresPropertySet: true,
    requiresRotatedPlacement: wallIsRotated(model, element.id),
  }));
  const body = {
    contractVersion: BIM_BUILD_CONTRACT_VERSION,
    verifierVersion: BIM_VERIFIER_VERSION,
    stage: "pre-build" as const,
    mode,
    passed: errors.length === 0,
    errors,
    warnings,
    modelHash,
    calibrationHash,
    inputHash,
    sourceKind: calibration?.sourceKind || null,
    sourceDescription: calibration?.sourceDescription || null,
    evidenceProvenance: {
      observedViews: calibration?.imageViews || [],
      synthesizedViews: calibration?.synthesizedImageViews || [],
      measuredEvidence: trustedMeasurements.map((item) => ({ id: item.id, source: item.source, evidenceRef: item.evidenceRef || null })),
      userConfirmedAssumptions: calibration?.userConfirmedAssumptions || [],
    },
    uncertainty: {
      dimensionUncertaintyMeters: Object.fromEntries(trustedMeasurements.map((item) => [item.axis, item.uncertaintyMeters])),
      concealedGeometry: "unknown" as const,
      structuralAdequacy: "unknown" as const,
      codeCompliance: "unknown" as const,
      propertyBoundary: "unknown" as const,
      coordinatePlacement: calibration?.coordinatePlacement ? "supplied_not_independently_verified" as const : "unknown" as const,
    },
    imageViews: calibration?.imageViews || [],
    synthesizedImageViews: calibration?.synthesizedImageViews || [],
    coordinateReference: calibration?.coordinateReference || null,
    coordinatePlacement: calibration?.coordinatePlacement || null,
    confirmedAssumptions: calibration?.userConfirmedAssumptions || [],
    trustedMeasurements,
    levelCount: modelReport.levelCount,
    elementCount: modelReport.elementCount,
    bounds: modelReport.bounds,
    modelDimensions,
    dimensionComparisons,
    expectedSemanticElements,
    expectedRelationships: {
      spatialElementIds: model.elements.map((element) => element.id),
      openings: model.elements.filter((element) => element.type === "opening").map((element) => ({ openingSourceId: element.id, hostSourceId: element.hostId! })),
      fills: model.elements.filter((element) => element.type === "door" || element.type === "window").map((element) => ({ fillingSourceId: element.id, openingSourceId: element.openingId! })),
    },
    accuracyClass: calibration?.coordinatePlacement?.source === "survey" ? "survey-referenced-not-certified" : "user-calibrated",
    visibleFacts: calibration?.sourceKind === "image" ? ["visible surfaces in explicitly observed views", "supplied view silhouettes"] : ["user-authored specification"],
    inferredFacts: ["unsupplied dimensions", "occluded geometry", "materials without documentation", ...(calibration?.synthesizedImageViews.length ? ["synthesized image views"] : [])],
    unknownFacts: ["concealed systems", "structural adequacy", "code compliance", "property boundaries"],
    disclosures: mode === "ifc"
      ? ["IFC semantics are authored from supplied facts and confirmed assumptions; they are not a survey or code certification.", "A CRS label without verified map conversion does not establish surveyed placement."]
      : ["Shell output is scaled visual geometry and contains no BIM semantics."],
  };
  return { ...body, reportHash: hashBimContract(body) };
}

const BoundsSchema = z.object({ min: z.tuple([finite, finite, finite]), max: z.tuple([finite, finite, finite]) }).strict();
const SemanticElementSchema = z.object({
  sourceElementId: z.string().trim().min(1).max(80),
  globalId: z.string().regex(/^[0-9A-Za-z_$]{22}$/, "Invalid IFC GlobalId"),
  ifcClass: z.string().regex(/^Ifc[A-Za-z0-9]+$/).max(80),
  hasPropertySet: z.boolean(),
  placementMatrix: z.array(finite).length(16),
}).strict();

export const BimPostBuildEvidenceSchema = z.object({
  format: z.enum(["glb-shell", "ifc4-bim"]),
  outputSha256: Sha256Schema.optional(),
  preBuildReportHash: Sha256Schema.optional(),
  modelHash: Sha256Schema.optional(),
  calibrationHash: Sha256Schema.optional(),
  axisConvention: z.enum(["z-up-model", "y-up-glb"]).optional(),
  bounds: BoundsSchema.nullable(),
  dimensionsMeters: z.object({ width: finitePositive, depth: finitePositive, height: finitePositive }).strict().optional(),
  geometryValid: z.boolean().optional(),
  schema: z.string().max(40).optional(),
  sourceUnit: z.string().max(40).optional(),
  metersPerUnit: finitePositive.optional(),
  elementCount: z.number().int().nonnegative().optional(),
  globalIdCount: z.number().int().nonnegative().optional(),
  uniqueGlobalIdCount: z.number().int().nonnegative().optional(),
  relationshipCount: z.number().int().nonnegative().optional(),
  voidRelationshipCount: z.number().int().nonnegative().optional(),
  fillingRelationshipCount: z.number().int().nonnegative().optional(),
  propertySetElementCount: z.number().int().nonnegative().optional(),
  storeyCount: z.number().int().nonnegative().optional(),
  coordinateReference: z.string().max(200).optional(),
  mapConversion: z.object({ easting: finite, northing: finite, orthogonalHeight: finite, xAxisAbscissa: finite, xAxisOrdinate: finite, scale: finitePositive }).strict().optional(),
  surveyControlVerified: z.boolean().optional(),
  placementsFinite: z.boolean().optional(),
  roundTripPassed: z.boolean().optional(),
  proxyCount: z.number().int().nonnegative().optional(),
  semanticElements: z.array(SemanticElementSchema).max(2000).optional(),
  spatialElementIds: z.array(z.string().trim().min(1).max(80)).max(2000).optional(),
  openingRelationships: z.array(z.object({ openingSourceId: z.string().max(80), hostSourceId: z.string().max(80) }).strict()).max(2000).optional(),
  fillingRelationships: z.array(z.object({ fillingSourceId: z.string().max(80), openingSourceId: z.string().max(80) }).strict()).max(2000).optional(),
}).strict();

export type BimPostBuildEvidence = z.infer<typeof BimPostBuildEvidenceSchema>;

const UNIT_TO_METERS: Record<string, number> = { m: 1, metre: 1, meter: 1, mm: 0.001, millimetre: 0.001, millimeter: 0.001, cm: 0.01, ft: 0.3048, in: 0.0254 };

function sameStringSet(actual: string[] | undefined, expected: string[]): boolean {
  return !!actual && actual.length === expected.length && new Set(actual).size === actual.length && expected.every((value) => actual.includes(value));
}

function determinant3(matrix: number[]): number {
  return matrix[0] * (matrix[5] * matrix[10] - matrix[6] * matrix[9])
    - matrix[4] * (matrix[1] * matrix[10] - matrix[2] * matrix[9])
    + matrix[8] * (matrix[1] * matrix[6] - matrix[2] * matrix[5]);
}

function hasRotation(matrix: number[]): boolean {
  return Math.abs(matrix[1]) > 1e-6 || Math.abs(matrix[2]) > 1e-6 || Math.abs(matrix[4]) > 1e-6 || Math.abs(matrix[6]) > 1e-6 || Math.abs(matrix[8]) > 1e-6 || Math.abs(matrix[9]) > 1e-6;
}

function relationshipKey(value: Record<string, string>): string {
  return Object.keys(value).sort().map((key) => `${key}:${value[key]}`).join("|");
}

export function buildBimPostBuildVerification(mode: BimProductMode, preBuild: ReturnType<typeof buildBimPreBuildVerification>, rawEvidence: BimPostBuildEvidence) {
  const parsed = BimPostBuildEvidenceSchema.safeParse(rawEvidence);
  const evidence = parsed.success ? parsed.data : rawEvidence;
  const errors: string[] = parsed.success ? [] : parsed.error.issues.map((issue) => `Post-build evidence ${issue.path.join(".")}: ${issue.message}`);
  const warnings: string[] = [];
  if (!preBuild.passed) errors.push("Pre-build verification did not pass.");
  if (evidence.preBuildReportHash !== preBuild.reportHash) errors.push("Post-build evidence is not bound to the exact pre-build report hash.");
  if (evidence.modelHash !== preBuild.modelHash) errors.push("Post-build evidence is not bound to the verified model hash.");
  if (evidence.calibrationHash !== preBuild.calibrationHash) errors.push("Post-build evidence is not bound to the verified calibration hash.");
  if (!evidence.outputSha256 || !Sha256Schema.safeParse(evidence.outputSha256).success) errors.push("Post-build evidence requires the delivered output SHA-256.");
  if (!evidence.axisConvention) errors.push("Post-build evidence requires an explicit axis convention.");

  const boundsDimensions = dimensions(evidence.bounds as { min: Point3; max: Point3 } | null, evidence.axisConvention || "z-up-model");
  const builtByAxis = evidence.dimensionsMeters || (boundsDimensions ? { width: boundsDimensions[0], depth: boundsDimensions[1], height: boundsDimensions[2] } : null);
  const builtDimensions = builtByAxis ? [builtByAxis.width, builtByAxis.depth, builtByAxis.height] as Point3 : null;
  if (boundsDimensions && builtDimensions && builtDimensions.some((value, axis) => Math.abs(value - boundsDimensions[axis]) > 1e-6)) errors.push("Canonical dimensions do not match bounds under the declared axis convention.");
  const comparisons = preBuild.trustedMeasurements.map((item) => {
    const axisIndex = item.axis === "width" ? 0 : item.axis === "depth" ? 1 : 2;
    const actual = builtDimensions?.[axisIndex] ?? null;
    const tolerance = toleranceFor(mode, item.meters, item.uncertaintyMeters);
    const delta = actual === null ? null : Math.abs(actual - item.meters);
    return { id: item.id, axis: item.axis, expectedMeters: item.meters, actualMeters: actual, uncertaintyMeters: item.uncertaintyMeters, toleranceMeters: tolerance, deltaMeters: delta, passed: delta !== null && delta <= tolerance };
  });
  if (comparisons.some((item) => !item.passed)) errors.push("One or more trusted dimensions are outside tolerance.");

  if (mode === "shell") {
    if (evidence.format !== "glb-shell") errors.push("Shell output must be a GLB shell.");
    if (evidence.geometryValid !== true) errors.push("Shell GLB geometry must pass independent validation.");
    if (evidence.semanticElements?.length || evidence.schema || evidence.globalIdCount || evidence.propertySetElementCount) errors.push("Shell evidence cannot assert IFC semantics.");
  } else {
    if (evidence.format !== "ifc4-bim") errors.push("IFC output format is invalid.");
    if (evidence.schema !== "IFC4") errors.push("IFC output must reopen as IFC4.");
    const expectedUnit = evidence.sourceUnit ? UNIT_TO_METERS[evidence.sourceUnit.toLowerCase()] : undefined;
    if (!expectedUnit || !Number.isFinite(evidence.metersPerUnit) || Math.abs(Number(evidence.metersPerUnit) - expectedUnit) > 1e-12) errors.push("IFC length units are missing or inconsistent with metersPerUnit.");
    if (!evidence.roundTripPassed) errors.push("IFC round-trip validation failed.");
    if (!evidence.placementsFinite) errors.push("IFC contains invalid placement matrices.");
    if (evidence.storeyCount !== preBuild.levelCount) errors.push("IFC storey hierarchy does not match the authored levels.");

    const semanticElements = evidence.semanticElements || [];
    const expectedElements = preBuild.expectedSemanticElements;
    const sourceIds = semanticElements.map((item) => item.sourceElementId);
    const globalIds = semanticElements.map((item) => item.globalId);
    if (semanticElements.length !== expectedElements.length || new Set(sourceIds).size !== sourceIds.length) errors.push("IFC semantic elements do not map one-to-one to authored elements.");
    if (new Set(globalIds).size !== globalIds.length || globalIds.length !== expectedElements.length) errors.push("Every IFC element requires a non-empty unique GlobalId.");
    for (const expected of expectedElements) {
      const actual = semanticElements.find((item) => item.sourceElementId === expected.sourceElementId);
      if (!actual) continue;
      if (actual.ifcClass !== expected.ifcClass) errors.push(`${expected.sourceElementId} reopened as ${actual.ifcClass}, expected ${expected.ifcClass}.`);
      if (!actual.hasPropertySet) errors.push(`${expected.sourceElementId} is missing its authored property set.`);
      const determinant = determinant3(actual.placementMatrix);
      if (!Number.isFinite(determinant) || Math.abs(Math.abs(determinant) - 1) > 1e-4) errors.push(`${expected.sourceElementId} has a non-rigid placement rotation.`);
      if (expected.requiresRotatedPlacement && !hasRotation(actual.placementMatrix)) errors.push(`${expected.sourceElementId} lost its rotated placement.`);
    }
    if (evidence.elementCount !== semanticElements.length || evidence.globalIdCount !== globalIds.length || evidence.uniqueGlobalIdCount !== new Set(globalIds).size) errors.push("IFC aggregate identity counts do not match per-element evidence.");
    if (evidence.propertySetElementCount !== semanticElements.filter((item) => item.hasPropertySet).length) errors.push("IFC property-set count does not match per-element evidence.");
    if (!sameStringSet(evidence.spatialElementIds, preBuild.expectedRelationships.spatialElementIds)) errors.push("IFC spatial hierarchy is incomplete.");

    const expectedOpenings = preBuild.expectedRelationships.openings.map((value) => relationshipKey(value));
    const actualOpenings = (evidence.openingRelationships || []).map((value) => relationshipKey(value));
    if (!sameStringSet(actualOpenings, expectedOpenings) || evidence.voidRelationshipCount !== expectedOpenings.length) errors.push("IFC opening/host relationships are incomplete.");
    const expectedFills = preBuild.expectedRelationships.fills.map((value) => relationshipKey(value));
    const actualFills = (evidence.fillingRelationships || []).map((value) => relationshipKey(value));
    if (!sameStringSet(actualFills, expectedFills) || evidence.fillingRelationshipCount !== expectedFills.length) errors.push("IFC opening/fill relationships are incomplete.");
    if (evidence.relationshipCount !== preBuild.expectedRelationships.spatialElementIds.length) errors.push("IFC spatial relationship count is inconsistent.");

    if (preBuild.coordinateReference && evidence.coordinateReference !== preBuild.coordinateReference) errors.push("IFC coordinate reference was not preserved.");
    if (evidence.mapConversion) {
      const norm = Math.hypot(evidence.mapConversion.xAxisAbscissa, evidence.mapConversion.xAxisOrdinate);
      if (Math.abs(norm - 1) > 1e-6) errors.push("IFC map-conversion axis is not normalized.");
      if (!preBuild.coordinatePlacement && evidence.surveyControlVerified) errors.push("Output cannot claim survey control that was absent from calibration.");
      if (preBuild.coordinatePlacement) {
        for (const key of ["easting", "northing", "orthogonalHeight", "xAxisAbscissa", "xAxisOrdinate", "scale"] as const) {
          if (Math.abs(evidence.mapConversion[key] - preBuild.coordinatePlacement[key]) > 1e-8) errors.push(`IFC map conversion did not preserve ${key}.`);
        }
      }
    } else if (preBuild.coordinateReference) {
      warnings.push("The CRS label was preserved without map conversion; surveyed placement is not verified.");
    }
    if (evidence.proxyCount) warnings.push(`${evidence.proxyCount} proxy elements require human review.`);
  }

  const passed = errors.length === 0;
  const body = {
    contractVersion: BIM_BUILD_CONTRACT_VERSION,
    verifierVersion: BIM_VERIFIER_VERSION,
    stage: "post-build" as const,
    mode,
    passed,
    errors,
    warnings,
    preBuildReportHash: preBuild.reportHash,
    modelHash: preBuild.modelHash,
    calibrationHash: preBuild.calibrationHash,
    outputSha256: evidence.outputSha256 || null,
    format: evidence.format,
    schema: evidence.schema || null,
    sourceUnit: evidence.sourceUnit || null,
    metersPerUnit: evidence.metersPerUnit || null,
    axisConvention: evidence.axisConvention || null,
    coordinateReference: evidence.coordinateReference || null,
    coordinatePlacementVerified: !!preBuild.coordinatePlacement && !!evidence.mapConversion && errors.every((error) => !error.includes("map conversion")),
    builtDimensions,
    dimensionComparisons: comparisons,
    semanticsVerified: mode === "ifc" && passed,
    claim: passed
      ? mode === "ifc" ? "verified_ifc4_semantic_model" : "verified_scaled_visual_shell"
      : mode === "ifc" ? "unverified_ifc_output" : "unverified_shell_output",
  };
  return { ...body, reportHash: hashBimContract(body) };
}
