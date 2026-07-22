import { z } from "zod";
import { RANDY_REGISTRY_VERSION, getRandyModuleRegistry, validateRandyCitations, type RandyModuleId } from "./registry";

const screens = ["DASHBOARD", "AVATAR_DASHBOARD", "STORE", "COMMUNITY", "PROFILE", "ALBUMS", "PAWPRINTS", "PAWLISHER", "FURBIN", "REQUEST_MEMORY", "WAGS_INBOX"] as const;
const tours = ["first_avatar", "buy_credits", "request_memory", "make_pawprint", "use_pawlisher", "share_refer", "manage_furbin"] as const;
const highlights = ["[data-tour=\"avatar-create\"]", "[data-tour=\"credit-store\"]", "[data-tour=\"furbin-library\"]", "[data-tour=\"pawprint-create\"]"] as const;

export const RandyChatRequestSchema = z.object({
  message: z.string().trim().min(1).max(2000),
  history: z.array(z.object({
    role: z.enum(["user", "model"]),
    text: z.string().trim().min(1).max(2000),
  }).strict()).max(10).default([]),
}).strict();

export const RandyActionProposalSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("none") }).strict(),
  z.object({ type: z.literal("navigate"), screen: z.enum(screens) }).strict(),
  z.object({ type: z.literal("start_tour"), tourId: z.enum(tours) }).strict(),
  z.object({ type: z.literal("highlight"), target: z.enum(highlights) }).strict(),
  z.object({ type: z.literal("launch_ar") }).strict(),
  z.object({ type: z.literal("open_credit_store") }).strict(),
]);

export type RandyActionProposal = z.infer<typeof RandyActionProposalSchema>;

const RandyModelResponseSchema = z.object({
  text: z.string(),
  action: z.unknown(),
  moduleId: z.enum(["create", "furbin", "pawprints", "animator", "ar", "bim", "wags", "credits"]).optional(),
  state: z.enum(["answer", "unknown", "stale_registry"]).optional(),
  knowledgeVersion: z.string().max(40).optional(),
  citations: z.array(z.string().max(100)).max(4).optional(),
}).strict();

export interface RandyResponseParseOptions {
  moduleScope?: readonly RandyModuleId[];
  expectedRegistryVersion?: string;
}

export function validateRandyAction(value: unknown): RandyActionProposal {
  const parsed = RandyActionProposalSchema.safeParse(value);
  return parsed.success ? parsed.data : { type: "none" };
}

export function sanitizeRandyText(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const text = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, " ").trim();
  return text ? text.slice(0, 1200) : fallback;
}

const EXECUTION_CLAIM = /\b(?:i|we|randy)\s+(?:have\s+)?(?:charged|credited|refunded|purchased|ordered|deleted|cancelled|canceled|published|unpublished|approved|rejected|started|submitted|completed|executed|changed)\b/i;

export function containsRandyExecutionClaim(value: string): boolean {
  return EXECUTION_CLAIM.test(value);
}

export function buildRandyUnknownStateResponse(subject: string): { text: string; action: RandyActionProposal } {
  const boundedSubject = sanitizeRandyText(subject, "that status").slice(0, 120);
  return { text: `I cannot verify ${boundedSubject} from the current live account data. Please check the relevant product screen.`, action: { type: "none" } };
}

function actionIsInModuleScope(action: RandyActionProposal, moduleId: RandyModuleId): boolean {
  if (action.type === "none") return true;
  const module = getRandyModuleRegistry([moduleId])[0];
  if (!module || !module.actions.includes(action.type)) return false;
  if (action.type === "navigate") return module.screens.includes(action.screen);
  if (action.type === "start_tour") return module.tourIds.includes(action.tourId);
  if (action.type === "highlight") return module.highlightTargets.includes(action.target);
  return action.type === "launch_ar" ? moduleId === "ar" : moduleId === "credits";
}

export function parseRandyModelResponse(rawValue: unknown, fallback: string, options: RandyResponseParseOptions = {}): { text: string; action: RandyActionProposal } {
  const raw = typeof rawValue === "string" ? rawValue.trim() : "";
  if (!raw) return { text: fallback, action: { type: "none" } };

  const unfenced = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  try {
    const parsed = RandyModelResponseSchema.parse(JSON.parse(unfenced));
    const expectedVersion = options.expectedRegistryVersion || RANDY_REGISTRY_VERSION;
    if (parsed.knowledgeVersion && parsed.knowledgeVersion !== expectedVersion) {
      return { text: "My product guide changed while we were talking. Please ask again so I can use the current information.", action: { type: "none" } };
    }
    if (parsed.moduleId && options.moduleScope && !options.moduleScope.includes(parsed.moduleId)) {
      return { text: fallback, action: { type: "none" } };
    }
    const citationScope = options.moduleScope || (parsed.moduleId ? [parsed.moduleId] : undefined);
    if (parsed.citations && (!parsed.moduleId && !options.moduleScope || validateRandyCitations(parsed.citations, citationScope) === null)) {
      return { text: fallback, action: { type: "none" } };
    }
    const text = sanitizeRandyText(parsed.text, fallback);
    if (containsRandyExecutionClaim(text)) return { text: fallback, action: { type: "none" } };
    if (parsed.state === "unknown" && !/\b(?:cannot|can't|unable to)\s+(?:verify|confirm|determine|check)\b/i.test(text)) {
      return { text: fallback, action: { type: "none" } };
    }
    const action = validateRandyAction(parsed.action);
    return {
      text,
      action: parsed.state === "unknown" || parsed.state === "stale_registry" || parsed.moduleId && !actionIsInModuleScope(action, parsed.moduleId) ? { type: "none" } : action,
    };
  } catch {
    // Malformed output may be displayed as bounded text but can never carry an action.
    return { text: sanitizeRandyText(raw, fallback), action: { type: "none" } };
  }
}
