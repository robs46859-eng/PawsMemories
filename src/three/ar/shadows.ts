/**
 * src/three/ar/shadows.ts — AR_PET_SIM_SPEC §6.2
 * Soft contact shadows on the floor plane (THREE.ShadowMaterial), used as the iOS
 * grounding fallback where per-pixel depth occlusion is unavailable.
 *
 * TODO(AR4): create a ShadowMaterial ground plane under the pet; on iOS also apply
 * the semantic-zone opacity-fade heuristic (1 → 0.85 when the pet path crosses a
 * furniture zone) from the semantic snapshot.
 */

export const CONTACT_SHADOW_OPACITY = 0.35;
export const FURNITURE_FADE_OPACITY = 0.85;

// TODO(AR4): export makeContactShadow(scene) and applyZoneFade(mesh, crossingFurniture).
export {};
