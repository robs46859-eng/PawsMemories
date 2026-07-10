import test from "node:test";
import assert from "node:assert";
import { ANIMATOR_DEFAULTS } from "../src/animator/defaults.ts";

test("ANIMATOR_DEFAULTS - validity", () => {
  // selects a clip heuristic exists
  assert.ok(ANIMATOR_DEFAULTS.clip.heuristics.length > 0);
  assert.ok(ANIMATOR_DEFAULTS.clip.heuristics.includes("idle"));
  
  // valid record preset
  assert.strictEqual(ANIMATOR_DEFAULTS.recording.fps, 30);
  assert.strictEqual(ANIMATOR_DEFAULTS.recording.resolution.width, 1920);
  assert.strictEqual(ANIMATOR_DEFAULTS.recording.resolution.height, 1080);
  
  // stays within MAX_CLIP_SECONDS
  assert.ok(ANIMATOR_DEFAULTS.recording.maxDurationSeconds > 0);
  assert.ok(ANIMATOR_DEFAULTS.recording.defaultDurationSeconds <= ANIMATOR_DEFAULTS.recording.maxDurationSeconds);
});
