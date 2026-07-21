/**
 * Canonical A–X viseme names and safe aliases commonly exported by avatar tools.
 * Canonical `viseme_A` … `viseme_X` remain the output contract; aliases only
 * let existing GLBs participate without mutating their source assets.
 */
import type { VisemeShape } from "./visemeRules.ts";

export const VISEME_MORPH_ALIASES: Record<VisemeShape, readonly string[]> = {
  A: ["viseme_A", "viseme_MBP", "mouthClose"],
  B: ["viseme_B", "viseme_EE"],
  C: ["viseme_C", "viseme_EH"],
  D: ["viseme_D", "viseme_AA", "jawOpen", "mouthOpen"],
  E: ["viseme_E", "viseme_OH"],
  F: ["viseme_F", "viseme_OO", "mouthPucker"],
  G: ["viseme_G", "viseme_FV"],
  H: ["viseme_H", "viseme_L"],
  X: ["viseme_X"],
};

const normalize = (name: string) => name.replace(/[^a-z0-9]/gi, "").toLowerCase();

/** Returns the actual morph-target index for a canonical shape or alias. */
export function findVisemeMorphIndex(dictionary: Record<string, number>, shape: VisemeShape): number | undefined {
  for (const candidate of VISEME_MORPH_ALIASES[shape]) {
    const exact = dictionary[candidate];
    if (exact !== undefined) return exact;
  }
  const aliases = new Set(VISEME_MORPH_ALIASES[shape].map(normalize));
  for (const [name, index] of Object.entries(dictionary)) {
    if (aliases.has(normalize(name))) return index;
  }
  return undefined;
}
