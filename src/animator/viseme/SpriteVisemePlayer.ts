/**
 * SpriteVisemePlayer.ts — 2D sprite variant of the lip-sync player.
 *
 * Shares the exact same validated-player contract as `LipSyncPlayer`: it takes
 * a `VisemeTrack` + authoritative clock and, each frame, samples the active
 * viseme and reports it via `onShape`. This lets Randy's 2D representation use
 * the identical Tier C/B/A pipeline as a 3D rigged pet (ANIM-LIP-03).
 */

import { VisemeShape, VisemeTrack, activeVisemeAt } from "./visemeRules.ts";

export interface SpriteVisemePlayerOptions {
  getClock?: () => number;
  onShape: (shape: VisemeShape) => void;
  onEnd?: () => void;
}

export class SpriteVisemePlayer {
  private track: VisemeTrack | null;
  private opts: Required<Pick<SpriteVisemePlayerOptions, "getClock">> & Pick<SpriteVisemePlayerOptions, "onShape" | "onEnd">;
  private state: "idle" | "playing" | "paused" | "ended" = "idle";
  private startTime = 0;
  private pausedAt = 0;
  private pausedAccum = 0;
  private endedFired = false;
  private lastShape: VisemeShape | null = null;

  constructor(track: VisemeTrack | null, options: SpriteVisemePlayerOptions) {
    this.track = track;
    this.opts = {
      getClock: options.getClock ?? (() => 0),
      onShape: options.onShape,
      onEnd: options.onEnd,
    };
  }

  setTrack(track: VisemeTrack | null): void {
    this.track = track;
  }
  getState() {
    return this.state;
  }

  start(clockNow = this.opts.getClock()): void {
    this.startTime = clockNow;
    this.pausedAccum = 0;
    this.endedFired = false;
    this.lastShape = null;
    this.state = "playing";
  }
  pause(clockNow = this.opts.getClock()): void {
    if (this.state !== "playing") return;
    this.pausedAt = clockNow;
    this.state = "paused";
  }
  resume(clockNow = this.opts.getClock()): void {
    if (this.state !== "paused") return;
    this.pausedAccum += clockNow - this.pausedAt;
    this.state = "playing";
  }
  seek(seconds: number, clockNow = this.opts.getClock()): void {
    this.startTime = clockNow - seconds - this.pausedAccum;
    this.endedFired = false;
    if (this.state === "ended") this.state = "playing";
  }

  update(clockNow = this.opts.getClock()): void {
    if (this.state !== "playing" || !this.track) return;
    const p = clockNow - this.startTime - this.pausedAccum;
    if (p >= this.track.durationSec) {
      if (!this.endedFired) {
        this.endedFired = true;
        this.state = "ended";
        this.opts.onEnd?.();
      }
      return;
    }
    const { cue } = activeVisemeAt(this.track, p);
    const shape = cue ? cue.v : "X";
    if (shape !== this.lastShape) {
      this.lastShape = shape;
      this.opts.onShape(shape);
    }
  }

  stop(): void {
    this.state = "idle";
    this.lastShape = null;
  }
  dispose(): void {
    this.stop();
  }
}
