import React, { useEffect, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { XR, XRDomOverlay, createXRStore, useXR, useXRHitTest } from "@react-three/xr";
import * as THREE from "three";
import { Avatar } from "../../types";
import AvatarModel from "../AvatarModel";
import ObjectModel from "../objects/ObjectModel";
import { useAvatarScene } from "../store";
import EighthWallARView from "./EighthWallARView";
import ARCommandOverlay from "../../components/ARCommandOverlay";
import ARObjectOverlay from "../../components/ARObjectOverlay";
import { addObjectAtPosition } from "../objects/placement";
import { useARLightEstimation } from "./lightProbe";
import ARPlaneGrid from "./planeGrid";
import { useDepthOcclusion } from "./occlusion";

// ---------------------------------------------------------------------------
// XR Store — request all optional features (degrade silently per device).
// ---------------------------------------------------------------------------
const store = createXRStore({
  domOverlay: true,
  hitTest: true,
  anchors: true,
  planeDetection: true,
  meshDetection: true,
  // Phase 4 — depth sensing (GPU-optimized, luminance-alpha format).
  depthSensing: {
    usagePreference: ["gpu-optimized"],
    dataFormatPreference: ["luminance-alpha"],
  } as any,
  // Phase 5 — light estimation. If the store doesn't expose a direct key,
  // fall through to session.requestLightProbe() in lightProbe.ts.
  lightEstimation: true,
} as any);

// Snap the reticle/placement to real detected planes AND meshes (not just the
// raw viewer ray), so the pet lands on actual surfaces the device has meshed.
const HIT_TRACKABLES: XRHitTestTrackableType[] = ["plane", "mesh"];

function PlacedObjects() {
  const objects = useAvatarScene((s) => s.placedObjects);
  return (
    <>
      {objects.map((o) => (
        <ObjectModel key={o.id} object={o} />
      ))}
    </>
  );
}

/**
 * AR content: a hit-test reticle finds a real surface; tapping anchors the pet
 * (and any placed objects) there. Before placement only the reticle shows.
 *
 * Phases 3–5 modules are mounted here:
 *  - Phase 3: <ARPlaneGrid /> — subtle plane visualization
 *  - Phase 4: useDepthOcclusion() — real-world occlusion shader
 *  - Phase 5: useARLightEstimation() — adaptive directional + ambient lights
 */
function ARContent({ avatar }: { avatar: Avatar }) {
  const url = avatar.rigged_model_url || avatar.model_url || "";
  const session = useXR((s) => s.session);
  const reticleRef = useRef<THREE.Group>(null);
  const anchorRef = useRef<THREE.Group>(null);

  const matrix = useRef(new THREE.Matrix4());
  const hitPos = useRef(new THREE.Vector3());
  const hitQuat = useRef(new THREE.Quaternion());
  const tmpScale = useRef(new THREE.Vector3());

  const latestHit = useRef<XRHitTestResult | null>(null);
  const xrAnchor = useRef<XRAnchor | null>(null);
  const placedRef = useRef(false);
  const [placed, setPlaced] = useState(false);

  // ------ Phase 5 — Light estimation (replaces hardcoded lights) -----------
  const { directionalRef, ambientProbeRef } = useARLightEstimation();

  // ------ Phase 4 — Depth occlusion ----------------------------------------
  useDepthOcclusion(anchorRef);

  // Phase 1 — reticle follows the hit-test pose with FULL orientation (oriented
  // points), so it lies flat on angled surfaces instead of only the floor.
  useXRHitTest((results, getWorldMatrix) => {
    latestHit.current = results[0] ?? null;
    if (!results.length || !reticleRef.current) return;
    if (getWorldMatrix(matrix.current, results[0])) {
      matrix.current.decompose(hitPos.current, hitQuat.current, tmpScale.current);
      reticleRef.current.position.copy(hitPos.current);
      reticleRef.current.quaternion.copy(hitQuat.current);
      reticleRef.current.visible = !placedRef.current;
    }
  }, "viewer", HIT_TRACKABLES);

  // Phase 2 — each frame, drive the anchored group from the live XRAnchor pose so
  // the pet stays locked to the real-world spot as ARCore refines its map (no drift).
  useFrame((state, _delta, frame?: XRFrame) => {
    const grp = anchorRef.current;
    const anchor = xrAnchor.current;
    if (!grp || !anchor || !frame) return;
    const refSpace = state.gl.xr.getReferenceSpace();
    if (!refSpace) return;
    const pose = frame.getPose(anchor.anchorSpace, refSpace);
    if (!pose) return;
    // Float vigilance: an anchor whose tracking is briefly lost can return a
    // non-finite transform; applying it would NaN the group (pet vanishes or
    // explodes). Only commit a fully finite pose.
    const m = pose.transform.matrix;
    if (!Number.isFinite(m[12]) || !Number.isFinite(m[13]) || !Number.isFinite(m[14])) return;
    matrix.current.fromArray(m);
    matrix.current.decompose(grp.position, grp.quaternion, tmpScale.current);
  });

  // Tap ("select"): anchor the pet, or drop an armed object onto the surface.
  useEffect(() => {
    if (!session) return;
    const onSelect = async () => {
      const grp = anchorRef.current;
      if (!grp) return;
      const pending = useAvatarScene.getState().pendingObjectKind;

      if (pending && placedRef.current) {
        // Offset the object into the anchored group's local frame (respects the
        // group's live orientation, not just a naive position subtraction).
        const inv = new THREE.Matrix4().copy(grp.matrixWorld).invert();
        const local = hitPos.current.clone().applyMatrix4(inv);
        addObjectAtPosition(avatar.id, pending, [local.x, 0, local.z]);
        useAvatarScene.getState().setPendingObjectKind(null);
        return;
      }

      // Prefer a real WebXR anchor; fall back to a static pose if the device or
      // browser didn't grant the anchors feature.
      const hit = latestHit.current as any;
      if (hit && typeof hit.createAnchor === "function") {
        try {
          xrAnchor.current = (await hit.createAnchor()) as XRAnchor;
          placedRef.current = true;
          setPlaced(true);
          return;
        } catch {
          /* fall through to static placement */
        }
      }
      xrAnchor.current = null;
      grp.position.copy(hitPos.current);
      grp.quaternion.copy(hitQuat.current);
      placedRef.current = true;
      setPlaced(true);
    };
    session.addEventListener("select", onSelect);
    return () => session.removeEventListener("select", onSelect);
  }, [session, avatar.id]);

  return (
    <>
      {/* Phase 5 — Adaptive lighting (replaces hardcoded hemisphereLight + directionalLight).
          Falls back to these default values if light estimation is unavailable. */}
      <directionalLight
        ref={directionalRef}
        position={[2, 4, 2]}
        intensity={1}
        castShadow
      />
      <primitive
        object={new THREE.LightProbe()}
        ref={ambientProbeRef}
        intensity={0.9}
      />

      {/* Phase 3 — Plane visualization (fades out once pet is placed) */}
      <ARPlaneGrid fadeOut={placed} />

      {/* Oriented reticle */}
      <group ref={reticleRef} visible={false}>
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.08, 0.1, 32]} />
          <meshBasicMaterial color="#22c55e" />
        </mesh>
      </group>
      {/* Anchored content */}
      <group ref={anchorRef} visible={placed}>
        {url ? <AvatarModel url={url} /> : null}
        <PlacedObjects />
      </group>
    </>
  );
}

/**
 * Capability detection + launcher for AR. The behavior brain must be driven by
 * the parent (LivingAvatarView) since the store is shared — this component only
 * renders the AR view.
 */
export default function ARScene({ avatar }: { avatar: Avatar }) {
  const [supported, setSupported] = useState<boolean | null>(null);
  const [use8thWall, setUse8thWall] = useState(false);

  useEffect(() => {
    const xr = (navigator as any).xr;
    if (!xr?.isSessionSupported) {
      setSupported(false);
      return;
    }
    xr.isSessionSupported("immersive-ar").then((ok: boolean) => setSupported(ok)).catch(() => setSupported(false));
  }, []);

  // iOS / no-WebXR path: 8th Wall engine (camera + SLAM).
  if (use8thWall) {
    return <EighthWallARView avatar={avatar} onExit={() => setUse8thWall(false)} />;
  }

  if (supported === false) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center text-center gap-3 p-6">
        <p className="text-sm font-bold">This device has no native WebXR AR.</p>
        <p className="text-xs opacity-60 max-w-xs">
          Native world-tracking AR (WebXR) is Android-only. On iPhone we use the
          8th Wall engine instead — it loads the camera + tracking on first use.
        </p>
        <button
          onClick={() => setUse8thWall(true)}
          className="px-4 py-2 rounded-full bg-primary text-white text-sm font-bold shadow-lg hover:bg-primary/90 active:scale-95"
        >
          Start AR (beta)
        </button>
      </div>
    );
  }

  return (
    <div className="w-full h-full relative">
      <button
        onClick={() => store.enterAR()}
        disabled={supported === null}
        className="absolute z-20 top-3 left-1/2 -translate-x-1/2 px-4 py-2 rounded-full bg-primary text-white text-sm font-bold shadow-lg hover:bg-primary/90 active:scale-95 disabled:opacity-50"
      >
        {supported === null ? "Checking AR…" : "Enter AR"}
      </button>
      <Canvas shadows camera={{ position: [0, 1.4, 2], fov: 50 }}>
        <XR store={store}>
          <ARContent avatar={avatar} />
          {/* Floats the command + object controls over the live camera during the immersive session. */}
          <XRDomOverlay>
            <ARObjectOverlay />
            <ARCommandOverlay avatarId={avatar.id} />
          </XRDomOverlay>
        </XR>
      </Canvas>
    </div>
  );
}
