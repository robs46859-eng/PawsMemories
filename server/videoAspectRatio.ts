/**
 * Veo only accepts landscape or portrait output. Keep this normalization at
 * the API boundary so stale clients can never send Gemini an unsupported
 * image-generation ratio such as 1:1.
 */
export const VIDEO_ASPECT_RATIOS = ["16:9", "9:16"] as const;

export type VideoAspectRatio = (typeof VIDEO_ASPECT_RATIOS)[number];

export function normalizeVideoAspectRatio(value: unknown): VideoAspectRatio {
  return value === "9:16" ? "9:16" : "16:9";
}
