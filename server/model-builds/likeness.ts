import { referencePalette, extractPalette, palettesDistance, extractBaseColorTexture } from "../textureLikeness";

export interface AdvisoryLikenessReport {
  status: "advisory";
  label: string;
  paletteDistance: number | null;
  overallScore: number | null;
  limitations: string;
  viewCount: number;
}

export const ADVISORY_LIKENESS_LIMITATIONS =
  "Advisory visual likeness comparison based on color palette similarity. " +
  "Exposes view angle, lighting, and texture coverage limitations. " +
  "Does NOT represent dimensional, mesh, structural, or identity proof.";

/**
 * Computes advisory visual likeness between approved Phase 2 reference view image buffers
 * and the 3D model's base-color texture (or rendered views).
 *
 * Scores are explicitly labeled advisory with disclaimers.
 */
export async function computeAdvisoryLikeness(
  glbBuffer: Buffer,
  referenceImageBuffers: Buffer[],
): Promise<AdvisoryLikenessReport> {
  const result: AdvisoryLikenessReport = {
    status: "advisory",
    label: "Advisory Palette Similarity",
    paletteDistance: null,
    overallScore: null,
    limitations: ADVISORY_LIKENESS_LIMITATIONS,
    viewCount: referenceImageBuffers.length,
  };

  if (!referenceImageBuffers || referenceImageBuffers.length === 0) {
    return result;
  }

  try {
    const refPalette = await referencePalette(referenceImageBuffers);
    if (!refPalette || refPalette.length === 0) {
      return result;
    }

    const atlas = await extractBaseColorTexture(glbBuffer);
    if (!atlas) {
      return result;
    }

    const modelPalette = await extractPalette(atlas);
    if (!modelPalette || modelPalette.length === 0) {
      return result;
    }

    const distance = palettesDistance(modelPalette, refPalette);
    if (distance === null) {
      return result;
    }

    // Convert distance to a normalized 0..1 advisory similarity score heuristic.
    // CIEDE2000 distance ~ 0 is identical, distance ~ 25 is significant difference.
    const normalizedScore = Math.max(0, Math.min(1, Number((1 - distance / 30).toFixed(3))));

    result.paletteDistance = Number(distance.toFixed(2));
    result.overallScore = normalizedScore;
  } catch (err: any) {
    console.warn("[model-build] Advisory likeness calculation warning:", err?.message || String(err));
  }

  return result;
}
