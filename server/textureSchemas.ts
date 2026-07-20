import { z } from "zod";

/**
 * Request validation for texture jobs (UV_TEXTURE_GENERATION_PLAN.md UV6/UV8).
 * Server-side only, following server/marketplaceSchemas.ts conventions.
 */

export const TEXTURE_SIZES = [512, 1024, 2048] as const;

export const RebakeRequestSchema = z
  .object({
    avatar_id: z.number().int().positive(),
    // Bounded to the three sizes the worker clamps to anyway; exposing a free
    // integer would just invite 4096 requests that silently downgrade.
    texture_size: z.union([z.literal(512), z.literal(1024), z.literal(2048)]).optional(),
  })
  .strict();

export type RebakeRequest = z.infer<typeof RebakeRequestSchema>;

/** Shape persisted by updateAvatarMultiview — front lives on image_url. */
export const MultiviewJsonSchema = z
  .object({
    left: z.string().url().optional(),
    back: z.string().url().optional(),
    right: z.string().url().optional(),
  })
  .passthrough();

export interface RebakeViews {
  front?: string;
  left?: string;
  back?: string;
  right?: string;
}

/**
 * Assemble the view set for a rebake from an avatar row. The front view is the
 * approved reference image itself; the turnaround views come from
 * multiview_json when the create flow produced them.
 *
 * Returns null when there is nothing usable — a rebake with zero views would
 * just re-emit the original texture at a different resolution.
 */
export function viewsFromAvatarRow(row: {
  image_url: string | null;
  multiview_json: unknown;
}): RebakeViews | null {
  const views: RebakeViews = {};
  if (row.image_url && /^https?:\/\//.test(row.image_url)) views.front = row.image_url;

  if (row.multiview_json) {
    const raw = typeof row.multiview_json === "string"
      ? (() => { try { return JSON.parse(row.multiview_json as string); } catch { return null; } })()
      : row.multiview_json;
    const parsed = raw ? MultiviewJsonSchema.safeParse(raw) : null;
    if (parsed?.success) {
      if (parsed.data.left) views.left = parsed.data.left;
      if (parsed.data.back) views.back = parsed.data.back;
      if (parsed.data.right) views.right = parsed.data.right;
    }
  }

  return Object.keys(views).length > 0 ? views : null;
}
