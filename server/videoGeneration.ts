import { z } from "zod";
import {
  VideoGenerationRequestSchema,
  VideoOutputMetadataSchema,
  VideoSourceImageIdSchema,
  type VideoGenerationRequest,
  type VideoOutputMetadata,
  type VideoSourceImageReference,
} from "../src/schemas/video";

/**
 * Allows for container timestamp rounding and duration-probe variance while
 * remaining far below the next supported duration. Exact 10s is not supported.
 */
export const VIDEO_OUTPUT_DURATION_TOLERANCE_SECONDS = 0.25;

export const ResolvedVideoSourceImageSchema = z
  .object({
    id: VideoSourceImageIdSchema,
    ownerId: z.string().trim().min(1).max(128),
    bytes: z.instanceof(Uint8Array).refine((bytes) => bytes.byteLength > 0, {
      message: "source image bytes are required",
    }),
    mimeType: z.string().regex(/^image\/[a-z0-9.+-]+$/i),
  })
  .strict();

export const VideoProviderOutputSchema = z
  .object({
    videoBytes: z.instanceof(Uint8Array).refine((bytes) => bytes.byteLength > 0, {
      message: "provider video bytes are required",
    }),
    mimeType: z.string().regex(/^video\/[a-z0-9.+-]+$/i),
    actualDurationSeconds: z.number().finite().positive(),
    provider: z.string().trim().min(1).max(128),
    model: z.string().trim().min(1).max(256),
  })
  .strict();

export interface ResolvedVideoSourceImage {
  id: string | number;
  ownerId: string;
  bytes: Uint8Array;
  mimeType: string;
}

export interface VideoProviderRequest {
  sourceImage: Pick<ResolvedVideoSourceImage, "bytes" | "mimeType">;
  prompt: string;
  requestedDurationSeconds: VideoGenerationRequest["requestedDurationSeconds"];
  aspectRatio: VideoGenerationRequest["aspectRatio"];
  generateAudio: boolean;
}

export interface VideoProviderOutput {
  videoBytes: Uint8Array;
  mimeType: string;
  actualDurationSeconds: number;
  provider: string;
  model: string;
}

export interface StoredVideo {
  id: string | number;
  url?: string;
}

export interface SaveGeneratedVideoInput {
  sourceImage: VideoSourceImageReference;
  videoBytes: Uint8Array;
  mimeType: string;
  metadata: VideoOutputMetadata;
}

export interface VideoGenerationProvider {
  generateVideo: (request: VideoProviderRequest) => Promise<VideoProviderOutput>;
}

export interface VideoGenerationStorage {
  loadSourceImage: (
    reference: VideoSourceImageReference,
  ) => Promise<ResolvedVideoSourceImage | null>;
  saveGeneratedVideo: (input: SaveGeneratedVideoInput) => Promise<StoredVideo>;
}

export interface VideoGenerationDependencies {
  provider: VideoGenerationProvider;
  storage: VideoGenerationStorage;
}

export interface VideoGenerationJobResult {
  request: VideoGenerationRequest;
  storedVideo: StoredVideo;
  metadata: VideoOutputMetadata;
}

export type VideoGenerationValidationCode =
  | "INVALID_REQUEST"
  | "SOURCE_NOT_FOUND_OR_NOT_OWNED"
  | "INVALID_SOURCE_IMAGE"
  | "INVALID_PROVIDER_OUTPUT"
  | "OUTPUT_DURATION_MISMATCH";

export class VideoGenerationValidationError extends Error {
  readonly code: VideoGenerationValidationCode;
  readonly issues: string[];
  readonly metadata?: VideoOutputMetadata;

  constructor(
    code: VideoGenerationValidationCode,
    message: string,
    options: { issues?: string[]; metadata?: VideoOutputMetadata } = {},
  ) {
    super(message);
    this.name = "VideoGenerationValidationError";
    this.code = code;
    this.issues = options.issues ?? [];
    this.metadata = options.metadata;
  }
}

function issueMessages(error: z.ZodError): string[] {
  return error.issues.map((issue) => issue.message);
}

function sameSourceId(left: string | number, right: string | number): boolean {
  return typeof left === typeof right && left === right;
}

export function parseVideoGenerationRequest(input: unknown): VideoGenerationRequest {
  const parsed = VideoGenerationRequestSchema.safeParse(input);
  if (!parsed.success) {
    throw new VideoGenerationValidationError(
      "INVALID_REQUEST",
      "Invalid video generation request.",
      { issues: issueMessages(parsed.error) },
    );
  }
  return parsed.data;
}

export function validateVideoProviderOutput(
  input: unknown,
  request: VideoGenerationRequest,
): { output: VideoProviderOutput; metadata: VideoOutputMetadata } {
  const parsed = VideoProviderOutputSchema.safeParse(input);
  if (!parsed.success) {
    throw new VideoGenerationValidationError(
      "INVALID_PROVIDER_OUTPUT",
      "Video provider returned an invalid output.",
      { issues: issueMessages(parsed.error) },
    );
  }

  const output = parsed.data;
  const durationDelta = Math.abs(
    output.actualDurationSeconds - request.requestedDurationSeconds,
  );
  const validationStatus =
    durationDelta <= VIDEO_OUTPUT_DURATION_TOLERANCE_SECONDS
      ? "validated"
      : "rejected";

  const metadata = VideoOutputMetadataSchema.parse({
    requestedDurationSeconds: request.requestedDurationSeconds,
    actualDurationSeconds: output.actualDurationSeconds,
    provider: output.provider,
    model: output.model,
    aspectRatio: request.aspectRatio,
    validationStatus,
  });

  if (validationStatus === "rejected") {
    throw new VideoGenerationValidationError(
      "OUTPUT_DURATION_MISMATCH",
      `Provider output duration differed from the request by more than ${VIDEO_OUTPUT_DURATION_TOLERANCE_SECONDS} seconds.`,
      { metadata },
    );
  }

  return { output, metadata };
}

/**
 * Validates, resolves, generates, validates output, then stores. Billing and
 * paid-usage reservation deliberately remain the responsibility of the route.
 */
export function createVideoGenerationPipeline(
  dependencies: VideoGenerationDependencies,
): (input: unknown) => Promise<VideoGenerationJobResult> {
  const { provider, storage } = dependencies;

  return async (input: unknown): Promise<VideoGenerationJobResult> => {
    // Request validation must complete before any storage or provider call.
    const request = parseVideoGenerationRequest(input);
    const source = await storage.loadSourceImage(request.sourceImage);
    if (!source) {
      throw new VideoGenerationValidationError(
        "SOURCE_NOT_FOUND_OR_NOT_OWNED",
        "Source image was not found for this owner.",
      );
    }

    const parsedSource = ResolvedVideoSourceImageSchema.safeParse(source);
    if (!parsedSource.success) {
      throw new VideoGenerationValidationError(
        "INVALID_SOURCE_IMAGE",
        "Resolved source image is invalid.",
        { issues: issueMessages(parsedSource.error) },
      );
    }

    if (
      parsedSource.data.ownerId !== request.sourceImage.ownerId ||
      !sameSourceId(parsedSource.data.id, request.sourceImage.id)
    ) {
      throw new VideoGenerationValidationError(
        "SOURCE_NOT_FOUND_OR_NOT_OWNED",
        "Source image was not found for this owner.",
      );
    }

    const providerOutput = await provider.generateVideo({
      sourceImage: {
        bytes: parsedSource.data.bytes,
        mimeType: parsedSource.data.mimeType,
      },
      prompt: request.prompt,
      requestedDurationSeconds: request.requestedDurationSeconds,
      aspectRatio: request.aspectRatio,
      generateAudio: request.generateAudio,
    });
    const { output, metadata } = validateVideoProviderOutput(
      providerOutput,
      request,
    );

    // Rejected output is never written to durable storage.
    const storedVideo = await storage.saveGeneratedVideo({
      sourceImage: request.sourceImage,
      videoBytes: output.videoBytes,
      mimeType: output.mimeType,
      metadata,
    });

    return { request, storedVideo, metadata };
  };
}

export async function runVideoGenerationJob(
  input: unknown,
  dependencies: VideoGenerationDependencies,
): Promise<VideoGenerationJobResult> {
  return createVideoGenerationPipeline(dependencies)(input);
}
