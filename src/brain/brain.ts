/**
 * src/brain/brain.ts
 * Orchestrator: tick(dt) → decay drives + relax hormones → utility select → BT execute.
 * Emits events; exposes serialisable state for DB sync (AR2). Pure TS.
 */

import {
  ActionId,
  BrainContext,
  BrainEvent,
  BrainState,
  BreedModifiers,
  DEFAULT_BREED_MODIFIERS,
  Drives,
  Hormones,
  Stimulus,
  Temperament,
} from "./types";
import { DEFAULT_DRIVES, decayDrives, recoverDrives, criticalDrives } from "./drives";
import { DEFAULT_HORMONES, relaxHormones } from "./hormones";
import { ACTIONS, actionById, weightsFromTemperament } from "./actions";
import { Rng, makeRng, selectAction, shouldReselect } from "./utility";
import { BTContext, BTNode, LeafRegistry } from "./behaviorTree";
import { buildTree, defaultRegistry } from "./trees";

export interface BrainOptions {
  temperament: Temperament;
  breed?: BreedModifiers;
  drives?: Drives;
  hormones?: Hormones;
  weights?: Record<ActionId, number>;
  /** Injected RNG for deterministic tests; defaults to a time-seeded mulberry32. */
  rng?: Rng;
  /** Leaf registry (AR5 supplies real leaves; defaults are structural). */
  registry?: LeafRegistry;
  now?: number;
}

export interface Brain {
  tick(dtSeconds: number, opts?: { now?: number; eventForced?: boolean }): BrainEvent[];
  addStimulus(s: Stimulus): void;
  setCommanded(action: ActionId | null, untilMs?: number): void;
  getState(): BrainState;
  getContext(): BrainContext;
  setWeights(w: Record<ActionId, number>): void;
}

const DEFAULT_TEMPERAMENT: Temperament = {
  energy: 0.5,
  sociability: 0.5,
  stubbornness: 0.5,
  foodMotivation: 0.5,
  vocality: 0.5,
};

export function createBrain(options?: Partial<BrainOptions>): Brain {
  const temperament = options?.temperament ?? DEFAULT_TEMPERAMENT;
  const breed = options?.breed ?? DEFAULT_BREED_MODIFIERS;
  const rng = options?.rng ?? makeRng((Date.now() & 0xffffffff) >>> 0);
  const registry = options?.registry ?? defaultRegistry();

  let drives: Drives = options?.drives ?? { ...DEFAULT_DRIVES };
  let hormones: Hormones = options?.hormones ?? { ...DEFAULT_HORMONES };
  let weights: Record<ActionId, number> =
    options?.weights ?? weightsFromTemperament(temperament);
  let stimuli: Stimulus[] = [];
  let commanded: BrainContext["commanded"] = null;

  let currentAction: ActionId | null = null;
  let lastDecisionAt = options?.now ?? 0;
  let currentTree: BTNode | null = null;
  let treeBlackboard: Record<string, unknown> = {};

  function ctxAt(now: number): BrainContext {
    return { drives, hormones, temperament, stimuli, now, currentAction, commanded };
  }

  function pruneStimuli(now: number): void {
    // Drop player stimuli older than ~60s (bonus ~0); keep ambient.
    stimuli = stimuli.filter(
      (s) => !s.playerInteracted || now - s.createdAt < 60_000
    );
  }

  return {
    tick(dtSeconds, opts) {
      const now = opts?.now ?? lastDecisionAt + dtSeconds * 1000;
      const events: BrainEvent[] = [];

      // 1) passive dynamics
      drives = decayDrives(drives, dtSeconds, breed);
      hormones = relaxHormones(hormones, dtSeconds);
      pruneStimuli(now);

      // 2) critical drive flags
      for (const d of criticalDrives(drives)) {
        events.push({ type: "drive-critical", drive: d });
      }

      // 3) utility (re)selection, throttled
      if (shouldReselect(lastDecisionAt, now, opts?.eventForced) || !currentAction) {
        const scored = selectAction(ACTIONS, weights, ctxAt(now), rng);
        const top = scored[0];
        if (top && top.id !== currentAction) {
          currentAction = top.id;
          currentTree = buildTree(top.id, registry);
          treeBlackboard = {};
          events.push({ type: "action-selected", action: top.id, utility: top.utility });
        }
        lastDecisionAt = now;
      }

      // 4) execute the current goal's BT
      if (currentTree && currentAction) {
        const btCtx: BTContext = {
          dt: dtSeconds,
          now,
          blackboard: treeBlackboard,
          emit: (evt) => {
            if (evt.type === "vocalize" && currentAction) {
              events.push({ type: "vocalize", action: currentAction });
            }
          },
        };
        const status = currentTree.tick(btCtx);
        if (status === "success") {
          const def = actionById(currentAction);
          drives = recoverDrives(drives, def?.recovery, dtSeconds);
          events.push({ type: "action-completed", action: currentAction });
          currentTree = null; // will re-select next tick
        }
      }

      return events;
    },

    addStimulus(s) {
      stimuli.push(s);
    },

    setCommanded(action, untilMs) {
      commanded = action ? { action, until: untilMs ?? lastDecisionAt + 15_000 } : null;
    },

    getState() {
      return {
        drives: { ...drives },
        hormones: { ...hormones },
        weights: { ...weights },
        lastDecisionAt,
        currentAction,
      };
    },

    getContext() {
      return ctxAt(lastDecisionAt);
    },

    setWeights(w) {
      weights = { ...w };
    },
  };
}
