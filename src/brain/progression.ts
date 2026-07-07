/**
 * src/brain/progression.ts — AR_PET_SIM_SPEC §4.7
 * Dual-loop progression. Inner loop: daily care → trainer points. Outer loop:
 * points + credits unlock decor/toys/trials/pets (unlock gating lives in pacing.ts).
 * Pure; the server persists trainer_score and awards credits via the ledger.
 */

export type CareAction = "feed" | "water" | "groom" | "play";
export type TrialType = "disc" | "agility";

/** Trainer points earned per inner-loop care action. */
export const CARE_POINTS: Record<CareAction, number> = {
  feed: 3,
  water: 2,
  groom: 4,
  play: 5,
};

export function pointsForCare(action: CareAction): number {
  return CARE_POINTS[action] ?? 0;
}

/**
 * Trainer points from a trial result. Disc: points per catch; Agility: the run
 * score scaled down. Bounded so a single trial can't spike progression.
 */
export function pointsForTrial(
  type: TrialType,
  result: { catches?: number; score?: number }
): number {
  if (type === "disc") return Math.max(0, Math.min(50, (result.catches ?? 0) * 5));
  if (type === "agility") return Math.max(0, Math.min(50, Math.round((result.score ?? 0) / 4)));
  return 0;
}

/** Outer-loop conversion: credits awarded for trainer points earned this event. */
export function creditsFromPoints(points: number, ratePer10 = 1): number {
  return Math.floor(Math.max(0, points) / 10) * ratePer10;
}
