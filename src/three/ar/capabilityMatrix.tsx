/**
 * src/three/ar/capabilityMatrix.tsx — AR_PET_SIM_SPEC §6 / AR9
 * Capability-detect test page: WebXR depth / lighting estimation / Web Speech /
 * XR8 presence — so degradation paths are verifiable on real devices.
 *
 * TODO(AR9): render a live matrix of detected capabilities and the fallback each
 * triggers (occlusion→shadows, lighting→luminance sampling, voice→on-screen buttons).
 */

export interface CapabilityReport {
  webxr: boolean;
  webxrDepth: boolean;
  webxrLighting: boolean;
  webSpeech: boolean;
  xr8: boolean;
}

/** Best-effort capability probe (safe on non-browser/build environments). */
export function detectCapabilities(): CapabilityReport {
  const nav: any = typeof navigator !== "undefined" ? navigator : undefined;
  const win: any = typeof window !== "undefined" ? window : undefined;
  return {
    webxr: !!nav?.xr,
    webxrDepth: false, // TODO(AR9): probe XRSession depth-sensing feature
    webxrLighting: false, // TODO(AR9): probe 'light-estimation' feature
    webSpeech: !!(win && (win.SpeechRecognition || win.webkitSpeechRecognition)),
    xr8: !!win?.XR8,
  };
}

export default function CapabilityMatrix() {
  // TODO(AR9): render detectCapabilities() as a table.
  return null;
}
