import { z } from "zod";

export const SCENE_SCRIPT_SCHEMA = z.object({
  id: z.string(),
  name: z.string(),
  durationSeconds: z.number().min(8).max(10),
  recommendedEnvironment: z.string().optional(),
  roles: z.array(z.object({
    id: z.string(),
    name: z.string(),
    requiredSkeleton: z.enum(["quadruped", "biped", "winged"]).optional()
  })),
  events: z.array(z.object({
    time: z.number(),
    type: z.enum(["camera", "clip", "light", "sound"]),
    roleId: z.string().optional(),
    value: z.any()
  }))
});

export type SceneScript = z.infer<typeof SCENE_SCRIPT_SCHEMA>;

export const PRESET_SCRIPTS: SceneScript[] = [
  {
    id: "hero-turn",
    name: "Hero Turn",
    durationSeconds: 8,
    recommendedEnvironment: "day_park",
    roles: [{ id: "actor1", name: "Star", requiredSkeleton: "quadruped" }],
    events: [
      { time: 0, type: "camera", value: { position: [0, 1, 5], fov: 45 } },
      { time: 0, type: "clip", roleId: "actor1", value: "idle" },
      { time: 4, type: "camera", value: { position: [2, 1, 3], fov: 40 } },
      { time: 4, type: "clip", roleId: "actor1", value: "run" }
    ]
  },
  {
    id: "two-dog-play",
    name: "Two-Dog Play",
    durationSeconds: 10,
    recommendedEnvironment: "day_park",
    roles: [
      { id: "dog1", name: "Dog 1", requiredSkeleton: "quadruped" },
      { id: "dog2", name: "Dog 2", requiredSkeleton: "quadruped" }
    ],
    events: [
      { time: 0, type: "camera", value: { position: [0, 2, 6], fov: 50 } },
      { time: 0, type: "clip", roleId: "dog1", value: "play-bow" },
      { time: 0, type: "clip", roleId: "dog2", value: "idle" },
      { time: 5, type: "clip", roleId: "dog1", value: "run" },
      { time: 5, type: "clip", roleId: "dog2", value: "run" }
    ]
  },
  {
    id: "spooky-reveal",
    name: "Spooky Reveal",
    durationSeconds: 9,
    recommendedEnvironment: "arkham_alley",
    roles: [{ id: "hero", name: "Hero", requiredSkeleton: "quadruped" }],
    events: [
      { time: 0, type: "camera", value: { position: [0, 0.5, 4], fov: 60 } },
      { time: 0, type: "clip", roleId: "hero", value: "sit" },
      { time: 3, type: "clip", roleId: "hero", value: "head_tilt" },
      { time: 6, type: "clip", roleId: "hero", value: "run" },
      { time: 6, type: "camera", value: { position: [0, 1.5, 2], fov: 50 } }
    ]
  },
  {
    id: "roll-call",
    name: "Roll Call",
    durationSeconds: 10,
    recommendedEnvironment: "photo_studio",
    roles: [
      { id: "a", name: "Member 1" },
      { id: "b", name: "Member 2" }
    ],
    events: [
      { time: 0, type: "camera", value: { position: [-2, 1, 3], fov: 50 } },
      { time: 0, type: "clip", roleId: "a", value: "idle" },
      { time: 0, type: "clip", roleId: "b", value: "sit" },
      { time: 5, type: "camera", value: { position: [2, 1, 3], fov: 50 } },
      { time: 5, type: "clip", roleId: "a", value: "sit" },
      { time: 5, type: "clip", roleId: "b", value: "idle" }
    ]
  },
  {
    id: "human-hello",
    name: "Human Hello",
    durationSeconds: 8,
    recommendedEnvironment: "photo_studio",
    roles: [{ id: "person", name: "Person", requiredSkeleton: "biped" }],
    events: [
      { time: 0, type: "camera", value: { position: [0, 1.5, 3], fov: 40 } },
      { time: 0, type: "clip", roleId: "person", value: "idle" },
      { time: 2, type: "clip", roleId: "person", value: "wave" },
      { time: 5, type: "clip", roleId: "person", value: "talk" }
    ]
  },
  {
    id: "bird-flyby",
    name: "Bird Flyby",
    durationSeconds: 8,
    recommendedEnvironment: "day_park",
    roles: [{ id: "bird", name: "Bird", requiredSkeleton: "winged" }],
    events: [
      { time: 0, type: "camera", value: { position: [0, 3, 5], fov: 60 } },
      { time: 0, type: "clip", roleId: "bird", value: "fly" },
      { time: 5, type: "clip", roleId: "bird", value: "land" }
    ]
  }
];
