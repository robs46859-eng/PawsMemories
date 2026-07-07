/**
 * src/three/ar/luminance.ts — AR_PET_SIM_SPEC §6.3
 * iOS lighting fallback: sample the camera frame's average luminance + RGB so the
 * stage can lerp its ambient + key light (no WebXR light estimation on iOS).
 * Pure (no three/DOM) so it unit-tests; the R3F hook feeds it pixel data.
 */

export interface AmbientSample {
  /** Perceived luminance in [0,1]. */
  luminance: number;
  /** Mean channel values in [0,1]. */
  r: number;
  g: number;
  b: number;
}

/**
 * Average an RGBA pixel buffer (Uint8ClampedArray or number[], 0..255) to an
 * AmbientSample. Uses Rec. 601 luma weights. `stride` skips pixels for speed.
 */
export function sampleAmbient(rgba: ArrayLike<number>, stride = 1): AmbientSample {
  const step = Math.max(1, Math.floor(stride)) * 4;
  let rs = 0, gs = 0, bs = 0, n = 0;
  for (let i = 0; i + 2 < rgba.length; i += step) {
    rs += rgba[i];
    gs += rgba[i + 1];
    bs += rgba[i + 2];
    n++;
  }
  if (n === 0) return { luminance: 0, r: 0, g: 0, b: 0 };
  const r = rs / n / 255;
  const g = gs / n / 255;
  const b = bs / n / 255;
  const luminance = Math.max(0, Math.min(1, 0.299 * r + 0.587 * g + 0.114 * b));
  return { luminance, r, g, b };
}

/**
 * Rough correlated-colour-temperature hint from mean RGB: >0 = warm (reddish),
 * <0 = cool (bluish). Used only to tint the key light. Returns [-1,1].
 */
export function warmthFromRGB(s: AmbientSample): number {
  return Math.max(-1, Math.min(1, s.r - s.b));
}
