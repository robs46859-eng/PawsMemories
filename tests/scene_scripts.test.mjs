import test from "node:test";
import assert from "node:assert";
import { estimateSpeechSeconds } from "../server/animator/scripts.ts";

test("Voiceover Scripts - estimateSpeechSeconds respects word counts", () => {
  const tenWords = "one two three four five six seven eight nine ten";
  const twentyWords = tenWords + " " + tenWords;
  const thirtyWords = twentyWords + " " + tenWords;
  
  const est10 = estimateSpeechSeconds(tenWords);
  const est20 = estimateSpeechSeconds(twentyWords);
  const est30 = estimateSpeechSeconds(thirtyWords);
  
  // Should be monotonic
  assert.ok(est10 < est20);
  assert.ok(est20 < est30);
  
  // ~20 words should be <= 10 seconds (cap)
  assert.ok(est20 <= 10, "20 words should fit in 10s cap");
  
  // ~30 words should be > 10 seconds (cap)
  assert.ok(est30 > 10, "30 words should exceed 10s cap");
});
