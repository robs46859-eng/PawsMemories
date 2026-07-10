import test from "node:test";
import assert from "node:assert";
import { evaluateSequence } from "../src/animator/scenes/SceneSequence.ts";

test("SceneSequence test suite", async (t) => {
  await t.test("Evaluates correct state based on time (cuts vs crossfades)", () => {
    const seq = {
      id: "1",
      name: "test",
      steps: [
        { timeSeconds: 0, action: "play_clip", target: "sit" },
        { timeSeconds: 2, action: "cut_camera", target: "cam_2" },
        { timeSeconds: 4, action: "play_clip", target: "stand" },
      ]
    };

    let state = evaluateSequence(seq, 1);
    assert.strictEqual(state.clipTarget, "sit");
    assert.strictEqual(state.cameraTarget, undefined);

    state = evaluateSequence(seq, 3);
    assert.strictEqual(state.clipTarget, "sit"); // still playing sit
    assert.strictEqual(state.cameraTarget, "cam_2"); // camera cut at 2s

    state = evaluateSequence(seq, 5);
    assert.strictEqual(state.clipTarget, "stand"); // hard cut to stand, no crossfade logic here
    assert.strictEqual(state.cameraTarget, "cam_2");
  });

  await t.test("Skips missing clips by falling through to next valid state or doing nothing", () => {
    const seq = {
      id: "1",
      name: "test",
      steps: [
        { timeSeconds: 0, action: "play_clip", target: "sit" },
        { timeSeconds: 2, action: "missing_action", target: "skip_me" },
        { timeSeconds: 4, action: "play_clip", target: "stand" },
      ]
    };

    let state = evaluateSequence(seq, 3);
    // the missing_action is ignored completely by evaluateSequence
    assert.strictEqual(state.clipTarget, "sit");
    assert.strictEqual(state.missing_action, undefined);
  });
});
