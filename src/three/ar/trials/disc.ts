/**
 * src/three/ar/trials/disc.ts — AR_PET_SIM_SPEC §7.4
 * Disc-throwing trial: AR throw (swipe vector) → ballistic arc → catch check =
 * mouthHitbox (breed) ∩ disc path.
 *
 * TODO(AR8): swipe→velocity vector; integrate ballistic arc; catch test against
 * breed mouthHitbox radius; larger breeds = faster run speed, smaller = tighter turn
 * radius (pull constants from breedProfiles); award trainer points + credits.
 */

export interface ThrowVector {
  vx: number;
  vy: number;
  vz: number;
}

export const GRAVITY = -9.81;

// TODO(AR8): simulateArc(throw, dt), catchCheck(discPos, mouthPos, mouthHitbox).
export {};
