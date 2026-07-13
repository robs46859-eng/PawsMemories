/**
 * Spatial metadata schema for authoritative model scale and coordinates.
 *
 * Defines the contract for physical-scale provenance, coordinate systems,
 * bounds, calibration, and derivative lineage. Used at every import/export
 * boundary to ensure scale preservation across the pipeline.
 *
 * Canonical unit is always SI meters. All other units convert at boundaries.
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// Supported source length units
// ---------------------------------------------------------------------------
export const SUPPORTED_LENGTH_UNITS = [
  "m",
  "cm",
  "mm",
  "ft",
  "in",
  "ft/in",
  "km",
] as const;

export const SourceLengthUnit = z.enum(SUPPORTED_LENGTH_UNITS);
export type SourceLengthUnit = z.infer<typeof SourceLengthUnit>;

// ---------------------------------------------------------------------------
// Conversion factors: source unit → meters
// ---------------------------------------------------------------------------
export const UNIT_TO_METERS: Record<SourceLengthUnit, number> = {
  m: 1,
  cm: 0.01,
  mm: 0.001,
  ft: 0.3048,
  in: 0.0254,
  "ft/in": 0.3048, // feet portion; inches handled separately
  km: 1000,
};

// ---------------------------------------------------------------------------
// Accuracy classes
// ---------------------------------------------------------------------------
export const ACCURACY_CLASSES = [
  "visual",
  "approximate",
  "precise",
  "survey",
] as const;

export const AccuracyClass = z.enum(ACCURACY_CLASSES);
export type AccuracyClass = z.infer<typeof AccuracyClass>;

// ---------------------------------------------------------------------------
// Calibration methods
// ---------------------------------------------------------------------------
export const CALIBRATION_METHODS = [
  "unknown",
  "trusted_source",
  "user_calibrated",
  "known_marker",
  "sensor_scale",
  "survey_control",
  "photogrammetric",
  "ifc_units",
  "estimated",
] as const;

export const CalibrationMethod = z.enum(CALIBRATION_METHODS);
export type CalibrationMethod = z.infer<typeof CalibrationMethod>;

// ---------------------------------------------------------------------------
// Up axis orientation
// ---------------------------------------------------------------------------
export const UpAxis = z.enum(["Y", "Z", "X"]);
export type UpAxis = z.infer<typeof UpAxis>;

// ---------------------------------------------------------------------------
// Forward axis orientation (view direction)
// ---------------------------------------------------------------------------
export const ForwardAxis = z.enum(["+Z", "-Z", "+X", "-X", "+Y", "-Y"]);
export type ForwardAxis = z.infer<typeof ForwardAxis>;

// ---------------------------------------------------------------------------
// Handedness
// ---------------------------------------------------------------------------
export const Handedness = z.enum(["right", "left"]);
export type Handedness = z.infer<typeof Handedness>;

// ---------------------------------------------------------------------------
// Bounds tuple [minX, minY, minZ] / [maxX, maxY, maxZ]
// ---------------------------------------------------------------------------
const Point3 = z.tuple([z.number(), z.number(), z.number()]).refine(
  (p) => p.every((v) => Number.isFinite(v)),
  { message: "Bounds must contain finite numbers" }
);

// ---------------------------------------------------------------------------
// Direction vector (normalized)
// ---------------------------------------------------------------------------
const Direction3 = z
  .tuple([z.number(), z.number(), z.number()])
  .refine((p) => {
    const len = Math.sqrt(p[0] * p[0] + p[1] * p[1] + p[2] * p[2]);
    return Number.isFinite(len) && len > 0;
  }, { message: "Direction must be finite non-zero vector" });

// ---------------------------------------------------------------------------
// North direction — stored as a direction vector {x, y, z}
// ---------------------------------------------------------------------------
const NorthDirection = z
  .object({ x: z.number(), y: z.number(), z: z.number() })
  .refine(
    (d) => {
      const len = Math.sqrt(d.x * d.x + d.y * d.y + d.z * d.z);
      return Number.isFinite(len) && len > 0;
    },
    { message: "North direction must be finite non-zero vector" }
  );

// ---------------------------------------------------------------------------
// Main spatial metadata schema
// ---------------------------------------------------------------------------
export const ModelSpatialMetadataSchema = z
  .object({
    // Schema version for forward/backward compatibility
    schemaVersion: z.literal(1),

    // Source information
    sourceUnit: SourceLengthUnit,
    metersPerSourceUnit: z.number().positive().finite(),
    canonicalUnit: z.literal("m"),

    // Coordinate axes
    upAxis: UpAxis.default("Y"),
    forwardAxis: ForwardAxis.default("+Z"),
    handedness: Handedness.default("right"),

    // Bounds in source units
    sourceBoundsMin: Point3,
    sourceBoundsMax: Point3,

    // Bounds in canonical meters (converted)
    canonicalBoundsMin: Point3,
    canonicalBoundsMax: Point3,

    // Local engineering origin (model-space origin in meters)
    localOrigin: Point3.default([0, 0, 0]),

    // Geospatial / datum (optional)
    datumDescription: z.string().optional(),
    sourceCRS: z.string().optional(), // e.g. "EPSG:4326"
    verticalDatum: z.string().optional(), // e.g. "NAVD88"

    // North references
    projectNorth: NorthDirection.optional(),
    trueNorth: NorthDirection.optional(),

    // Calibration
    calibrationMethod: CalibrationMethod.default("unknown"),
    calibrationConfidence: z.number().min(0).max(1).default(0),
    accuracyClass: AccuracyClass.default("visual"),
    tolerance: z.number().nonnegative().optional(), // meters

    // Source identity
    sourceHash: z.string().min(1),
    sourceFilename: z.string().optional(),
    sourceUri: z.string().optional(),

    // Derivative lineage
    parentDerivativeId: z.string().uuid().optional(),
    derivativeId: z.string().uuid().optional(),

    // Tool versions
    converterVersion: z.string().optional(),
    importTool: z.string().optional(),

    // Scale values
    physicalScale: z.number().positive().finite().default(1),
    displayScale: z.number().positive().finite().default(1),

    // Timestamps
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime().optional(),

    // Calibration provenance (before/after)
    calibrationBefore: Point3.optional(),
    calibrationAfter: Point3.optional(),
  })
  .refine(
    (data) => {
      // Verify bounds have positive extents (max > min for each axis)
      const sMin = data.sourceBoundsMin;
      const sMax = data.sourceBoundsMax;
      const cMin = data.canonicalBoundsMin;
      const cMax = data.canonicalBoundsMax;
      for (let i = 0; i < 3; i++) {
        if (sMax[i] <= sMin[i]) return false;
        if (cMax[i] <= cMin[i]) return false;
      }
      return true;
    },
    {
      message:
        "Bounds must have positive extents (max > min for each axis)",
    }
  )
  .superRefine((data, context) => {
    const expectedFactor = UNIT_TO_METERS[data.sourceUnit];
    if (Math.abs(data.metersPerSourceUnit - expectedFactor) > Math.max(1e-12, expectedFactor * 1e-9)) {
      context.addIssue({ code: "custom", path: ["metersPerSourceUnit"], message: "Conversion factor does not match sourceUnit" });
    }
    for (const axis of [0, 1, 2] as const) {
      const expectedMin = data.sourceBoundsMin[axis] * data.metersPerSourceUnit;
      const expectedMax = data.sourceBoundsMax[axis] * data.metersPerSourceUnit;
      const tolerance = Math.max(1e-9, Math.abs(expectedMax - expectedMin) * 1e-8);
      if (Math.abs(data.canonicalBoundsMin[axis] - expectedMin) > tolerance || Math.abs(data.canonicalBoundsMax[axis] - expectedMax) > tolerance) {
        context.addIssue({ code: "custom", path: ["canonicalBoundsMin"], message: `Canonical bounds do not match source bounds on axis ${axis}` });
      }
    }
  });

export type ModelSpatialMetadata = z.infer<typeof ModelSpatialMetadataSchema>;

// ---------------------------------------------------------------------------
// Helper: create a default spatial metadata from minimal info
// ---------------------------------------------------------------------------
export function createSpatialMetadata(args: {
  sourceUnit: SourceLengthUnit;
  sourceBoundsMin: [number, number, number];
  sourceBoundsMax: [number, number, number];
  sourceHash: string;
  sourceFilename?: string;
  sourceUri?: string;
  physicalScale?: number;
  displayScale?: number;
  calibrationMethod?: CalibrationMethod;
  accuracyClass?: AccuracyClass;
  importTool?: string;
  converterVersion?: string;
}): ModelSpatialMetadata {
  const metersPerUnit = UNIT_TO_METERS[args.sourceUnit];
  const min = args.sourceBoundsMin;
  const max = args.sourceBoundsMax;

  const canonicalMin: [number, number, number] = [
    min[0] * metersPerUnit,
    min[1] * metersPerUnit,
    min[2] * metersPerUnit,
  ];
  const canonicalMax: [number, number, number] = [
    max[0] * metersPerUnit,
    max[1] * metersPerUnit,
    max[2] * metersPerUnit,
  ];

  return ModelSpatialMetadataSchema.parse({
    schemaVersion: 1,
    sourceUnit: args.sourceUnit,
    metersPerSourceUnit: metersPerUnit,
    canonicalUnit: "m",
    upAxis: "Y",
    forwardAxis: "+Z",
    handedness: "right",
    sourceBoundsMin: min,
    sourceBoundsMax: max,
    canonicalBoundsMin: canonicalMin,
    canonicalBoundsMax: canonicalMax,
    localOrigin: [0, 0, 0],
    sourceHash: args.sourceHash,
    sourceFilename: args.sourceFilename,
    sourceUri: args.sourceUri,
    physicalScale: args.physicalScale ?? 1,
    displayScale: args.displayScale ?? 1,
    calibrationMethod: args.calibrationMethod ?? "unknown",
    accuracyClass: args.accuracyClass ?? "visual",
    calibrationConfidence: 0,
    createdAt: new Date().toISOString(),
    importTool: args.importTool,
    converterVersion: args.converterVersion,
  });
}

// ---------------------------------------------------------------------------
// Helper: compute bounds from a GLB file
// ---------------------------------------------------------------------------
export async function computeGlbBounds(
  glbPath: string
): Promise<{
  min: [number, number, number];
  max: [number, number, number];
}> {
  // Dynamic import to avoid bundling @gltf-transform/core in browser
  const g = await import("@gltf-transform/core");
  const io = new g.NodeIO();
  const doc = await io.read(glbPath);
  const root = doc.getRoot();
  const scenes = root.listScenes();
  if (scenes.length === 0) throw new Error("GLB has no scenes");
  const { getBounds } = await import("@gltf-transform/functions");
  const bounds = getBounds(scenes[0]);
  if (!bounds || bounds.min.some((value) => !Number.isFinite(value)) || bounds.max.some((value) => !Number.isFinite(value))) {
    throw new Error("GLB has no bounded geometry");
  }
  return { min: [...bounds.min] as [number, number, number], max: [...bounds.max] as [number, number, number] };
}
