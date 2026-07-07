/**
 * src/three/ar/trials/disc.ts — AR_PET_SIM_SPEC §7.4
 * Disc-throwing trial: a swipe becomes a throw velocity; the disc follows a
 * ballistic arc; a catch happens when the disc passes within the pet's breed
 * mouth-hitbox radius of the pet along the path.
 *
 * Pure simulation + geometry (unit-tested); the AR swipe capture + rendering are
 * thin browser glue.
 */

export const GRAVITY = -9.81;

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface ThrowState {
  pos: Vec3;
  vel: Vec3;
}

/** Integrate one disc trajectory into a list of sampled points (until it lands). */
export function simulateArc(
  start: ThrowState,
  dt = 1 / 60,
  maxSteps = 600
): Vec3[] {
  const path: Vec3[] = [];
  let { x, y, z } = start.pos;
  let { x: vx, y: vy, z: vz } = start.vel;
  for (let i = 0; i < maxSteps; i++) {
    path.push({ x, y, z });
    vy += GRAVITY * dt;
    x += vx * dt;
    y += vy * dt;
    z += vz * dt;
    if (y <= 0 && i > 0) {
      path.push({ x, y: 0, z });
      break;
    }
  }
  return path;
}

/** Planar (XZ) distance between two points. */
export function planarDist(a: Vec3, b: { x: number; z: number }): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

export interface CatchResult {
  caught: boolean;
  /** Index into the path where the catch occurred, or -1. */
  atIndex: number;
}

/**
 * Catch check: the pet (at `mouthPos`, reachable within its run range) catches the
 * disc if any path sample comes within `mouthHitbox` (breed radius, meters) while
 * also being catchable height (y under ~1m). Larger breeds have bigger hitboxes.
 */
export function catchCheck(
  path: Vec3[],
  mouthPos: { x: number; z: number },
  mouthHitbox: number,
  maxCatchHeight = 1.0
): CatchResult {
  for (let i = 0; i < path.length; i++) {
    const p = path[i];
    if (p.y <= maxCatchHeight && planarDist(p, mouthPos) <= mouthHitbox) {
      return { caught: true, atIndex: i };
    }
  }
  return { caught: false, atIndex: -1 };
}

/** Breed-scaled run speed (m/s) and turn radius (m): bigger = faster, wider turns. */
export function breedAgility(scale: number): { runSpeed: number; turnRadius: number } {
  return {
    runSpeed: 2.0 * (0.7 + 0.6 * scale),
    turnRadius: 0.4 * scale,
  };
}
