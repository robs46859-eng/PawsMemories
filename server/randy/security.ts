import { z } from "zod";

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

export function validateRandyAction(value: unknown): RandyActionProposal {
  const parsed = RandyActionProposalSchema.safeParse(value);
  return parsed.success ? parsed.data : { type: "none" };
}

export function sanitizeRandyText(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const text = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, " ").trim();
  return text ? text.slice(0, 1200) : fallback;
}

export function parseRandyModelResponse(rawValue: unknown, fallback: string): { text: string; action: RandyActionProposal } {
  const raw = typeof rawValue === "string" ? rawValue.trim() : "";
  if (!raw) return { text: fallback, action: { type: "none" } };

  const unfenced = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  try {
    const parsed = JSON.parse(unfenced);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid response object");
    return {
      text: sanitizeRandyText((parsed as Record<string, unknown>).text, fallback),
      action: validateRandyAction((parsed as Record<string, unknown>).action),
    };
  } catch {
    // Malformed output may be displayed as bounded text but can never carry an action.
    return { text: sanitizeRandyText(raw, fallback), action: { type: "none" } };
  }
}
