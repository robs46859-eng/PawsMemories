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
import { CLASS_DEFINITIONS, type ExtendedSubjectClass } from "../avatarPrompts";
import { extractJson, type GenerateFn } from "./petClassify";

/** Clamp any number into [0,1]; coerce strings; default 0 on garbage. */
const unit = z
  .coerce.number()
  .transform((n) => (Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0));

const bool = z.coerce.boolean();

export const TriageSchema = z.object({
  // ── Detection ───────────────────────────────────────────────────────────
  subjectClass: z.enum(["dog", "cat", "bird", "rabbit", "horse", "reptile", "small_animal", "other", "human", "object"]),
  classConfidence: unit,
  reason: z.string().default(""),
  // Sub-classification for objects: what KIND of object is this? Lets the build
  // stage treat a habitable structure differently from a usable prop, a plant
  // from food, and a component from a 2D blueprint. "none" for human/dog.
  objectCategory: z
    .enum(["structure", "prop", "plant", "food", "part", "blueprint", "none"])
    .default("none"),
  objectCategoryConfidence: unit.default(0),
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
  // Best-effort human anatomy audit. For a human subject these should read the
  // canonical counts (2/2/2/4/5); anything else is flagged in `anomalies` and
  // corrected on regeneration so we never rig a one-eyed or six-fingered mesh.
  humanAnatomy: z
    .object({
      eyeCount: z.coerce.number().default(2),
      earCount: z.coerce.number().default(2),
      nostrilCount: z.coerce.number().default(2),
      limbCount: z.coerce.number().default(4),
      fingersPerHand: z.coerce.number().default(5),
      anomalies: z.array(z.string()).default([]),
    })
    // A whole-object default must list every field — `.default({})` would NOT
    // run the inner field defaults, leaving the counts undefined.
    .default({ eyeCount: 2, earCount: 2, nostrilCount: 2, limbCount: 4, fingersPerHand: 5, anomalies: [] }),
});

export type TriageResult = z.infer<typeof TriageSchema>;

const CLASS_LABEL: Record<string, string> = {
  human: "person",
  object: "static object",
  dog: "dog",
  cat: "cat",
  bird: "bird",
  rabbit: "rabbit",
  horse: "horse",
  reptile: "reptile",
  small_animal: "small animal",
  other: "animal",
};

export function classLabel(c: ExtendedSubjectClass): string {
  return CLASS_LABEL[c] || String(c);
}

/** System prompt: embeds the shared rubric so detection is consistent everywhere. */
export function buildTriagePrompt(userType: ExtendedSubjectClass): string {
  return (
    `You are a strict quality-control and classification gate for a 3D model generator. ` +
    `Analyze the single image and return STRICT JSON only (no prose, no markdown fences).\n\n` +
    CLASS_DEFINITIONS +
    `\n\nThe user asked to create a "${userType}" (${classLabel(userType)}). Decide the TRUE class from the image using the definitions above — do not just echo the user's choice.\n\n` +
    `Also judge how suitable this image is for single-image/multiview 3D reconstruction. ` +
    `A good image has exactly ONE subject, the WHOLE subject visible with margin, a clean plain background, and no watermark or text. ` +
    `A soft contact shadow beneath the subject and gentle ambient occlusion are GOOD (this is a 3D render) — only set bakedShadowsOrHarshLight true for HARSH, hard-edged directional cast shadows or strong baked highlights that would corrupt the texture. ` +
    `For a living subject a neutral standing/A-pose is best; for an object, pose is not applicable (set poseOk true).\n\n` +
    `Return EXACTLY this JSON shape:\n` +
    `{\n` +
    `  "subjectClass": "human"|"dog"|"object",\n` +
    `  "classConfidence": number 0-1,\n` +
    `  "reason": string (one short sentence),\n` +
    `  "objectCategory": "structure"|"prop"|"plant"|"food"|"part"|"blueprint"|"none" (per the definitions above; "none" if not an object),\n` +
    `  "objectCategoryConfidence": number 0-1,\n` +
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
    `  "coatPattern": string,\n` +
    `  "humanAnatomy": {  // ONLY meaningful when subjectClass is "human"; count what is actually visible\n` +
    `    "eyeCount": number, "earCount": number, "nostrilCount": number,\n` +
    `    "limbCount": number (arms + legs; a normal human is 4),\n` +
    `    "fingersPerHand": number (a normal human is 5),\n` +
    `    "anomalies": string[]  // list any deviation from canonical human counts, e.g. "only 4 fingers on left hand", "missing one ear"; empty if all normal\n` +
    `  }\n` +
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
  // Human anatomy correction: if the detected counts drift from the canonical
  // human figure, force a regeneration that renders exactly the right features.
  if (t.subjectClass === "human") {
    const a = t.humanAnatomy;
    const anatomyOff =
      (a?.anomalies?.length ?? 0) > 0 ||
      a?.eyeCount !== 2 || a?.earCount !== 2 || a?.nostrilCount !== 2 ||
      a?.limbCount !== 4 || a?.fingersPerHand !== 5;
    if (anatomyOff) {
      fixes.push(
        "render canonical human anatomy exactly: two eyes, two ears, one nose with two nostrils, " +
        "two arms and two legs, and two hands each with five clearly separated fingers"
      );
    }
  }
  // Blueprint safety: a 2D plan is not a reconstructable 3D subject.
  if (t.subjectClass === "object" && t.objectCategory === "blueprint") {
    fixes.push("provide a photo of the actual 3D object, not a blueprint, plan or drawing of it");
  }
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
  userType: ExtendedSubjectClass;
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
export function isClassMismatch(t: TriageResult, userType: ExtendedSubjectClass, minConfidence = 0.8): boolean {
  return t.subjectClass !== userType && t.classConfidence >= minConfidence;
}
