import React, { Suspense, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { Canvas, useFrame } from "@react-three/fiber";
import { ContactShadows, OrbitControls, useGLTF } from "@react-three/drei";
import { SkeletonUtils } from "three-stdlib";
import { LipSyncPlayer } from "../animator/viseme/LipSyncPlayer";
import type { VisemeTrack } from "../animator/viseme/visemeRules";

function Model({
  url,
  track,
  audioRef,
  playing,
}: {
  url: string;
  track: VisemeTrack;
  audioRef: React.RefObject<HTMLAudioElement | null>;
  playing: boolean;
}) {
  const { scene } = useGLTF(url);
  const model = useMemo(() => {
    const clone = SkeletonUtils.clone(scene);
    const box = new THREE.Box3().setFromObject(clone);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const scale = 1.8 / Math.max(size.x, size.y, size.z, 0.001);
    clone.position.set(-center.x, -box.min.y, -center.z);
    const wrapper = new THREE.Group();
    wrapper.scale.setScalar(scale);
    wrapper.add(clone);
    return wrapper;
  }, [scene]);
  const playerRef = useRef<LipSyncPlayer | null>(null);

  useEffect(() => {
    const player = new LipSyncPlayer(model, track, {
      getClock: () => audioRef.current?.currentTime || 0,
    });
    playerRef.current = player;
    if (playing) player.start(0);
    return () => {
      player.dispose();
      playerRef.current = null;
    };
  }, [audioRef, model, track]);

  useEffect(() => {
    if (playing) playerRef.current?.start(0);
    else playerRef.current?.stop();
  }, [playing]);

  useFrame(() => playerRef.current?.update());
  return <primitive object={model} />;
}

export default function LipSyncModelPreview({
  url,
  track,
  audioRef,
  playing,
}: {
  url: string;
  track: VisemeTrack;
  audioRef: React.RefObject<HTMLAudioElement | null>;
  playing: boolean;
}) {
  return (
    <div className="h-80 w-full overflow-hidden rounded-3xl bg-gradient-to-b from-surface-container-high to-surface-container-highest">
      <Canvas camera={{ position: [3, 1.35, 0], fov: 38 }} dpr={[1, 1.5]}>
        <ambientLight intensity={1.6} />
        <directionalLight position={[3, 5, 4]} intensity={2.2} />
        <Suspense fallback={null}>
          <Model url={url} track={track} audioRef={audioRef} playing={playing} />
        </Suspense>
        <ContactShadows position={[0, -0.02, 0]} opacity={0.35} scale={4} blur={2.5} />
        <OrbitControls target={[0, 0.9, 0]} enablePan={false} minDistance={1.5} maxDistance={6} />
      </Canvas>
    </div>
  );
}
