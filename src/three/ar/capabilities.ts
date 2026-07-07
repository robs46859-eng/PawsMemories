/**
 * src/three/ar/capabilities.ts — AR_PET_SIM_SPEC §6 / AR9
 * Capability detection + the degradation plan it implies, so features fall back
 * silently (occlusion→shadows, lighting→luminance, voice→buttons). Pure logic is
 * unit-tested; detection reads globals defensively (safe off-browser).
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
    webxrDepth: !!(win && "XRDepthInformation" in win),
    webxrLighting: !!(win && "XRLightEstimate" in win),
    webSpeech: !!(win && (win.SpeechRecognition || win.webkitSpeechRecognition)),
    xr8: !!win?.XR8,
  };
}

export interface DegradationPlan {
  tracking: "webxr" | "xr8" | "none";
  occlusion: "webxr-depth" | "shadow-fade";
  lighting: "webxr-estimation" | "luminance-sample";
  voice: "web-speech" | "buttons-only";
}

/** Map a capability report to the concrete fallbacks the stage should use. */
export function degradationPlan(r: CapabilityReport): DegradationPlan {
  return {
    tracking: r.webxr ? "webxr" : r.xr8 ? "xr8" : "none",
    occlusion: r.webxr && r.webxrDepth ? "webxr-depth" : "shadow-fade",
    lighting: r.webxr && r.webxrLighting ? "webxr-estimation" : "luminance-sample",
    voice: r.webSpeech ? "web-speech" : "buttons-only",
  };
}
