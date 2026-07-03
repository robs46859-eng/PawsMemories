import React, { useEffect, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { XR, XRDomOverlay, createXRStore, useXR, useXRHitTest } from "@react-three/xr";
import * as THREE from "three";
import { Avatar } from "../../types";
import AvatarModel from "../AvatarModel";
import ObjectModel from "../objects/ObjectModel";
import { useAvatarScene } from "../store";
import EighthWallARView from "./EighthWallARView";
import ARCommandOverlay from "../../components/ARCommandOverlay";
import ARObjectOverlay from "../../components/ARObjectOverlay";
import { addObjectForAvatar } from "../objects/placement";

// Request the DOM-overlay feature so command buttons can float over the camera view.
const store = createXRStore({ domOverlay: true });

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
  const lastHit = useRef(new THREE.Vector3());
  const matrix = useRef(new THREE.Matrix4());
  const [placed, setPlaced] = useState(false);

  // Continuously position the reticle on the nearest detected surface.
  useXRHitTest((results, getWorldMatrix) => {
    if (!results.length || !reticleRef.current) return;
    if (getWorldMatrix(matrix.current, results[0])) {
      lastHit.current.setFromMatrixPosition(matrix.current);
      reticleRef.current.position.copy(lastHit.current);
      reticleRef.current.visible = !placed;
    }
  }, "viewer");

  // Tap ("select") to anchor the scene at the reticle.
  useEffect(() => {
    if (!session) return;
    const onSelect = () => {
      if (anchorRef.current) {
        anchorRef.current.position.copy(lastHit.current);
        setPlaced(true);
      }
    };
    session.addEventListener("select", onSelect);
    return () => session.removeEventListener("select", onSelect);
  }, [session]);

  return (
    <>
      <hemisphereLight intensity={0.9} />
      <directionalLight position={[2, 4, 2]} intensity={1} />
      {/* Reticle */}
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
            <ARObjectOverlay onAdd={(kind) => addObjectForAvatar(avatar.id, kind)} />
            <ARCommandOverlay avatarId={avatar.id} />
          </XRDomOverlay>
        </XR>
      </Canvas>
    </div>
  );
}
