/**
 * src/three/ar/ARPetStage.tsx — AR_PET_SIM_SPEC §6
 * One component, two backends (WebXR Android / XR8 iOS), shared scene graph.
 * OVERWRITES ARScene.tsx / EighthWallARView.tsx once at parity (§1).
 *
 * TODO(AR4):
 *  - Bootstrap tracking: Android WebXR immersive-ar + hit-test + anchors (+ plane/mesh
 *    if available); iOS XR8 SLAM (reuse eighthWallAR.ts bootstrap) + horizontal plane.
 *  - Reticle placement flow reused from current code.
 *  - Render the rigged pet with existing clips; contact shadows (shadows.ts);
 *    IK paw grounding + head look-at (ik.ts).
 *  - AR5: attach brainBridge; AR6: occlusion + lighting + navmesh; AR9: dispose on unmount.
 */

export interface ARPetStageProps {
  petId: number;
  glbUrl: string;
  backend?: "webxr" | "xr8";
}

export default function ARPetStage(_props: ARPetStageProps) {
  // TODO(AR4): mount the AR canvas + scene graph.
  return null;
}
