/**
 * 1D locomotion blend space — ANIM-RUN-02.
 *
 * Maps normalized speed to idle/walk/run weights. A shared gait phase is
 * advanced using the dominant clip and then warped through each clip's
 * declared foot-contact markers, keeping contacts aligned across clips with
 * different durations.
 */

import type { LayeredAnimationController } from "./createAnimationController.ts";
import type { AnimationLayer } from "../types.ts";
import { resolveLayer, resolvePhaseMarkers } from "./animationSets.ts";

export const LOCOMOTION_SPEEDS = {
  idle: 0,
  walk: 0.9,
  run: 2.2,
} as const;

export interface BlendEntry {
  name: string;
  clip: string;
  layer: AnimationLayer;
  /** Normalized contact positions in the clip cycle. */
  phaseMarkers: number[];
  duration: number;
}

export interface BlendState {
  active: { entry: BlendEntry; intensity: number }[];
  speed: number;
  prevSpeed: number;
  /** Backward-compatible elapsed time diagnostic. */
  phaseTime: number;
  /** Normalized phase in the dominant clip's gait cycle. */
  gaitPhase: number;
  /** Contact markers defining the shared phase for this frame. */
  referenceMarkers: number[];
}

function cycleDistance(from: number, to: number, fullCycleWhenEqual = false): number {
  const distance = ((to - from) % 1 + 1) % 1;
  return distance === 0 && fullCycleWhenEqual ? 1 : distance;
}

function normalizeMarkers(markers: number[]): number[] {
  const normalized = markers
    .map((marker) => marker >= 0 && marker < 1 ? marker : ((marker % 1) + 1) % 1)
    .filter((marker, index, values) => values.indexOf(marker) === index)
    .sort((a, b) => a - b);
  return normalized.length > 0 ? normalized : [0];
}

/**
 * Warp a phase from one clip's contact intervals into another clip's.
 * Marker boundaries map exactly; progress inside the interval is preserved.
 */
export function mapPhaseBetweenMarkers(
  phase: number,
  sourceMarkers: number[],
  targetMarkers: number[],
): number {
  const source = normalizeMarkers(sourceMarkers);
  const target = normalizeMarkers(targetMarkers);
  const normalizedPhase = phase >= 0 && phase < 1 ? phase : ((phase % 1) + 1) % 1;

  let sourceIndex = source.length - 1;
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] <= normalizedPhase) sourceIndex = index;
  }

  const sourceStart = source[sourceIndex];
  const sourceEnd = source[(sourceIndex + 1) % source.length];
  const intervalProgress = cycleDistance(sourceStart, normalizedPhase)
    / cycleDistance(sourceStart, sourceEnd, true);

  const targetIndex = Math.min(
    target.length - 1,
    Math.floor(sourceIndex * target.length / source.length),
  );
  const targetStart = target[targetIndex];
  const targetEnd = target[(targetIndex + 1) % target.length];
  return (targetStart + intervalProgress * cycleDistance(targetStart, targetEnd, true)) % 1;
}

export function createBlendSpace(
  setType: string,
  controller: LayeredAnimationController,
  opts?: {
    knownClips?: string[];
    /** Test/custom asset override; production defaults to AnimationSetV2. */
    phaseMarkers?: Record<string, number[]>;
  },
): (speed: number, dt: number) => BlendState {
  const knownClipSet = new Set(opts?.knownClips ?? []);
  const clipInfoByName = new Map(controller.listClips().map((clip) => [clip.name, clip]));
  const entries = new Map<string, BlendEntry>();

  for (const clipName of ["idle", "walk", "run"]) {
    const info = clipInfoByName.get(clipName);
    if (!info && !knownClipSet.has(clipName)) continue;
    entries.set(clipName, {
      name: clipName,
      clip: clipName,
      layer: resolveLayer(setType, clipName),
      phaseMarkers: normalizeMarkers(
        opts?.phaseMarkers?.[clipName] ?? resolvePhaseMarkers(setType, clipName),
      ),
      duration: Math.max(info?.duration ?? 1, Number.EPSILON),
    });
  }

  const state: BlendState = {
    active: [],
    speed: 0,
    prevSpeed: 0,
    phaseTime: 0,
    gaitPhase: 0,
    referenceMarkers: [0],
  };

  return function blend(speed: number, dt: number): BlendState {
    speed = Math.max(0, Math.min(1, speed));
    state.prevSpeed = state.speed;
    state.speed = speed;
    state.phaseTime += Math.max(0, dt);

    const rawWeights: { entry: BlendEntry; weight: number }[] = [];
    const idle = entries.get("idle");
    const walk = entries.get("walk");
    const run = entries.get("run");

    if (idle) rawWeights.push({ entry: idle, weight: speed < 0.3 ? 1 - speed / 0.3 : 0 });
    if (walk) {
      const weight = speed < 0.15
        ? speed / 0.15
        : speed < 0.6
          ? 1
          : Math.max(0, 1 - (speed - 0.6) / 0.2);
      rawWeights.push({ entry: walk, weight });
    }
    if (run) rawWeights.push({ entry: run, weight: speed < 0.4 ? 0 : Math.min(1, (speed - 0.4) / 0.4) });

    const totalWeight = rawWeights.reduce((sum, candidate) => sum + candidate.weight, 0);
    const active = totalWeight > 0
      ? rawWeights
        .map(({ entry, weight }) => ({ entry, intensity: weight / totalWeight }))
        .filter(({ intensity }) => intensity > 0.05)
      : [];

    const dominant = active.reduce<typeof active[number] | null>(
      (best, candidate) => !best || candidate.intensity > best.intensity ? candidate : best,
      null,
    );
    if (dominant) {
      state.gaitPhase = mapPhaseBetweenMarkers(
        state.gaitPhase,
        state.referenceMarkers,
        dominant.entry.phaseMarkers,
      );
      state.gaitPhase = (state.gaitPhase + Math.max(0, dt) / dominant.entry.duration) % 1;
      state.referenceMarkers = dominant.entry.phaseMarkers;
    }
    state.active = active;
    return state;
  };
}

export function applyBlendState(
  controller: LayeredAnimationController,
  state: BlendState,
): void {
  controller.setLocomotionBlend(
    state.active
      .filter(({ entry }) => entry.layer === "L0")
      .map(({ entry, intensity }) => ({
        clipName: entry.clip,
        weight: intensity,
        timeSec: mapPhaseBetweenMarkers(
          state.gaitPhase,
          state.referenceMarkers,
          entry.phaseMarkers,
        ) * entry.duration,
      })),
  );
}
