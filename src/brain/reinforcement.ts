/**
 * src/brain/reinforcement.ts
 * Hebbian-lite reinforcement (AR_PET_SIM_SPEC §4.5).
 * Touch gestures reward/punish the current (or last) action:
 *   - adjust per-action weight w_a by ±0.05, clamped to [0.2, 2.0]
 *   - adjust per-command compliance probability, clamped to [0, 1]
 */

import { ActionId } from "./types";

export const WEIGHT_STEP = 0.05;
export const WEIGHT_MIN = 0.2;
export const WEIGHT_MAX = 2.0;

export const COMPLIANCE_STEP = 0.08;

export type Gesture = "stroke" | "slap" | "tap";

/** Classify a pointer gesture on the pet by velocity + duration (§7.1). */
export function classifyGesture(
  durationMs: number,
  peakVelocity: number
): Gesture {
  if (peakVelocity > 1.2 && durationMs < 250) return "slap"; // fast flick
  if (durationMs >= 400 && peakVelocity < 0.8) return "stroke"; // long slow drag
  return "tap"; // quick contact = get attention
}

function clampWeight(w: number): number {
  return w < WEIGHT_MIN ? WEIGHT_MIN : w > WEIGHT_MAX ? WEIGHT_MAX : w;
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** Apply a reward (stroke) or punish (slap) to the weight of `action`. */
export function reinforceWeight(
  weights: Record<ActionId, number>,
  action: ActionId,
  gesture: Gesture
): Record<ActionId, number> {
  if (gesture === "tap") return { ...weights }; // tap does not reinforce
  const dir = gesture === "stroke" ? +1 : -1;
  const cur = weights[action] ?? 1;
  return { ...weights, [action]: clampWeight(cur + dir * WEIGHT_STEP) };
}

/** Adjust a command's compliance probability from a reward/punish. */
export function reinforceCompliance(
  compliance: number,
  gesture: Gesture
): number {
  if (gesture === "tap") return clamp01(compliance);
  const dir = gesture === "stroke" ? +1 : -1;
  return clamp01(compliance + dir * COMPLIANCE_STEP);
}

/**
 * Forgetting: unreinforced commands lose compliance over days (§7.2).
 * `daysSince` days since last reinforcement; `rate` per-day decay toward baseline.
 */
export function decayCompliance(
  compliance: number,
  daysSince: number,
  baseline = 0.5,
  ratePerDay = 0.05
): number {
  if (daysSince <= 0) return clamp01(compliance);
  const decayed = baseline + (compliance - baseline) * Math.exp(-ratePerDay * daysSince);
  return clamp01(decayed);
}
