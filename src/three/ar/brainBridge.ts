/**
 * src/three/ar/brainBridge.ts — AR_PET_SIM_SPEC §4.4 / AR5
 * react-three-fiber hook around the framework-free bridge core (brainBridgeCore).
 * Each frame it ticks the brain and drives the shared store's `action` (clip) and
 * `target` (walk-to-object). Only runs while `active` (pet placed).
 */

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import type { Brain } from "../../brain";
import { useAvatarScene } from "../store";
import { createBrainBridge, type BrainBridge } from "./brainBridgeCore";

export { actionToClip, createBrainBridge } from "./brainBridgeCore";
export type { BrainBridge, BrainBridgeOptions } from "./brainBridgeCore";

export function usePetBrain(active: boolean, brain?: Brain): BrainBridge {
  const ref = useRef<BrainBridge | null>(null);
  if (!ref.current) {
    ref.current = createBrainBridge({
      brain,
      onClip: (a) => useAvatarScene.getState().setAction(a),
      onTarget: (obj) => {
        if (obj) useAvatarScene.getState().setTarget({ x: obj.position[0], z: obj.position[2] });
      },
    });
  }

  useFrame((_, dt) => {
    if (!active) return;
    const st = useAvatarScene.getState();
    const pos = (st as any).position ?? { x: 0, z: 0 };
    ref.current!.step(
      dt,
      typeof performance !== "undefined" ? performance.now() : Date.now(),
      st.placedObjects,
      pos
    );
  });

  return ref.current;
}
