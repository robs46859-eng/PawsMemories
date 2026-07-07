/**
 * src/three/ar/buttons.ts — AR_PET_SIM_SPEC §7.3
 * FluentPet-style spatial speech buttons: recordable button entities on the floor.
 *
 * TODO(AR7):
 *  - Place via existing object placement flow; record with MediaRecorder → upload B2 →
 *    pet_buttons row.
 *  - Owner tap = Aided Language Input (association event links buttonId ↔ following action).
 *  - Pet stepping on a reachable button plays audio + fires linked action's utility boost.
 *  - Hand-signal steering: on-screen drag draws a path the pet's nav follows.
 */

export interface SpatialButton {
  id: number;
  label: string;
  audioUrl: string;
  linkedAction: string | null;
  associationStrength: number;
  anchor: { x: number; y: number; z: number };
}

// TODO(AR7): recordButton(), onOwnerTap(), onPetStep().
export {};
