/**
 * Prefab structural components for the Scaled BIM Builder.
 *
 * Each prefab emits fully-related BimElements (walls host openings, openings
 * host doors/windows) so every insert passes `validateBimModel` on its own.
 * All dimensions are meters and snapped to the caller's grid increment.
 */
import { snap, type BimElement, type BimElementType } from "./model";

export interface BimPrefab {
  id: string;
  label: string;
  description: string;
  /** Rough footprint (x-extent, y-extent) used to auto-offset repeated inserts. */
  footprint: [number, number];
  build: (levelId: string, origin: [number, number], increment: number) => BimElement[];
}

const WALL_HEIGHT = 2.7;
const WALL_THICKNESS = 0.2;

function uid(type: BimElementType): string {
  return `${type}-${crypto.randomUUID()}`;
}

interface WallSpec { name: string; from: [number, number]; to: [number, number]; height?: number; thickness?: number }

function makeWall(levelId: string, inc: number, spec: WallSpec): BimElement {
  return {
    id: uid("wall"), type: "wall", name: spec.name, levelId,
    position: [snap(spec.from[0], inc), snap(spec.from[1], inc), 0],
    end: [snap(spec.to[0], inc), snap(spec.to[1], inc)],
    height: spec.height ?? WALL_HEIGHT, thickness: spec.thickness ?? WALL_THICKNESS,
  };
}

function makeOpeningWithFilling(
  levelId: string, inc: number, host: BimElement, filling: "door" | "window",
  name: string, at: [number, number], width: number, height: number, sill = 0,
): BimElement[] {
  const opening: BimElement = {
    id: uid("opening"), type: "opening", name: `${name} opening`, levelId,
    position: [snap(at[0], inc), snap(at[1], inc), sill],
    width, depth: host.thickness ?? WALL_THICKNESS, height, hostId: host.id,
  };
  const fill: BimElement = {
    id: uid(filling), type: filling, name, levelId,
    position: [...opening.position] as [number, number, number],
    width, depth: 0.06, height, openingId: opening.id,
  };
  return [opening, fill];
}

function makeSlab(levelId: string, inc: number, name: string, type: "slab" | "roof", origin: [number, number], width: number, depth: number, z: number): BimElement {
  return {
    id: uid(type), type, name, levelId,
    position: [snap(origin[0], inc), snap(origin[1], inc), z],
    width, depth, height: 0.2,
  };
}

function makeSpace(levelId: string, inc: number, name: string, origin: [number, number], width: number, depth: number, height = WALL_HEIGHT): BimElement {
  return {
    id: uid("space"), type: "space", name, levelId,
    position: [snap(origin[0], inc), snap(origin[1], inc), 0],
    width, depth, height,
    properties: { RoomName: name },
  };
}

export const BIM_PREFABS: BimPrefab[] = [
  {
    id: "partition",
    label: "Partition wall",
    description: "3 m interior wall, 2.7 m high",
    footprint: [3, 0.2],
    build: (levelId, [ox, oy], inc) => [
      makeWall(levelId, inc, { name: "Partition wall", from: [ox, oy], to: [ox + 3, oy] }),
    ],
  },
  {
    id: "doorway",
    label: "Doorway wall",
    description: "3 m wall with hosted 0.9 × 2.1 m door",
    footprint: [3, 0.2],
    build: (levelId, [ox, oy], inc) => {
      const wall = makeWall(levelId, inc, { name: "Doorway wall", from: [ox, oy], to: [ox + 3, oy] });
      return [wall, ...makeOpeningWithFilling(levelId, inc, wall, "door", "Door", [ox + 1, oy], 0.9, 2.1)];
    },
  },
  {
    id: "window-bay",
    label: "Window wall",
    description: "3 m wall with hosted 1.4 × 1.2 m window at 0.9 m sill",
    footprint: [3, 0.2],
    build: (levelId, [ox, oy], inc) => {
      const wall = makeWall(levelId, inc, { name: "Window wall", from: [ox, oy], to: [ox + 3, oy] });
      return [wall, ...makeOpeningWithFilling(levelId, inc, wall, "window", "Window", [ox + 0.8, oy], 1.4, 1.2, 0.9)];
    },
  },
  {
    id: "room-shell",
    label: "Room shell 4 × 3",
    description: "Floor slab and four perimeter walls",
    footprint: [4.4, 3.4],
    build: (levelId, [ox, oy], inc) => [
      makeSlab(levelId, inc, "Room slab", "slab", [ox - 0.2, oy - 0.2], 4.4, 3.4, -0.2),
      makeWall(levelId, inc, { name: "Room wall S", from: [ox, oy], to: [ox + 4, oy] }),
      makeWall(levelId, inc, { name: "Room wall E", from: [ox + 4, oy], to: [ox + 4, oy + 3] }),
      makeWall(levelId, inc, { name: "Room wall N", from: [ox + 4, oy + 3], to: [ox, oy + 3] }),
      makeWall(levelId, inc, { name: "Room wall W", from: [ox, oy + 3], to: [ox, oy] }),
      makeSpace(levelId, inc, "Room", [ox + 0.2, oy + 0.2], 3.6, 2.6),
    ],
  },
  {
    id: "post-and-beam",
    label: "Post & beam",
    description: "Two 0.3 m columns carrying a 4 m beam",
    footprint: [4, 0.3],
    build: (levelId, [ox, oy], inc) => [
      { id: uid("column"), type: "column", name: "Column A", levelId, position: [snap(ox, inc), snap(oy, inc), 0], width: 0.3, depth: 0.3, height: WALL_HEIGHT },
      { id: uid("column"), type: "column", name: "Column B", levelId, position: [snap(ox + 3.7, inc), snap(oy, inc), 0], width: 0.3, depth: 0.3, height: WALL_HEIGHT },
      { id: uid("beam"), type: "beam", name: "Beam", levelId, position: [snap(ox, inc), snap(oy, inc), WALL_HEIGHT], width: 4, depth: 0.3, height: 0.3 },
    ],
  },
  {
    id: "studio-apartment",
    label: "Studio apartment",
    description: "6 × 4 m studio: slab, roof, perimeter + bathroom walls, entry & bath doors, two windows, kitchenette, spaces",
    footprint: [6.4, 4.4],
    build: (levelId, [ox, oy], inc) => {
      const south = makeWall(levelId, inc, { name: "Studio wall S (entry)", from: [ox, oy], to: [ox + 6, oy] });
      const east = makeWall(levelId, inc, { name: "Studio wall E", from: [ox + 6, oy], to: [ox + 6, oy + 4] });
      const north = makeWall(levelId, inc, { name: "Studio wall N", from: [ox + 6, oy + 4], to: [ox, oy + 4] });
      const west = makeWall(levelId, inc, { name: "Studio wall W", from: [ox, oy + 4], to: [ox, oy] });
      const bathSouth = makeWall(levelId, inc, { name: "Bathroom wall S", from: [ox, oy + 2.6], to: [ox + 2.2, oy + 2.6] });
      const bathEast = makeWall(levelId, inc, { name: "Bathroom wall E", from: [ox + 2.2, oy + 2.6], to: [ox + 2.2, oy + 4] });
      return [
        makeSlab(levelId, inc, "Studio floor slab", "slab", [ox - 0.2, oy - 0.2], 6.4, 4.4, -0.2),
        makeSlab(levelId, inc, "Studio roof", "roof", [ox - 0.2, oy - 0.2], 6.4, 4.4, WALL_HEIGHT),
        south, east, north, west, bathSouth, bathEast,
        ...makeOpeningWithFilling(levelId, inc, south, "door", "Entry door", [ox + 0.7, oy], 0.9, 2.1),
        ...makeOpeningWithFilling(levelId, inc, bathSouth, "door", "Bathroom door", [ox + 1.2, oy + 2.6], 0.8, 2.1),
        ...makeOpeningWithFilling(levelId, inc, north, "window", "Living window", [ox + 3.6, oy + 4], 1.4, 1.2, 0.9),
        ...makeOpeningWithFilling(levelId, inc, east, "window", "Kitchen window", [ox + 6, oy + 1.4], 1.2, 1.2, 0.9),
        { id: uid("beam"), type: "beam", name: "Kitchenette counter", levelId, position: [snap(ox + 3.2, inc), snap(oy + 0.2, inc), 0], width: 2.6, depth: 0.6, height: 0.9 },
        makeSpace(levelId, inc, "Studio", [ox + 0.2, oy + 0.2], 5.6, 3.6),
        makeSpace(levelId, inc, "Bathroom", [ox + 0.2, oy + 2.8], 1.8, 1.0),
      ];
    },
  },
];

/** Pick an insert origin that keeps a new prefab clear of existing elements. */
export function prefabInsertOrigin(elements: BimElement[]): [number, number] {
  let maxX = Number.NEGATIVE_INFINITY;
  for (const item of elements) {
    if (!Array.isArray(item.position)) continue;
    maxX = Math.max(maxX, item.position[0] + (item.width || 0), item.end ? item.end[0] : Number.NEGATIVE_INFINITY);
  }
  return Number.isFinite(maxX) ? [Math.ceil(maxX) + 1, 0] : [0, 0];
}
