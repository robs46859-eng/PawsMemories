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
  },
  weather: {
    maxParticles: 5000, // Mobile-capped bounded count
    speed: 1.0,
  },
  sound: {
    volume: 0.5,
    ambientEnabled: true,
  },
  sequences: [
    {
      id: "hero-intro",
      name: "Hero Intro",
      version: 1,
      fps: 30,
      durationSeconds: 10,
      lanes: [
        {
          id: "cam-lane",
          type: "camera",
          keyframes: [
            { timeSeconds: 0, value: { position: [0, 1, 3], fov: 45 } },
            { timeSeconds: 3, value: { position: [2, 1, 2], fov: 50 } },
          ]
        },
        {
          id: "clip-lane",
          type: "clip",
          actorId: "default", // Assuming a default actor
          keyframes: [
            { timeSeconds: 0, value: 'idle' },
            { timeSeconds: 3, value: 'run' }
          ]
        }
      ]
    },
    {
      id: "playful",
      name: "Playful",
      version: 1,
      fps: 30,
      durationSeconds: 10,
      lanes: [
        {
          id: "cam-lane",
          type: "camera",
          keyframes: [
            { timeSeconds: 0, value: { position: [0, 0.5, 4], fov: 60 } },
          ]
        },
        {
          id: "clip-lane",
          type: "clip",
          actorId: "default",
          keyframes: [
            { timeSeconds: 0, value: 'run' },
            { timeSeconds: 5, value: 'idle' }
          ]
        }
      ]
    },
    {
      id: "sleepy",
      name: "Sleepy",
      version: 1,
      fps: 30,
      durationSeconds: 10,
      lanes: [
        {
          id: "cam-lane",
          type: "camera",
          keyframes: [
            { timeSeconds: 0, value: { position: [0, 0.5, 2], fov: 40 } },
          ]
        },
        {
          id: "weather-lane",
          type: "weather",
          keyframes: [
            { timeSeconds: 0, value: 'fog' }
          ]
        },
        {
          id: "clip-lane",
          type: "clip",
          actorId: "default",
          keyframes: [
            { timeSeconds: 0, value: 'idle' }
          ]
        }
      ]
    }
  ]
};
