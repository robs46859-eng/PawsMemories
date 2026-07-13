/**
 * speak.ts — ANIM-LIP-05 speech pipeline integration.
 *
 * text → TTS audio + transcript → Tier B (Rhubarb) viseme job → cached
 * VisemeTrack → synchronized playback.
 *
 * Tier selection (explicit, per spec §5.6):
 *   • Tier C — provider visemes (Azure/ElevenLabs timestamps) when valid.
 *   • Tier B — Rhubarb track when available.
 *   • Tier A — amplitude/jaw fallback when higher tiers are unavailable/fail.
 *
 * A Tier B failure MUST NOT prevent speech audio from playing — audio is started
 * before (and independent of) viseme resolution, and any lipsync error degrades
 * to Tier A.
 */

import type * as THREE from "three";
import { VisemeTrack } from "../viseme/visemeRules.ts";
import { LipSyncPlayer, LipSyncPlayerOptions } from "../viseme/LipSyncPlayer.ts";
import { SpriteVisemePlayer } from "../viseme/SpriteVisemePlayer.ts";
import { tierAAmplitude } from "../../three/randyVisemes.ts";

export type LipSyncTier = "C" | "B" | "A";

export interface TierSelection {
  tier: LipSyncTier;
  track: VisemeTrack | null;
}

/** Pure tier-selection logic (testable without audio). */
export function selectLipSyncTier(opts: {
  providerVisemes?: VisemeTrack | null;
  bTrack?: VisemeTrack | null;
}): TierSelection {
  if (opts.providerVisemes) return { tier: "C", track: opts.providerVisemes };
  if (opts.bTrack) return { tier: "B", track: opts.bTrack };
  return { tier: "A", track: null };
}

export interface Speak3DOptions {
  root: THREE.Object3D;
  /** Start the audio source; return a clock fn `() => seconds`, or null if audio failed. */
  playAudio: () => (() => number) | null;
  transcript?: string;
  language?: string;
  providerVisemes?: VisemeTrack | null;
  /** Resolve the Tier B track (Rhubarb job). May throw → falls back to Tier A. */
  resolveViseme?: () => Promise<VisemeTrack | null>;
  tierA?: (t: number) => number;
  onTier?: (tier: LipSyncTier) => void;
  onEnd?: () => void;
  playerOptions?: Partial<LipSyncPlayerOptions>;
}

export interface Speak3DResult {
  player: LipSyncPlayer | null;
  tier: LipSyncTier;
  track: VisemeTrack | null;
  /** True when Tier B resolution threw and we degraded to Tier A. */
  degraded: boolean;
}

export interface Speak2DOptions {
  /** Start the audio source; return a clock fn, or null if audio failed. */
  playAudio: () => (() => number) | null;
  setShape: (shape: string) => void;
  transcript?: string;
  language?: string;
  providerVisemes?: VisemeTrack | null;
  resolveViseme?: () => Promise<VisemeTrack | null>;
  onTier?: (tier: LipSyncTier) => void;
  onEnd?: () => void;
}

export interface Speak2DResult {
  player: SpriteVisemePlayer | null;
  tier: LipSyncTier;
  track: VisemeTrack | null;
  degraded: boolean;
}

/**
 * Shared tier-resolution core. Returns the selected tier + whether we degraded
 * from a failed Tier B attempt. Audio is NOT started here; callers start it and
 * then construct the appropriate player.
 */
async function resolveTier(opts: {
  providerVisemes?: VisemeTrack | null;
  resolveViseme?: () => Promise<VisemeTrack | null>;
  onTier?: (tier: LipSyncTier) => void;
}): Promise<{ tier: LipSyncTier; track: VisemeTrack | null; degraded: boolean }> {
  let tier: LipSyncTier = "A";
  let track: VisemeTrack | null = null;
  let degraded = false;
  try {
    if (opts.providerVisemes) {
      tier = "C";
      track = opts.providerVisemes;
    } else if (opts.resolveViseme) {
      const t = await opts.resolveViseme();
      if (t) {
        tier = "B";
        track = t;
      }
    }
  } catch {
    // Tier B/C resolution failed — degrade to Tier A, but audio still plays.
    tier = "A";
    track = null;
    degraded = true;
  }
  opts.onTier?.(tier);
  return { tier, track, degraded };
}

/** Speak on a 3D rigged avatar using `LipSyncPlayer` (morph + bone fallback). */
export async function speak(opts: Speak3DOptions): Promise<Speak3DResult> {
  // Start audio first so an unavailable or slow lip-sync tier cannot block speech.
  const clock = opts.playAudio();
  const { tier, track, degraded } = await resolveTier({
    providerVisemes: opts.providerVisemes,
    resolveViseme: opts.resolveViseme,
    onTier: opts.onTier,
  });

  if (!clock) {
    return { player: null, tier, track, degraded };
  }

  const player = new LipSyncPlayer(opts.root, track, {
    getClock: clock,
    tierA: opts.tierA ?? tierAAmplitude(opts.transcript ?? ""),
    onEnd: opts.onEnd,
    ...opts.playerOptions,
  });
  player.start(clock());
  return { player, tier, track, degraded };
}

/** Speak on Randy's 2D sprite representation using the same player contract. */
export async function speak2D(opts: Speak2DOptions): Promise<Speak2DResult> {
  const clock = opts.playAudio();
  const { tier, track, degraded } = await resolveTier({
    providerVisemes: opts.providerVisemes,
    resolveViseme: opts.resolveViseme,
    onTier: opts.onTier,
  });

  if (!clock) {
    return { player: null, tier, track, degraded };
  }

  const player = new SpriteVisemePlayer(track, {
    getClock: clock,
    onShape: (shape) => opts.setShape(shape),
    onEnd: opts.onEnd,
  });
  player.start(clock());
  return { player, tier, track, degraded };
}
