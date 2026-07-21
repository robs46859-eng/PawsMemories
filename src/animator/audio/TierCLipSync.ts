import { featureStats, frameSignal, hannWindow, hzToMel, melBandCenters, melToHz, mfccFrameSpec } from './dsp.ts';

/**
 * Tier C Realtime Lip-Sync
 * Implements MFCC-based feature extraction from audio buffers for realtime viseme classification.
 */

const TARGET_SAMPLE_RATE = 22050; // Use standard SR for features

export class TierCLipSyncAnalyzer {
  private audioContext: AudioContext;
  private analyser: AnalyserNode | null = null;
  private mediaStream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private isListening = false;

  constructor() {
    this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({
      sampleRate: TARGET_SAMPLE_RATE,
    });
  }

  async startListening(): Promise<void> {
    if (this.isListening) return;

    this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    this.source = this.audioContext.createMediaStreamSource(this.mediaStream);
    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = 2048; // About 46ms at 44.1kHz, 92ms at 22kHz

    this.source.connect(this.analyser);
    this.isListening = true;

    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }
  }

  stopListening(): void {
    if (!this.isListening) return;
    this.isListening = false;
    
    if (this.source) {
      this.source.disconnect();
      this.source = null;
    }
    
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(t => t.stop());
      this.mediaStream = null;
    }
  }

  /**
   * Captures the current audio frame and returns MFCC-like features.
   * In a full implementation, this should be an AudioWorklet for glitch-free DSP.
   * Here we extract simple frequency bands as a stand-in for full MFCC math
   * (since doing DCT on main thread every 16ms can stutter).
   */
  getFeatures(): Float32Array | null {
    if (!this.isListening || !this.analyser) return null;

    const buffer = new Float32Array(this.analyser.frequencyBinCount);
    this.analyser.getFloatFrequencyData(buffer);

    // Naive 20-band binning (Mel scale approximation)
    const bins = 20;
    const result = new Float32Array(bins);
    const bandCenters = melBandCenters(bins, 20, 8000);
    const nyquist = this.audioContext.sampleRate / 2;

    for (let i = 0; i < bins; i++) {
      const centerHz = bandCenters[i];
      const binIndex = Math.floor((centerHz / nyquist) * this.analyser.frequencyBinCount);
      result[i] = buffer[Math.min(binIndex, buffer.length - 1)];
    }

    return result;
  }

  /**
   * Classify current features into a viseme string (A-H, X)
   * Needs a trained profile (calibration data) to be accurate.
   */
  classifyViseme(calibrationProfile?: Record<string, Float32Array>): string {
    const features = this.getFeatures();
    if (!features) return 'X';

    // Simple RMS check for silence
    let sum = 0;
    for (let i = 0; i < features.length; i++) sum += features[i];
    const avgDb = sum / features.length;

    // Silence threshold
    if (avgDb < -80) {
      return 'X';
    }

    if (calibrationProfile) {
      let bestMatch = 'X';
      let minDistance = Infinity;

      for (const [viseme, profileFeatures] of Object.entries(calibrationProfile)) {
        let dist = 0;
        for (let i = 0; i < features.length; i++) {
          dist += Math.pow(features[i] - profileFeatures[i], 2);
        }
        if (dist < minDistance) {
          minDistance = dist;
          bestMatch = viseme;
        }
      }
      return bestMatch;
    }

    // Fallback heuristic if no profile provided
    if (avgDb > -50) {
      return 'D'; // Loud -> open mouth
    } else if (avgDb > -70) {
      return 'C'; // Medium
    }

    return 'X';
  }
}
