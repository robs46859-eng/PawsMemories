/**
 * src/three/ar/trials/agility.ts — AR_PET_SIM_SPEC §7.4
 * Agility course: prefab obstacle set on the floor; guided touch cues steer the pet
 * over jumps; scored by time + compliance. Pure scoring (tested); placement is glue.
 */

export interface Obstacle {
  kind: "jump" | "weave" | "tunnel";
  anchor: { x: number; z: number };
}

/** A simple straight-line prefab course of N obstacles spaced `spacing` meters. */
export function prefabCourse(count = 5, spacing = 1.2): Obstacle[] {
  const kinds: Obstacle["kind"][] = ["jump", "weave", "tunnel"];
  const out: Obstacle[] = [];
  for (let i = 0; i < count; i++) {
    out.push({ kind: kinds[i % kinds.length], anchor: { x: 0, z: (i + 1) * spacing } });
  }
  return out;
}

export interface AgilityScore {
  timeSeconds: number;
  compliance: number; // 0..1
  points: number;
}

/**
 * Score a run: faster + more compliant = more points. Baseline 100 for a par time,
 * scaled by compliance, with a time bonus/penalty around `parSeconds`. Never negative.
 */
export function scoreRun(
  timeSeconds: number,
  compliance: number,
  parSeconds = 20
): AgilityScore {
  const c = Math.max(0, Math.min(1, compliance));
  const timeFactor = Math.max(0.25, Math.min(2, parSeconds / Math.max(1, timeSeconds)));
  const points = Math.round(100 * c * timeFactor);
  return { timeSeconds, compliance: c, points };
}
