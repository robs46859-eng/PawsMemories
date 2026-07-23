/**
 * randyVisemes.ts — Amplitude-driven lip-sync for Randy's 3D head.
 *
 * Tier A (current): Uses SpeechSynthesis boundary events + a sine-wave jaw
 * simulation to drive a `mouthOpen` value (0–1).
 *
 * Tier B (future): Will accept viseme timing data from a TTS provider
 * (Azure/ElevenLabs) and blend full viseme morph targets.
 */
import {
  chooseBrowserVoice,
  DEFAULT_BROWSER_VOICE_PREFERENCE,
  type BrowserVoicePreference,
} from "./browserVoicePreferences";

// ---------------------------------------------------------------------------
// Tier A — SpeechSynthesis amplitude lip-sync
// ---------------------------------------------------------------------------

export interface LipSyncCallbacks {
  onMouthUpdate: (value: number) => void;
  onStart?: () => void;
  onEnd?: () => void;
}

/**
 * Speaks `text` using the browser SpeechSynthesis API and drives a mouthOpen
 * value (0–1) via a sine-wave gated by speech boundaries.
 *
 * Returns a handle to cancel the utterance early.
 */
export function speakText(
  text: string,
  callbacks: LipSyncCallbacks,
  preference: BrowserVoicePreference = DEFAULT_BROWSER_VOICE_PREFERENCE,
): { cancel: () => void } {
  const synth = window.speechSynthesis;

  // Cancel any in-progress speech first
  synth.cancel();

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = preference.rate;
  utterance.pitch = preference.pitch;

  // Try to pick a warm English voice
  const voices = synth.getVoices();
  const preferred = chooseBrowserVoice(voices, preference);
  if (preferred) utterance.voice = preferred;

  let speaking = false;
  let animFrame = 0;
  let phase = 0;

  const animateJaw = () => {
    if (!speaking) {
      callbacks.onMouthUpdate(0);
      return;
    }
    // Sine-wave amplitude simulation — varies between 0.15 and 0.85 for
    // natural-looking jaw movement.  Frequency ~12 Hz gives a speech cadence.
    phase += 0.18;
    const base = 0.5 + 0.35 * Math.sin(phase * 12);
    // Add a smaller harmonic for natural variation
    const variation = 0.15 * Math.sin(phase * 7.3 + 1.2);
    const value = Math.max(0, Math.min(1, base + variation));
    callbacks.onMouthUpdate(value);
    animFrame = requestAnimationFrame(animateJaw);
  };

  utterance.onstart = () => {
    speaking = true;
    phase = 0;
    callbacks.onStart?.();
    animFrame = requestAnimationFrame(animateJaw);
  };

  // On word boundaries, add a slight random perturbation so the jaw
  // doesn't look perfectly periodic
  utterance.onboundary = () => {
    phase += Math.random() * 0.5;
  };

  utterance.onend = () => {
    speaking = false;
    cancelAnimationFrame(animFrame);
    callbacks.onMouthUpdate(0);
    callbacks.onEnd?.();
  };

  utterance.onerror = () => {
    speaking = false;
    cancelAnimationFrame(animFrame);
    callbacks.onMouthUpdate(0);
    callbacks.onEnd?.();
  };

  synth.speak(utterance);

  return {
    cancel: () => {
      speaking = false;
      cancelAnimationFrame(animFrame);
      synth.cancel();
      callbacks.onMouthUpdate(0);
      callbacks.onEnd?.();
    },
  };
}

// ---------------------------------------------------------------------------
// Tier A — amplitude fallback (shared by the LipSyncPlayer & speak() pipeline)
// ---------------------------------------------------------------------------

/**
 * Returns a deterministic jaw-openness function (0–1) for Tier A fallback when
 * no VisemeTrack is available. Cadence ~12 Hz with a secondary harmonic for a
 * natural, non-periodic look. Used by `LipSyncPlayer` tierA mode and the
 * speak() pipeline when Tier B/C fail.
 */
export function tierAAmplitude(_text: string): (t: number) => number {
  return (t: number) => {
    const local = t * 12;
    const base = 0.5 + 0.35 * Math.sin(local);
    const variation = 0.15 * Math.sin(local * 0.6 + 1.2);
    return Math.max(0, Math.min(1, base + variation));
  };
}

// ---------------------------------------------------------------------------
// Tier B — Viseme mapper interface (future)
// ---------------------------------------------------------------------------

/** Viseme IDs matching the ARKit/Azure 15-viseme set subset. */
export type VisemeId =
  | "mouth_open"
  | "viseme_AA"
  | "viseme_EE"
  | "viseme_OO"
  | "viseme_FV"
  | "viseme_MBP";

export interface VisemeEvent {
  viseme: VisemeId;
  time: number; // seconds from utterance start
  duration: number;
}

/**
 * Future: accepts an array of timed viseme events and returns a function
 * that, given the current playback time, returns a map of viseme weights.
 */
export function createVisemeTimeline(
  _events: VisemeEvent[],
): (currentTime: number) => Record<VisemeId, number> {
  // Stub for Tier B — will blend viseme morphs on a timeline
  return (_t: number) => ({
    mouth_open: 0,
    viseme_AA: 0,
    viseme_EE: 0,
    viseme_OO: 0,
    viseme_FV: 0,
    viseme_MBP: 0,
  });
}
