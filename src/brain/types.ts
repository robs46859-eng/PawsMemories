/**
 * src/brain/types.ts
 * Shared types for the Pawsome3D behavior engine (AR_PET_SIM_SPEC §4).
 *
 * IMPORTANT: this module tree is framework-agnostic. No React, three.js, or DOM
 * imports anywhere under src/brain/ — so an Option B Unity/C# client can port it
 * mechanically. Keep it that way.
 */

/** The five drives (0..100). Higher hunger/thirst/tiredness = more urgent;
 *  higher playfulness/happiness = better. */
export interface Drives {
  hunger: number;
  thirst: number;
  tiredness: number;
  playfulness: number;
  happiness: number;
}

export type DriveId = keyof Drives;

/** Three slow global hormone scalars (0..100), each with its own baseline. */
export interface Hormones {
  excitement: number;
  stress: number;
  affection: number;
}

export type HormoneId = keyof Hormones;

/** Temperament from breed classification (§3.2), each in [0,1]. Drives personality weights. */
export interface Temperament {
  energy: number;
  sociability: number;
  stubbornness: number;
  foodMotivation: number;
  vocality: number;
}

/** Per-breed multipliers applied to drive decay/recovery and gameplay (§3.2 breedProfiles). */
export interface BreedModifiers {
  /** Multipliers on passive decay rate, keyed by drive. Default 1.0 each. */
  decay: Partial<Record<DriveId, number>>;
  /** Extra exercise requirement multiplier (affects tiredness/playfulness coupling). */
  exerciseNeed: number;
  /** Base compliance rate for learned commands [0,1]. */
  complianceBase: number;
  /** Skeleton/render scale hint (not used by the brain math, carried for the stage). */
  scale: number;
}

export const DEFAULT_BREED_MODIFIERS: BreedModifiers = {
  decay: {},
  exerciseNeed: 1,
  complianceBase: 0.5,
  scale: 1,
};

/** Canonical action ids. These map to the 15 GLB clips downstream (AR5). */
export type ActionId =
  | "idle"
  | "eat"
  | "drink"
  | "nap"
  | "fetch"
  | "dig"
  | "greet"
  | "roll"
  | "sniff"
  | "bark";

/** A single consideration: read a value from context, shape it to [0,1] via `curve`,
 *  raised to `exponent` in the utility product (§4.1). */
export interface Consideration {
  id: string;
  /** Pull a raw scalar from the brain context (drives, hormones, stimuli, …). */
  input: (ctx: BrainContext) => number;
  /** Map the raw scalar to [0,1]. Use the curve library in considerations.ts. */
  curve: (x: number) => number;
  /** Sensitivity exponent p_i (default 1). */
  exponent?: number;
}

/** Definition of an action in the catalog (§4). */
export interface ActionDef {
  id: ActionId;
  /** Base personality weight w_a; further scaled by temperament at build time. */
  baseWeight: number;
  considerations: Consideration[];
  /** Drives recovered (negative = reduce urgency) when the action completes, per second. */
  recovery?: Partial<Record<DriveId, number>>;
  /** Optional vocalization emitted on execute. */
  vocalize?: boolean;
}

/** A transient stimulus in the world (e.g. a thrown ball) with a decaying bonus. */
export interface Stimulus {
  id: string;
  /** Action this stimulus biases toward. */
  action: ActionId;
  /** Time the stimulus was created (ms epoch). */
  createdAt: number;
  /** true = player-interacted (decaying bonus), false = ambient (flat low bonus). */
  playerInteracted: boolean;
}

/** Everything a consideration can read at tick time. */
export interface BrainContext {
  drives: Drives;
  hormones: Hormones;
  temperament: Temperament;
  stimuli: Stimulus[];
  /** ms epoch of the current tick. */
  now: number;
  /** Action id currently being executed (for stimulus decay / commanded boosts). */
  currentAction: ActionId | null;
  /** Optional command boost: action under an active voice command + its window end (ms). */
  commanded?: { action: ActionId; until: number } | null;
}

/** Serialisable brain state (persisted to pet_profiles, §8). */
export interface BrainState {
  drives: Drives;
  hormones: Hormones;
  /** Per-action personality weights w_a (§4.5). */
  weights: Record<ActionId, number>;
  /** ms epoch of last decision. */
  lastDecisionAt: number;
  currentAction: ActionId | null;
}

/** Events the brain emits for the render/interaction layers to consume (AR5). */
export type BrainEvent =
  | { type: "action-selected"; action: ActionId; utility: number }
  | { type: "action-completed"; action: ActionId }
  | { type: "vocalize"; action: ActionId }
  | { type: "drive-critical"; drive: DriveId };
