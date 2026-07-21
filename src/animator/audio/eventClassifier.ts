import { detectOnsets, rmsEnvelope } from './dsp.ts';

/**
 * Event Classifier (Phase 7)
 * Lightweight spectrogram-based heuristics to detect sudden sound events
 * like barks or meows, which can then trigger EmoteQueue reactions.
 */

export interface AudioEvent {
  type: 'bark' | 'meow' | 'unknown';
  timeSeconds: number;
  confidence: number;
}

export class AudioEventClassifier {
  /**
   * Analyzes an audio buffer (decoded via AudioContext) and detects prominent events.
   * Uses RMS envelope and onset detection to find candidate events,
   * then classifies them based on simple heuristics (e.g. duration and peak energy).
   */
  public analyzeBuffer(buffer: AudioBuffer): AudioEvent[] {
    const events: AudioEvent[] = [];
    const channelData = buffer.getChannelData(0);
    const sampleRate = buffer.sampleRate;
    
    // Use 20ms window for precise onset detection
    const frameLength = Math.floor(sampleRate * 0.02);
    const hopLength = Math.floor(sampleRate * 0.01);

    const env = rmsEnvelope(channelData, frameLength, hopLength);
    const onsets = detectOnsets(env, 2.5); // Threshold

    for (const onsetFrame of onsets) {
      const timeSeconds = (onsetFrame * hopLength) / sampleRate;
      
      // Determine duration of the event (frames where energy stays above 10% of peak)
      let peak = env[onsetFrame];
      let endFrame = onsetFrame;
      for (let i = onsetFrame; i < env.length; i++) {
        if (env[i] > peak) peak = env[i];
        if (env[i] < peak * 0.1) {
          endFrame = i;
          break;
        }
      }
      
      const durationSeconds = ((endFrame - onsetFrame) * hopLength) / sampleRate;

      // Heuristics:
      // Barks are typically short, sharp, and loud (0.05s to 0.3s)
      // Meows are typically longer (0.3s to 1.5s)
      let type: AudioEvent['type'] = 'unknown';
      let confidence = 0;

      if (durationSeconds >= 0.05 && durationSeconds < 0.3) {
        type = 'bark';
        confidence = Math.min(1.0, peak * 2.0); // Normalize confidence by amplitude
      } else if (durationSeconds >= 0.3 && durationSeconds < 1.5) {
        type = 'meow';
        confidence = Math.min(1.0, peak * 2.0);
      }

      if (type !== 'unknown' && confidence > 0.3) {
        events.push({ type, timeSeconds, confidence });
      }
    }

    return events;
  }
}
