/**
 * src/three/ar/buttons.ts — AR_PET_SIM_SPEC §7.3
 * FluentPet-style spatial speech buttons. The pure logic (step-on detection,
 * Aided-Language-Input association strengthening, tap→link) is here + tested; the
 * MediaRecorder capture and B2 upload are browser/server glue wired at the edges.
 */

export interface PetButton {
  id: string | number;
  label: string;
  audioUrl: string;
  linkedAction: string | null;
  associationStrength: number; // 0..1
  anchor: { x: number; y: number; z: number };
}

/** Pet must be within this planar distance (m) of a button to trigger it. */
export const STEP_ON_RADIUS = 0.25;
export const ASSOCIATION_STEP = 0.1;

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** Planar (XZ) distance from the pet to a button anchor. */
export function distanceToButton(button: PetButton, petPos: { x: number; z: number }): number {
  const dx = button.anchor.x - petPos.x;
  const dz = button.anchor.z - petPos.z;
  return Math.hypot(dx, dz);
}

/** Whether the pet is stepping on the button (within STEP_ON_RADIUS). */
export function isSteppingOn(
  button: PetButton,
  petPos: { x: number; z: number },
  radius = STEP_ON_RADIUS
): boolean {
  return distanceToButton(button, petPos) <= radius;
}

/**
 * Aided Language Input: owner taps a button then the pet performs an action —
 * strengthen the button↔action association (clamped 0..1).
 */
export function reinforceAssociation(strength: number, delta = ASSOCIATION_STEP): number {
  return clamp01(strength + delta);
}

/**
 * Owner taps a button and an action follows: link the action (if unlinked) and
 * bump the association. Returns an updated button (pure).
 */
export function linkActionOnTap(button: PetButton, followingAction: string): PetButton {
  return {
    ...button,
    linkedAction: button.linkedAction ?? followingAction,
    associationStrength: reinforceAssociation(button.associationStrength),
  };
}

/** The nearest button the pet is currently stepping on, or null. */
export function buttonUnderPet(
  buttons: PetButton[],
  petPos: { x: number; z: number },
  radius = STEP_ON_RADIUS
): PetButton | null {
  let best: PetButton | null = null;
  let bestD = Infinity;
  for (const b of buttons) {
    const d = distanceToButton(b, petPos);
    if (d <= radius && d < bestD) {
      bestD = d;
      best = b;
    }
  }
  return best;
}
