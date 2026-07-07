/**
 * src/three/ar/ik.ts — AR_PET_SIM_SPEC §6.5
 * CCDIKSolver on 4 leg chains + head look-at; paw raycast grounding.
 *
 * TODO(AR4): build CCDIKSolver chains from the canonical bone map (leg.FL/FR/BL/BR),
 * raycast each paw to the AR plane/mesh, adjust pelvis height, clamp max slope,
 * head look-at target = user camera or active object.
 */

export const LEG_CHAINS = ["leg.FL", "leg.FR", "leg.BL", "leg.BR"] as const;
export type LegChain = (typeof LEG_CHAINS)[number];

export const MAX_SLOPE_RAD = 0.6;

export interface IKConfig {
  chains: readonly LegChain[];
  maxSlopeRad: number;
}

export const DEFAULT_IK_CONFIG: IKConfig = {
  chains: LEG_CHAINS,
  maxSlopeRad: MAX_SLOPE_RAD,
};

// TODO(AR4): export setupLegIK(model, floor) and solveIK(dt).
