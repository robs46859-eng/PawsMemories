/**
 * server/rigBudget.ts — AR_PET_SIM_SPEC §3.1 / §3.3
 * Pure interpreter of the blender-worker bake-lod stats. No I/O, so the app can
 * unit-test the budget + retarget-fallback decisions without Blender.
 */

export const BUDGET = {
  maxTris: 30_000,
  maxBones: 40,
  maxBytes: 4 * 1024 * 1024,
} as const;

/** Shape returned by bake_lod.py's BAKE_RESULT line. */
export interface BakeStats {
  tris: number;
  bones: number;
  bytes: number;
  retarget_confidence: number;
  leg_chains_ok: boolean;
  missing_bones?: string[];
  missing_leg_bones?: string[];
  within_budget?: boolean;
}

export interface BudgetVerdict {
  ok: boolean;
  reasons: string[];
}

/** Check a bake result against the hard budget. */
export function checkBudget(stats: BakeStats): BudgetVerdict {
  const reasons: string[] = [];
  if (stats.tris > BUDGET.maxTris) reasons.push(`tris ${stats.tris} > ${BUDGET.maxTris}`);
  if (stats.bones > BUDGET.maxBones) reasons.push(`bones ${stats.bones} > ${BUDGET.maxBones}`);
  if (stats.bytes > BUDGET.maxBytes) reasons.push(`bytes ${stats.bytes} > ${BUDGET.maxBytes}`);
  return { ok: reasons.length === 0, reasons };
}

/**
 * Whether we should fall back to Tripo preset animations instead of retargeting
 * the 15 clips: retarget confidence below threshold, or a leg chain is missing
 * (spec §3.1). `threshold` mirrors bonemap.json confidenceThreshold.
 */
export function needsRetargetFallback(stats: BakeStats, threshold = 0.7): boolean {
  return !stats.leg_chains_ok || stats.retarget_confidence < threshold;
}
