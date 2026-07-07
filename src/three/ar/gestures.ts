/**
 * src/three/ar/gestures.ts — AR_PET_SIM_SPEC §7.1
 * Pointer-events on the pet raycast hit → stroke | slap | tap by velocity+duration.
 * Delegates classification to the pure brain (reinforcement.classifyGesture).
 *
 * TODO(AR5): wire pointer sampling on the AR canvas; feed classified gesture into
 * reinforceWeight / reinforceCompliance and emit the matching hormone event.
 */

import { classifyGesture, type Gesture } from "../../brain/reinforcement";

export interface PointerSample {
  t: number; // ms
  x: number;
  y: number;
}

/** Reduce a pointer stroke to (durationMs, peakVelocity) then classify. */
export function classifyPointerStroke(samples: PointerSample[]): Gesture {
  if (samples.length < 2) return "tap";
  const durationMs = samples[samples.length - 1].t - samples[0].t;
  let peak = 0;
  for (let i = 1; i < samples.length; i++) {
    const dt = Math.max(1, samples[i].t - samples[i - 1].t);
    const dx = samples[i].x - samples[i - 1].x;
    const dy = samples[i].y - samples[i - 1].y;
    const v = Math.hypot(dx, dy) / dt; // units/ms
    if (v > peak) peak = v;
  }
  return classifyGesture(durationMs, peak * 1000); // → units/sec to match classifier scale
}
