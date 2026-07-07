/**
 * src/three/ar/shadows.ts — AR_PET_SIM_SPEC §6.2
 * Soft contact shadows on the floor plane (THREE.ShadowMaterial) — the grounding
 * fallback where per-pixel depth occlusion is unavailable (iOS). Plus the
 * semantic-zone opacity-fade heuristic (fade the pet 1 → 0.85 when its path
 * crosses a furniture zone) that cheaply sells depth.
 */

import * as THREE from "three";

export const CONTACT_SHADOW_OPACITY = 0.35;
export const FURNITURE_FADE_OPACITY = 0.85;

/** A ground plane that only shows the shadow the pet casts onto it. */
export function makeContactShadow(radius = 0.6): THREE.Mesh {
  const geo = new THREE.CircleGeometry(radius, 48);
  const mat = new THREE.ShadowMaterial({
    opacity: CONTACT_SHADOW_OPACITY,
    transparent: true,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2; // lie flat on the floor
  mesh.receiveShadow = true;
  mesh.name = "contact-shadow";
  return mesh;
}

/** Pet opacity given whether its path currently crosses a furniture zone (§6.2). */
export function zoneFadeOpacity(crossingFurniture: boolean): number {
  return crossingFurniture ? FURNITURE_FADE_OPACITY : 1;
}

/** Apply a fade opacity to every material under `root` (used by the iOS heuristic). */
export function applyOpacity(root: THREE.Object3D, opacity: number): void {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    for (const mat of mats) {
      if (!mat) continue;
      (mat as THREE.Material).transparent = opacity < 1;
      (mat as any).opacity = opacity;
    }
  });
}
