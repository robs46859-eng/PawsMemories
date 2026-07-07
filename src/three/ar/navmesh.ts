/**
 * src/three/ar/navmesh.ts — AR_PET_SIM_SPEC §6.4
 * Semantic zones → 2D navmesh cost regions + zone behaviors.
 *
 * Zones arrive from the semantic scan as polygons (server projects them onto the
 * floor plane; here they are 2D floor-space polygons). This module answers the
 * queries the BT pathfind + behavior leaves need: cost at a point, walkability,
 * and which zone behavior a point triggers. Pure + unit-tested.
 */

export type ZoneClass =
  | "natural_ground"
  | "artificial_ground"
  | "water"
  | "seating"
  | "vegetation"
  | "obstacle";

/** A floor-space polygon with its semantic class. */
export interface NavZone {
  cls: ZoneClass;
  /** Polygon points as [x, y] pairs (floor plane; y is the 2nd ground axis). */
  points: [number, number][];
}

/** The doc's exact cost table (§6.4). Infinity = un-walkable. */
export const ZONE_COST: Record<ZoneClass, number> = {
  natural_ground: 1.0, // grass
  artificial_ground: 1.2,
  water: 5.0,
  seating: 2.5,
  vegetation: Infinity,
  obstacle: Infinity,
};

export const ZONE_BEHAVIOR: Partial<Record<ZoneClass, string>> = {
  natural_ground: "dig|roll",
  water: "drink",
  seating: "rest-if-tired",
  vegetation: "perimeter-sniff",
};

export function costFor(cls: ZoneClass): number {
  return ZONE_COST[cls];
}

/** Ray-casting point-in-polygon test. Pure. */
export function pointInPolygon(p: [number, number], poly: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    const intersects = yi > p[1] !== yj > p[1] &&
      p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi + 0) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

/**
 * Cost at a floor point: the MAX cost among zones containing it (so an obstacle
 * zone dominates a ground zone), or 1.0 (free ground) if no zone contains it.
 */
export function costAtPoint(zones: NavZone[], p: [number, number]): number {
  let cost = 1.0;
  for (const z of zones) {
    if (pointInPolygon(p, z.points)) cost = Math.max(cost, ZONE_COST[z.cls]);
  }
  return cost;
}

/** A point is walkable if its cost is finite (vegetation/obstacle = Infinity). */
export function isWalkable(zones: NavZone[], p: [number, number]): boolean {
  return Number.isFinite(costAtPoint(zones, p));
}

/** The behavior a point triggers (first containing zone with a behavior), or null. */
export function behaviorAtPoint(zones: NavZone[], p: [number, number]): string | null {
  for (const z of zones) {
    if (pointInPolygon(p, z.points) && ZONE_BEHAVIOR[z.cls]) return ZONE_BEHAVIOR[z.cls]!;
  }
  return null;
}

/** Furniture-ish zones used by the iOS occlusion-fade heuristic (§6.2). */
export const FURNITURE_CLASSES: ZoneClass[] = ["seating", "obstacle"];

/**
 * Whether the segment from→to crosses any zone of one of `classes` (sampled).
 * Used by the iOS depth fallback: fade the pet when its path passes "behind"
 * furniture. Pure + unit-tested.
 */
export function pathCrossesClass(
  zones: NavZone[],
  from: [number, number],
  to: [number, number],
  classes: ZoneClass[] = FURNITURE_CLASSES,
  samples = 8
): boolean {
  const relevant = zones.filter((z) => classes.includes(z.cls));
  if (!relevant.length) return false;
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const p: [number, number] = [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t];
    if (relevant.some((z) => pointInPolygon(p, z.points))) return true;
  }
  return false;
}
