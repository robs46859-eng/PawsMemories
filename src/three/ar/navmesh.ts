/**
 * src/three/ar/navmesh.ts — AR_PET_SIM_SPEC §6.4
 * Semantic zones → 2D navmesh cost regions + zone behaviors.
 *
 * TODO(AR6): project scan polygons to the floor plane using camera pose; build cost
 * grid; expose nearest-walkable + path query for the BT pathfind leaf. Vegetation = ∞
 * (obstacle). Zone behaviors: dig/roll on grass, drink at water, jump-rest on seating
 * if tired, perimeter-sniff vegetation.
 */

export type ZoneClass =
  | "natural_ground"
  | "artificial_ground"
  | "water"
  | "seating"
  | "vegetation"
  | "obstacle";

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
