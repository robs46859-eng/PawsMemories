export const ANIMATOR_DEFAULTS = {
  camera: {
    fov: 40,
    position: [2, 1.5, 3] as [number, number, number],
    target: [0, 1, 0] as [number, number, number],
  },
  actor: {
    offsetY: 0,
    spacingX: 1.5, // Used for non-overlapping placement
  },
  clip: {
    heuristics: ["idle", "stand", "breath"],
    loop: true,
    speed: 1.0,
  },
  renderer: {
    toneMapping: "ACESFilmicToneMapping",
    outputColorSpace: "srgb",
    shadowMapType: "PCFSoftShadowMap",
    dprMax: 2,
  },
  shadows: {
    contactShadowOpacity: 0.5,
    contactShadowBlur: 2,
  },
  recording: {
    resolution: { width: 1920, height: 1080 },
    fps: 30,
    bitrate: 16_000_000,
    maxDurationSeconds: 10,
    defaultDurationSeconds: 8,
  }
};
