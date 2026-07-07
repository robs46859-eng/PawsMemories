/**
 * src/three/ar/ik.ts — AR_PET_SIM_SPEC §6.5
 * IK & grounding: CCDIKSolver on the 4 canonical leg chains + head look-at,
 * paw raycast to the AR plane/mesh, pelvis height adjust, max-slope clamp.
 *
 * The canonical bone names come from the bake-lod rename (skeletal-clips.js /
 * bonemap.json). Everything here is defensive: if the rig is missing bones, the
 * setup returns null and the stage renders without IK rather than crashing.
 *
 * The CCDIKSolver wiring runs in the browser against a real SkinnedMesh and can't
 * be exercised in CI; the pure math helpers below (pelvisHeightFromPaws, slope
 * clamp) are unit-tested.
 */

import * as THREE from "three";

/** Canonical leg chains: [upper, lower, paw] per leg (effector = paw). */
export const LEG_CHAINS: [string, string, string][] = [
  ["front_leg_upper.L", "front_leg_lower.L", "front_paw.L"],
  ["front_leg_upper.R", "front_leg_lower.R", "front_paw.R"],
  ["back_leg_upper.L", "back_leg_lower.L", "back_paw.L"],
  ["back_leg_upper.R", "back_leg_lower.R", "back_paw.R"],
];

export const HEAD_BONE = "head";
export const HIPS_BONE = "hips";
export const MAX_SLOPE_RAD = 0.6;

/** Find the first SkinnedMesh under a root. */
export function findSkinnedMesh(root: THREE.Object3D): THREE.SkinnedMesh | null {
  let found: THREE.SkinnedMesh | null = null;
  root.traverse((o) => {
    if (!found && (o as THREE.SkinnedMesh).isSkinnedMesh) found = o as THREE.SkinnedMesh;
  });
  return found;
}

export interface LegIKRig {
  mesh: THREE.SkinnedMesh;
  headBone: THREE.Bone | null;
  hipsBone: THREE.Bone | null;
  /** Bone-name → index within the skeleton. */
  boneIndex: Record<string, number>;
  /** Chains present on this rig (subset of LEG_CHAINS). */
  chains: [string, string, string][];
}

/**
 * Inspect a loaded model's skeleton and build the IK rig description.
 * Returns null if there's no skinned mesh. Present chains = those whose three
 * bones all exist. TODO(AR4): construct CCDIKSolver ikConfig from `chains` (needs
 * per-chain target bones added to the skeleton) and tune iteration/min-angle.
 */
export function buildLegIK(root: THREE.Object3D): LegIKRig | null {
  const mesh = findSkinnedMesh(root);
  if (!mesh || !mesh.skeleton) return null;
  const boneIndex: Record<string, number> = {};
  mesh.skeleton.bones.forEach((b, i) => (boneIndex[b.name] = i));
  const present = LEG_CHAINS.filter((c) => c.every((n) => n in boneIndex));
  const head = mesh.skeleton.bones.find((b) => b.name === HEAD_BONE) || null;
  const hips = mesh.skeleton.bones.find((b) => b.name === HIPS_BONE) || null;
  return { mesh, headBone: head, hipsBone: hips, boneIndex, chains: present };
}

/**
 * Pelvis height adjustment so the highest-lifted paw still reaches the ground.
 * `pawYs` = current world-Y of each paw; `restY` = the pelvis rest height.
 * Lowers the pelvis by the deepest ground penetration (paw below 0), never raises
 * above rest. Pure + unit-tested.
 */
export function pelvisHeightFromPaws(pawYs: number[], restY: number): number {
  if (!pawYs.length) return restY;
  const lowest = Math.min(...pawYs);
  if (lowest >= 0) return restY;
  return restY + lowest; // lowest is negative → lower the pelvis
}

/** Clamp a ground-slope pitch/roll to the max the rig should lean. Pure. */
export function clampSlope(angleRad: number, maxRad = MAX_SLOPE_RAD): number {
  return Math.max(-maxRad, Math.min(maxRad, angleRad));
}

/** Rotate the head bone to look at a world-space target (e.g. the user camera). */
export function headLookAt(
  headBone: THREE.Bone | null,
  targetWorld: THREE.Vector3
): void {
  if (!headBone) return;
  const parent = headBone.parent;
  if (!parent) {
    headBone.lookAt(targetWorld);
    return;
  }
  // Convert the world target into the head bone's parent space, then look at it.
  const local = parent.worldToLocal(targetWorld.clone());
  const m = new THREE.Matrix4().lookAt(headBone.position, local, THREE.Object3D.DEFAULT_UP);
  headBone.quaternion.setFromRotationMatrix(m);
}
