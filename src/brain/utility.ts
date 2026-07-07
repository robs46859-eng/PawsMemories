/**
 * src/brain/utility.ts
 * Utility scorer — exactly the doc's formula (AR_PET_SIM_SPEC §4.1):
 *   U_a = w_a · Π C_i(x_i)^{p_i}
 * plus fuzzy noise U'_a = U_a · (1 + rand(-0.08,+0.08)) and a re-select throttle.
 */

import { ActionDef, ActionId, BrainContext, Consideration } from "./types";
import { clamp01 } from "./considerations";

/** Deterministic RNG so tests can pin noise. `rand()` returns [0,1). */
export type Rng = () => number;

/** mulberry32 — small, fast, seedable PRNG for reproducible noise. */
export function makeRng(seed: number): Rng {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const FUZZ = 0.08;

/** Evaluate one consideration to [0,1] raised to its exponent. */
export function evalConsideration(c: Consideration, ctx: BrainContext): number {
  const raw = c.input(ctx);
  const shaped = clamp01(c.curve(raw));
  const p = c.exponent ?? 1;
  return Math.pow(shaped, p);
}

/** Raw (noise-free) utility U_a for one action. */
export function scoreAction(
  action: ActionDef,
  weight: number,
  ctx: BrainContext
): number {
  let product = 1;
  for (const c of action.considerations) {
    product *= evalConsideration(c, ctx);
    if (product === 0) break; // any zero consideration kills the action (a veto)
  }
  return weight * product;
}

export interface ScoredAction {
  id: ActionId;
  utility: number;
}

/**
 * Score every action, apply fuzzy noise, and return sorted desc.
 * `weights` are the current per-action personality weights (§4.5).
 * Pass an rng with fixed seed (or a `() => 0.5` no-noise stub) for deterministic tests.
 */
export function selectAction(
  actions: ActionDef[],
  weights: Record<ActionId, number>,
  ctx: BrainContext,
  rng: Rng
): ScoredAction[] {
  const scored: ScoredAction[] = actions.map((a) => {
    const base = scoreAction(a, weights[a.id] ?? a.baseWeight, ctx);
    const noise = 1 + (rng() * 2 - 1) * FUZZ; // (1 + rand(-0.08,+0.08))
    return { id: a.id, utility: base * noise };
  });
  scored.sort((x, y) => y.utility - x.utility);
  return scored;
}

/** Re-select throttle: at most every 1.5s unless an event forces it (§4.1). */
export const RESELECT_INTERVAL_MS = 1500;

export function shouldReselect(
  lastDecisionAt: number,
  now: number,
  eventForced = false
): boolean {
  return eventForced || now - lastDecisionAt >= RESELECT_INTERVAL_MS;
}
