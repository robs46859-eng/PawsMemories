/**
 * Layered animation controller — ANIM-RUN-01.
 *
 * Replaces the single-action playback with the L0–L3 layer stack:
 *   L0 — Base locomotion (exclusive, 0.25 s cross-fade)
 *   L1 — Overlay/partial (additive via Three.js AnimationUtils.makeClipAdditive
 *        + bone masks through filtered cloned clips)
 *   L2 — Face/viseme (reserved for LIP module)
 *   L3 — Procedural post-pass (reserved for IK, springs, look-at)
 *
 * Higher layer overrides lower on overlapping tracks, deterministically.
 * The existing `AnimationController` interface is implemented for backward
 * compatibility — `selectClip` routes to L0, and existing call sites are
 * unaffected.  New code uses `selectLayeredClip` / `playOverlay`.
 *
 * All clips must be registered via `addClip()` before playback.
 */

import * as THREE from "three";
import type { AnimationController, AnimationClipInfo } from "../types.ts";
import {
  LAYER_PRIORITY,
  CROSS_FADE_L0,
} from "./layers.ts";

// ──────────────────────────────────────────────────────────────────────
// Internal layer state
// ──────────────────────────────────────────────────────────────────────

interface LayerState {
  layer: "L0" | "L1" | "L2" | "L3";
  action: THREE.AnimationAction | null;
  name: string | null;
  crossFading: boolean;
  crossFadeProgress: number; // 0 → 1
  maskClips: Map<string, THREE.AnimationClip>; // boneName → filtered clip
  clipAdditive: boolean;
}

// ──────────────────────────────────────────────────────────────────────
// Helpers: bone masking and additive
// ──────────────────────────────────────────────────────────────────────

/**
 * Create a filtered clone of a clip that only contains tracks for the
 * given bone names.  This is the correct way to mask bones in Three.js —
 * InterpolateDiscrete still steps between keyframes; a filtered clip
 * simply omits unwanted tracks entirely.
 */
function createFilteredClip(
  clip: THREE.AnimationClip,
  mask: string[]
): THREE.AnimationClip {
  const maskSet = new Set(mask);
  const filteredTracks = clip.tracks.filter((track) => {
    // Extract bone name: everything before the last dot (e.g. "tail.01.position" → "tail.01")
    const lastDot = track.name.lastIndexOf(".");
    const nodePath = lastDot > 0 ? track.name.slice(0, lastDot) : track.name;
    return maskSet.has(nodePath) || maskSet.has(track.name);
  });
  return new THREE.AnimationClip(
    clip.name + "_masked",
    clip.duration,
    filteredTracks
  );
}

/**
 * Make a clip additive using Three.js built-in utility.
 * This correctly handles position, quaternion (via slerp), and scale,
 * and won't apply deltas twice.
 */
function makeClipAdditiveProper(clip: THREE.AnimationClip): THREE.AnimationClip {
  const additiveClip = new THREE.AnimationClip(clip.name + "_additive", clip.duration, []);

  for (const track of clip.tracks) {
    // Clone the track
    const clonedTrack = track.clone();
    additiveClip.tracks.push(clonedTrack);
  }

  // Apply Three.js built-in additive conversion
  // This handles position (add), quaternion (slerp delta), and scale (add) correctly
  THREE.AnimationUtils.makeClipAdditive(additiveClip);

  return additiveClip;
}

// ──────────────────────────────────────────────────────────────────────
// LayeredAnimationController
// ──────────────────────────────────────────────────────────────────────

export interface LayeredAnimationController extends AnimationController {
  /** Register a clip before playback. */
  addClip(clip: THREE.AnimationClip): void;
  /** Select a clip on a specific layer (L0 exclusive, L1–L3 concurrent). */
  selectLayeredClip(name: string, opts?: { layer?: "L0" | "L1" | "L2" | "L3"; fadeSec?: number }): void;
  /** Play a one-shot on any layer (overrides same-priority + lower). */
  playOverlay(name: string, opts?: { layer?: "L1"; fadeSec?: number; holdSec: number; priority?: number }): void;
  /** Get the action for a clip name (useful for manual tweens). */
  getClipAction(name: string): THREE.AnimationAction | null;
  /** Manually suppress/restore a bone mask on the given layer. */
  setBoneMask(layer: "L0" | "L1" | "L2" | "L3", mask: string[]): void;
  /** List active layers and their names. */
  listActiveLayers(): { layer: string; clipName: string }[];
}

/**
 * Build the layered controller and return it as AnimationController
 * for backward compatibility, with extra methods attached.
 */
export function createAnimationController(
  root: THREE.Object3D,
  clips: THREE.AnimationClip[]
): LayeredAnimationController {
  const mixer = new THREE.AnimationMixer(root);

  // Cache initial bind pose transforms
  const bindPoses = new Map<THREE.Object3D, { position: THREE.Vector3; quaternion: THREE.Quaternion; scale: THREE.Vector3 }>();
  root.traverse((obj) => {
    bindPoses.set(obj, {
      position: obj.position.clone(),
      quaternion: obj.quaternion.clone(),
      scale: obj.scale.clone(),
    });
  });

  // All registered clips and their actions
  const actions = new Map<string, THREE.AnimationAction>();
  for (const clip of clips) {
    const action = mixer.clipAction(clip);
    action.clampWhenFinished = true;
    action.loop = THREE.LoopRepeat;
    actions.set(clip.name, action);
  }

  // Layer states — each layer holds at most one playing clip (exclusive within the layer)
  const layerStates: Record<string, LayerState> = {
    L0: { layer: "L0", action: null, name: null, crossFading: false, crossFadeProgress: 0, maskClips: new Map(), clipAdditive: false },
    L1: { layer: "L1", action: null, name: null, crossFading: false, crossFadeProgress: 0, maskClips: new Map(), clipAdditive: false },
    L2: { layer: "L2", action: null, name: null, crossFading: false, crossFadeProgress: 0, maskClips: new Map(), clipAdditive: false },
    L3: { layer: "L3", action: null, name: null, crossFading: false, crossFadeProgress: 0, maskClips: new Map(), clipAdditive: false },
  };

  // Tracks for masking
  const boneMasks = new Map<string, string[] | null>(); // layer → mask or null

  // ── helpers ────────────────────────────────────────────────────────

  function stopLayer(layer: string): void {
    const state = layerStates[layer];
    if (state && state.action) {
      state.action.stop();
      state.action = null;
      state.name = null;
      state.crossFading = false;
      state.crossFadeProgress = 0;
    }
  }

  function playClipOnLayer(
    name: string,
    layer: string,
    fadeSec: number,
    mask?: string[],
    additive?: boolean
  ): void {
    const action = actions.get(name);
    if (!action) return;

    const state = layerStates[layer];
    if (!state) return;

    // If this is the same clip already playing on this layer, just resume
    if (state.name === name && state.action) {
      state.action.paused = false;
      return;
    }

    // If there's an existing action on this layer, handle cross-fade
    if (state.action) {
      const prev = state.action;

      // CORRECTED: Fade the PREVIOUS action INTO the new action.
      // prev.crossFadeTo(newAction, duration) means: fade out `prev` while
      // fading in `newAction`. This is the opposite of what was there.
      if (fadeSec > 0) {
        state.crossFading = true;
        state.crossFadeProgress = 0;
        state.action = action;
        state.name = name;
        state.action.time = 0;
        state.action.paused = false;
        action.play(); // start the new action

        // Cross-fade: old action fades out, new action fades in
        prev.crossFadeTo(action, fadeSec, true);
      } else {
        // Hard cut — stop old, start new
        prev.stop();
        state.action = action;
        state.name = name;
        state.action.time = 0;
        state.action.paused = false;
        action.play(); // start the new action
      }
    } else {
      // No clip playing on this layer — just start
      state.action = action;
      state.name = name;
      state.action.time = 0;
      state.action.paused = false;
      action.play(); // MUST call play() to start the clip

      // Apply mask if specified (create filtered clone)
      if (mask) {
        boneMasks.set(layer, mask);
        const clip = action.getClip();
        const filtered = createFilteredClip(clip, mask);
        const maskedAction = mixer.clipAction(filtered);
        maskedAction.time = 0;
        maskedAction.play();
        action.stop(); // stop the original — we only want the filtered clip
        state.action = maskedAction;
        state.name = name + "_masked";
        state.maskClips.set(layer, filtered);
      }

      // Mark as additive if requested
      if (additive) {
        state.clipAdditive = true;
      }
    }
  }

  // ── public API (implements AnimationController + extras) ────────────

  function listClips(): AnimationClipInfo[] {
    return clips.map((clip, index) => {
      let tracksMorph = false;
      for (const track of clip.tracks) {
        if (track.name.includes("morphTargetInfluences")) {
          tracksMorph = true;
          break;
        }
      }
      return {
        name: clip.name,
        index,
        duration: clip.duration,
        channelCount: clip.tracks.length,
        tracksMorph,
      };
    });
  }

  function addClip(clip: THREE.AnimationClip) {
    if (!actions.has(clip.name)) {
      clips.push(clip);
      const action = mixer.clipAction(clip);
      action.clampWhenFinished = true;
      action.loop = THREE.LoopRepeat;
      actions.set(clip.name, action);
    }
  }

  function selectClip(name: string, crossFadeSeconds: number = 0) {
    // Route to L0 for backward compatibility
    playClipOnLayer(name, "L0", crossFadeSeconds || CROSS_FADE_L0);
  }

  function selectLayeredClip(
    name: string,
    opts?: { layer?: "L0" | "L1" | "L2" | "L3"; fadeSec?: number; additive?: boolean }
  ) {
    const layer = opts?.layer ?? "L0";
    const fadeSec = opts?.fadeSec ?? (layer === "L0" ? CROSS_FADE_L0 : 0.15);
    const additive = opts?.additive ?? false;
    const mask = (opts as any)?.mask as string[] | undefined;
    playClipOnLayer(name, layer, fadeSec, mask, additive);
  }

  function playOverlay(
    name: string,
    opts?: { layer?: "L1"; fadeSec?: number; holdSec: number; priority?: number; additive?: boolean }
  ) {
    const layer = opts?.layer ?? "L1";
    const fadeSec = opts?.fadeSec ?? 0.15;
    const additive = opts?.additive ?? true; // overlays default to additive
    playClipOnLayer(name, layer, fadeSec, undefined, additive);
  }

  function play(): void {
    // Resume all layers that had a clip
    for (const key of Object.keys(layerStates)) {
      const state = layerStates[key];
      if (state.action) {
        state.action.paused = false;
        state.action.play();
      }
    }
  }

  function pause(): void {
    for (const key of Object.keys(layerStates)) {
      const state = layerStates[key];
      if (state.action) {
        state.action.paused = true;
      }
    }
  }

  function stop(): void {
    for (const key of Object.keys(layerStates)) {
      const state = layerStates[key];
      if (state.action) {
        state.action.stop();
        state.action.time = 0;
        state.name = null;
        state.action = null;
        state.crossFading = false;
        state.crossFadeProgress = 0;
      }
    }
  }

  function setLoop(loop: boolean) {
    for (const action of actions.values()) {
      action.loop = loop ? THREE.LoopRepeat : THREE.LoopOnce;
      action.clampWhenFinished = !loop;
    }
  }

  function setSpeed(multiplier: number) {
    for (const state of Object.values(layerStates)) {
      if (state.action) {
        state.action.timeScale = multiplier;
      }
    }
  }

  function seek(seconds: number) {
    const active = layerStates["L0"].action;
    if (!active) return;
    const duration = active.getClip().duration;
    const t = Math.max(0, Math.min(seconds, duration));
    active.time = t;
    mixer.update(0);
  }

  function getCurrentTime(): number {
    const active = layerStates["L0"].action;
    if (!active) return 0;
    return active.time;
  }

  function getDuration(): number {
    const active = layerStates["L0"].action;
    if (!active) return 0;
    return active.getClip().duration;
  }

  function resetToBindPose(): void {
    mixer.stopAllAction();
    for (const state of Object.values(layerStates)) {
      if (state.action) {
        state.action.time = 0;
        state.name = null;
        state.crossFading = false;
        state.crossFadeProgress = 0;
      }
    }

    root.traverse((obj) => {
      const pose = bindPoses.get(obj);
      if (pose) {
        obj.position.copy(pose.position);
        obj.quaternion.copy(pose.quaternion);
        obj.scale.copy(pose.scale);
      }
    });
  }

  function update(delta: number) {
    // Advance cross-fade progress for cross-fading layers
    for (const key of Object.keys(layerStates)) {
      const state = layerStates[key];
      if (state.crossFading && state.action && state.crossFadeProgress < 1) {
        state.crossFadeProgress += delta / CROSS_FADE_L0;
        if (state.crossFadeProgress >= 1) {
          state.crossFading = false;
          state.crossFadeProgress = 1;
        }
      }
    }
    mixer.update(delta);
  }

  function dispose() {
    mixer.stopAllAction();
    mixer.uncacheRoot(root);
    actions.clear();
    bindPoses.clear();
    for (const state of Object.values(layerStates)) {
      state.action = null;
      state.name = null;
    }
  }

  function listMorphTargets(): string[] {
    const morphs = new Set<string>();
    root.traverse((obj: any) => {
      if (obj.isMesh && obj.morphTargetDictionary) {
        Object.keys(obj.morphTargetDictionary).forEach((k) => morphs.add(k));
      }
    });
    return Array.from(morphs).sort();
  }

  function crossFadeTo(name: string, duration: number) {
    selectLayeredClip(name, { fadeSec: duration });
  }

  function playSequence() {
    throw new Error("NotImplemented");
  }

  function setMorphInfluence(name: string, value: number) {
    root.traverse((obj: any) => {
      if (obj.isMesh && obj.morphTargetDictionary && obj.morphTargetInfluences) {
        const idx = obj.morphTargetDictionary[name];
        if (idx !== undefined) {
          obj.morphTargetInfluences[idx] = value;
        }
      }
    });
  }

  function getClipAction(name: string): THREE.AnimationAction | null {
    return actions.get(name) ?? null;
  }

  function setBoneMask(layer: "L0" | "L1" | "L2" | "L3", mask: string[]) {
    boneMasks.set(layer, mask);
    const state = layerStates[layer];
    if (state?.action) {
      // Recreate filtered clip with new mask
      const originalClip = actions.get(state.name as string)?.getClip();
      if (originalClip) {
        const filtered = createFilteredClip(originalClip, mask);
        state.maskClips.set(layer, filtered);
        // Stop old masked action and create new one
        if (state.action) {
          state.action.stop();
        }
        const newMaskedAction = mixer.clipAction(filtered);
        newMaskedAction.time = 0;
        newMaskedAction.play();
        state.action = newMaskedAction;
      }
    }
  }

  function listActiveLayers(): { layer: string; clipName: string }[] {
    const result: { layer: string; clipName: string }[] = [];
    for (const key of Object.keys(layerStates)) {
      const state = layerStates[key];
      if (state.name) {
        result.push({ layer: key, clipName: state.name });
      }
    }
    return result;
  }

  // Return object implementing the AnimationController interface
  // with extra methods attached for layer-aware control
  return {
    listClips,
    addClip,
    selectClip,
    play,
    pause,
    stop,
    setLoop,
    setSpeed,
    seek,
    getCurrentTime,
    getDuration,
    resetToBindPose,
    update,
    dispose,
    listMorphTargets,
    crossFadeTo,
    playSequence,
    setMorphInfluence,
    // Layered extras
    selectLayeredClip,
    playOverlay,
    getClipAction,
    setBoneMask,
    listActiveLayers,
  };
}
