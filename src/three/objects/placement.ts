import { PetObjectKind, PlacedObject } from "../../types";
import { useAvatarScene } from "../store";
import { OBJECT_CATALOG } from "./catalog";
import { createPlacedObject, deletePlacedObject } from "../../api";

function newObjectId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `obj_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }
}

/**
 * Place an object for an avatar: computes a non-overlapping spot (golden-angle
 * spiral), optimistically adds it to the shared store, and persists it.
 * Shared by the in-app 3D view and both AR paths.
 */
export function addObjectForAvatar(avatarId: number, kind: PetObjectKind): PlacedObject {
  const count = useAvatarScene.getState().placedObjects.length;
  const angle = count * 2.399963;
  const r = 1.2 + (count % 3) * 0.35;
  const obj: PlacedObject = {
    id: newObjectId(),
    kind,
    position: [Math.cos(angle) * r, 0, Math.sin(angle) * r],
    rotationY: Math.random() * Math.PI * 2,
    scale: OBJECT_CATALOG[kind]?.baseScale ?? 1,
    createdAt: new Date().toISOString(),
  };
  useAvatarScene.getState().addPlacedObject(obj); // optimistic
  createPlacedObject(avatarId, obj).catch(() => {});
  return obj;
}

/**
 * Place an object at an explicit position (used by AR tap-to-place, where the
 * position comes from a real-world surface hit-test).
 */
export function addObjectAtPosition(
  avatarId: number,
  kind: PetObjectKind,
  position: [number, number, number]
): PlacedObject {
  const obj: PlacedObject = {
    id: newObjectId(),
    kind,
    position,
    rotationY: Math.random() * Math.PI * 2,
    scale: OBJECT_CATALOG[kind]?.baseScale ?? 1,
    createdAt: new Date().toISOString(),
  };
  useAvatarScene.getState().addPlacedObject(obj); // optimistic
  createPlacedObject(avatarId, obj).catch(() => {});
  return obj;
}

/** Remove a placed object everywhere (store + server). */
export function removeObjectForAvatar(avatarId: number, id: string): void {
  useAvatarScene.getState().removePlacedObject(id); // optimistic
  deletePlacedObject(avatarId, id).catch(() => {});
}
