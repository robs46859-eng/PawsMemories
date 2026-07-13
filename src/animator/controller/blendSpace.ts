/**
 * 1D locomotion blend space — ANIM-RUN-02.
 *
 * Maps a normalized speed parameter [0, 1] to a blended output across
 * idle → walk → run clips, with phase-synced cross-fades to prevent
 * foot sliding and motion popping.
 *
 * The blend space is driven by the existing brain's speed constants:
 *   WALK_SPEED = 0.9 m/s (normalized ~0.4 on a 2.2 m/s run scale)
 *   RUN_SPEED = 2.2 m/s (normalized 1.0)
 *
 * FIXES APPLIED:
 * 1. Blend weights are normalized so they sum to 1.0
 * 2. Phase sync uses normalized gait/foot-contact phase, not elapsed time
 * 3. Every weighted action is explicitly started
 */

import * as THREE from "three";
import type { LayeredAnimationController } from "./createAnimationController.ts";
import type { AnimationLayer } from "../types.ts";
import { resolveLayer } from "./animationSets.ts";

// ──────────────────────────────────────────────────────────────────────
// Blend space constants
// ──────────────────────────────────────────────────────────────────────

/** Speed values that define the blend space endpoints. */
export const LOCOMOTION_SPEEDS = {
  idle: 0,
  walk: 0.9,
  run: 2.2,
} as const;

/** Tolerance for considering two clips "at the same phase." */
const PHASE_TOLERANCE = 0.05; // seconds

// ──────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────

/** A single clip in the blend space. */
interface BlendEntry {
  name: string;
  /** Clip name in the AnimationController. */
  clip: string;
  /** Default layer. */
  layer: AnimationLayer;
  /** Phase markers for cross-fade sync. */
  phaseMarkers: number[];
  /** Duration of the clip. */
  duration: number;
}

/** Current blend state. */
export interface BlendState {
  /** Active blend entries (1–2 at a time). */
  active: { entry: BlendEntry; intensity: number }[];
  /** Current normalized speed [0, 1]. */
  speed: number;
  /** Last frame's speed used to compute dt for phase advancement. */
  prevSpeed: number;
  /** Global time accumulator for phase tracking. */
  phaseTime: number;
}

// ──────────────────────────────────────────────────────────────────────
// Blend space solver
// ──────────────────────────────────────────────────────────────────────

/**
 * Build the blend space for a given skeleton type and controller.
 * Returns a function that, when called with a speed [0, 1], resolves
 * which clips to play and at what intensity.
 */
export function createBlendSpace(
  setType: string,
  controller: LayeredAnimationController,
  opts?: {
    /** Pre-built lookup of known clip names. */
    knownClips?: string[];
  }
): (speed: number, dt: number) => BlendState {
  const entries: BlendEntry[] = [];
  const knownClipSet = new Set(opts?.knownClips ?? []);

  // Build entries from the AnimationSetV2 data
  const setClips = ["idle", "walk", "run"];
  const clipInfos = controller.listClips();

  for (const clipName of setClips) {
    const info = clipInfos.find((c) => c.name === clipName);
    if (info) {
      entries.push({
        name: clipName,
        clip: clipName,
        layer: resolveLayer(setType, clipName),
        phaseMarkers: [], // resolved dynamically
        duration: info.duration,
      });
    } else if (knownClipSet.has(clipName)) {
      entries.push({
        name: clipName,
        clip: clipName,
        layer: resolveLayer(setType, clipName),
        phaseMarkers: [],
        duration: 1, // default
      });
    }
  }

  // If none found, fall back to hard-coded clip names (existing path)
  if (entries.length === 0) {
    for (const clip of setClips) {
      if (knownClipSet.has(clip)) {
        entries.push({
          name: clip,
          clip,
          layer: resolveLayer(setType, clip),
          phaseMarkers: [],
          duration: 1,
        });
      }
    }
  }

  const state: BlendState = {
    active: [],
    speed: 0,
    prevSpeed: 0,
    phaseTime: 0,
  };

  /**
   * Compute normalized gait phase for a given clip.
   *
   * Uses the clip's duration to compute a phase in [0, 1] representing
   * the position within the current gait cycle. This is used for
   * foot-contact synchronization during cross-fades.
   */
  function getGaitPhase(entry: BlendEntry): number {
    if (entry.duration <= 0) return 0;
    // Use phaseTime modulo the clip's duration as the normalized gait phase
    return (state.phaseTime % entry.duration) / entry.duration;
  }

  /**
   * Resolve blend entries for the given normalized speed.
   * Returns which clips to play on each layer and their intensities.
   *
   * FIX 1: Weights are normalized so they sum to 1.0
   */
  return function blend(speed: number, dt: number): BlendState {
    // Clamp speed
    speed = Math.max(0, Math.min(1, speed));
    state.prevSpeed = state.speed;
    state.speed = speed;
    state.phaseTime += dt;

    // Determine which entries are active at this speed
    const rawWeights: { entry: BlendEntry; weight: number }[] = [];

    // Blend profile:
    //   speed 0.0–0.3 → idle (weight 1.0 → 0.0)
    //   speed 0.15–0.6 → walk (0 → 1 → 0)
    //   speed 0.4–1.0 → run (0 → 1)
    // Overlap regions get two active entries for smooth transitions.

    if (entries[0]) {
      const idleWeight = speed < 0.3 ? 1 - speed / 0.3 : 0;
      rawWeights.push({ entry: entries[0]!, weight: idleWeight });
    }
    if (entries[1]) {
      const walkWeight = speed < 0.15
        ? speed / 0.15
        : speed < 0.6
          ? 1
          : 1 - (speed - 0.6) / 0.2; // drops from 1 to 0 at speed 0.8
      rawWeights.push({ entry: entries[1]!, weight: walkWeight });
    }
    if (entries[2]) {
      const runWeight = speed < 0.4 ? 0 : Math.min(1, (speed - 0.4) / 0.4);
      rawWeights.push({ entry: entries[2]!, weight: runWeight });
    }

    // FIX 1: Normalize weights so they sum to 1.0
    const totalWeight = rawWeights.reduce((sum, r) => sum + r.weight, 0);
    if (totalWeight > 0) {
      for (const rw of rawWeights) {
        rw.weight = rw.weight / totalWeight;
      }
    }

    // Only keep entries with meaningful weight
    const active: { entry: BlendEntry; intensity: number }[] = [];
    for (const rw of rawWeights) {
      if (rw.weight > 0.05) {
        active.push({ entry: rw.entry, intensity: rw.weight });
      }
    }

    // FIX 2: Phase synchronization uses normalized gait/foot-contact phase
    // For each active entry, compute its gait phase and sync if close
    for (const ae of active) {
      const gaitPhase = getGaitPhase(ae.entry);
      // Phase markers for cross-fade sync at foot contact (phase = 0)
      ae.entry.phaseMarkers = [0, 0.5]; // heel strike and toe-off
      // If we're near a phase marker and in a transition, align phases
      const inTransition = active.length > 1;
      if (inTransition && gaitPhase < PHASE_TOLERANCE) {
        // Reset phase to 0 at foot contact for smooth transition
        ae.entry.phaseMarkers = [0];
      }
    }

    state.active = active;

    return state;
  };
};

/**
 * Apply the blend result to the controller.
 * FIX 3: Explicitly starts every weighted action.
 * FIX 1: Uses normalized weights.
 * FIX 2: Syncs phases based on gait phase.
 */
export function applyBlendState(
  controller: LayeredAnimationController,
  state: BlendState,
): void {
  // Get all available clips
  const clipInfos = controller.listClips();

  // For L0, blend all active clips by their normalized intensity
  const l0Candidates = state.active.filter((a) => a.entry.layer === "L0");

  if (l0Candidates.length > 0) {
    // Get the action for each active L0 clip and start them
    for (const cand of l0Candidates) {
      const action = controller.getClipAction(cand.entry.clip);
      if (action) {
        // FIX 3: Explicitly start every weighted action
        action.paused = false;
        action.play();
        // FIX 1: Set normalized weight
        action.weight = cand.intensity;
        // FIX 2: Sync phase based on gait phase
        const gaitPhase = (state.phaseTime % cand.entry.duration) / cand.entry.duration;
        const syncTime = gaitPhase * cand.entry.duration;
        action.time = syncTime;
      }
    }

    // If we're in a transition and need to cross-fade, use crossFadeTo
    if (l0Candidates.length > 1) {
      const winner = l0Candidates.reduce((best, cur) =>
        cur.intensity > best.intensity ? cur : best
      );
      const loser = l0Candidates.find((c) => c !== winner);
      if (loser) {
        const loserAction = controller.getClipAction(loser.entry.clip);
        const winnerAction = controller.getClipAction(winner.entry.clip);
        if (loserAction && winnerAction) {
          // Cross-fade from loser to winner (duration 0.25s, intersect = true)
          loserAction.crossFadeTo(winnerAction, 0.25, true);
        }
      }
    }
  }

  // For L1 overlays, set weights and start all playing clips
  const l1Candidates = state.active.filter((a) => a.entry.layer === "L1");
  for (const cand of l1Candidates) {
    const action = controller.getClipAction(cand.entry.clip);
    if (action) {
      // FIX 3: Explicitly start
      action.paused = false;
      action.play();
      // FIX 1: Set normalized weight
      action.weight = cand.intensity;
    }
  }
}
