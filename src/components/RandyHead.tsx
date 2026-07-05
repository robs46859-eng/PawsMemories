/**
 * RandyHead.tsx — Procedural 3D golden-retriever talking head.
 *
 * Renders a stylized golden retriever head using Three.js primitives via
 * @react-three/fiber. Supports expression states (idle, listen, think, talk, happy)
 * and a mouthOpen morph driven by the lip-sync engine.
 *
 * Designed as a stopgap until a proper artist-created GLB with morph targets
 * is available at public/models/randy_head.glb.
 */

import React, { useRef, useImperativeHandle, forwardRef, useState, useCallback, useMemo } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { RandyHeadState } from "../types";

// ─── Public imperative API ───────────────────────────────────────────────────

export interface RandyHeadRef {
  setState: (state: RandyHeadState) => void;
  setMouthOpen: (value: number) => void;
}

// ─── Colors ──────────────────────────────────────────────────────────────────

const FUR_COLOR = "#DAA520";      // golden
const FUR_DARK = "#B8860B";       // darker golden for ears/snout shadow
const NOSE_COLOR = "#2C1A0E";     // dark brown/black
const EYE_COLOR = "#1A0F00";      // very dark brown
const EYE_WHITE = "#FFFEF5";      // warm white
const TONGUE_COLOR = "#E87B8A";   // pink
const INNER_EAR = "#E8B87B";      // light tan

// ─── Inner head mesh (renders inside the Canvas) ─────────────────────────────

interface HeadMeshProps {
  stateRef: React.MutableRefObject<RandyHeadState>;
  mouthRef: React.MutableRefObject<number>;
}

function HeadMesh({ stateRef, mouthRef }: HeadMeshProps) {
  const groupRef = useRef<THREE.Group>(null);
  const jawRef = useRef<THREE.Group>(null);
  const tongueRef = useRef<THREE.Mesh>(null);
  const eyeLeftRef = useRef<THREE.Group>(null);
  const eyeRightRef = useRef<THREE.Group>(null);
  const lidLeftRef = useRef<THREE.Mesh>(null);
  const lidRightRef = useRef<THREE.Mesh>(null);
  const earLeftRef = useRef<THREE.Mesh>(null);
  const earRightRef = useRef<THREE.Mesh>(null);

  // Animation state
  const phaseRef = useRef(0);
  const blinkTimer = useRef(Math.random() * 4 + 3);
  const blinkPhase = useRef(0);
  const isBlinking = useRef(false);

  // Memoize materials so they aren't recreated each frame
  const materials = useMemo(() => ({
    fur: new THREE.MeshStandardMaterial({ color: FUR_COLOR, roughness: 0.85, metalness: 0.05 }),
    furDark: new THREE.MeshStandardMaterial({ color: FUR_DARK, roughness: 0.9, metalness: 0.02 }),
    nose: new THREE.MeshStandardMaterial({ color: NOSE_COLOR, roughness: 0.3, metalness: 0.1 }),
    eye: new THREE.MeshStandardMaterial({ color: EYE_COLOR, roughness: 0.2, metalness: 0.1 }),
    eyeWhite: new THREE.MeshStandardMaterial({ color: EYE_WHITE, roughness: 0.6 }),
    tongue: new THREE.MeshStandardMaterial({ color: TONGUE_COLOR, roughness: 0.7 }),
    innerEar: new THREE.MeshStandardMaterial({ color: INNER_EAR, roughness: 0.8 }),
    lid: new THREE.MeshStandardMaterial({ color: FUR_COLOR, roughness: 0.85, metalness: 0.05 }),
  }), []);

  useFrame((_, dt) => {
    if (!groupRef.current) return;
    const state = stateRef.current;
    const mouthOpen = mouthRef.current;
    phaseRef.current += dt;
    const t = phaseRef.current;

    // ── Breathing ──
    const breathe = Math.sin(t * 2.0) * 0.008;
    groupRef.current.position.y = breathe;

    // ── Head motion by state ──
    let targetRotX = 0;
    let targetRotY = 0;
    let targetRotZ = 0;

    switch (state) {
      case "listen":
        // Ears perk + slight head tilt
        targetRotZ = 0.12;
        targetRotX = -0.05;
        break;
      case "think":
        // Side-to-side head bob
        targetRotZ = Math.sin(t * 1.8) * 0.15;
        targetRotY = Math.sin(t * 1.2) * 0.08;
        break;
      case "talk":
        // Subtle nod while speaking
        targetRotX = Math.sin(t * 3) * 0.04;
        targetRotY = Math.sin(t * 1.5) * 0.03;
        break;
      case "happy":
        // Happy head bob (like a pant)
        targetRotX = Math.sin(t * 6) * 0.06;
        groupRef.current.position.y = breathe + Math.abs(Math.sin(t * 5)) * 0.015;
        break;
      default: // idle
        targetRotX = Math.sin(t * 0.7) * 0.02;
        targetRotY = Math.sin(t * 0.5) * 0.015;
    }

    // Smooth lerp rotation
    groupRef.current.rotation.x += (targetRotX - groupRef.current.rotation.x) * 4 * dt;
    groupRef.current.rotation.y += (targetRotY - groupRef.current.rotation.y) * 4 * dt;
    groupRef.current.rotation.z += (targetRotZ - groupRef.current.rotation.z) * 4 * dt;

    // ── Jaw / mouth ──
    if (jawRef.current) {
      const targetJaw = -mouthOpen * 0.18;
      jawRef.current.rotation.x += (targetJaw - jawRef.current.rotation.x) * 12 * dt;
    }

    // ── Tongue ──
    if (tongueRef.current) {
      const tongueShow = state === "happy" ? 0.7 : mouthOpen * 0.5;
      tongueRef.current.scale.y = 0.5 + tongueShow * 0.8;
      tongueRef.current.visible = tongueShow > 0.1;
    }

    // ── Blinking ──
    blinkTimer.current -= dt;
    if (blinkTimer.current <= 0 && !isBlinking.current) {
      isBlinking.current = true;
      blinkPhase.current = 0;
    }
    if (isBlinking.current) {
      blinkPhase.current += dt * 8;
      if (blinkPhase.current > Math.PI) {
        isBlinking.current = false;
        blinkTimer.current = 3 + Math.random() * 3;
        blinkPhase.current = 0;
      }
    }
    const blinkAmount = isBlinking.current ? Math.sin(blinkPhase.current) : 0;
    if (lidLeftRef.current) lidLeftRef.current.scale.y = 0.01 + blinkAmount * 1.0;
    if (lidRightRef.current) lidRightRef.current.scale.y = 0.01 + blinkAmount * 1.0;

    // ── Ears ──
    const earPerk = state === "listen" ? 0.25 : state === "happy" ? 0.15 : 0;
    if (earLeftRef.current) {
      const targetEarL = -0.4 + earPerk;
      earLeftRef.current.rotation.z += (targetEarL - earLeftRef.current.rotation.z) * 3 * dt;
    }
    if (earRightRef.current) {
      const targetEarR = 0.4 - earPerk;
      earRightRef.current.rotation.z += (targetEarR - earRightRef.current.rotation.z) * 3 * dt;
    }
  });

  return (
    <group ref={groupRef} position={[0, -0.1, 0]}>
      {/* ── Main head sphere ── */}
      <mesh material={materials.fur}>
        <sphereGeometry args={[0.52, 32, 24]} />
      </mesh>

      {/* ── Forehead tuft (slightly raised) ── */}
      <mesh position={[0, 0.38, 0.22]} material={materials.fur}>
        <sphereGeometry args={[0.22, 16, 12]} />
      </mesh>

      {/* ── Cheeks ── */}
      <mesh position={[-0.3, -0.08, 0.28]} material={materials.fur}>
        <sphereGeometry args={[0.2, 16, 12]} />
      </mesh>
      <mesh position={[0.3, -0.08, 0.28]} material={materials.fur}>
        <sphereGeometry args={[0.2, 16, 12]} />
      </mesh>

      {/* ── Snout (upper) ── */}
      <mesh position={[0, -0.08, 0.42]} material={materials.fur} scale={[0.8, 0.6, 0.9]}>
        <sphereGeometry args={[0.28, 20, 16]} />
      </mesh>

      {/* ── Jaw (lower snout, animated) ── */}
      <group ref={jawRef} position={[0, -0.18, 0.35]}>
        <mesh material={materials.furDark} scale={[0.7, 0.4, 0.75]}>
          <sphereGeometry args={[0.24, 16, 12]} />
        </mesh>
        {/* Tongue (inside mouth) */}
        <mesh ref={tongueRef} position={[0, -0.02, 0.08]} material={materials.tongue}
              scale={[0.5, 0.5, 0.6]} visible={false}>
          <sphereGeometry args={[0.1, 12, 8]} />
        </mesh>
      </group>

      {/* ── Nose ── */}
      <mesh position={[0, -0.02, 0.65]} material={materials.nose}>
        <sphereGeometry args={[0.08, 16, 12]} />
      </mesh>

      {/* ── Eyes ── */}
      {/* Left eye */}
      <group ref={eyeLeftRef} position={[-0.18, 0.12, 0.42]}>
        <mesh material={materials.eyeWhite}>
          <sphereGeometry args={[0.085, 16, 12]} />
        </mesh>
        <mesh position={[0, 0, 0.05]} material={materials.eye}>
          <sphereGeometry args={[0.055, 14, 10]} />
        </mesh>
        {/* Pupil highlight */}
        <mesh position={[0.02, 0.02, 0.085]}>
          <sphereGeometry args={[0.018, 8, 8]} />
          <meshStandardMaterial color="#ffffff" emissive="#ffffff" emissiveIntensity={0.5} />
        </mesh>
        {/* Eyelid (for blinking) */}
        <mesh ref={lidLeftRef} position={[0, 0.06, 0.02]} material={materials.lid}
              scale={[1.2, 0.01, 1.1]}>
          <sphereGeometry args={[0.09, 12, 8]} />
        </mesh>
      </group>

      {/* Right eye */}
      <group ref={eyeRightRef} position={[0.18, 0.12, 0.42]}>
        <mesh material={materials.eyeWhite}>
          <sphereGeometry args={[0.085, 16, 12]} />
        </mesh>
        <mesh position={[0, 0, 0.05]} material={materials.eye}>
          <sphereGeometry args={[0.055, 14, 10]} />
        </mesh>
        <mesh position={[0.02, 0.02, 0.085]}>
          <sphereGeometry args={[0.018, 8, 8]} />
          <meshStandardMaterial color="#ffffff" emissive="#ffffff" emissiveIntensity={0.5} />
        </mesh>
        <mesh ref={lidRightRef} position={[0, 0.06, 0.02]} material={materials.lid}
              scale={[1.2, 0.01, 1.1]}>
          <sphereGeometry args={[0.09, 12, 8]} />
        </mesh>
      </group>

      {/* ── Eyebrows (fur ridges) ── */}
      <mesh position={[-0.2, 0.25, 0.38]} rotation={[0, 0, 0.2]} material={materials.furDark}
            scale={[1.2, 0.3, 0.6]}>
        <sphereGeometry args={[0.08, 10, 6]} />
      </mesh>
      <mesh position={[0.2, 0.25, 0.38]} rotation={[0, 0, -0.2]} material={materials.furDark}
            scale={[1.2, 0.3, 0.6]}>
        <sphereGeometry args={[0.08, 10, 6]} />
      </mesh>

      {/* ── Ears (floppy, golden retriever style) ── */}
      {/* Left ear */}
      <mesh
        ref={earLeftRef}
        position={[-0.45, 0.15, -0.05]}
        rotation={[0.3, 0, -0.4]}
        material={materials.furDark}
        scale={[0.6, 1.0, 0.25]}
      >
        <sphereGeometry args={[0.25, 14, 10]} />
      </mesh>
      {/* Left ear inner */}
      <mesh
        position={[-0.48, 0.1, 0.0]}
        rotation={[0.3, 0, -0.4]}
        material={materials.innerEar}
        scale={[0.4, 0.7, 0.15]}
      >
        <sphereGeometry args={[0.22, 10, 8]} />
      </mesh>

      {/* Right ear */}
      <mesh
        ref={earRightRef}
        position={[0.45, 0.15, -0.05]}
        rotation={[0.3, 0, 0.4]}
        material={materials.furDark}
        scale={[0.6, 1.0, 0.25]}
      >
        <sphereGeometry args={[0.25, 14, 10]} />
      </mesh>
      {/* Right ear inner */}
      <mesh
        position={[0.48, 0.1, 0.0]}
        rotation={[0.3, 0, 0.4]}
        material={materials.innerEar}
        scale={[0.4, 0.7, 0.15]}
      >
        <sphereGeometry args={[0.22, 10, 8]} />
      </mesh>

      {/* ── Neck ── */}
      <mesh position={[0, -0.45, -0.1]} material={materials.fur} scale={[0.9, 0.6, 0.7]}>
        <sphereGeometry args={[0.38, 16, 12]} />
      </mesh>
    </group>
  );
}

// ─── Main exported component ─────────────────────────────────────────────────

interface RandyHeadProps {
  /** Size of the canvas in pixels */
  size?: number;
  /** If true, pauses the render loop for battery savings */
  paused?: boolean;
  /** Optional className for the container */
  className?: string;
}

const RandyHead = forwardRef<RandyHeadRef, RandyHeadProps>(
  function RandyHead({ size = 120, paused = false, className = "" }, ref) {
    const stateRef = useRef<RandyHeadState>("idle");
    const mouthRef = useRef(0);

    const setState = useCallback((s: RandyHeadState) => {
      stateRef.current = s;
    }, []);

    const setMouthOpen = useCallback((v: number) => {
      mouthRef.current = Math.max(0, Math.min(1, v));
    }, []);

    useImperativeHandle(ref, () => ({
      setState,
      setMouthOpen,
    }), [setState, setMouthOpen]);

    return (
      <div
        className={className}
        style={{
          width: size,
          height: size,
          borderRadius: "50%",
          overflow: "hidden",
          background: "linear-gradient(135deg, #FFF8E1 0%, #FFE0B2 100%)",
        }}
      >
        <Canvas
          frameloop={paused ? "never" : "always"}
          dpr={[1, 1.5]}
          camera={{ position: [0, 0, 1.9], fov: 35 }}
          gl={{ antialias: true, alpha: true }}
          style={{ background: "transparent" }}
        >
          <ambientLight intensity={0.6} />
          <hemisphereLight intensity={0.5} groundColor="#8B6914" />
          <directionalLight position={[2, 3, 4]} intensity={1.0} />
          <directionalLight position={[-1, 1, 2]} intensity={0.3} />
          <HeadMesh stateRef={stateRef} mouthRef={mouthRef} />
        </Canvas>
      </div>
    );
  },
);

export default RandyHead;
