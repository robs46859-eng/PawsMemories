import { z } from "zod";

// ─── Build Start Request ────────────────────────────────────────────────────
export const StartBuildSchema = z.object({
  referenceSessionUuid: z.string().uuid(),
  idempotencyKey: z.string().uuid(),
  requestedOutput: z.enum(["glb"]).default("glb"),
}).strict();

export type StartBuildInput = z.infer<typeof StartBuildSchema>;

// ─── Build Quote / Preflight Request ────────────────────────────────────────
export const QuoteBuildSchema = z.object({
  referenceSessionUuid: z.string().uuid(),
}).strict();

export type QuoteBuildInput = z.infer<typeof QuoteBuildSchema>;

// ─── Correction Retry Request ───────────────────────────────────────────────
export const RetryBuildSchema = z.object({
  idempotencyKey: z.string().uuid(),
  correctionNotes: z.string().max(2000).optional(),
}).strict();

export type RetryBuildInput = z.infer<typeof RetryBuildSchema>;

// ─── Acceptance Request ─────────────────────────────────────────────────────
export const AcceptBuildSchema = z.object({
  artifactHash: z.string().regex(/^[a-f0-9]{64}$/i, "Must be a SHA-256 hex string"),
  reportHash: z.string().regex(/^[a-f0-9]{64}$/i, "Must be a SHA-256 hex string"),
}).strict();

export type AcceptBuildInput = z.infer<typeof AcceptBuildSchema>;

// ─── Cancellation Request ───────────────────────────────────────────────────
export const CancelBuildSchema = z.object({
  reason: z.string().max(500).optional(),
}).strict();

export type CancelBuildInput = z.infer<typeof CancelBuildSchema>;

// ─── GLB Validation Report ─────────────────────────────────────────────────
export const GlbValidationMetricsSchema = z.object({
  magicValid: z.boolean(),
  versionValid: z.boolean(),
  declaredLength: z.number().int().nonnegative(),
  actualLength: z.number().int().nonnegative(),
  sceneCount: z.number().int().nonnegative(),
  nodeCount: z.number().int().nonnegative(),
  meshCount: z.number().int().nonnegative(),
  primitiveCount: z.number().int().nonnegative(),
  triangleCount: z.number().int().nonnegative(),
  vertexCount: z.number().int().nonnegative(),
  materialCount: z.number().int().nonnegative(),
  textureCount: z.number().int().nonnegative(),
  hasPositionAccessor: z.boolean(),
  hasNormals: z.boolean(),
  hasUVs: z.boolean(),
  hasSkin: z.boolean(),
  hasAnimation: z.boolean(),
  boundingBox: z.object({
    min: z.tuple([z.number(), z.number(), z.number()]),
    max: z.tuple([z.number(), z.number(), z.number()]),
  }).nullable(),
  dimensions: z.object({
    width: z.number(),
    height: z.number(),
    depth: z.number(),
    unit: z.literal("unscaled"),
  }).nullable(),
  containsNaN: z.boolean(),
  containsInfinity: z.boolean(),
  hasExternalUris: z.boolean(),
  hasEmptyGeometry: z.boolean(),
  textureDetails: z.array(z.object({
    mimeType: z.string(),
    width: z.number().int().nonnegative(),
    height: z.number().int().nonnegative(),
  })).optional(),
  warnings: z.array(z.string()).optional(),
  errors: z.array(z.string()).optional(),
}).strict();

export type GlbValidationMetrics = z.infer<typeof GlbValidationMetricsSchema>;

// ─── Provider Callback (Tripo webhook, if supported in future) ──────────────
export const ProviderCallbackSchema = z.object({
  provider: z.string(),
  taskId: z.string(),
  status: z.enum(["success", "failed", "cancelled", "processing"]),
  progress: z.number().min(0).max(100).optional(),
  outputUrl: z.string().url().optional(),
  errorMessage: z.string().max(1000).optional(),
  signature: z.string().optional(),
}).strict();

export type ProviderCallbackInput = z.infer<typeof ProviderCallbackSchema>;
