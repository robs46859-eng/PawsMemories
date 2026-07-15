import { z } from "zod";

export type HermesJobType = "translate" | "knowledge";
export type HermesJsonValue =
  | string
  | number
  | boolean
  | null
  | HermesJsonValue[]
  | { [key: string]: HermesJsonValue };

const MAX_JSON_STRING_LENGTH = 100_000;
const MAX_JSON_ARRAY_LENGTH = 1_000;
const MAX_JSON_OBJECT_KEYS = 256;
const MAX_JSON_DEPTH = 20;
const MAX_JSON_NODES = 10_000;

export const HermesJobTypeSchema = z.enum(["translate", "knowledge"]);
export const HermesRelayStatusSchema = z.enum(["queued", "leased", "completed", "failed"]);
export const HermesJobStatusSchema = z.enum([
  "submitting",
  "queued",
  "leased",
  "completed",
  "failed",
]);

export const HermesBridgeJobIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .regex(/^[A-Za-z0-9._:-]+$/, "Bridge job ID contains unsupported characters.");

export const HermesLocalJobIdSchema = z.string().uuid();
export const HermesOwnerKeySchema = z.string().min(1).max(32);
export const HermesStoredErrorSchema = z.string().min(1).max(255);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value == null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isSafeJsonValue(root: unknown): root is HermesJsonValue {
  const stack: Array<{ value: unknown; depth: number }> = [{ value: root, depth: 0 }];
  const seen = new WeakSet<object>();
  let nodes = 0;

  while (stack.length > 0) {
    const { value, depth } = stack.pop()!;
    nodes += 1;
    if (nodes > MAX_JSON_NODES || depth > MAX_JSON_DEPTH) return false;

    if (value == null || typeof value === "boolean") continue;
    if (typeof value === "string") {
      if (value.length > MAX_JSON_STRING_LENGTH) return false;
      continue;
    }
    if (typeof value === "number") {
      if (!Number.isFinite(value)) return false;
      continue;
    }
    if (typeof value !== "object") return false;
    if (seen.has(value)) return false;
    seen.add(value);

    if (Array.isArray(value)) {
      if (value.length > MAX_JSON_ARRAY_LENGTH) return false;
      for (const item of value) stack.push({ value: item, depth: depth + 1 });
      continue;
    }
    if (!isPlainObject(value)) return false;

    const entries = Object.entries(value);
    if (entries.length > MAX_JSON_OBJECT_KEYS) return false;
    for (const [key, item] of entries) {
      if (key.length < 1 || key.length > 128) return false;
      stack.push({ value: item, depth: depth + 1 });
    }
  }

  return true;
}

export const HermesJsonValueSchema = z.custom<HermesJsonValue>(isSafeJsonValue, {
  message: "Value must be bounded JSON data.",
});

const NonBlankString = (max: number) => z
  .string()
  .min(1)
  .max(max)
  .refine((value) => value.trim().length > 0, "Value must not be blank.");

const utf8Size = (...values: string[]) => values.reduce(
  (total, value) => total + Buffer.byteLength(value, "utf8"),
  0,
);

export const HERMES_TRANSLATION_INPUT_MAX_BYTES = 6_000;
export const HERMES_KNOWLEDGE_INPUT_MAX_BYTES = 8_000;

export const HermesTranslationPayloadSchema = z
  .object({
    text: NonBlankString(20_000),
    source_language: NonBlankString(80),
    target_language: NonBlankString(80),
    context: z.string().max(4_000).optional(),
  })
  .strict()
  .refine(
    (value) => utf8Size(value.text, value.context ?? "") <= HERMES_TRANSLATION_INPUT_MAX_BYTES,
    { message: "Translation input exceeds the model budget." },
  );

export const HermesKnowledgePayloadSchema = z
  .object({
    question: NonBlankString(4_000),
    context_chunks: z.array(NonBlankString(20_000)).min(1).max(64),
    collection: z.literal("pawsome3d-ar"),
  })
  .strict()
  .refine(
    (value) => value.context_chunks.reduce((total, chunk) => total + chunk.length, 0) <= 80_000,
    { message: "Context chunks exceed 80000 total characters.", path: ["context_chunks"] },
  )
  .refine(
    (value) => utf8Size(value.question, ...value.context_chunks) <= HERMES_KNOWLEDGE_INPUT_MAX_BYTES,
    { message: "Knowledge input exceeds the model budget.", path: ["context_chunks"] },
  );

export const HermesCreateRequestSchemas = {
  translate: z.object({ payload: HermesTranslationPayloadSchema }).strict(),
  knowledge: z.object({ payload: HermesKnowledgePayloadSchema }).strict(),
} as const;

export const HermesJobParamsSchema = z
  .object({
    id: HermesLocalJobIdSchema,
  })
  .strict();

export const HermesBridgeCreateResponseSchema = z
  .object({
    job_id: HermesBridgeJobIdSchema,
    status: HermesRelayStatusSchema,
  })
  .strict();

const HermesPendingStatusResponseSchema = z
  .object({
    status: z.enum(["queued", "leased"]),
    result: z.null(),
    error: z.null(),
  })
  .strict();

const HermesFailedStatusResponseSchema = z
  .object({
    status: z.literal("failed"),
    result: z.null(),
    error: z.string().min(1).max(2_048),
  })
  .strict();

const HermesTranslationResultSchema = z
  .object({
    translated_text: NonBlankString(30_000),
    source_language: NonBlankString(80),
    target_language: NonBlankString(80),
    model: z.literal("gemma-4-e2b"),
    processing_ms: z.number().int().min(0).max(600_000),
  })
  .strict();

const HermesKnowledgeResultSchema = z
  .object({
    answer: NonBlankString(30_000),
    citations: z
      .array(z.number().int().min(0).max(63))
      .max(64)
      .refine((values) => new Set(values).size === values.length, "Citations must be unique."),
    collection: z.literal("pawsome3d-ar"),
    model: z.literal("gemma-4-e2b"),
    processing_ms: z.number().int().min(0).max(600_000),
  })
  .strict();

const completedStatusResponse = (result: z.ZodTypeAny) => z
  .object({
    status: z.literal("completed"),
    result,
    error: z.null(),
  })
  .strict();

export const HermesBridgeStatusResponseSchemas = {
  translate: z.union([
    HermesPendingStatusResponseSchema,
    HermesFailedStatusResponseSchema,
    completedStatusResponse(HermesTranslationResultSchema),
  ]),
  knowledge: z.union([
    HermesPendingStatusResponseSchema,
    HermesFailedStatusResponseSchema,
    completedStatusResponse(HermesKnowledgeResultSchema),
  ]),
} as const;
