import { z } from "zod";

export const ViewKindSchema = z.enum([
  "front",
  "left",
  "right",
  "rear",
  "front_three_quarter",
]);

export const InputModeSchema = z.enum(["text", "photo"]);
export const ReportStatusSchema = z.enum(["pass", "warn", "fail"]);
export const ScaleConfidenceSchema = z.enum(["unknown", "declared", "calibrated"]);

export const CreateSessionSchema = z
  .object({
    inputMode: InputModeSchema,
    subjectClass: z.string().min(1).max(64).default("pet"),
    prompt: z.string().max(2000).optional().nullable(),
  })
  .strict();

export type CreateSessionInput = z.infer<typeof CreateSessionSchema>;

export const ReplaceSourcePhotoSchema = z
  .object({
    sessionUuid: z.string().uuid(),
    imageBufferBase64: z.string().min(1),
    mimeType: z.string().min(1).max(120),
  })
  .strict();

export const StartAttemptSchema = z
  .object({
    sessionUuid: z.string().uuid(),
    idempotencyKey: z.string().min(1).max(190),
  })
  .strict();

export const RetryAttemptSchema = z
  .object({
    sessionUuid: z.string().uuid(),
    idempotencyKey: z.string().min(1).max(190),
    retryNotes: z.string().max(1000).optional().nullable(),
  })
  .strict();

export const ApproveManifestSchema = z
  .object({
    sessionUuid: z.string().uuid(),
    manifestHash: z.string().length(64).regex(/^[a-fA-F0-9]{64}$/),
  })
  .strict();

export const ConsistencyMetricItemSchema = z
  .object({
    name: z.string().min(1).max(100),
    status: ReportStatusSchema,
    score: z.number().min(0).max(1),
    details: z.string().max(500),
  })
  .strict();

export const ConsistencyReportPayloadSchema = z
  .object({
    status: ReportStatusSchema,
    scaleConfidence: ScaleConfidenceSchema,
    summaryNote: z.string().max(1000),
    metrics: z.array(ConsistencyMetricItemSchema),
    crossViewIdentityScore: z.number().min(0).max(1),
    cropSuitabilityScore: z.number().min(0).max(1),
  })
  .strict();

export type ConsistencyReportPayload = z.infer<typeof ConsistencyReportPayloadSchema>;
