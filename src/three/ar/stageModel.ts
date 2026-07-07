/**
 * src/three/ar/stageModel.ts — AR_PET_SIM_SPEC §6 / AR4
 * Pure model-URL selection for the AR stage: prefer the mobile-budget LOD, then
 * the full rigged GLB, then the avatar's legacy model. Keeps ARPetStage dumb and
 * this decision unit-tested.
 */

export interface StageModelSources {
  lodGlbUrl?: string | null;
  riggedGlbUrl?: string | null;
  fallbackUrl?: string | null;
}

/** First non-empty of: LOD → rigged → fallback. Returns "" if none. */
export function chooseStageModelUrl(s: StageModelSources): string {
  return s.lodGlbUrl || s.riggedGlbUrl || s.fallbackUrl || "";
}

/** True when the pet has a rig-pipeline GLB (so IK/clip retarget applies). */
export function hasRiggedModel(s: StageModelSources): boolean {
  return !!(s.lodGlbUrl || s.riggedGlbUrl);
}
