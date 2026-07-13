/**
 * LipSyncPlayer.ts — ANIM-LIP-03 runtime.
 *
 * Plays a validated VisemeTrack on an avatar using the authoritative audio
 * clock (AudioContext.currentTime by default). Writes to:
 *   1. morph targets  viseme_A … viseme_X  (15-target Oculus/MPEG-4 FBA subset)
 *   2. bone-only fallback: jaw open + lip-corner bones (per-species map)
 *   3. Tier A amplitude fallback (no track available)
 *
 * Design rules (Checkpoint B/C):
 *  • Clock is injected: production passes `() => audioCtx.currentTime - startOffset`
 *    so AudioContext suspension naturally pauses playback. Never uses frame
 *    counting or Date.now().
 *  • Cross-fades viseme weights over 50–80 ms (default 65 ms).
 *  • No per-frame allocations in the playback loop (reused weight vector +
 *    cached mesh/bone references gathered at construction).
 *  • L2 override: the player writes face targets directly; the caller must call
 *    player.update() AFTER mixer.update() so L2 wins over L0/L1 clip tracks on
 *    the same targets. It only touches face morphs + jaw/lip-corner bones, never
 *    body bones, so L0 locomotion and L1 emotes continue uninterrupted.
 *  • Resets face transforms/morphs on stop, dispose, interruption, and end.
 *  • Degrades cleanly when an avatar lacks a requested morph or bone.
 */

import * as THREE from "three";
import {
  VISEME_SHAPES,
  VISEME_OPENNESS,
  VisemeShape,
  VisemeTrack,
  activeVisemeAt,
} from "./visemeRules.ts";

export type PlayerState = "idle" | "playing" | "paused" | "ended";

export interface LipSyncPlayerOptions {
  /** Authoritative clock in seconds. Defaults to a no-op (must be supplied for real playback). */
  getClock?: () => number;
  /** Morph name prefix. Default "viseme_" → "viseme_A" … "viseme_X". */
  morphPrefix?: string;
  /** Cross-fade duration in seconds (must be within 0.05–0.08). Default 0.065. */
  crossfadeSec?: number;
  /** Bone names for the bone-only fallback. */
  boneMap?: { jaw?: string; lipCornerL?: string; lipCornerR?: string };
  /** Max jaw open rotation (radians). Default 0.5. */
  maxJawRad?: number;
  /** Max lip-corner spread rotation (radians). Default 0.35. */
  maxCornerRad?: number;
  /** Tier A amplitude fallback: (t) => jaw openness 0..1 when no track is set. */
  tierA?: (t: number) => number;
  /** Called once when playback reaches the end of the track. */
  onEnd?: () => void;
}

interface MorphBinding {
  mesh: THREE.Mesh;
  index: number;
}

const DEFAULT_BONE_MAP = { jaw: "jaw", lipCornerL: "lipCorner.L", lipCornerR: "lipCorner.R" };

// Lip-corner spread per shape (cosmetic fallback only).
const SHAPE_SPREAD: Record<VisemeShape, number> = {
  X: 0,
  A: 0,
  B: 0.1,
  C: 0.3,
  D: 0.55,
  E: 0.45,
  F: 0.6,
  G: 0.2,
  H: 0.4,
};

export class LipSyncPlayer {
  private root: THREE.Object3D;
  private track: VisemeTrack | null;
  private opts: Required<Pick<LipSyncPlayerOptions, "getClock" | "morphPrefix" | "crossfadeSec" | "maxJawRad" | "maxCornerRad">> &
    Pick<LipSyncPlayerOptions, "tierA" | "onEnd"> & { boneMap: { jaw: string; lipCornerL: string; lipCornerR: string } };

  private state: PlayerState = "idle";
  private startTime = 0;
  private pausedAt = 0;
  private pausedAccum = 0;
  private lastClock = 0;
  private endedFired = false;

  // Reused weight vector (no per-frame allocation).
  private weights: Record<VisemeShape, number>;
  private targetWeights: Record<VisemeShape, number>;
  // Cached bindings.
  private morphBindings = new Map<VisemeShape, MorphBinding[]>();
  private jawBone: THREE.Object3D | null = null;
  private cornerLBone: THREE.Object3D | null = null;
  private cornerRBone: THREE.Object3D | null = null;
  private jawBind = new THREE.Euler();
  private cornerLBind = new THREE.Euler();
  private cornerRBind = new THREE.Euler();

  constructor(root: THREE.Object3D, track: VisemeTrack | null, options: LipSyncPlayerOptions = {}) {
    this.root = root;
    this.track = track;
    this.opts = {
      getClock: options.getClock ?? (() => 0),
      morphPrefix: options.morphPrefix ?? "viseme_",
      crossfadeSec: clamp(options.crossfadeSec ?? 0.065, 0.05, 0.08),
      maxJawRad: options.maxJawRad ?? 0.5,
      maxCornerRad: options.maxCornerRad ?? 0.35,
      tierA: options.tierA,
      onEnd: options.onEnd,
      boneMap: {
        jaw: options.boneMap?.jaw ?? DEFAULT_BONE_MAP.jaw,
        lipCornerL: options.boneMap?.lipCornerL ?? DEFAULT_BONE_MAP.lipCornerL,
        lipCornerR: options.boneMap?.lipCornerR ?? DEFAULT_BONE_MAP.lipCornerR,
      },
    };
    this.weights = Object.fromEntries(VISEME_SHAPES.map((s) => [s, 0])) as Record<VisemeShape, number>;
    this.targetWeights = Object.fromEntries(VISEME_SHAPES.map((s) => [s, 0])) as Record<VisemeShape, number>;
    this.collectBindings();
  }

  /** Gather morph + bone references once (called at construction). */
  private collectBindings(): void {
    this.root.traverse((obj: any) => {
      if (obj.isMesh && obj.morphTargetDictionary && obj.morphTargetInfluences) {
        for (const shape of VISEME_SHAPES) {
          const name = `${this.opts.morphPrefix}${shape}`;
          const idx = obj.morphTargetDictionary[name];
          if (idx !== undefined) {
            const arr = this.morphBindings.get(shape) ?? [];
            arr.push({ mesh: obj as THREE.Mesh, index: idx });
            this.morphBindings.set(shape, arr);
          }
        }
      }
    });
    const bm = this.opts.boneMap;
    this.jawBone = this.root.getObjectByName(bm.jaw) ?? null;
    this.cornerLBone = this.root.getObjectByName(bm.lipCornerL) ?? null;
    this.cornerRBone = this.root.getObjectByName(bm.lipCornerR) ?? null;
    if (this.jawBone) this.jawBind.copy(this.jawBone.rotation);
    if (this.cornerLBone) this.cornerLBind.copy(this.cornerLBone.rotation);
    if (this.cornerRBone) this.cornerRBind.copy(this.cornerRBone.rotation);
  }

  setTrack(track: VisemeTrack | null): void {
    this.track = track;
  }

  getState(): PlayerState {
    return this.state;
  }

  /** Begin playback. `clockNow` is the current authoritative clock (seconds). */
  start(clockNow: number = this.opts.getClock()): void {
    this.startTime = clockNow;
    this.pausedAccum = 0;
    this.lastClock = clockNow;
    this.endedFired = false;
    this.state = "playing";
  }

  pause(clockNow: number = this.opts.getClock()): void {
    if (this.state !== "playing") return;
    this.pausedAt = clockNow;
    this.state = "paused";
  }

  resume(clockNow: number = this.opts.getClock()): void {
    if (this.state !== "paused") return;
    this.pausedAccum += clockNow - this.pausedAt;
    this.lastClock = clockNow;
    this.state = "playing";
  }

  /** Seek to absolute playback position `seconds`. */
  seek(seconds: number, clockNow: number = this.opts.getClock()): void {
    this.startTime = clockNow - seconds - this.pausedAccum;
    this.lastClock = clockNow;
    this.endedFired = false;
    if (this.state === "ended") this.state = "playing";
  }

  /** Replay from the beginning using the current track. */
  replay(clockNow: number = this.opts.getClock()): void {
    this.resetFace();
    this.start(clockNow);
  }

  stop(): void {
    this.state = "idle";
    this.resetFace();
  }

  dispose(): void {
    this.state = "idle";
    this.resetFace();
    this.morphBindings.clear();
    this.jawBone = null;
    this.cornerLBone = null;
    this.cornerRBone = null;
  }

  /** Playback position in seconds (<= 0 before start, >= duration after end). */
  private playbackTime(clockNow: number): number {
    return clockNow - this.startTime - this.pausedAccum;
  }

  /**
   * Advance playback to the current clock. Safe to call every animation frame.
   * Only writes face targets; never touches body bones.
   */
  update(clockNow: number = this.opts.getClock()): void {
    if (this.state !== "playing") return;
    const p = this.playbackTime(clockNow);

    // End-of-track detection.
    if (this.track && p >= this.track.durationSec) {
      if (!this.endedFired) {
        this.endedFired = true;
        this.state = "ended";
        this.resetFace();
        this.opts.onEnd?.();
        return;
      }
    }

    // Determine target weights.
    const target = this.targetWeights;
    for (const shape of VISEME_SHAPES) target[shape] = 0;
    if (this.track) {
      const { cue } = activeVisemeAt(this.track, p);
      if (cue) target[cue.v] = 1;
    } else if (this.opts.tierA) {
      // Tier A: drive jaw openness directly; no discrete visemes.
      const open = clamp(this.opts.tierA(Math.max(0, p)), 0, 1);
      // Map openness to a pseudo-weight on A/X boundary for bone fallback.
      target.A = open;
    }

    // Cross-fade weights.
    const dt = Math.max(0, clockNow - this.lastClock);
    const alpha = this.opts.crossfadeSec > 0 ? Math.min(1, dt / this.opts.crossfadeSec) : 1;
    for (const s of VISEME_SHAPES) {
      this.weights[s] += (target[s] - this.weights[s]) * alpha;
    }
    this.lastClock = clockNow;

    this.writeFace();
  }

  /** Write current weights to morphs + face bones. */
  private writeFace(): void {
    // Morph targets (skip shapes with no binding — graceful degrade).
    for (const shape of VISEME_SHAPES) {
      const bindings = this.morphBindings.get(shape);
      if (!bindings) continue;
      const w = this.weights[shape];
      for (const b of bindings) {
        (b.mesh.morphTargetInfluences as number[])[b.index] = w;
      }
    }

    // Bone-only fallback (openness + spread).
    let open = 0;
    let spread = 0;
    for (const s of VISEME_SHAPES) {
      open += this.weights[s] * VISEME_OPENNESS[s];
      spread += this.weights[s] * SHAPE_SPREAD[s];
    }
    if (this.jawBone) {
      this.jawBone.rotation.x = this.jawBind.x + open * this.opts.maxJawRad;
    }
    if (this.cornerLBone) {
      this.cornerLBone.rotation.z = this.cornerLBind.z + spread * this.opts.maxCornerRad;
    }
    if (this.cornerRBone) {
      this.cornerRBone.rotation.z = this.cornerRBind.z - spread * this.opts.maxCornerRad;
    }
  }

  /** Reset all face targets to bind/rest. */
  resetFace(): void {
    for (const shape of VISEME_SHAPES) {
      this.weights[shape] = 0;
      const bindings = this.morphBindings.get(shape);
      if (bindings) {
        for (const b of bindings) {
          (b.mesh.morphTargetInfluences as number[])[b.index] = 0;
        }
      }
    }
    if (this.jawBone) this.jawBone.rotation.copy(this.jawBind);
    if (this.cornerLBone) this.cornerLBone.rotation.copy(this.cornerLBind);
    if (this.cornerRBone) this.cornerRBone.rotation.copy(this.cornerRBind);
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
