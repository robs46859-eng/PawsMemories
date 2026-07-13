/**
 * Pure DSP utilities for Phase 7 / SKILLS.md ANIM-AUD-01 and ANIM-LIP-04.
 *
 * Dependency-free and environment-agnostic (plain Float32Array math) so the
 * same functions run in an AudioWorklet, the main thread, or node:test.
 * The MFCC classifier (Tier C) composes these; nothing imports this module
 * before Phase 7.
 *
 * Contracts (from the audio-feature reference scripts):
 *  - MFCC: 20 coefficients, 50 ms FFT window, 10 ms hop, power mel-spectrogram.
 *  - Spectrogram: 22.05 kHz, STFT 512 Hann / 128 stride, 128 mel bins.
 */

// ── Mel scale ────────────────────────────────────────────────────────────────

export function hzToMel(hz: number): number {
  return 2595 * Math.log10(1 + hz / 700);
}

export function melToHz(mel: number): number {
  return 700 * (10 ** (mel / 2595) - 1);
}

/** Center frequencies (Hz) for `bins` mel bands spanning [fMin, fMax]. */
export function melBandCenters(bins: number, fMin: number, fMax: number): Float32Array {
  if (bins < 1 || fMax <= fMin) throw new Error("melBandCenters: invalid band spec");
  const loMel = hzToMel(fMin);
  const hiMel = hzToMel(fMax);
  const centers = new Float32Array(bins);
  for (let i = 0; i < bins; i += 1) {
    centers[i] = melToHz(loMel + ((i + 1) / (bins + 1)) * (hiMel - loMel));
  }
  return centers;
}

// ── Windowing & framing ─────────────────────────────────────────────────────

export function hannWindow(length: number): Float32Array {
  const w = new Float32Array(length);
  for (let i = 0; i < length; i += 1) w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (length - 1)));
  return w;
}

/** Split a signal into overlapping frames (frameLength window, hopLength stride). */
export function frameSignal(signal: Float32Array, frameLength: number, hopLength: number): Float32Array[] {
  if (frameLength <= 0 || hopLength <= 0) throw new Error("frameSignal: lengths must be positive");
  const frames: Float32Array[] = [];
  for (let start = 0; start + frameLength <= signal.length; start += hopLength) {
    frames.push(signal.subarray(start, start + frameLength));
  }
  return frames;
}

/** Standard MFCC framing: 50 ms window / 10 ms hop at the given sample rate. */
export function mfccFrameSpec(sampleRate: number): { frameLength: number; hopLength: number } {
  return { frameLength: Math.round(sampleRate * 0.05), hopLength: Math.round(sampleRate * 0.01) };
}

// ── Envelope & onsets (sequencer audio lane) ────────────────────────────────

/** RMS amplitude per frame — the Tier A jaw driver and the sequencer envelope. */
export function rmsEnvelope(signal: Float32Array, frameLength: number, hopLength: number): Float32Array {
  const frames = frameSignal(signal, frameLength, hopLength);
  const env = new Float32Array(frames.length);
  for (let i = 0; i < frames.length; i += 1) {
    let sum = 0;
    for (let j = 0; j < frames[i].length; j += 1) sum += frames[i][j] * frames[i][j];
    env[i] = Math.sqrt(sum / frames[i].length);
  }
  return env;
}

/**
 * Simple positive-flux onset detector over an envelope. Returns frame indices
 * whose rise exceeds `threshold` × the envelope's mean rise. Good enough for
 * beat-marker suggestions; replace with spectral flux when Phase 7 needs it.
 */
export function detectOnsets(envelope: Float32Array, threshold = 2): number[] {
  if (envelope.length < 3) return [];
  const rises: number[] = [];
  for (let i = 1; i < envelope.length; i += 1) rises.push(Math.max(0, envelope[i] - envelope[i - 1]));
  const meanRise = rises.reduce((a, b) => a + b, 0) / rises.length || 1e-12;
  const onsets: number[] = [];
  for (let i = 1; i < envelope.length; i += 1) {
    const rise = Math.max(0, envelope[i] - envelope[i - 1]);
    const prevRise = Math.max(0, envelope[i - 1] - (envelope[i - 2] ?? envelope[i - 1]));
    if (rise > threshold * meanRise && rise > prevRise) onsets.push(i);
  }
  return onsets;
}

// ── Feature statistics (per the MFCC feature contract) ──────────────────────

export interface FeatureStats { mean: number; std: number; min: number; max: number }

export function featureStats(values: Float32Array | number[]): FeatureStats {
  if (!values.length) throw new Error("featureStats: empty input");
  let sum = 0; let min = Infinity; let max = -Infinity;
  for (const v of values) { sum += v; min = Math.min(min, v); max = Math.max(max, v); }
  const mean = sum / values.length;
  let variance = 0;
  for (const v of values) variance += (v - mean) * (v - mean);
  return { mean, std: Math.sqrt(variance / values.length), min, max };
}
