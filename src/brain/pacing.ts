/**
 * src/brain/pacing.ts
 * Adaptive-pacing / AI-storyteller rule (AR_PET_SIM_SPEC §4.7).
 * Neglect penalties disabled until trainer score > S1; mechanics unlock in a
 * fixed order gated by score so complexity ramps with familiarity.
 * All thresholds live here in one tunable config.
 */

export interface PacingConfig {
  /** Below this trainer score, neglect penalties are off. */
  neglectPenaltyThreshold: number; // S1
  /** Ordered mechanic unlocks: score at which each becomes available. */
  unlocks: {
    voiceTraining: number;
    spatialButtons: number;
    discTrial: number;
    agilityCourse: number;
    extraPet: number;
  };
}

export const DEFAULT_PACING: PacingConfig = {
  neglectPenaltyThreshold: 50,
  unlocks: {
    voiceTraining: 20,
    spatialButtons: 60,
    discTrial: 100,
    agilityCourse: 160,
    extraPet: 240,
  },
};

export type MechanicId = keyof PacingConfig["unlocks"];

/** Whether neglect penalties should apply at the given trainer score. */
export function neglectEnabled(score: number, cfg: PacingConfig = DEFAULT_PACING): boolean {
  return score > cfg.neglectPenaltyThreshold;
}

/** Whether a mechanic is unlocked at the given trainer score. */
export function isUnlocked(
  mechanic: MechanicId,
  score: number,
  cfg: PacingConfig = DEFAULT_PACING
): boolean {
  return score >= cfg.unlocks[mechanic];
}

/** All mechanics unlocked so far, in unlock order. */
export function unlockedMechanics(
  score: number,
  cfg: PacingConfig = DEFAULT_PACING
): MechanicId[] {
  return (Object.keys(cfg.unlocks) as MechanicId[])
    .filter((m) => isUnlocked(m, score, cfg))
    .sort((a, b) => cfg.unlocks[a] - cfg.unlocks[b]);
}
