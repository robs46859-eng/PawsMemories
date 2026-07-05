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

// Request the features this scene uses. domOverlay = floating command buttons;
// hitTest = surface reticle; anchors = drift-free placement (Phase 2). All are
// requested as optional, so the session still starts on devices that lack them.
const store = createXRStore({ domOverlay: true, hitTest: true, anchors: true });

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
  }, "viewer");

  // Phase 2 — each frame, drive the anchored group from the live XRAnchor pose so
  // the pet stays locked to the real-world spot as ARCore refines its map (no drift).
  useFrame((state, _delta, frame?: XRFrame) => {
    const grp = anchorRef.current;
    const anchor = xrAnchor.current;
    if (!grp || !anchor || !frame) return;
    const refSpace = state.gl.xr.getReferenceSpace();
    if (!refSpace) return;
    const pose = frame.getPose(anchor.anchorSpace, refSpace);
    if (pose) {
      matrix.current.fromArray(pose.transform.matrix);
      matrix.current.decompose(grp.position, grp.quaternion, tmpScale.current);
    }
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
      <hemisphereLight intensity={0.9} />
      <directionalLight position={[2, 4, 2]} intensity={1} />
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
