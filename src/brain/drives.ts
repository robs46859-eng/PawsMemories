/**
 * src/brain/drives.ts
 * Five drives + decay/recovery + breed modifiers (AR_PET_SIM_SPEC §4.2).
 */

import {
  Drives,
  DriveId,
  BreedModifiers,
  DEFAULT_BREED_MODIFIERS,
} from "./types";

/** Passive change per SECOND while awake and idle. Positive = grows toward urgent. */
export const DECAY_PER_SEC: Record<DriveId, number> = {
  hunger: +0.05,
  thirst: +0.07,
  tiredness: +0.04,
  playfulness: +0.03, // playfulness builds up (wants to play) when idle
  happiness: -0.02, // happiness gently fades without interaction
};

/** Thresholds that create override considerations (§4.2 extreme states). */
export const CRITICAL = {
  hunger: 90, // starving → may "eat" a real-world object
  thirst: 90, // very thirsty → seeks water zone
  tiredness: 90, // exhausted → nap
  happinessLow: 15,
} as const;

export const DEFAULT_DRIVES: Drives = {
  hunger: 20,
  thirst: 20,
  tiredness: 20,
  playfulness: 40,
  happiness: 70,
};

export function clamp100(v: number): number {
  return v < 0 ? 0 : v > 100 ? 100 : v;
}

/** Apply passive decay for `dtSeconds`, scaled by breed decay multipliers. */
export function decayDrives(
  drives: Drives,
  dtSeconds: number,
  breed: BreedModifiers = DEFAULT_BREED_MODIFIERS
): Drives {
  const out: Drives = { ...drives };
  (Object.keys(DECAY_PER_SEC) as DriveId[]).forEach((k) => {
    const mult = breed.decay[k] ?? 1;
    out[k] = clamp100(out[k] + DECAY_PER_SEC[k] * mult * dtSeconds);
  });
  return out;
}

/** Apply per-action recovery for `dtSeconds`. Recovery values are per-second deltas. */
export function recoverDrives(
  drives: Drives,
  recovery: Partial<Record<DriveId, number>> | undefined,
  dtSeconds: number
): Drives {
  if (!recovery) return { ...drives };
  const out: Drives = { ...drives };
  (Object.keys(recovery) as DriveId[]).forEach((k) => {
    out[k] = clamp100(out[k] + (recovery[k] as number) * dtSeconds);
  });
  return out;
}

/** Which drives are currently in a critical/override state. */
export function criticalDrives(drives: Drives): DriveId[] {
  const out: DriveId[] = [];
  if (drives.hunger >= CRITICAL.hunger) out.push("hunger");
  if (drives.thirst >= CRITICAL.thirst) out.push("thirst");
  if (drives.tiredness >= CRITICAL.tiredness) out.push("tiredness");
  if (drives.happiness <= CRITICAL.happinessLow) out.push("happiness");
  return out;
}
