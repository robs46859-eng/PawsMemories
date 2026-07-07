/**
 * src/brain/hormones.ts
 * Three slow global scalars with exponential return-to-baseline (AR_PET_SIM_SPEC §4.2).
 * They multiply into consideration curves (e.g. high stress flattens compliance).
 */

import { Hormones, HormoneId } from "./types";

/** Resting baselines each hormone drifts back toward. */
export const BASELINE: Hormones = {
  excitement: 20,
  stress: 10,
  affection: 40,
};

/** Return-to-baseline time constants (seconds). Larger = slower. */
export const TAU: Record<HormoneId, number> = {
  excitement: 30,
  stress: 60,
  affection: 120,
};

export const DEFAULT_HORMONES: Hormones = { ...BASELINE };

function clamp100(v: number): number {
  return v < 0 ? 0 : v > 100 ? 100 : v;
}

/** Exponentially relax each hormone toward its baseline over `dtSeconds`. */
export function relaxHormones(h: Hormones, dtSeconds: number): Hormones {
  const out: Hormones = { ...h };
  (Object.keys(BASELINE) as HormoneId[]).forEach((k) => {
    const decay = Math.exp(-dtSeconds / TAU[k]);
    out[k] = clamp100(BASELINE[k] + (out[k] - BASELINE[k]) * decay);
  });
  return out;
}

/** Event bumps: play → +excitement/+affection; scold → +stress; neglect → -affection. */
export type HormoneEvent = "play" | "scold" | "neglect" | "pet" | "feed";

const EVENT_DELTAS: Record<HormoneEvent, Partial<Hormones>> = {
  play: { excitement: +25, affection: +10, stress: -8 },
  pet: { affection: +15, stress: -12, excitement: +5 },
  feed: { affection: +8, stress: -5 },
  scold: { stress: +30, affection: -10, excitement: -10 },
  neglect: { affection: -12, stress: +8 },
};

export function applyHormoneEvent(h: Hormones, event: HormoneEvent): Hormones {
  const out: Hormones = { ...h };
  const delta = EVENT_DELTAS[event];
  (Object.keys(delta) as HormoneId[]).forEach((k) => {
    out[k] = clamp100(out[k] + (delta[k] as number));
  });
  return out;
}

/** Compliance modifier from stress: high stress → lower compliance (§4.2). Returns [0,1]. */
export function stressComplianceModifier(h: Hormones): number {
  // 0 stress → 1.0; 100 stress → ~0.4
  return clamp100(100 - h.stress * 0.6) / 100;
}
