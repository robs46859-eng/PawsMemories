/**
 * src/three/ar/brainBridge.ts — AR_PET_SIM_SPEC §4.4 / AR5
 * Bridges the pure brain engine to the three.js stage: rAF tick → brain.tick(dt) →
 * utility goal → BT → clip; maps object utilityTags; drives body-language poses.
 *
 * TODO(AR5): register real BT leaves (pathfind via navmesh, orient, playClip via the
 * existing clip system, applyRecovery, vocalize) on the brain's LeafRegistry; consume
 * emitted events to trigger clips/vocalizations and body-language poses (no stat bars).
 */

import { createBrain, type Brain } from "../../brain/brain";
import type { BrainEvent } from "../../brain/types";
import { readBodyLanguage } from "../../brain/bodyLanguage";

export interface BrainBridge {
  brain: Brain;
  step(dtSeconds: number, nowMs: number): BrainEvent[];
}

export function createBrainBridge(brain?: Brain): BrainBridge {
  const b = brain ?? createBrain();
  return {
    brain: b,
    step(dtSeconds, nowMs) {
      const events = b.tick(dtSeconds, { now: nowMs });
      // Body language is derived each step for the stage to apply poses.
      readBodyLanguage(b.getState().drives);
      return events;
    },
  };
}
