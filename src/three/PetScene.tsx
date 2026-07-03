import React, { Suspense } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, ContactShadows } from "@react-three/drei";
import { Avatar } from "../types";
import { useAvatarScene } from "./store";
import AvatarModel from "./AvatarModel";
import ObjectModel from "./objects/ObjectModel";

interface PetSceneProps {
  avatar: Avatar;
  /** Optional explicit model URL override (e.g. a rigged model). Defaults to avatar.model_url. */
  modelUrl?: string;
  /** Called when a placed object is tapped (for removal). */
  onRemoveObject?: (id: string) => void;
  className?: string;
}

function PlacedObjects({ onRemoveObject }: { onRemoveObject?: (id: string) => void }) {
  const objects = useAvatarScene((s) => s.placedObjects);
  return (
    <>
      {objects.map((o) => (
        <ObjectModel key={o.id} object={o} onClick={onRemoveObject} />
      ))}
    </>
  );
}

function Ground() {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
      <circleGeometry args={[8, 48]} />
      <meshStandardMaterial color="#7cc46a" />
    </mesh>
  );
}

/**
 * Phase 1 in-app 3D scene. Renders the avatar's GLB with animation playback
 * (or procedural motion when the GLB has no skeletal clips yet), placed objects,
 * lighting, ground and orbit controls. The behavior brain (Phase 2) drives
 * `action`/`target` in the store; this component only renders them.
 */
export default function PetScene({ avatar, modelUrl, onRemoveObject, className = "" }: PetSceneProps) {
  // Prefer a rigged skeletal model (Phase 5) so real clips play; fall back to the plain mesh.
  const url = modelUrl || avatar.rigged_model_url || avatar.model_url || "";
  return (
    <div className={className} style={{ width: "100%", height: "100%" }}>
      <Canvas shadows camera={{ position: [2.2, 1.6, 2.6], fov: 42 }} dpr={[1, 2]}>
        <color attach="background" args={["#dfeee0"]} />
        <hemisphereLight intensity={0.7} groundColor={"#8fbf7f"} />
        <directionalLight
          position={[4, 6, 3]}
          intensity={1.2}
          castShadow
          shadow-mapSize={[1024, 1024]}
        />
        <Suspense fallback={null}>
          {url ? <AvatarModel url={url} /> : null}
          <PlacedObjects onRemoveObject={onRemoveObject} />
          <Ground />
          <ContactShadows position={[0, 0.01, 0]} opacity={0.35} scale={12} blur={2.4} far={4} />
        </Suspense>
        <OrbitControls
          enablePan={false}
          minDistance={1.5}
          maxDistance={6}
          maxPolarAngle={Math.PI / 2.05}
          target={[0, 0.4, 0]}
        />
      </Canvas>
    </div>
  );
}
