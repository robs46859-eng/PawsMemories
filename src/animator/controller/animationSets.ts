/**
 * AnimationSet v2 — data declarations for the layered animation runtime.
 *
 * Implements ANIM-RUN-02: every clip declares its default layer, named bone
 * masks, and transition metadata.  This replaces the flat expectedClips list
 * from v1 and drives the 1D blend space, EmoteQueue defaults, and mask
 * resolution at runtime.
 *
 * The clip names here are the SINGLE SOURCE OF TRUTH for the worker.
 * `src/three/clipMap.ts` fuzzy matching is a safety net only.
 */

import type { AnimationLayer } from "../types.ts";

// ──────────────────────────────────────────────────────────────────────
// AnimationSetV2 data type (mirrors server/animator/schemas.ts for client use)
// ──────────────────────────────────────────────────────────────────────

export interface AnimationTransition {
  from: string;
  to: string;
  fadeSec: number;
  condition?: string; // e.g. "speed > 0.5"
}

export interface AnimationSetV2 {
  version: 1;
  type: "quadruped" | "biped" | "winged";
  expectedClips: string[];
  /** Default layer for each clip name. */
  layers: Record<string, AnimationLayer>;
  /** Named bone masks — each key maps to bone names that should be
   *  suppressed when the mask is active. */
  masks: Record<string, string[]>;
  /** Phase markers: foot-contact timestamps for cross-fade sync. */
  phaseMarkers: Record<string, number[]>;
  /** Declared transitions between locomotion clips. */
  transitions: AnimationTransition[];
}

// ──────────────────────────────────────────────────────────────────────
// Quadruped set (15 clips)
// ──────────────────────────────────────────────────────────────────────

export const QUADRUPED_SET: AnimationSetV2 = {
  version: 1,
  type: "quadruped",
  expectedClips: [
    // L0 locomotion
    "idle", "walk", "run",
    // L0 pose clips (non-locomotion, exclusive)
    "sit", "lie", "eat", "play-bow",
    // L1 overlays (additive / masked)
    "tail_wave", "head_tilt", "ear_flick",
    // L1 action clips (one-shot overlays)
    "paw_offer", "roll_over", "beg",
    // L1 sound-emote combos
    "bark_speak", "growl",
    // L0 idle gestures
    "yawn", "shake", "scratch",
  ],
  layers: {
    idle: "L0", walk: "L0", run: "L0",
    sit: "L0", lie: "L0", eat: "L0", "play-bow": "L0",
    tail_wave: "L1", head_tilt: "L1", ear_flick: "L1",
    paw_offer: "L1", roll_over: "L1", beg: "L1",
    bark_speak: "L1", growl: "L1",
    yawn: "L0", shake: "L0", scratch: "L0",
  },
  masks: {
    tail_wave: ["spine", "tail.*"],       // only spine and tail
    head_tilt: ["neck", "head"],           // only neck and head
    ear_flick: ["ear.L", "ear.R"],         // ears only
    bark_speak: ["head", "neck", "jaw"],   // head/neck/jaw
    growl: ["head", "neck"],
    head_tilt_no_spine: ["head", "neck"],  // head tilt without spine pollution
  },
  phaseMarkers: {
    idle: [0],                            // continuous, no phase markers needed
    walk: [0, 0.5, 1.0],                  // ~2 steps per cycle
    run: [0, 0.33, 0.66, 1.0],            // faster gait
    sit: [0],
    lie: [0],
  },
  transitions: [
    // Locomotion transitions with speed conditions
    { from: "idle", to: "walk", fadeSec: 0.25 },
    { from: "walk", to: "idle", fadeSec: 0.25 },
    { from: "walk", to: "run", fadeSec: 0.25, condition: "speed > 0.7" },
    { from: "run", to: "walk", fadeSec: 0.25, condition: "speed < 0.5" },
    // Locomotion to pose
    { from: "idle", to: "sit", fadeSec: 0.5 },
    { from: "idle", to: "lie", fadeSec: 0.5 },
    { from: "walk", to: "sit", fadeSec: 0.5 },
    { from: "run", to: "sit", fadeSec: 0.5 },
    // Pose back to locomotion
    { from: "sit", to: "idle", fadeSec: 0.5 },
    { from: "lie", to: "idle", fadeSec: 0.5 },
  ],
};

// ──────────────────────────────────────────────────────────────────────
// Biped set (10 clips)
// ──────────────────────────────────────────────────────────────────────

export const BIPED_SET: AnimationSetV2 = {
  version: 1,
  type: "biped",
  expectedClips: [
    // L0 locomotion
    "idle", "walk", "run",
    // L0 pose clips
    "sit",
    // L1 overlays
    "talk_gesture", "head_nod",
    // L1 action clips
    "wave", "clap", "point",
    // L1 sound-emote
    "laugh",
  ],
  layers: {
    idle: "L0", walk: "L0", run: "L0", sit: "L0",
    talk_gesture: "L1", head_nod: "L1",
    wave: "L1", clap: "L1", point: "L1",
    laugh: "L1",
  },
  masks: {
    talk_gesture: ["spine", "arm.*", "hand.*"],
    head_nod: ["head", "neck"],
    wave: ["arm.L"],                       // left arm waves
    clap: ["arm.L", "arm.R", "hand.L", "hand.R"],
    point: ["arm.L"],
    laugh: ["head", "spine"],
  },
  phaseMarkers: {
    idle: [0],
    walk: [0, 0.5, 1.0],
    run: [0, 0.33, 0.66, 1.0],
    sit: [0],
  },
  transitions: [
    { from: "idle", to: "walk", fadeSec: 0.25 },
    { from: "walk", to: "idle", fadeSec: 0.25 },
    { from: "walk", to: "run", fadeSec: 0.25, condition: "speed > 0.7" },
    { from: "run", to: "walk", fadeSec: 0.25, condition: "speed < 0.5" },
    { from: "idle", to: "sit", fadeSec: 0.5 },
    { from: "sit", to: "idle", fadeSec: 0.5 },
  ],
};

// ──────────────────────────────────────────────────────────────────────
// Winged set (8 clips)
// ──────────────────────────────────────────────────────────────────────

export const WINGED_SET: AnimationSetV2 = {
  version: 1,
  type: "winged",
  expectedClips: [
    // L0 locomotion
    "idle", "fly", "land", "swim",
    // L1 overlays
    "hover", "preen",
    // L1 action clips
    "peck", "roost", "wing_wave",
  ],
  layers: {
    idle: "L0", fly: "L0", land: "L0", swim: "L0",
    hover: "L1", preen: "L1",
    peck: "L1", roost: "L0", wing_wave: "L1",
  },
  masks: {
    hover: ["wing.L", "wing.R"],
    preen: ["beak", "neck"],
    peck: ["beak"],
    wing_wave: ["wing.L", "wing.R", "tail.*"],
  },
  phaseMarkers: {
    idle: [0],
    fly: [0, 0.5, 1.0],
    hover: [0, 0.33, 0.66, 1.0],
  },
  transitions: [
    { from: "idle", to: "fly", fadeSec: 0.3 },
    { from: "fly", to: "idle", fadeSec: 0.3 },
    { from: "fly", to: "land", fadeSec: 0.5 },
    { from: "land", to: "idle", fadeSec: 0.3 },
  ],
};

// ──────────────────────────────────────────────────────────────────────
// Registry
// ──────────────────────────────────────────────────────────────────────

export const ANIMATION_SETS_V2: Record<string, AnimationSetV2> = {
  quadruped: QUADRUPED_SET,
  biped: BIPED_SET,
  winged: WINGED_SET,
};

/**
 * Backward-compatible v1 export for tests and any code that still
 * references the old { type, expectedClips } shape.
 */
export const ANIMATION_SETS: Record<string, { type: string; expectedClips: string[] }> = {
  quadruped: { type: "quadruped", expectedClips: QUADRUPED_SET.expectedClips },
  biped: { type: "biped", expectedClips: BIPED_SET.expectedClips },
  winged: { type: "winged", expectedClips: WINGED_SET.expectedClips },
};

/** Look up an AnimationSetV2 by skeleton type. */
export function getAnimationSetV2(type: string): AnimationSetV2 | null {
  return ANIMATION_SETS_V2[type] ?? null;
}

/** Resolve the default layer for a given clip name. */
export function resolveLayer(
  setType: string,
  clipName: string,
): AnimationLayer {
  const set = getAnimationSetV2(setType);
  if (!set) return "L0"; // default fallback
  return set.layers[clipName] ?? "L0";
}

/** Resolve a named bone mask for a clip name. */
export function resolveMask(
  setType: string,
  clipName: string,
): string[] | null {
  const set = getAnimationSetV2(setType);
  if (!set) return null;
  // Exact match first, then check "clip_no_spine" pattern
  return set.masks[clipName]
    ?? set.masks[`${clipName}_no_spine`]
    ?? null;
}
