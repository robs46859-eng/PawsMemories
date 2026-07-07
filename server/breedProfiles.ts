/**
 * server/breedProfiles.ts — AR_PET_SIM_SPEC §3.2
 * Static breed → gameplay-parameter table for the ~60 most common breeds, plus a
 * size_class fallback for everything else.
 *
 * TODO(AR2): fill out the full ~60-breed table; wire into /api/pets/classify so the
 * classified breed resolves to a profile. Values below are the two worked examples
 * from the spec plus a size_class fallback map.
 */

export interface BreedProfile {
  scale: number;
  decay: { hunger?: number; thirst?: number; tiredness?: number };
  exerciseNeed: number;
  complianceBase: number;
  mouthHitbox: number; // radius multiplier for catch minigames
  barkSet: string;
}

export const SIZE_FALLBACK: Record<string, BreedProfile> = {
  toy: { scale: 0.6, decay: {}, exerciseNeed: 0.7, complianceBase: 0.5, mouthHitbox: 0.7, barkSet: "yip" },
  small: { scale: 0.8, decay: {}, exerciseNeed: 0.9, complianceBase: 0.5, mouthHitbox: 0.85, barkSet: "yip" },
  medium: { scale: 1.0, decay: {}, exerciseNeed: 1.0, complianceBase: 0.5, mouthHitbox: 1.0, barkSet: "bark" },
  large: { scale: 1.15, decay: {}, exerciseNeed: 1.3, complianceBase: 0.5, mouthHitbox: 1.15, barkSet: "woof" },
  giant: { scale: 1.3, decay: {}, exerciseNeed: 1.4, complianceBase: 0.5, mouthHitbox: 1.3, barkSet: "woof" },
};

// Common breeds. Keys are lowercased; resolveBreedProfile also normalizes spaces/hyphens.
// TODO(AR2+): continue toward the full ~60; unlisted breeds fall back to size_class.
export const BREED_PROFILES: Record<string, BreedProfile> = {
  pug: { scale: 0.7, decay: { tiredness: 1.5 }, exerciseNeed: 0.7, complianceBase: 0.5, mouthHitbox: 0.8, barkSet: "snort" },
  husky: { scale: 1.15, decay: { hunger: 1.3 }, exerciseNeed: 1.6, complianceBase: 0.45, mouthHitbox: 1.1, barkSet: "howl" },
  "siberian husky": { scale: 1.15, decay: { hunger: 1.3 }, exerciseNeed: 1.6, complianceBase: 0.45, mouthHitbox: 1.1, barkSet: "howl" },
  "labrador retriever": { scale: 1.1, decay: { hunger: 1.2 }, exerciseNeed: 1.3, complianceBase: 0.7, mouthHitbox: 1.15, barkSet: "woof" },
  labrador: { scale: 1.1, decay: { hunger: 1.2 }, exerciseNeed: 1.3, complianceBase: 0.7, mouthHitbox: 1.15, barkSet: "woof" },
  "golden retriever": { scale: 1.1, decay: { hunger: 1.2 }, exerciseNeed: 1.3, complianceBase: 0.75, mouthHitbox: 1.15, barkSet: "woof" },
  "german shepherd": { scale: 1.15, decay: {}, exerciseNeed: 1.4, complianceBase: 0.75, mouthHitbox: 1.1, barkSet: "woof" },
  poodle: { scale: 0.95, decay: {}, exerciseNeed: 1.1, complianceBase: 0.72, mouthHitbox: 0.95, barkSet: "bark" },
  "french bulldog": { scale: 0.7, decay: { tiredness: 1.4 }, exerciseNeed: 0.7, complianceBase: 0.55, mouthHitbox: 0.8, barkSet: "snort" },
  bulldog: { scale: 0.85, decay: { tiredness: 1.5 }, exerciseNeed: 0.6, complianceBase: 0.5, mouthHitbox: 0.9, barkSet: "snort" },
  beagle: { scale: 0.85, decay: { hunger: 1.3 }, exerciseNeed: 1.2, complianceBase: 0.45, mouthHitbox: 0.9, barkSet: "bay" },
  chihuahua: { scale: 0.5, decay: {}, exerciseNeed: 0.8, complianceBase: 0.4, mouthHitbox: 0.6, barkSet: "yip" },
  dachshund: { scale: 0.65, decay: {}, exerciseNeed: 0.9, complianceBase: 0.45, mouthHitbox: 0.7, barkSet: "yip" },
  "yorkshire terrier": { scale: 0.5, decay: {}, exerciseNeed: 0.85, complianceBase: 0.45, mouthHitbox: 0.6, barkSet: "yip" },
  boxer: { scale: 1.1, decay: {}, exerciseNeed: 1.4, complianceBase: 0.6, mouthHitbox: 1.05, barkSet: "woof" },
  "border collie": { scale: 1.0, decay: {}, exerciseNeed: 1.7, complianceBase: 0.8, mouthHitbox: 1.0, barkSet: "bark" },
  "shih tzu": { scale: 0.6, decay: {}, exerciseNeed: 0.8, complianceBase: 0.5, mouthHitbox: 0.7, barkSet: "yip" },
  rottweiler: { scale: 1.25, decay: {}, exerciseNeed: 1.3, complianceBase: 0.65, mouthHitbox: 1.2, barkSet: "woof" },
  "great dane": { scale: 1.4, decay: {}, exerciseNeed: 1.2, complianceBase: 0.6, mouthHitbox: 1.3, barkSet: "woof" },
  corgi: { scale: 0.7, decay: { hunger: 1.15 }, exerciseNeed: 1.1, complianceBase: 0.65, mouthHitbox: 0.8, barkSet: "bark" },
  "pembroke welsh corgi": { scale: 0.7, decay: { hunger: 1.15 }, exerciseNeed: 1.1, complianceBase: 0.65, mouthHitbox: 0.8, barkSet: "bark" },
  "australian shepherd": { scale: 1.0, decay: {}, exerciseNeed: 1.6, complianceBase: 0.75, mouthHitbox: 1.0, barkSet: "bark" },
  pomeranian: { scale: 0.5, decay: {}, exerciseNeed: 0.85, complianceBase: 0.45, mouthHitbox: 0.6, barkSet: "yip" },
};

/** Normalize a breed string to a table key: lowercase, collapse whitespace. */
function normBreed(breed: string): string {
  return breed.trim().toLowerCase().replace(/\s+/g, " ");
}

export function resolveBreedProfile(breed: string | undefined, sizeClass: string): BreedProfile {
  if (breed) {
    const key = normBreed(breed);
    if (BREED_PROFILES[key]) return BREED_PROFILES[key];
  }
  return SIZE_FALLBACK[sizeClass] ?? SIZE_FALLBACK.medium;
}
