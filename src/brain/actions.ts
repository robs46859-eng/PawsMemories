/**
 * src/brain/actions.ts
 * Action catalog with per-action considerations (AR_PET_SIM_SPEC §4).
 * Each ActionId maps to one of the 15 GLB clips downstream (see clipHint).
 */

import {
  ActionDef,
  ActionId,
  BrainContext,
  DriveId,
  Temperament,
  Stimulus,
} from "./types";
import { norm100, linear, inverse, clamp01, decayBonus } from "./considerations";

/** Brain ActionId → existing GLB clip BehaviorAction (wired in AR5). */
export const CLIP_HINT: Record<ActionId, string> = {
  idle: "idle",
  eat: "eating",
  drink: "drinking",
  nap: "sleeping",
  fetch: "playing",
  dig: "digging",
  greet: "interacting",
  roll: "shaking",
  sniff: "interacting",
  bark: "speaking",
};

/** Sum the decaying bonus from stimuli that bias toward `action` (§4.1). */
function stimulusBonus(action: ActionId, ctx: BrainContext): number {
  let best = 0;
  for (const s of ctx.stimuli) {
    if (s.action !== action) continue;
    const ageSec = Math.max(0, (ctx.now - s.createdAt) / 1000);
    const b = s.playerInteracted ? decayBonus(ageSec, 20) : 0.15; // ambient = flat low
    if (b > best) best = b;
  }
  return best;
}

/** Commanded boost: if a voice command for this action is active, add a strong bonus. */
function commandedBonus(action: ActionId, ctx: BrainContext): number {
  const c = ctx.commanded;
  if (c && c.action === action && ctx.now <= c.until) return 1;
  return 0;
}

/** A consideration that adds stimulus + commanded bonuses on top of a base of 0.2. */
function opportunityConsideration(action: ActionId) {
  return {
    id: `${action}-opportunity`,
    input: (ctx: BrainContext) =>
      0.2 + stimulusBonus(action, ctx) + commandedBonus(action, ctx),
    curve: (x: number) => clamp01(x),
  };
}

/** The catalog. baseWeight is refined per-pet from temperament in weightsFromTemperament(). */
export const ACTIONS: ActionDef[] = [
  {
    id: "idle",
    baseWeight: 0.15,
    considerations: [{ id: "always", input: () => 1, curve: () => 0.3 }],
  },
  {
    id: "eat",
    baseWeight: 1,
    recovery: { hunger: -20 },
    // Hunger alone drives eating; food-object availability is an AR2+ world gate,
    // not an opportunity bonus (would otherwise suppress eating in a bare scene).
    considerations: [
      { id: "hunger", input: (c) => norm100(c.drives.hunger), curve: linear(0.3, 1), exponent: 2 },
    ],
  },
  {
    id: "drink",
    baseWeight: 1,
    recovery: { thirst: -20 },
    considerations: [
      { id: "thirst", input: (c) => norm100(c.drives.thirst), curve: linear(0.3, 1), exponent: 2 },
    ],
  },
  {
    id: "nap",
    baseWeight: 1,
    recovery: { tiredness: -25, happiness: +2 },
    considerations: [
      { id: "tired", input: (c) => norm100(c.drives.tiredness), curve: linear(0.4, 1), exponent: 2 },
      // won't nap while very playful
      { id: "not-playful", input: (c) => norm100(c.drives.playfulness), curve: inverse(0.6, 1) },
    ],
  },
  {
    id: "fetch",
    baseWeight: 1,
    recovery: { playfulness: -30, happiness: +15, tiredness: +8 },
    considerations: [
      { id: "playful", input: (c) => norm100(c.drives.playfulness), curve: linear(0.2, 1) },
      { id: "energy", input: (c) => norm100(c.drives.tiredness), curve: inverse(0.7, 1) },
      opportunityConsideration("fetch"),
    ],
  },
  {
    id: "dig",
    baseWeight: 0.7,
    recovery: { playfulness: -15, happiness: +8 },
    considerations: [
      { id: "playful", input: (c) => norm100(c.drives.playfulness), curve: linear(0.2, 1) },
      opportunityConsideration("dig"),
    ],
  },
  {
    id: "greet",
    baseWeight: 0.8,
    recovery: { happiness: +12, playfulness: +4 },
    considerations: [
      { id: "social", input: (c) => c.temperament.sociability, curve: linear(0.2, 1) },
      opportunityConsideration("greet"),
    ],
  },
  {
    id: "roll",
    baseWeight: 0.5,
    recovery: { happiness: +6 },
    considerations: [
      { id: "happy-excited", input: (c) => norm100(c.hormones.excitement), curve: linear(0.4, 1) },
    ],
  },
  {
    id: "sniff",
    baseWeight: 0.5,
    recovery: { playfulness: -5 },
    considerations: [{ id: "curious", input: (c) => c.temperament.energy, curve: linear(0.1, 1) }],
  },
  {
    id: "bark",
    baseWeight: 0.6,
    vocalize: true,
    recovery: { playfulness: -3 },
    considerations: [
      { id: "vocal", input: (c) => c.temperament.vocality, curve: linear(0.3, 1) },
      { id: "excited", input: (c) => norm100(c.hormones.excitement), curve: linear(0.5, 1) },
    ],
  },
];

/** Build starting per-action weights from temperament (§4.5 personality weights). */
export function weightsFromTemperament(t: Temperament): Record<ActionId, number> {
  const w: Record<ActionId, number> = {
    idle: 0.15,
    eat: 1 + t.foodMotivation * 0.5,
    drink: 1,
    nap: 1 + (1 - t.energy) * 0.4,
    fetch: 0.6 + t.energy * 0.8,
    dig: 0.5 + t.energy * 0.4,
    greet: 0.4 + t.sociability * 0.8,
    roll: 0.4 + t.energy * 0.3,
    sniff: 0.4 + t.energy * 0.3,
    bark: 0.3 + t.vocality * 0.9,
  };
  return w;
}

/** Look up an action def by id. */
export function actionById(id: ActionId): ActionDef | undefined {
  return ACTIONS.find((a) => a.id === id);
}

/** Make a fresh stimulus (used by the stage when the player throws a ball, etc.). */
export function makeStimulus(
  id: string,
  action: ActionId,
  now: number,
  playerInteracted = true
): Stimulus {
  return { id, action, createdAt: now, playerInteracted };
}

export const ALL_DRIVE_IDS: DriveId[] = [
  "hunger",
  "thirst",
  "tiredness",
  "playfulness",
  "happiness",
];
