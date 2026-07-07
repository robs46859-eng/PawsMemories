/**
 * src/three/objects/utilityTags.ts — AR_PET_SIM_SPEC §4.3
 * Every catalog object gains utilityTags so considerations can query
 * "nearest object with tag X", and placed objects become ambient stimuli that
 * bias the brain's utility selection toward what's actually in the scene.
 */

import { PetObjectKind, PlacedObject } from "../../types";
import { ActionId, Stimulus, makeStimulus } from "../../brain";

export type UtilityTag = "food" | "water" | "toy" | "rest" | "dig" | "social";

/** Object kind → its utility tags. */
export const UTILITY_TAGS: Record<PetObjectKind, UtilityTag[]> = {
  food_bowl: ["food"],
  water_bowl: ["water"],
  ball: ["toy"],
  bone: ["toy", "dig"],
  chew_toy: ["toy"],
  bed: ["rest"],
  dog_house: ["rest", "social"],
  hydrant: ["social"],
};

/** Which brain action a tag draws the pet toward. */
export const TAG_TO_ACTION: Record<UtilityTag, ActionId> = {
  food: "eat",
  water: "drink",
  toy: "fetch",
  rest: "nap",
  dig: "dig",
  social: "greet",
};

/** Reverse of TAG_TO_ACTION: which tag an action seeks (if any). */
export const ACTION_TO_TAG: Partial<Record<ActionId, UtilityTag>> = {
  eat: "food",
  drink: "water",
  fetch: "toy",
  nap: "rest",
  dig: "dig",
  greet: "social",
};

export function tagsFor(kind: PetObjectKind): UtilityTag[] {
  return UTILITY_TAGS[kind] ?? [];
}

export function objectHasTag(obj: PlacedObject, tag: UtilityTag): boolean {
  return tagsFor(obj.kind).includes(tag);
}

/** Nearest placed object carrying `tag` to a point on the XZ plane, or null. */
export function nearestObjectWithTag(
  objects: PlacedObject[],
  tag: UtilityTag,
  from: { x: number; z: number }
): PlacedObject | null {
  let best: PlacedObject | null = null;
  let bestD = Infinity;
  for (const o of objects) {
    if (!objectHasTag(o, tag)) continue;
    const dx = o.position[0] - from.x;
    const dz = o.position[2] - from.z;
    const d = dx * dx + dz * dz;
    if (d < bestD) {
      bestD = d;
      best = o;
    }
  }
  return best;
}

/**
 * Convert placed objects into ambient stimuli (flat low bonus, §4.1) so utility
 * considerations see what's available in the scene. One stimulus per (object,tag).
 */
export function objectsToStimuli(objects: PlacedObject[], now: number): Stimulus[] {
  const out: Stimulus[] = [];
  for (const o of objects) {
    for (const tag of tagsFor(o.kind)) {
      out.push(makeStimulus(`obj-${o.id}-${tag}`, TAG_TO_ACTION[tag], now, false));
    }
  }
  return out;
}
