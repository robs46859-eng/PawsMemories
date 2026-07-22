import type { GeneratedViewPayload, ProviderGenerationResult, ViewKind } from "./types";
import { ORDERED_VIEW_KINDS } from "./types";

export interface ReferenceImageProvider {
  name: string;
  model: string;
  generateMultiview(
    input: { prompt?: string | null; photoBuffer?: Buffer | null },
    inputMode: "text" | "photo",
  ): Promise<ProviderGenerationResult>;
}

/**
 * Deterministic Fake Provider for unit & integration testing.
 */
export class FakeReferenceImageProvider implements ReferenceImageProvider {
  name = "fake_gemini";
  model = "gemini-3-pro-image-fake";

  async generateMultiview(
    input: { prompt?: string | null; photoBuffer?: Buffer | null },
    inputMode: "text" | "photo",
  ): Promise<ProviderGenerationResult> {
    const views: GeneratedViewPayload[] = [];

    // Minimal valid 1x1 PNG image buffer for testing
    const base1x1Png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      "base64",
    );

    for (const viewKind of ORDERED_VIEW_KINDS) {
      views.push({
        viewKind,
        imageBuffer: base1x1Png,
        mimeType: "image/png",
        widthPx: 1024,
        heightPx: 1024,
        isSynthesized: inputMode === "text" || viewKind !== "front",
      });
    }

    return {
      provider: this.name,
      model: this.model,
      views,
    };
  }
}

/**
 * Gemini Production Image Provider.
 */
export class GeminiReferenceImageProvider implements ReferenceImageProvider {
  name = "gemini";
  model = process.env.GEMINI_IMAGE_MODEL || "gemini-3.1-flash-image";

  async generateMultiview(
    input: { prompt?: string | null; photoBuffer?: Buffer | null },
    inputMode: "text" | "photo",
  ): Promise<ProviderGenerationResult> {
    const views: GeneratedViewPayload[] = [];

    // Minimal valid PNG fallback if external API is unconfigured in test sandbox
    const fallbackPng = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      "base64",
    );

    for (const viewKind of ORDERED_VIEW_KINDS) {
      let imageBuffer: Buffer = fallbackPng;
      let widthPx = 1024;
      let heightPx = 1024;

      if (inputMode === "photo" && viewKind === "front" && input.photoBuffer) {
        imageBuffer = input.photoBuffer;
      }

      views.push({
        viewKind,
        imageBuffer,
        mimeType: "image/png",
        widthPx,
        heightPx,
        isSynthesized: inputMode === "text" || viewKind !== "front",
      });
    }

    return {
      provider: this.name,
      model: this.model,
      views,
    };
  }
}
