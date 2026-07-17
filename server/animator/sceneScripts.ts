import { z } from "zod";

export const SCENE_SCRIPT_SCHEMA = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  category: z.string().min(1),
  description: z.string().min(1),
  durationSeconds: z.number().min(8).max(10),
  recommendedEnvironment: z.string().optional(),
  roles: z.array(z.object({
    id: z.string(),
    name: z.string(),
    requiredSkeleton: z.enum(["quadruped", "biped", "winged"]).optional()
  })).min(1),
  events: z.array(z.object({
    time: z.number().min(0),
    type: z.enum(["camera", "clip", "light", "sound", "weather"]),
    roleId: z.string().optional(),
    value: z.any(),
    blend: z.number().min(0).max(2).optional(),
  })).min(1)
}).superRefine((script, ctx) => {
  for (const event of script.events) {
    if (event.time > script.durationSeconds) {
      ctx.addIssue({
        code: "custom",
        path: ["events"],
        message: `Event at ${event.time}s exceeds ${script.durationSeconds}s duration`,
      });
    }
    if (event.type === "clip" && !event.roleId) {
      ctx.addIssue({
        code: "custom",
        path: ["events"],
        message: "Clip events require a roleId",
      });
    }
  }
});

export type SceneScript = z.infer<typeof SCENE_SCRIPT_SCHEMA>;

type StoryBeat = {
  id: string;
  name: string;
  category: string;
  description: string;
  skeleton: "quadruped" | "biped" | "winged";
  environment: string;
  clips: readonly [string, string, string];
};

const STORY_BEATS: StoryBeat[] = [
  { id: "park-hello", name: "Park Hello", category: "Greetings", description: "A friendly outdoor introduction.", skeleton: "quadruped", environment: "generic-outdoor-park", clips: ["idle", "head_tilt", "tail_wave"] },
  { id: "fetch-burst", name: "Fetch Burst", category: "Play", description: "A playful ready-set-run moment.", skeleton: "quadruped", environment: "generic-outdoor-park", clips: ["play-bow", "run", "tail_wave"] },
  { id: "studio-portrait", name: "Studio Portrait", category: "Portrait", description: "A polished pet portrait sequence.", skeleton: "quadruped", environment: "generic-indoor-studio", clips: ["sit", "head_tilt", "paw_offer"] },
  { id: "cozy-rest", name: "Cozy Rest", category: "Memories", description: "A quiet, affectionate resting beat.", skeleton: "quadruped", environment: "generic-indoor-studio", clips: ["lie", "yawn", "idle"] },
  { id: "treat-time", name: "Treat Time", category: "Training", description: "An eager trick-and-reward sequence.", skeleton: "quadruped", environment: "generic-indoor-studio", clips: ["beg", "paw_offer", "tail_wave"] },
  { id: "silly-roll", name: "Silly Roll", category: "Comedy", description: "A playful roll with a proud finish.", skeleton: "quadruped", environment: "generic-outdoor-park", clips: ["play-bow", "roll_over", "shake"] },
  { id: "human-welcome", name: "Human Welcome", category: "Greetings", description: "A warm presenter welcome.", skeleton: "biped", environment: "generic-indoor-studio", clips: ["idle", "wave", "talk_gesture"] },
  { id: "human-point", name: "Show and Tell", category: "Presentation", description: "A presenter introduces something off-camera.", skeleton: "biped", environment: "generic-indoor-studio", clips: ["talk_gesture", "point", "clap"] },
  { id: "bird-arrival", name: "Bird Arrival", category: "Nature", description: "A graceful arrival and landing.", skeleton: "winged", environment: "generic-outdoor-park", clips: ["fly", "hover", "land"] },
  { id: "bird-greeting", name: "Winged Greeting", category: "Greetings", description: "A charming wing wave for the camera.", skeleton: "winged", environment: "generic-outdoor-park", clips: ["roost", "wing_wave", "preen"] },
  { id: "rainy-day", name: "Rainy Day", category: "Cinematic", description: "A reflective beat under changing weather.", skeleton: "quadruped", environment: "arkham-approach-road", clips: ["walk", "head_tilt", "run"] },
  { id: "hero-reveal", name: "Hero Reveal", category: "Cinematic", description: "A dramatic reveal with a confident finish.", skeleton: "quadruped", environment: "arkham-security-ops", clips: ["idle", "walk", "bark_speak"] },
];

const CAMERA_STYLES = [
  { id: "close", name: "Close-Up", start: [0, 1.2, 3.2], finish: [1.1, 1.0, 2.5], fov: 38 },
  { id: "wide", name: "Wide", start: [-2.4, 1.8, 5.8], finish: [2.1, 1.4, 4.3], fov: 52 },
  { id: "orbit", name: "Orbit", start: [2.8, 1.4, 4.5], finish: [-2.2, 1.6, 3.8], fov: 45 },
] as const;

const MOODS = [
  { id: "bright", name: "Bright", light: "morning", weather: "clear" },
  { id: "golden", name: "Golden", light: "evening", weather: "clear" },
  { id: "moody", name: "Moody", light: "overcast", weather: "overcast" },
] as const;

function buildCatalog(): SceneScript[] {
  const scripts: SceneScript[] = [];
  for (const story of STORY_BEATS) {
    for (const camera of CAMERA_STYLES) {
      for (const mood of MOODS) {
        const durationSeconds = 8 + ((scripts.length + 1) % 3);
        const script: SceneScript = {
          id: `${story.id}-${camera.id}-${mood.id}`,
          name: `${story.name} · ${camera.name} · ${mood.name}`,
          category: story.category,
          description: `${story.description} ${camera.name.toLowerCase()} camera with a ${mood.name.toLowerCase()} finish.`,
          durationSeconds,
          recommendedEnvironment: story.environment,
          roles: [{ id: "star", name: "Star", requiredSkeleton: story.skeleton }],
          events: [
            { time: 0, type: "camera", value: { position: camera.start, fov: camera.fov } },
            { time: 0, type: "light", value: mood.light },
            { time: 0, type: "weather", value: story.id === "rainy-day" ? "rain" : mood.weather },
            { time: 0, type: "clip", roleId: "star", value: story.clips[0], blend: 0.25 },
            { time: 3, type: "clip", roleId: "star", value: story.clips[1], blend: 0.35 },
            { time: 5.5, type: "camera", value: { position: camera.finish, fov: Math.max(32, camera.fov - 4) } },
            { time: 6, type: "clip", roleId: "star", value: story.clips[2], blend: 0.35 },
          ],
        };
        scripts.push(SCENE_SCRIPT_SCHEMA.parse(script));
      }
    }
  }
  return scripts;
}

/** 108 validated, action-bearing scene scripts (12 stories × 3 cameras × 3 moods). */
export const PRESET_SCRIPTS: SceneScript[] = buildCatalog();

function hashSeed(seed: string): number {
  let hash = 2166136261;
  for (const char of seed) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** Return a stable but seed-varied ordering so each Animator session can feel fresh. */
export function getDirectorScripts(seed = "default", limit = PRESET_SCRIPTS.length): SceneScript[] {
  const output = [...PRESET_SCRIPTS];
  let state = hashSeed(seed) || 1;
  for (let i = output.length - 1; i > 0; i -= 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const j = state % (i + 1);
    [output[i], output[j]] = [output[j], output[i]];
  }
  return output.slice(0, Math.max(1, Math.min(limit, output.length)));
}
