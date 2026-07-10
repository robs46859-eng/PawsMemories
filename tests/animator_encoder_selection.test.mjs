import test from "node:test";
import assert from "node:assert";
import { selectEncoder } from "../src/animator/recording/capabilities.ts";

test("animator_encoder_selection", async (t) => {
  await t.test("returns unsupported when no webcodecs", () => {
    const res = selectEncoder({ hasWebCodecs: false, supportedCodecs: [], maxFps: 30 });
    assert.strictEqual(res.unsupported, true);
  });

  await t.test("selects H.264 High 1080p 60fps when available", () => {
    const res = selectEncoder({
      hasWebCodecs: true,
      supportedCodecs: ['avc1.640028', 'vp8'],
      maxFps: 60
    });
    assert.strictEqual(res.codec, 'avc1.640028');
    assert.strictEqual(res.fps, 60);
    assert.strictEqual(res.width, 1920);
  });

  await t.test("selects H.264 Baseline 720p 30fps when High is unavailable", () => {
    const res = selectEncoder({
      hasWebCodecs: true,
      supportedCodecs: ['avc1.42E01F', 'vp8'],
      maxFps: 30
    });
    assert.strictEqual(res.codec, 'avc1.42E01F');
    assert.strictEqual(res.fps, 30);
    assert.strictEqual(res.width, 1280);
  });

  await t.test("selects VP9 when H.264 is unavailable", () => {
    const res = selectEncoder({
      hasWebCodecs: true,
      supportedCodecs: ['vp09.00.10.08', 'vp8'],
      maxFps: 30
    });
    assert.strictEqual(res.codec, 'vp09.00.10.08');
  });

  await t.test("returns unsupported when no matching codecs", () => {
    const res = selectEncoder({
      hasWebCodecs: true,
      supportedCodecs: ['av01.0.04M.08'], // Only AV1 supported
      maxFps: 30
    });
    assert.strictEqual(res.unsupported, true);
  });
});
