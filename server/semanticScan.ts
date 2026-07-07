/**
 * server/semanticScan.ts — AR_PET_SIM_SPEC §6.4
 * One camera frame → vision LLM → semantic zone polygons in normalized screen
 * space, validated with zod. Provider-agnostic (LLM call injected); the route
 * wires the real Gemini client and caches results per anchor hash (H7).
 */

import { z } from "zod";

export const ZONE_CLASSES = [
  "natural_ground",
  "artificial_ground",
  "water",
  "seating",
  "vegetation",
  "obstacle",
] as const;

const clampUnit = z.coerce.number().transform((n) => (Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0));
const point = z.tuple([clampUnit, clampUnit]);

export const ZoneSchema = z.object({
  cls: z.enum(ZONE_CLASSES),
  /** Polygon in normalized screen space (0..1), >= 3 points. */
  points: z.array(point).min(3),
});

export const ZonesSchema = z.object({
  zones: z.array(ZoneSchema).default([]),
});

export type Zone = z.infer<typeof ZoneSchema>;
export type Zones = z.infer<typeof ZonesSchema>;

export const SEMANTIC_SCAN_PROMPT = `You are labelling one camera frame for an AR pet game.
Return STRICT JSON only (no prose, no markdown fences):
{ "zones": [ { "cls": "natural_ground"|"artificial_ground"|"water"|"seating"|"vegetation"|"obstacle",
              "points": [[x,y], [x,y], [x,y], ...] } ] }
- Each zone is a polygon of >= 3 points in NORMALIZED screen coordinates (0..1, origin top-left).
- natural_ground = grass/dirt; artificial_ground = floor/pavement/carpet; water = puddles/bowls/ponds;
  seating = sofas/chairs/beds; vegetation = bushes/plants (impassable); obstacle = walls/large furniture.
- Only include surfaces you can see. Omit the sky. Keep it under ~8 zones.`;

/** Strip fences + isolate the first {...} object from raw LLM text. */
export function extractJson(text: string): string {
  let t = (text ?? "").trim();
  t = t.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const first = t.indexOf("{");
  const last = t.lastIndexOf("}");
  if (first !== -1 && last !== -1 && last > first) return t.slice(first, last + 1);
  return t;
}

/** Parse + validate raw LLM text into zones. Throws on failure. */
export function parseAndValidateZones(text: string): Zones {
  const obj = JSON.parse(extractJson(text));
  return ZonesSchema.parse(obj);
}

export interface GenerateInput {
  prompt: string;
  imageBase64: string;
  mimeType: string;
  temperature: number;
}
export type GenerateFn = (input: GenerateInput) => Promise<string>;

/** Run a semantic scan: one call, retry once at temp 0 on parse/validate failure. */
export async function semanticScan(
  generate: GenerateFn,
  input: { imageBase64: string; mimeType?: string }
): Promise<Zones> {
  const mimeType = input.mimeType || "image/jpeg";
  try {
    return parseAndValidateZones(
      await generate({ prompt: SEMANTIC_SCAN_PROMPT, imageBase64: input.imageBase64, mimeType, temperature: 0.2 })
    );
  } catch {
    return parseAndValidateZones(
      await generate({ prompt: SEMANTIC_SCAN_PROMPT, imageBase64: input.imageBase64, mimeType, temperature: 0 })
    );
  }
}
