/**
 * src/brain/bodyLanguage.ts — AR_PET_SIM_SPEC §4.4
 * Needs are communicated via body language, NOT stat bars. Maps drive pressure
 * to idle-clip variants + ear/tail poses + vocalization hints.
 *
 * TODO(AR5): consume from the stage to pick idle variants + poses each frame.
 */

import { Drives } from "./types";

export interface BodyLanguage {
  idleVariant: "relaxed" | "restless" | "droopy" | "alert";
  ears: "neutral" | "perked" | "back";
  tail: "neutral" | "wag" | "tucked";
  vocal: "none" | "whine" | "bark";
}

export function readBodyLanguage(d: Drives): BodyLanguage {
  if (d.tiredness > 80) return { idleVariant: "droopy", ears: "back", tail: "neutral", vocal: "none" };
  if (d.hunger > 80 || d.thirst > 80) return { idleVariant: "restless", ears: "perked", tail: "neutral", vocal: "whine" };
  if (d.playfulness > 70) return { idleVariant: "alert", ears: "perked", tail: "wag", vocal: "bark" };
  if (d.happiness < 25) return { idleVariant: "droopy", ears: "back", tail: "tucked", vocal: "whine" };
  return { idleVariant: "relaxed", ears: "neutral", tail: "wag", vocal: "none" };
}
