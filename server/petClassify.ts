/**
 * server/petClassify.ts — AR_PET_SIM_SPEC §3.2
 * One vision-LLM call → strict-JSON breed/build/temperament, validated with zod.
 *
 * The LLM call is INJECTED (`GenerateFn`) so the route wires the real Gemini client
 * and tests pass a mock. Provider note: the repo uses Gemini (@google/genai) rather
 * than the spec's OpenRouter — same strict-JSON contract, no new account.
 */

import { z } from "zod";

/** Clamp any number into [0,1]; coerce strings; default 0 on garbage. */
const unit = z
  .coerce.number()
  .transform((n) => (Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0));

const ratio = z.coerce.number().transform((n) => (Number.isFinite(n) ? n : 1));

const point = z.tuple([z.coerce.number(), z.coerce.number()]);

export const ClassifySchema = z.object({
  breed: z.string().min(1),
  breed_confidence: unit,
  breed_top3: z.array(z.string()).default([]),
  size_class: z.enum(["toy", "small", "medium", "large", "giant"]),
  build: z.object({
    legLengthRatio: ratio,
    snoutLengthRatio: ratio,
    earType: z.enum(["erect", "floppy", "semi"]),
    tailType: z.enum(["curly", "straight", "docked", "plume"]),
    coat: z.enum(["short", "medium", "long", "double"]),
  }),
  temperament: z.object({
    energy: unit,
    sociability: unit,
    stubbornness: unit,
    foodMotivation: unit,
    vocality: unit,
  }),
  faceLandmarks: z.object({
    leftEye: point,
    rightEye: point,
    nose: point,
  }),
});

export type ClassifyResult = z.infer<typeof ClassifySchema>;

export const CLASSIFY_SYSTEM_PROMPT = `Identify the dog in the image. Return STRICT JSON only (no prose, no markdown fences) with exactly this shape:
{ "breed": string,
  "breed_confidence": number 0-1,
  "breed_top3": string[],
  "size_class": "toy"|"small"|"medium"|"large"|"giant",
  "build": { "legLengthRatio": number, "snoutLengthRatio": number,
             "earType": "erect"|"floppy"|"semi",
             "tailType": "curly"|"straight"|"docked"|"plume",
             "coat": "short"|"medium"|"long"|"double" },
  "temperament": { "energy": number 0-1, "sociability": number 0-1,
                   "stubbornness": number 0-1, "foodMotivation": number 0-1,
                   "vocality": number 0-1 },
  "faceLandmarks": { "leftEye": [x,y], "rightEye": [x,y], "nose": [x,y] } }
All landmark coordinates normalized 0-1. If unsure of the breed, give your best guess and a low breed_confidence.`;

/** Strip markdown code fences and pull the first {...} JSON object out of raw LLM text. */
export function extractJson(text: string): string {
  let t = (text ?? "").trim();
  // remove ```json ... ``` or ``` ... ``` fences
  t = t.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const first = t.indexOf("{");
  const last = t.lastIndexOf("}");
  if (first !== -1 && last !== -1 && last > first) return t.slice(first, last + 1);
  return t;
}

/** Parse + validate raw LLM text into a ClassifyResult. Throws on failure. */
export function parseAndValidateClassify(text: string): ClassifyResult {
  const json = extractJson(text);
  const obj = JSON.parse(json); // throws on malformed JSON
  return ClassifySchema.parse(obj); // throws ZodError on shape mismatch
}

export interface GenerateInput {
  prompt: string;
  imageBase64: string;
  mimeType: string;
  temperature: number;
}

/** Injected LLM call: returns raw model text. */
export type GenerateFn = (input: GenerateInput) => Promise<string>;

export interface ClassifyImageInput {
  imageBase64: string;
  mimeType?: string;
}

/**
 * Run classification: one call, and on parse/validation failure retry ONCE at
 * temperature 0 (spec §3.2). Throws if both attempts fail.
 */
export async function classifyPetImage(
  generate: GenerateFn,
  input: ClassifyImageInput
): Promise<ClassifyResult> {
  const mimeType = input.mimeType || "image/jpeg";
  try {
    const text = await generate({
      prompt: CLASSIFY_SYSTEM_PROMPT,
      imageBase64: input.imageBase64,
      mimeType,
      temperature: 0.4,
    });
    return parseAndValidateClassify(text);
  } catch {
    // retry once, deterministic
    const text = await generate({
      prompt: CLASSIFY_SYSTEM_PROMPT,
      imageBase64: input.imageBase64,
      mimeType,
      temperature: 0,
    });
    return parseAndValidateClassify(text);
  }
}
