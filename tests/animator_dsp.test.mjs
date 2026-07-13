import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  hzToMel, melToHz, melBandCenters, hannWindow, frameSignal, mfccFrameSpec,
  rmsEnvelope, detectOnsets, featureStats,
} from "../src/animator/audio/dsp.ts";

describe("ANIM-AUD-01 DSP utilities", () => {
  test("mel scale round-trips and is monotonic", () => {
    for (const hz of [100, 440, 1000, 8000]) {
      assert.ok(Math.abs(melToHz(hzToMel(hz)) - hz) < 1e-6);
    }
    assert.ok(hzToMel(2000) > hzToMel(1000));
    const centers = melBandCenters(128, 0, 11025);
    assert.equal(centers.length, 128);
    for (let i = 1; i < centers.length; i += 1) assert.ok(centers[i] > centers[i - 1]);
    assert.throws(() => melBandCenters(0, 0, 8000));
  });
  test("hann window is symmetric with zero endpoints and unit peak", () => {
    const w = hannWindow(512);
    assert.ok(w[0] < 1e-9 && w[511] < 1e-9);
    assert.ok(Math.abs(w[255] - w[256]) < 1e-3);
    assert.ok(Math.max(...w) <= 1 && Math.max(...w) > 0.999);
  });
  test("framing matches the 50ms/10ms MFCC contract at 16 kHz", () => {
    const { frameLength, hopLength } = mfccFrameSpec(16000);
    assert.equal(frameLength, 800);
    assert.equal(hopLength, 160);
    const frames = frameSignal(new Float32Array(16000), frameLength, hopLength);
    assert.equal(frames.length, Math.floor((16000 - frameLength) / hopLength) + 1);
  });
  test("rms envelope and onset detection find a burst in silence", () => {
    const signal = new Float32Array(8000);
    for (let i = 4000; i < 4400; i += 1) signal[i] = Math.sin(i * 0.3); // burst
    const env = rmsEnvelope(signal, 400, 100);
    const onsets = detectOnsets(env);
    assert.ok(onsets.length >= 1, "burst must register at least one onset");
    // The onset frame's window [idx*hop, idx*hop + frameLength) must contain the burst start (sample 4000).
    assert.ok(onsets.some((idx) => idx * 100 <= 4000 && 4000 < idx * 100 + 400), "onset window covers the burst start");
  });
  test("feature stats match the mean/std/min/max contract", () => {
    const stats = featureStats([1, 2, 3, 4]);
    assert.equal(stats.mean, 2.5);
    assert.equal(stats.min, 1);
    assert.equal(stats.max, 4);
    assert.ok(Math.abs(stats.std - Math.sqrt(1.25)) < 1e-12);
    assert.throws(() => featureStats([]));
  });
});
