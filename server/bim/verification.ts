import crypto from "node:crypto";
import { z } from "zod";
import { preflightBimModel, type BimModel, type Point3 } from "../../src/bim/model";

export const BIM_VERIFIER_VERSION = "phase9-v1.0.0";
export type BimProductMode = "shell" | "ifc";

const finitePositive = z.number().finite().positive();
export const BimCalibrationSchema = z.object({
  sourceKind: z.enum(["text", "image"]),
  sourceDescription: z.string().trim().min(10).max(4000),
  imageViews: z.array(z.enum(["front", "rear", "left", "right", "interior", "plan", "detail"])).max(20).default([]),
  synthesizedImageViews: z.array(z.enum(["front", "rear", "left", "right", "interior", "plan", "detail"])).max(20).default([]),
  measurements: z.array(z.object({
    id: z.string().trim().min(1).max(80),
    axis: z.enum(["width", "depth", "height"]),
    value: finitePositive,
    unit: z.enum(["m", "cm", "mm", "ft", "in"]),
    source: z.enum(["user_measurement", "drawing", "survey", "known_object"]),
  }).strict()).min(1).max(50),
  coordinateReference: z.string().trim().max(200).optional(),
  userConfirmedAssumptions: z.array(z.string().trim().min(1).max(500)).max(50).default([]),
}).strict();

export type BimCalibration = z.infer<typeof BimCalibrationSchema>;

const METERS: Record<BimCalibration["measurements"][number]["unit"], number> = {
  m: 1, cm: 0.01, mm: 0.001, ft: 0.3048, in: 0.0254,
};

function dimensions(bounds: { min: Point3; max: Point3 } | null): Point3 | null {
  return bounds ? bounds.max.map((value, axis) => value - bounds.min[axis]) as Point3 : null;
}

function hashReport(report: Record<string, unknown>): string {
  return crypto.createHash("sha256").update(JSON.stringify(report)).digest("hex");
}

function toleranceFor(mode: BimProductMode, expectedMeters: number): number {
  return mode === "ifc" ? Math.max(0.025, expectedMeters * 0.01) : Math.max(0.05, expectedMeters * 0.02);
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
    if (!["left", "right", "rear", "plan"].some((view) => unique.has(view as any))) errors.push("Image calibration requires a second exterior or plan view.");
    if (unique.size < 3) warnings.push("Fewer than three distinct image views increases concealed-geometry uncertainty.");
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
  if (mode === "ifc" && !calibration?.userConfirmedAssumptions.length) {
    errors.push("IFC authoring requires explicit confirmation of inferred assumptions.");
  }
  if (mode === "ifc" && calibration?.coordinateReference) {
    warnings.push("The IFC stores the supplied CRS label, but no survey map-conversion parameters are inferred.");
  }

  const trustedMeasurements = (calibration?.measurements || []).map((item) => ({
    ...item,
    meters: item.value * METERS[item.unit],
  }));
  const modelDimensions = dimensions(modelReport.bounds);
  const dimensionComparisons = trustedMeasurements.map((item) => {
    const axisIndex = item.axis === "width" ? 0 : item.axis === "depth" ? 1 : 2;
    const actual = modelDimensions?.[axisIndex] ?? null;
    const tolerance = toleranceFor(mode, item.meters);
    const delta = actual === null ? null : Math.abs(actual - item.meters);
    return { id: item.id, axis: item.axis, expectedMeters: item.meters, actualMeters: actual, toleranceMeters: tolerance, deltaMeters: delta, passed: delta !== null && delta <= tolerance };
  });
  if (dimensionComparisons.some((item) => !item.passed)) errors.push("Authored dimensions do not match one or more trusted measurements.");
  const body = {
    verifierVersion: BIM_VERIFIER_VERSION,
    stage: "pre-build" as const,
    mode,
    passed: errors.length === 0,
    errors,
    warnings,
    sourceKind: calibration?.sourceKind || null,
    sourceDescription: calibration?.sourceDescription || null,
    imageViews: calibration?.imageViews || [],
    synthesizedImageViews: calibration?.synthesizedImageViews || [],
    coordinateReference: calibration?.coordinateReference || null,
    confirmedAssumptions: calibration?.userConfirmedAssumptions || [],
    trustedMeasurements,
    levelCount: modelReport.levelCount,
    elementCount: modelReport.elementCount,
    bounds: modelReport.bounds,
    modelDimensions,
    dimensionComparisons,
    expectedRelationships: {
      spatial: model.elements.length,
      voids: model.elements.filter((item) => item.type === "opening").length,
      fills: model.elements.filter((item) => item.type === "door" || item.type === "window").length,
    },
    accuracyClass: calibration?.measurements.some((item) => item.source === "survey") ? "survey-referenced" : "user-calibrated",
    visibleFacts: calibration?.sourceKind === "image" ? ["visible exterior surfaces", "supplied view silhouettes"] : ["user-authored specification"],
    inferredFacts: ["unsupplied dimensions", "occluded geometry", "materials without documentation", ...(calibration?.synthesizedImageViews.length ? ["synthesized image views"] : [])],
    unknownFacts: ["concealed systems", "structural adequacy", "code compliance", "property boundaries"],
    disclosures: mode === "ifc"
      ? ["IFC semantics are authored from supplied facts and confirmed assumptions; they are not a survey or code certification.", "A coordinate-reference label does not establish surveyed easting, northing, elevation, or rotation."]
      : ["Shell output is scaled visual geometry and contains no BIM semantics."],
  };
  return { ...body, reportHash: hashReport(body) };
}

export interface BimPostBuildEvidence {
  format: "glb-shell" | "ifc4-bim";
  bounds: { min: Point3; max: Point3 } | null;
  dimensionsMeters?: { width: number; depth: number; height: number };
  schema?: string;
  sourceUnit?: string;
  metersPerUnit?: number;
  elementCount?: number;
  globalIdCount?: number;
  uniqueGlobalIdCount?: number;
  relationshipCount?: number;
  voidRelationshipCount?: number;
  fillingRelationshipCount?: number;
  propertySetElementCount?: number;
  storeyCount?: number;
  coordinateReference?: string;
  placementsFinite?: boolean;
  roundTripPassed?: boolean;
  proxyCount?: number;
  geometryValid?: boolean;
}

export function buildBimPostBuildVerification(
  mode: BimProductMode,
  preBuild: ReturnType<typeof buildBimPreBuildVerification>,
  evidence: BimPostBuildEvidence,
) {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!preBuild.passed) errors.push("Pre-build verification did not pass.");
  const fallbackDimensions = dimensions(evidence.bounds);
  const builtByAxis = evidence.dimensionsMeters || (fallbackDimensions ? {
    width: fallbackDimensions[0], depth: fallbackDimensions[1], height: fallbackDimensions[2],
  } : null);
  const builtDimensions = builtByAxis ? [builtByAxis.width, builtByAxis.depth, builtByAxis.height] as Point3 : null;
  const comparisons = preBuild.trustedMeasurements.map((item) => {
    const axisIndex = item.axis === "width" ? 0 : item.axis === "depth" ? 1 : 2;
    const actual = builtDimensions?.[axisIndex] ?? null;
    const tolerance = toleranceFor(mode, item.meters);
    const delta = actual === null ? null : Math.abs(actual - item.meters);
    return { id: item.id, axis: item.axis, expectedMeters: item.meters, actualMeters: actual, toleranceMeters: tolerance, deltaMeters: delta, passed: delta !== null && delta <= tolerance };
  });
  if (comparisons.some((item) => !item.passed)) errors.push("One or more trusted dimensions are outside tolerance.");

  if (mode === "shell") {
    if (evidence.format !== "glb-shell") errors.push("Shell output must be a GLB shell.");
    if (evidence.geometryValid === false) errors.push("Shell GLB geometry validation failed.");
  } else {
    if (evidence.format !== "ifc4-bim") errors.push("IFC output format is invalid.");
    if (evidence.schema !== "IFC4") errors.push("IFC output must reopen as IFC4.");
    if (!Number.isFinite(evidence.metersPerUnit) || Number(evidence.metersPerUnit) <= 0) errors.push("IFC length units are invalid.");
    if (!evidence.roundTripPassed) errors.push("IFC round-trip validation failed.");
    if (!evidence.placementsFinite) errors.push("IFC contains invalid placement matrices.");
    if (!evidence.elementCount || evidence.globalIdCount !== evidence.elementCount || evidence.uniqueGlobalIdCount !== evidence.elementCount) errors.push("Every IFC element requires a non-empty unique GlobalId.");
    if (evidence.relationshipCount !== preBuild.expectedRelationships.spatial) errors.push("IFC spatial hierarchy is incomplete.");
    if (evidence.voidRelationshipCount !== preBuild.expectedRelationships.voids) errors.push("IFC opening/host relationships are incomplete.");
    if (evidence.fillingRelationshipCount !== preBuild.expectedRelationships.fills) errors.push("IFC opening/fill relationships are incomplete.");
    if (evidence.propertySetElementCount !== evidence.elementCount) errors.push("IFC authored property sets are incomplete.");
    if (evidence.storeyCount !== preBuild.levelCount) errors.push("IFC storey hierarchy does not match the authored levels.");
    if (preBuild.coordinateReference && evidence.coordinateReference !== preBuild.coordinateReference) errors.push("IFC coordinate reference was not preserved.");
    if (evidence.proxyCount) warnings.push(`${evidence.proxyCount} proxy elements require human review.`);
  }

  const body = {
    verifierVersion: BIM_VERIFIER_VERSION,
    stage: "post-build" as const,
    mode,
    passed: errors.length === 0,
    errors,
    warnings,
    format: evidence.format,
    schema: evidence.schema || null,
    sourceUnit: evidence.sourceUnit || null,
    metersPerUnit: evidence.metersPerUnit || null,
    coordinateReference: evidence.coordinateReference || null,
    builtDimensions,
    dimensionComparisons: comparisons,
    semanticsVerified: mode === "ifc" && errors.length === 0,
    claim: mode === "ifc" ? "verified_ifc4_semantic_model" : "verified_scaled_visual_shell",
  };
  return { ...body, reportHash: hashReport(body) };
}
