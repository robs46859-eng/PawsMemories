/**
 * src/three/ar/trials/agility.ts — AR_PET_SIM_SPEC §7.4
 * Agility course: prefab obstacle set placed on the floor; guided touch cues steer
 * over jumps; scored by time + compliance; awards trainer points + credits.
 *
 * TODO(AR8): place prefab obstacle set; touch-cue steering; scoring (time + compliance);
 * credits/ledger integration.
 */

export interface AgilityScore {
  timeSeconds: number;
  compliance: number; // 0..1
  points: number;
}

// TODO(AR8): placeCourse(), scoreRun().
export {};
