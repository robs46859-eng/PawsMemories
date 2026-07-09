/**
 * server/imageTriage.ts — the generator's unified "front-door brain".
 *
 * One vision-LLM call on the generated reference image that does THREE jobs at
 * once (replacing what used to be up to three separate passes):
 *   1. Auto-detect the subject class (human | animal("dog") | object) using the
 *      shared CLASS_DEFINITIONS rubric.
 *   2. Qualify the image for 3D reconstruction (single subject, full subject
 *      visible, clean background, no baked shadows / watermark → a 0–1 score).
 *   3. Extract the anatomy/colour facts the downstream build/rig stage needs, so
 *      it never has to re-analyze the image from scratch.
 *
 * The LLM call is INJECTED (`GenerateFn`, same contract as petClassify.ts) so the
 * route wires the real Gemini client and tests pass a mock.
 */

import { z } from "zod";
import { CLASS_DEFINITIONS, type SubjectClass } from "../avatarPrompts";
import { extractJson, type GenerateFn } from "./petClassify";

/** Clamp any number into [0,1]; coerce strings; default 0 on garbage. */
const unit = z
  .coerce.number()
  .transform((n) => (Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0));

const bool = z.coerce.boolean();

export const TriageSchema = z.object({
  // ── Detection ───────────────────────────────────────────────────────────
  subjectClass: z.enum(["human", "dog", "object"]),
  classConfidence: unit,
  reason: z.string().default(""),
  // ── Qualification ───────────────────────────────────────────────────────
  qualify: z.object({
    score: unit,
    subjectPresent: bool.default(true),
    singleSubject: bool.default(true),
    fullSubjectVisible: bool.default(true),
    poseOk: bool.default(true),
    cleanBackground: bool.default(true),
    bakedShadowsOrHarshLight: bool.default(false),
    watermarkOrText: bool.default(false),
  }),
  // ── Anatomy / colour (best-effort; used to skip a second analysis) ────────
  species: z.string().default(""),
  breed: z.string().default(""),
  breedConfidence: unit.default(0),
  bodyType: z.enum(["quadruped", "biped", "winged", "static"]).default("static"),
  legCount: z.coerce.number().default(0),
  hasTail: bool.default(false),
  coatColors: z.array(z.string()).default([]),
  coatPattern: z.string().default(""),
});

export type TriageResult = z.infer<typeof TriageSchema>;

const CLASS_LABEL: Record<SubjectClass, string> = {
  human: "person",
  dog: "animal",
  object: "static object",
};

export function classLabel(c: SubjectClass): string {
  return CLASS_LABEL[c] || String(c);
}

/** System prompt: embeds the shared rubric so detection is consistent everywhere. */
export function buildTriagePrompt(userType: SubjectClass): string {
  return (
    `You are a strict quality-control and classification gate for a 3D model generator. ` +
    `Analyze the single image and return STRICT JSON only (no prose, no markdown fences).\n\n` +
    CLASS_DEFINITIONS +
    `\n\nThe user asked to create a "${userType}" (${classLabel(userType)}). Decide the TRUE class from the image using the definitions above — do not just echo the user's choice.\n\n` +
    `Also judge how suitable this image is for single-image/multiview 3D reconstruction. ` +
    `A good image has exactly ONE subject, the WHOLE subject visible with margin, a clean plain background, even lighting with no baked-in shadows or harsh highlights, and no watermark or text. ` +
    `For a living subject a neutral standing/A-pose is best; for an object, pose is not applicable (set poseOk true).\n\n` +
    `Return EXACTLY this JSON shape:\n` +
    `{\n` +
    `  "subjectClass": "human"|"dog"|"object",\n` +
    `  "classConfidence": number 0-1,\n` +
    `  "reason": string (one short sentence),\n` +
    `  "qualify": {\n` +
    `    "score": number 0-1 (overall reconstruction suitability),\n` +
    `    "subjectPresent": boolean,\n` +
    `    "singleSubject": boolean,\n` +
    `    "fullSubjectVisible": boolean,\n` +
    `    "poseOk": boolean,\n` +
    `    "cleanBackground": boolean,\n` +
    `    "bakedShadowsOrHarshLight": boolean,\n` +
    `    "watermarkOrText": boolean\n` +
    `  },\n` +
    `  "species": string ("dog","cat","bird",... or "" for objects/humans),\n` +
    `  "breed": string (best guess or ""),\n` +
    `  "breedConfidence": number 0-1,\n` +
    `  "bodyType": "quadruped"|"biped"|"winged"|"static",\n` +
    `  "legCount": number,\n` +
    `  "hasTail": boolean,\n` +
    `  "coatColors": string[] (1-3 hex colours, e.g. ["#C0A080"]),\n` +
    `  "coatPattern": string\n` +
    `}`
  );
}

/** Parse + validate raw LLM text into a TriageResult. Throws on failure. */
export function parseAndValidateTriage(text: string): TriageResult {
  const json = extractJson(text);
  const obj = JSON.parse(json); // throws on malformed JSON
  return TriageSchema.parse(obj); // throws ZodError on shape mismatch
}

/** Qualification thresholds. Central so they can be tuned in one place. */
export const QUALIFY_PASS_SCORE = 0.75;

/** Does this triage result pass the quality gate? Hard flags + score. */
export function triagePasses(t: TriageResult): boolean {
  const q = t.qualify;
  if (!q.subjectPresent) return false;
  if (!q.singleSubject) return false;
  if (!q.fullSubjectVisible) return false;
  if (q.watermarkOrText) return false;
  return q.score >= QUALIFY_PASS_SCORE;
}

/** Build a corrective clause for the next regeneration from the failed flags. */
export function correctiveFromTriage(t: TriageResult): string {
  const q = t.qualify;
  const fixes: string[] = [];
  if (!q.subjectPresent) fixes.push("clearly show the intended subject");
  if (!q.singleSubject) fixes.push("show exactly ONE subject and remove any others");
  if (!q.fullSubjectVisible) fixes.push("show the FULL subject head-to-toe with margin, nothing cropped");
  if (!q.poseOk) fixes.push("use a neutral, clearly-readable pose with limbs separated");
  if (!q.cleanBackground) fixes.push("use a plain neutral light-gray seamless background");
  if (q.bakedShadowsOrHarshLight) fixes.push("use even soft lighting with no harsh shadows or baked highlights");
  if (q.watermarkOrText) fixes.push("remove all text and watermarks");
  return fixes.join("; ");
}

/** User-facing error when the gate can't get a usable image after all retries. */
export function friendlyQualifyError(t: TriageResult | null): string {
  const base = "We couldn't get a clean enough image for 3D. ";
  if (!t) return base + "Try a clearer, well-lit, front-on photo of a single subject on a plain background.";
  const c = correctiveFromTriage(t);
  return base + (c ? `Try to: ${c}.` : "Try a clearer, full-body, front-on photo on a plain background.");
}

export interface TriageInput {
  /** Raw base64 (no data: prefix) OR a full data URL — both accepted. */
  imageBase64: string;
  mimeType?: string;
  /** What the user selected in the UI; used to detect a mismatch. */
  userType: SubjectClass;
}

/**
 * Run the triage call. On parse/validation failure, retry ONCE at temperature 0
 * (same pattern as petClassify.ts). Throws if both attempts fail — the caller
 * decides whether to treat that as "QA unavailable, proceed" or block.
 */
export async function triageReferenceImage(
  generate: GenerateFn,
  input: TriageInput
): Promise<TriageResult> {
  const mimeType = input.mimeType || "image/png";
  const data = input.imageBase64.replace(/^data:[^;]+;base64,/, "");
  const prompt = buildTriagePrompt(input.userType);
  try {
    const text = await generate({ prompt, imageBase64: data, mimeType, temperature: 0.3 });
    return parseAndValidateTriage(text);
  } catch {
    const text = await generate({ prompt, imageBase64: data, mimeType, temperature: 0 });
    return parseAndValidateTriage(text);
  }
}

/** True if the detected class differs from what the user picked, with confidence. */
export function isClassMismatch(t: TriageResult, userType: SubjectClass, minConfidence = 0.8): boolean {
  return t.subjectClass !== userType && t.classConfidence >= minConfidence;
}
