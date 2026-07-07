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

export const BREED_PROFILES: Record<string, BreedProfile> = {
  // TODO(AR2): expand to ~60 breeds.
  pug: { scale: 0.7, decay: { tiredness: 1.5 }, exerciseNeed: 0.7, complianceBase: 0.5, mouthHitbox: 0.8, barkSet: "snort" },
  husky: { scale: 1.15, decay: { hunger: 1.3 }, exerciseNeed: 1.6, complianceBase: 0.45, mouthHitbox: 1.1, barkSet: "howl" },
};

export function resolveBreedProfile(breed: string | undefined, sizeClass: string): BreedProfile {
  if (breed && BREED_PROFILES[breed.toLowerCase()]) return BREED_PROFILES[breed.toLowerCase()];
  return SIZE_FALLBACK[sizeClass] ?? SIZE_FALLBACK.medium;
}
