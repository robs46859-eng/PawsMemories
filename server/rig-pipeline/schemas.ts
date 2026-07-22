// ─── Phase 4: Rig Pipeline Zod Schemas ──────────────────────────────────────
import { z } from "zod";

// ── Classification Request ──────────────────────────────────────────────────
export const ClassifyModelRequestSchema = z.object({
  modelBuildJobUuid: z.string().uuid(),
  overrideClassification: z.enum(["biped", "quadruped", "unsupported"]).optional(),
  overrideReason: z.string().max(500).optional(),
}).strict();

export type ClassifyModelRequest = z.infer<typeof ClassifyModelRequestSchema>;

// ── Start Rig Job Request ───────────────────────────────────────────────────
export const StartRigJobRequestSchema = z.object({
  modelBuildJobUuid: z.string().uuid(),
  idempotencyKey: z.string().min(8).max(128),
  profileId: z.string().optional(),
  requestFacial: z.boolean().default(true),
  accessoryIds: z.array(z.string().uuid()).max(10).default([]),
}).strict();

export type StartRigJobRequest = z.infer<typeof StartRigJobRequestSchema>;

// ── Accept Rig Job Request ──────────────────────────────────────────────────
export const AcceptRigJobRequestSchema = z.object({
  manifestHash: z.string().length(64),
}).strict();

export const RetryRigJobRequestSchema = z.object({
  idempotencyKey: z.string().min(8).max(128),
  accessoryIds: z.array(z.string().uuid()).max(10).default([]),
}).strict();

export type RetryRigJobRequest = z.infer<typeof RetryRigJobRequestSchema>;

export type AcceptRigJobRequest = z.infer<typeof AcceptRigJobRequestSchema>;

// ── Accessory Registration ──────────────────────────────────────────────────
export const RegisterAccessoryRequestSchema = z.object({
  name: z.string().min(1).max(200),
  assetUuid: z.string().uuid(),
  versionNumber: z.number().int().positive(),
  compatibleProfiles: z.array(z.string()).min(1).max(50),
  attachmentBone: z.string().min(1).max(100),
  fitBounds: z.object({
    min: z.tuple([z.number(), z.number(), z.number()]),
    max: z.tuple([z.number(), z.number(), z.number()]),
  }),
  collisionBounds: z.object({
    min: z.tuple([z.number(), z.number(), z.number()]),
    max: z.tuple([z.number(), z.number(), z.number()]),
  }),
  license: z.string().max(500).default("proprietary"),
  commercialUseEligible: z.boolean().default(false),
  exportPolicy: z.enum(["allowed", "preview_only", "derivative_only"]).default("allowed"),
}).strict();

export type RegisterAccessoryRequest = z.infer<typeof RegisterAccessoryRequestSchema>;

// ── Classification Result ───────────────────────────────────────────────────
export const ClassificationResultSchema = z.object({
  classification: z.enum(["biped", "quadruped", "unsupported"]),
  classifierVersion: z.string(),
  confidence: z.number().min(0).max(1),
  evidence: z.record(z.string(), z.unknown()),
  selectedProfileId: z.string(),
});

export type ClassificationResult = z.infer<typeof ClassificationResultSchema>;

// ── Rig Validation Rule ─────────────────────────────────────────────────────
export const RigValidationRuleSchema = z.object({
  rule: z.string(),
  pass: z.boolean(),
  detail: z.string(),
  measured: z.union([z.number(), z.string()]).optional(),
});

export type RigValidationRule = z.infer<typeof RigValidationRuleSchema>;

// ── Rig Validation Report ───────────────────────────────────────────────────
export const RigValidationReportSchema = z.object({
  validatorVersion: z.string(),
  boneCount: z.number().int().nonnegative(),
  skinnedVertexCount: z.number().int().nonnegative(),
  maxInfluences: z.number().int().nonnegative(),
  unweightedIslands: z.number().int().nonnegative(),
  bindMatrixValid: z.boolean(),
  animationSweepPass: z.boolean(),
  silhouetteDeviation: z.number().nonnegative(),
  mobileBudgetPass: z.boolean(),
  triangleCount: z.number().int().nonnegative(),
  textureMaxDimension: z.number().int().nonnegative(),
  jointCount: z.number().int().nonnegative(),
  rules: z.array(RigValidationRuleSchema),
});

export type RigValidationReport = z.infer<typeof RigValidationReportSchema>;

// ── Facial Inventory ────────────────────────────────────────────────────────
export const FacialInventorySchema = z.object({
  capability: z.enum(["full", "partial", "body_only", "unsupported"]),
  morphCount: z.number().int().nonnegative(),
  visemeCoverage: z.number().min(0).max(1),
  hasBlink: z.boolean(),
  hasJaw: z.boolean(),
  hasEyeControls: z.boolean(),
  morphNames: z.array(z.string()),
  canonicalMap: z.record(z.string(), z.string()),
  deformationPass: z.boolean(),
  notes: z.string().default(""),
});

export type FacialInventory = z.infer<typeof FacialInventorySchema>;

// ── Accessory Fit Result ────────────────────────────────────────────────────
export const AccessoryFitResultSchema = z.object({
  attachmentBone: z.string(),
  transform: z.object({
    position: z.tuple([z.number(), z.number(), z.number()]),
    rotation: z.tuple([z.number(), z.number(), z.number(), z.number()]),
    scale: z.tuple([z.number(), z.number(), z.number()]),
  }),
  floatingDistance: z.number().nonnegative(),
  penetrationDepth: z.number().nonnegative(),
  animationSweepPass: z.boolean(),
  polygonBudgetPass: z.boolean(),
  printClearanceMm: z.number().nonnegative(),
});

export const AccessoryFitMeasurementsSchema = AccessoryFitResultSchema.extend({
  accessoryTriangleCount: z.number().int().nonnegative(),
});

export type AccessoryFitResult = z.infer<typeof AccessoryFitResultSchema>;
