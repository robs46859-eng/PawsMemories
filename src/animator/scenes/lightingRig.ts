import { EnvironmentPreset } from "../../../server/animator/environments.ts";

export type TimeOfDay = "morning" | "afternoon" | "evening" | "night";

export interface LightingProfile {
  sunPosition: [number, number, number];
  sunColor: string;
  sunIntensity: number;
  ambientColor: string;
  ambientIntensity: number;
  exposure: number;
  showStars: boolean;
  fogColor: string;
  fogDensity: number;
}

export function lightingFor(timeOfDay: TimeOfDay, preset: EnvironmentPreset): LightingProfile {
  // If indoor, mostly ignore time of day and use a fixed, flattering indoor rig
  if (preset.id.includes("indoor")) {
    return {
      sunPosition: [2, 5, 2],
      sunColor: "#ffffff",
      sunIntensity: 0.8,
      ambientColor: "#ffffff",
      ambientIntensity: 0.6,
      exposure: 1.0,
      showStars: false,
      fogColor: "#ffffff",
      fogDensity: 0,
    };
  }

  // Base outdoor profiles
  const profiles: Record<TimeOfDay, LightingProfile> = {
    morning: {
      sunPosition: [5, 2, -5],
      sunColor: "#ffecd1",
      sunIntensity: 1.5,
      ambientColor: "#cce0ff",
      ambientIntensity: 0.4,
      exposure: 0.9,
      showStars: false,
      fogColor: "#e6f2ff",
      fogDensity: 0.01,
    },
    afternoon: {
      sunPosition: [2, 5, 2], // high sun
      sunColor: "#ffffff",
      sunIntensity: 1.8,
      ambientColor: "#ffffff",
      ambientIntensity: 0.6,
      exposure: 1.0,
      showStars: false,
      fogColor: "#ffffff",
      fogDensity: 0.005,
    },
    evening: {
      sunPosition: [-5, 1, 5],
      sunColor: "#ffaa55",
      sunIntensity: 1.2,
      ambientColor: "#88aaff",
      ambientIntensity: 0.3,
      exposure: 0.8,
      showStars: false,
      fogColor: "#ffd2a6",
      fogDensity: 0.015,
    },
    night: {
      sunPosition: [0, 5, 0], // moonlight
      sunColor: "#88bbff",
      sunIntensity: 0.3,
      ambientColor: "#112244",
      ambientIntensity: 0.1,
      exposure: 0.5,
      showStars: true,
      fogColor: "#000511",
      fogDensity: 0.02,
    }
  };

  const profile = { ...profiles[timeOfDay] };

  // If HDRI, we might dim the env map instead of moving a sun, but for now we just return the rig profile
  // and the renderer uses these values.

  return profile;
}
