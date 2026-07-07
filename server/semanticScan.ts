/**
 * server/semanticScan.ts — AR_PET_SIM_SPEC §6.4 / §8
 * POST /api/ar/semantic-scan — 1 camera frame → vision LLM → zone polygons.
 *
 * TODO(AR6):
 *  - Vision LLM returns screen-space polygons with classes:
 *    {natural_ground, artificial_ground, water, seating, vegetation, obstacle}.
 *  - Cache per anchor_hash in semantic_scans (H7: avoid repeat LLM cost).
 *  - Client projects polygons onto the floor plane → navmesh cost regions (navmesh.ts).
 */

export type ZoneClass =
  | "natural_ground"
  | "artificial_ground"
  | "water"
  | "seating"
  | "vegetation"
  | "obstacle";

export interface ZonePolygon {
  cls: ZoneClass;
  points: [number, number][]; // normalized screen space 0..1
}

export async function semanticScan(_frame: string, _anchorHash: string): Promise<ZonePolygon[]> {
  throw new Error("TODO(AR6): vision-LLM semantic scan + per-anchor cache");
}
