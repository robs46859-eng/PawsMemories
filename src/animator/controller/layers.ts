/**
 * Layered animation runtime types and utilities.
 *
 * Implements ANIM-RUN-01: layered mixer (L0–L3), and the layering
 * primitives used by both the runtime controller and the EmoteQueue.
 *
 * Layer stack on `THREE.AnimationMixer`:
 *   L0 — Base locomotion (exclusive, 0.25 s cross-fade)
 *   L1 — Overlay/partial (additive via `AnimationUtils.makeClipAdditive`
 *        + named bone masks through `PropertyBinding` filtering)
 *   L2 — Face/viseme (ANIM-LIP-03 writes directly, wins over clips)
 *   L3 — Procedural post-pass (IK, springs, look-at; ANIM-RUN-04)
 *
 * Deterministic priority: higher layer overrides lower on overlapping
 * tracks.  L2 and L3 are reserved but typed so later phases can wire
 * in without retro-fit.
 */

import type { AnimationLayer } from "../types.ts";
import * as THREE from "three";

// ──────────────────────────────────────────────────────────────────────
// Layer constants & type
// ──────────────────────────────────────────────────────────────────────

/** Ordered from lowest to highest priority. */
export const LAYER_PRIORITY: Record<AnimationLayer, number> = {
  L0: 0,
  L1: 1,
  L2: 2,
  L3: 3,
};

export const CROSS_FADE_L0 = 0.25; // seconds — L0 exclusive cross-fade duration

// ──────────────────────────────────────────────────────────────────────
// Layered clip selection options
// ──────────────────────────────────────────────────────────────────────

/** Options passed to `selectLayeredClip` / `playOverlay`. */
export interface LayeredClipOptions {
  /** Layer this clip belongs to.  Default: L0 for backward compat. */
  layer?: AnimationLayer;
  /** Duration in seconds for the cross-fade (L0 exclusive by default). */
  fadeSec?: number;
  /** Named bone mask from AnimationSetV2.masks — tracks outside this list
   *  are suppressed for this clip via PropertyBinding filtering.
   */
  mask?: string[];
  /** If true, make the clip additive (L1 only; silently ignored for L0). */
  additive?: boolean;
}

/** Internal state of a single layer's clip. */
export interface LayerState {
  layer: AnimationLayer;
  action: THREE.AnimationAction | null;
  /** The clip name that is currently playing on this layer (null = none). */
  name: string | null;
  /** Cross-fade duration used for the last selection on this layer. */
  fadeSec: number;
}

// ──────────────────────────────────────────────────────────────────────
// Emote queue entry
// ──────────────────────────────────────────────────────────────────────

/** An emote request from EmoteQueue.enqueue(). */
export interface EmoteEntry {
  /** Clip name from AnimationSetV2.expectedClips. */
  clip: string;
  /** Layer to play on.  L1 for non-disruptive gestures. */
  layer: AnimationLayer;
  /** Priority: 0 = lowest (idle life), 10 = highest (user commands).
   *  Only interrupts an entry with the same or lower priority. */
  priority: number;
  /** How long to hold the clip at full intensity (seconds). */
  holdSec: number;
  /** Minimum seconds before this clip can be re-enqueued (cooldown). */
  cooldownSec: number;
  /** Earliest time (performance.now()) when the cooldown expires. */
  cooldownUntil?: number;
}

/** Entry currently executing in the EmoteQueue. */
export interface EmotePlaying {
  entry: EmoteEntry;
  startTime: number; // performance.now()
  action: THREE.AnimationAction;
}
