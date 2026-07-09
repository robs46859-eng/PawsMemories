import React, { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useAnimations } from "@react-three/drei";
import { useGLTF } from "@react-three/drei";
import { clone as skeletonClone } from "three/examples/jsm/utils/SkeletonUtils.js";
import * as THREE from "three";
import { BehaviorAction } from "../types";
import { useAvatarScene } from "./store";
import { resolveClipName, LOOPING } from "./clipMap";

const WALK_SPEED = 0.9; // m/s
const RUN_SPEED = 2.2; // m/s
const TARGET_HEIGHT = 0.7; // meters — normalize any generated mesh to roughly dog-sized

/**
 * Lightweight code-driven motion used until real Blender skeletal clips exist
 * (Phase 5). Heading (rotation.y) is owned by the steering logic and preserved.
 */
export function applyProcedural(g: THREE.Group, action: BehaviorAction, t: number): void {
  let y = 0;
  let tilt = 0;
  let roll = 0;
  switch (action) {
    case "walking":
      y = Math.abs(Math.sin(t * 8)) * 0.04;
      break;
    case "running":
      y = Math.abs(Math.sin(t * 12)) * 0.08;
      break;
    case "playing":
      y = Math.abs(Math.sin(t * 10)) * 0.15;
      break;
    case "sleeping":
      roll = Math.PI / 2;
      y = -0.02 + Math.sin(t * 1.5) * 0.01;
      break;
    case "sitting":
      tilt = -0.15;
      break;
    case "eating":
      tilt = 0.25 + Math.sin(t * 9) * 0.05;
      break;
    case "drinking":
      tilt = 0.3 + Math.sin(t * 7) * 0.04;
      break;
    case "peeing":
      roll = 0.25;
      break;
    case "pooping":
      tilt = -0.3;
      y = -0.04;
      break;
    case "speaking":
      y = Math.abs(Math.sin(t * 14)) * 0.03;
      break;
    default:
      // idle — completely still (no breathing motion)
      break;
  }
  g.position.y = y;
  g.rotation.x = tilt;
  g.rotation.z = roll;
}

export function applyHumanProcedural(g: THREE.Group, action: BehaviorAction, t: number): void {
  let y = 0;
  let tilt = 0;
  let roll = 0;
  let sway = 0;
  switch (action) {
    case "walking":
      y = Math.abs(Math.sin(t * 5)) * 0.03;
      sway = Math.sin(t * 5) * 0.05;
      break;
    case "running":
      y = Math.abs(Math.sin(t * 8)) * 0.06;
      sway = Math.sin(t * 8) * 0.08;
      break;
    case "playing":
    case "interacting":
      sway = Math.sin(t * 6) * 0.08;
      tilt = Math.sin(t * 3) * 0.04;
      break;
    case "sleeping":
      roll = Math.PI / 2.1;
      y = -0.6;
      break;
    case "sitting":
      y = -0.3;
      tilt = -0.1;
      break;
    case "speaking":
      tilt = Math.sin(t * 10) * 0.05;
      break;
    default:
      // idle — completely still (no breathing/sway motion)
      break;
  }
  g.position.y = y;
  g.rotation.x = tilt;
  g.rotation.z = roll + sway;
}

/**
 * The avatar's GLB, normalized to the ground, driven by the shared store's
 * `action`/`target`. Plays skeletal clips when the model has them, otherwise
 * animates procedurally. Used by both the in-app scene and the AR scene.
 */
export default function AvatarModel({ url, avatarType = "dog" }: { url: string; avatarType?: "dog" | "human" }) {
  const group = useRef<THREE.Group>(null);
  const { scene, animations } = useGLTF(url);

  const { model, fitScale } = useMemo(() => {
    const cloned = skeletonClone(scene) as THREE.Object3D;
    cloned.updateMatrixWorld(true);

    const box = new THREE.Box3().setFromObject(cloned);
    const size = new THREE.Vector3();
    box.getSize(size);

    // ---- Grounding + objective center of gravity --------------------------
    // Vertical: rest the true base (box.min.y) on y = 0 so the feet sit exactly
    // on the surface (in AR, on the anchored plane).
    // Horizontal: center the SUPPORT FOOTPRINT — the mean X/Z of the lowest slice
    // of vertices (where the feet contact the ground) — over the origin, so the
    // pet is planted on its feet at the placement point instead of centered on
    // its bounding box (which a raised head or tail would bias, making it look
    // off-balance or floating). Falls back to the bbox center if geometry can't
    // be sampled.
    // Float discipline: all sums in f64; guard NaN/Inity and empty geometry;
    // sampled exactly once at load (never per frame).
    const minY = box.min.y;
    const height = Math.max(size.y, 1e-4);
    const footThreshold = minY + height * 0.12;

    let sumX = 0, sumZ = 0, count = 0;
    const v = new THREE.Vector3();
    cloned.traverse((o) => {
      const m = o as THREE.Mesh;
      const geo = (m as any).geometry as THREE.BufferGeometry | undefined;
      if (!m.isMesh || !geo?.attributes?.position) return;
      const pos = geo.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
        if (Number.isFinite(v.x) && Number.isFinite(v.z) && v.y <= footThreshold) {
          sumX += v.x; sumZ += v.z; count += 1;
        }
      }
    });

    const cog = new THREE.Vector3();
    if (count > 0 && Number.isFinite(sumX) && Number.isFinite(sumZ)) {
      cog.set(sumX / count, 0, sumZ / count); // objective footprint COG
    } else {
      box.getCenter(cog); cog.y = 0; // fallback: bounding-box center
    }

    cloned.position.x -= cog.x;
    cloned.position.z -= cog.z;
    cloned.position.y -= minY;

    const targetHeight = avatarType === "human" ? 1.7 : 0.7;
    const scale = targetHeight / (size.y || Math.max(size.x, size.z) || 1);
    cloned.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.castShadow = true;
        m.receiveShadow = true;
      }
    });
    return { model: cloned, fitScale: scale };
  }, [scene, avatarType]);

  const { actions, names } = useAnimations(animations, group);
  const action = useAvatarScene((s) => s.action);
  const currentClipRef = useRef<string | null>(null);
  const procPhase = useRef(0);

  React.useEffect(() => {
    const clip = resolveClipName(action, names, avatarType);
    if (!clip || !actions[clip]) {
      currentClipRef.current = null;
      return;
    }
    if (currentClipRef.current === clip) return;
    const next = actions[clip]!;
    const prev = currentClipRef.current ? actions[currentClipRef.current] : null;
    next.reset().fadeIn(0.25).play();
    next.setLoop(LOOPING[action] ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
    next.clampWhenFinished = !LOOPING[action];
    if (prev && prev !== next) prev.fadeOut(0.25);
    currentClipRef.current = clip;
  }, [action, actions, names, avatarType]);

  useFrame((_, dt) => {
    const g = group.current;
    if (!g) return;
    const { target, setFacing } = useAvatarScene.getState();
    const dx = target.x - g.position.x;
    const dz = target.z - g.position.z;
    const distv = Math.hypot(dx, dz);
    const wantsMove = action === "walking" || action === "running";
    const moving = distv > 0.05 && wantsMove;
    if (moving) {
      const speed = (action === "running" ? RUN_SPEED : WALK_SPEED) * dt;
      const step = Math.min(speed, distv);
      g.position.x += (dx / distv) * step;
      g.position.z += (dz / distv) * step;
      const heading = Math.atan2(dx, dz);
      g.rotation.y = heading;
      setFacing(heading);
    }
    if (currentClipRef.current === null) {
      procPhase.current += dt;
      if (avatarType === "human") {
        applyHumanProcedural(g, action, procPhase.current);
      } else {
        applyProcedural(g, action, procPhase.current);
      }
      if (moving) g.rotation.y = Math.atan2(dx, dz);
    }
    useAvatarScene.getState().setPosition({ x: g.position.x, z: g.position.z });
  });

  return (
    <group ref={group} dispose={null}>
      <group scale={fitScale}>
        <primitive object={model} />
      </group>
    </group>
  );
}
