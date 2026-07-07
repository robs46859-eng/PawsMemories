/**
 * src/three/ar/dispose.ts — AR_PET_SIM_SPEC §9 / AR9
 * Memory cleanup on AR session end — the doc's "volumetric cleanup" analogue.
 * Frees GPU resources (geometries, materials, textures) so repeated open/close of
 * the AR stage doesn't leak. Duck-typed (only needs `.traverse` + `.dispose`) so it
 * unit-tests without a real WebGL context.
 */

interface Disposable {
  dispose?: () => void;
}
interface MeshLike {
  geometry?: Disposable;
  material?: MaterialLike | MaterialLike[];
}
interface MaterialLike extends Disposable {
  [key: string]: any;
}
interface Object3DLike {
  traverse: (cb: (o: any) => void) => void;
}

/** Texture-valued material properties three uses (dispose each if present). */
const TEXTURE_KEYS = [
  "map", "normalMap", "roughnessMap", "metalnessMap", "aoMap", "emissiveMap",
  "bumpMap", "displacementMap", "alphaMap", "envMap", "lightMap", "specularMap",
];

export function disposeMaterial(mat: MaterialLike | undefined | null): number {
  if (!mat) return 0;
  let freed = 0;
  for (const key of TEXTURE_KEYS) {
    const tex = mat[key];
    if (tex && typeof tex.dispose === "function") {
      tex.dispose();
      freed++;
    }
  }
  if (typeof mat.dispose === "function") {
    mat.dispose();
    freed++;
  }
  return freed;
}

/**
 * Recursively dispose geometries, materials, and their textures under `root`.
 * Returns the count of disposed resources (handy for tests + leak assertions).
 */
export function disposeObject3D(root: Object3DLike | null | undefined): number {
  if (!root || typeof root.traverse !== "function") return 0;
  let freed = 0;
  root.traverse((o: MeshLike) => {
    if (o.geometry && typeof o.geometry.dispose === "function") {
      o.geometry.dispose();
      freed++;
    }
    if (Array.isArray(o.material)) {
      for (const m of o.material) freed += disposeMaterial(m);
    } else if (o.material) {
      freed += disposeMaterial(o.material);
    }
  });
  return freed;
}
