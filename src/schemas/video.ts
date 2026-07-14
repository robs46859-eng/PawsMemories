import { z } from "zod";

/** Veo 3.1 currently produces eight-second clips. Exact 10s remains deferred. */
export const SUPPORTED_VIDEO_DURATION_SECONDS = [8] as const;
export const DEFAULT_VIDEO_DURATION_SECONDS = 8 as const;

export const VIDEO_ASPECT_RATIOS = ["16:9", "9:16"] as const;
export const DEFAULT_VIDEO_ASPECT_RATIO = "16:9" as const;

export const DEFAULT_VIDEO_PROMPT =
  "Gentle breeze, subtle motion, cinematic lighting";
export const MAX_VIDEO_PROMPT_LENGTH = 2_000;

export const VideoDurationSecondsSchema = z
  .literal(8)
  .default(DEFAULT_VIDEO_DURATION_SECONDS);

export const VideoAspectRatioSchema = z.enum(VIDEO_ASPECT_RATIOS);

export const VideoSourceImageIdSchema = z.union([
  z.number().int().positive("source image id must be a positive integer"),
  z.string().trim().min(1, "source image id is required").max(128),
]);

/**
 * Source IDs are always owner-scoped. A bare source ID is intentionally not a
 * valid job input because it cannot prove which tenant is allowed to use it.
 */
export const VideoSourceImageReferenceSchema = z
  .object({
    id: VideoSourceImageIdSchema,
    ownerId: z.string().trim().min(1, "source image ownerId is required").max(128),
  })
  .strict();

export const VideoGenerationRequestSchema = z
  .object({
    sourceImage: VideoSourceImageReferenceSchema,
    prompt: z
      .string()
      .trim()
      .min(1, "video prompt is required")
      .max(
        MAX_VIDEO_PROMPT_LENGTH,
        `video prompt must be at most ${MAX_VIDEO_PROMPT_LENGTH} characters`,
      )
      .default(DEFAULT_VIDEO_PROMPT),
    requestedDurationSeconds: VideoDurationSecondsSchema,
    aspectRatio: VideoAspectRatioSchema.default(DEFAULT_VIDEO_ASPECT_RATIO),
    generateAudio: z.boolean().default(true),
  })
  .strict();

export const VideoValidationStatusSchema = z.enum(["validated", "rejected"]);

export const VideoOutputMetadataSchema = z
  .object({
    requestedDurationSeconds: z.literal(8),
    actualDurationSeconds: z.number().finite().positive(),
    provider: z.string().trim().min(1).max(128),
    model: z.string().trim().min(1).max(256),
    aspectRatio: VideoAspectRatioSchema,
    validationStatus: VideoValidationStatusSchema,
  })
  .strict();

export type SupportedVideoDurationSeconds =
  (typeof SUPPORTED_VIDEO_DURATION_SECONDS)[number];
export type VideoAspectRatio = (typeof VIDEO_ASPECT_RATIOS)[number];
export type VideoSourceImageReference = z.infer<
  typeof VideoSourceImageReferenceSchema
>;
export type VideoGenerationRequest = z.infer<
  typeof VideoGenerationRequestSchema
>;
export type VideoOutputMetadata = z.infer<typeof VideoOutputMetadataSchema>;
