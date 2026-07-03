import { create } from "zustand";
import { AvatarNeeds, BehaviorAction, PlacedObject, AvatarCommand } from "../types";

export interface Vec2 {
  x: number;
  z: number;
}

/**
 * Shared state for the active living-avatar 3D view. Singleton: the living
 * view shows ONE avatar full-screen at a time, so a single store is fine.
 * (If we ever render several living avatars at once we'd make this per-avatar.)
 */
interface AvatarSceneState {
  needs: AvatarNeeds;
  action: BehaviorAction;
  /** World-space target the avatar walks toward (XZ plane). */
  target: Vec2;
  /** Avatar's current world position (XZ), written by the scene each frame. */
  position: Vec2;
  /** Current heading in radians (Y axis). */
  facing: number;
  commandQueue: AvatarCommand[];
  placedObjects: PlacedObject[];
  /** Transient speech/emote bubble text, or null. */
  speech: string | null;

  setNeeds: (n: Partial<AvatarNeeds>) => void;
  replaceNeeds: (n: AvatarNeeds) => void;
  setAction: (a: BehaviorAction) => void;
  setTarget: (t: Vec2) => void;
  setPosition: (p: Vec2) => void;
  setFacing: (f: number) => void;
  enqueueCommand: (c: AvatarCommand) => void;
  dequeueCommand: () => AvatarCommand | undefined;
  clearCommands: () => void;
  setPlacedObjects: (o: PlacedObject[]) => void;
  addPlacedObject: (o: PlacedObject) => void;
  removePlacedObject: (id: string) => void;
  say: (msg: string | null) => void;
}

export const DEFAULT_NEEDS: AvatarNeeds = {
  food: 80,
  water: 80,
  energy: 90,
  bladder: 20,
  bowel: 15,
  happiness: 85,
  lastSeen: new Date().toISOString(),
};

export const useAvatarScene = create<AvatarSceneState>((set, get) => ({
  needs: DEFAULT_NEEDS,
  action: "idle",
  target: { x: 0, z: 0 },
  position: { x: 0, z: 0 },
  facing: 0,
  commandQueue: [],
  placedObjects: [],
  speech: null,

  setNeeds: (n) => set((s) => ({ needs: { ...s.needs, ...n } })),
  replaceNeeds: (n) => set({ needs: n }),
  setAction: (a) => set({ action: a }),
  setTarget: (t) => set({ target: t }),
  setPosition: (p) => set({ position: p }),
  setFacing: (f) => set({ facing: f }),
  enqueueCommand: (c) => set((s) => ({ commandQueue: [...s.commandQueue, c] })),
  dequeueCommand: () => {
    const q = get().commandQueue;
    if (!q.length) return undefined;
    const [head, ...rest] = q;
    set({ commandQueue: rest });
    return head;
  },
  clearCommands: () => set({ commandQueue: [] }),
  setPlacedObjects: (o) => set({ placedObjects: o }),
  addPlacedObject: (o) => set((s) => ({ placedObjects: [...s.placedObjects, o] })),
  removePlacedObject: (id) =>
    set((s) => ({ placedObjects: s.placedObjects.filter((p) => p.id !== id) })),
  say: (msg) => set({ speech: msg }),
}));
