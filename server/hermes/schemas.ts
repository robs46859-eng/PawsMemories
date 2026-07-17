import { z } from "zod";

export type HermesJobType = "translate" | "knowledge" | "looks";
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

export const HermesJobTypeSchema = z.enum(["translate", "knowledge", "looks"]);
export const HermesJobStatusSchema = z
  .string()
  .min(1)
  .max(32)
  .regex(/^[a-z][a-z0-9_-]*$/, "Status must be a lowercase token.");

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
export const HERMES_LOOKS_INPUT_MAX_BYTES = 4_000;

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
    collection: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/),
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

/**
 * The browser sends text metadata only. Reference photos remain in Pawsome3D's
 * media pipeline and are never relayed through the small Hermes language model.
 */
export const HermesLooksPayloadSchema = z
  .object({
    avatar_id: z.number().int().positive(),
    prompt: NonBlankString(2_000),
    identity_summary: NonBlankString(1_000),
    look_pack: z.string().trim().min(1).max(80).optional(),
    look_count: z.number().int().min(1).max(4),
    reference_photo_count: z.number().int().min(10).max(30),
    aspect_ratio: z.enum(["1:1", "4:5", "9:16", "16:9"]),
    output_schema: z.literal("pawsome.look-spec.v1"),
  })
  .strict()
  .refine(
    (value) => utf8Size(value.prompt, value.identity_summary, value.look_pack ?? "") <= HERMES_LOOKS_INPUT_MAX_BYTES,
    { message: "Looks input exceeds the model budget." },
  );

const LookText = (max: number) => z.string().trim().min(1).max(max);

export const HermesLookSpecSchema = z
  .object({
    schema_version: z.literal("pawsome.look-spec.v1"),
    request_summary: LookText(500),
    identity_rules: z.array(LookText(240)).min(1).max(8),
    looks: z.array(z.object({
      id: z.string().regex(/^look-[1-4]$/),
      title: LookText(80),
      outfit: z.object({
        style: LookText(120),
        garments: z.array(LookText(120)).min(1).max(8),
        colors: z.array(LookText(40)).min(1).max(6),
        accessories: z.array(LookText(100)).max(6),
      }).strict(),
      pose: z.object({
        stance: LookText(160),
        expression: LookText(120),
        gaze: LookText(100),
      }).strict(),
      environment: z.object({
        setting: LookText(180),
        background: LookText(180),
      }).strict(),
      camera: z.object({
        shot: z.enum(["close-up", "waist-up", "three-quarter", "full-body"]),
        angle: LookText(100),
      }).strict(),
      lighting: LookText(180),
      render_prompt: LookText(1_200),
      negative_prompt: LookText(800),
    }).strict()).min(1).max(4),
  })
  .strict()
  .superRefine((value, context) => {
    const ids = new Set(value.looks.map((look) => look.id));
    if (ids.size !== value.looks.length) {
      context.addIssue({ code: "custom", message: "Look IDs must be unique.", path: ["looks"] });
    }
  });

export const HermesCreateRequestSchemas = {
  translate: z.object({ payload: HermesTranslationPayloadSchema }).strict(),
  knowledge: z.object({ payload: HermesKnowledgePayloadSchema }).strict(),
  looks: z.object({ payload: HermesLooksPayloadSchema }).strict(),
} as const;

export const HermesJobParamsSchema = z
  .object({
    id: HermesLocalJobIdSchema,
  })
  .strict();

export const HermesBridgeCreateResponseSchema = z
  .object({
    job_id: HermesBridgeJobIdSchema,
    status: HermesJobStatusSchema,
  })
  .strict();

export const HermesBridgeStatusResponseSchema = z
  .object({
    status: HermesJobStatusSchema,
    result: HermesJsonValueSchema.nullable(),
    error: z.string().max(2_048).nullable(),
  })
  .strict();
