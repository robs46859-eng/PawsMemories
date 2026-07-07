/**
 * src/three/ar/brainBridgeCore.ts — AR_PET_SIM_SPEC §4.4 / AR5
 * Framework-free core of the brain→stage bridge (no React / three imports), so it
 * unit-tests under node:test. The react-three-fiber hook lives in brainBridge.ts.
 *
 *   step(dt) → brain.tick → selected ActionId → clip (BehaviorAction) via CLIP_HINT,
 *   nearest tagged object → walk target, vocalization events, body-language readout.
 * Touch gestures feed reinforcement + hormones back into the brain (§4.5).
 */

import {
  createBrain,
  type Brain,
  type BrainEvent,
  type ActionId,
  readBodyLanguage,
  type BodyLanguage,
  CLIP_HINT,
  type Gesture,
  reinforceWeight,
} from "../../brain";
import { BehaviorAction, PlacedObject } from "../../types";
import { ACTION_TO_TAG, nearestObjectWithTag } from "../objects/utilityTags";

/** Map a brain ActionId to the clip BehaviorAction the stage plays. */
export function actionToClip(id: ActionId): BehaviorAction {
  return CLIP_HINT[id] as BehaviorAction;
}

export interface BrainBridgeOptions {
  brain?: Brain;
  onClip?: (action: BehaviorAction) => void;
  onTarget?: (obj: PlacedObject | null) => void;
  onVocalize?: (action: BehaviorAction) => void;
  onBodyLanguage?: (bl: BodyLanguage) => void;
}

export interface BrainBridge {
  brain: Brain;
  step(
    dtSeconds: number,
    nowMs: number,
    objects?: PlacedObject[],
    petPos?: { x: number; z: number }
  ): BrainEvent[];
  applyGesture(gesture: Gesture): void;
}

export function createBrainBridge(opts: BrainBridgeOptions = {}): BrainBridge {
  const brain = opts.brain ?? createBrain();

  return {
    brain,

    step(dtSeconds, nowMs, objects = [], petPos = { x: 0, z: 0 }) {
      const events = brain.tick(dtSeconds, { now: nowMs });
      for (const e of events) {
        if (e.type === "action-selected") {
          opts.onClip?.(actionToClip(e.action));
          const tag = ACTION_TO_TAG[e.action];
          if (tag) opts.onTarget?.(nearestObjectWithTag(objects, tag, petPos));
        } else if (e.type === "vocalize") {
          opts.onVocalize?.(actionToClip(e.action));
        }
      }
      // Body language every step (idle-variant + ear/tail poses, NOT stat bars — §4.4).
      opts.onBodyLanguage?.(readBodyLanguage(brain.getState().drives));
      return events;
    },

    applyGesture(gesture) {
      if (gesture === "tap") return; // attention only, no reinforcement
      const action = brain.getState().currentAction;
      if (action) {
        brain.setWeights(reinforceWeight(brain.getState().weights, action, gesture));
      }
      brain.applyHormoneEvent(gesture === "stroke" ? "pet" : "scold");
    },
  };
}
