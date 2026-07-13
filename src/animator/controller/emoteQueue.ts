/**
 * EmoteQueue — ANIM-RUN-03.
 *
 * Priority-based queue for idle life emotes and reactive expressions.
 * Enqueued clips play on overlay layers (default L1) without interrupting
 * the base locomotion on L0.
 *
 * API:
 *   emoteQueue.enqueue({clip, layer, priority, holdSec, cooldownSec})
 *
 * Rules:
 *   - Only interrupts entries of the same or lower priority.
 *   - Starvation-safe: entries at priority 0 are never starved.
 *   - Cooldowns prevent rapid replay of the same clip.
 *   - Seamless blend: cross-fade into the emote at `holdSec`.
 */

import * as THREE from "three";
import type { LayeredAnimationController } from "./createAnimationController.ts";
import type { AnimationLayer } from "../types.ts";
import type { EmoteEntry, EmotePlaying } from "./layers.ts";
import { resolveMask } from "./animationSets.ts";

// ──────────────────────────────────────────────────────────────────────
// EmoteQueue
// ──────────────────────────────────────────────────────────────────────

export interface EmoteQueueOptions {
  /** Default hold duration for emotes (seconds). */
  defaultHoldSec?: number;
  /** Default cooldown (seconds). */
  defaultCooldownSec?: number;
  /** Minimum gap between identical clips to avoid repetition. */
  minRepeatGapSec?: number;
  /** AnimationSetV2 key used to resolve declared overlay masks. */
  setType?: string;
}

export class EmoteQueue {
  private queue: EmoteEntry[] = [];
  private playing: EmotePlaying | null = null;
  private controller: LayeredAnimationController;
  private lastPlayedClip: string | null = null;
  private lastPlayedAt: number = 0;
  private playingElapsedSec = 0;

  private readonly defaultHoldSec: number;
  private readonly defaultCooldownSec: number;
  private readonly minRepeatGapSec: number;
  private readonly setType: string;

  constructor(controller: LayeredAnimationController, opts?: EmoteQueueOptions) {
    this.controller = controller;
    this.defaultHoldSec = opts?.defaultHoldSec ?? 2;
    this.defaultCooldownSec = opts?.defaultCooldownSec ?? 5;
    this.minRepeatGapSec = opts?.minRepeatGapSec ?? 3;
    this.setType = opts?.setType ?? "quadruped";
  }

  /**
   * Enqueue an emote. Returns whether it was accepted.
   *
   * Returns false if:
   *   - A clip at the same priority is already playing
   *   - The cooldown hasn't expired
   *   - The clip was played too recently (repetition guard)
   */
  enqueue(entry: Omit<EmoteEntry, "cooldownUntil">): boolean {
    // Guard against already playing the same clip
    if (this.playing && this.playing.entry.clip === entry.clip) {
      return false;
    }

    // Check cooldown
    const cooldownUntil = Date.now() + (entry.cooldownSec ?? this.defaultCooldownSec) * 1000;
    if (this.lastPlayedClip === entry.clip && this.lastPlayedAt > 0) {
      const elapsed = Date.now() - this.lastPlayedAt;
      if (elapsed < (entry.cooldownSec ?? this.defaultCooldownSec) * 1000) {
        return false; // cooldown active
      }
    }

    // Starvation-safe: priority 0 entries are always accepted
    if (entry.priority > 0 && this.playing && this.playing.entry.priority > entry.priority) {
      return false; // higher-priority emote already playing
    }

    // Add to queue
    const normalized: EmoteEntry = {
      ...entry,
      cooldownSec: entry.cooldownSec ?? this.defaultCooldownSec,
      cooldownUntil,
      layer: entry.layer ?? "L1",
      priority: entry.priority ?? 0,
      holdSec: entry.holdSec ?? this.defaultHoldSec,
    };

    // Insert in priority order (higher priority first)
    // Also sort by insertion order within same priority (FIFO)
    const insertIdx = this.queue.findIndex((q) => q.priority < normalized.priority);
    if (insertIdx >= 0) {
      this.queue.splice(insertIdx, 0, normalized);
    } else {
      this.queue.push(normalized);
    }

    return true;
  }

  /**
   * Process the queue: play the next entry if nothing is playing,
   * or interrupt the current one if the front-of-queue has higher priority.
   */
  tick(dt: number): void {
    if (this.playing) this.playingElapsedSec += Math.max(0, dt);
    if (!this.queue.length) {
      // Nothing in queue; check if an emote has finished
      if (this.playing) {
        if (this.playingElapsedSec >= this.playing.entry.holdSec) {
          this.finishEmote();
        }
      }
      return;
    }

    // If nothing is playing, start the front of the queue
    if (!this.playing) {
      this.startNextEmote();
      return;
    }

    // Check if a higher-priority entry is waiting (shouldn't happen since we
    // insert in priority order, but handle edge cases)
    const front = this.queue[0];
    if (front && front.priority > this.playing.entry.priority) {
      // Interrupt current and start front
      this.finishEmote();
      this.startNextEmote();
      return;
    }

    // Check if current emote has finished
    if (this.playingElapsedSec >= this.playing.entry.holdSec) {
      this.finishEmote();
      // Start next if any
      if (this.queue.length > 0) {
        this.startNextEmote();
      }
    }
  }

  /** Get the currently playing emote, if any. */
  getPlaying(): EmoteEntry | null {
    return this.playing ? this.playing.entry : null;
  }

  /** Peek at the next queued entry without starting it. */
  peekNext(): EmoteEntry | null {
    return this.queue[0] ?? null;
  }

  /** Clear all queued and playing emotes. */
  clear(): void {
    this.queue = [];
    if (this.playing) {
      this.playing.action?.stop();
      this.playing = null;
      this.playingElapsedSec = 0;
    }
  }

  /** Get queue depth (not counting playing). */
  getDepth(): number {
    return this.queue.length;
  }

  private startNextEmote(): void {
    if (this.queue.length === 0) return;

    const entry = this.queue.shift()!;
    this.lastPlayedClip = entry.clip;
    this.lastPlayedAt = Date.now();

    this.controller.playOverlay(entry.clip, {
      layer: entry.layer === "L1" ? "L1" : undefined,
      holdSec: entry.holdSec,
      mask: resolveMask(this.setType, entry.clip) ?? undefined,
      additive: true,
    });
    const action = this.controller.getLayerAction(entry.layer);
    if (!action) return;

    const playing: EmotePlaying = {
      entry,
      startTime: performance.now(),
      action,
    };

    action.setLoop(THREE.LoopOnce, Infinity);
    action.clampWhenFinished = true;
    action.paused = false;
    action.play();

    this.playing = playing;
    this.playingElapsedSec = 0;
  }

  private finishEmote(): void {
    if (!this.playing) return;
    this.playing.action?.stop();
    this.playing = null;
    this.playingElapsedSec = 0;
  }
}
