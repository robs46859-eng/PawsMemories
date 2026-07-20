import test from "node:test";
import assert from "node:assert";
import { evaluateSequence } from "../src/animator/scenes/SceneSequence.ts";

test("SceneSequence test suite", async (t) => {
  await t.test("Evaluates correct state based on time (cuts vs crossfades)", () => {
    const seq = {
      id: "1",
      name: "test",
      version: 1,
      fps: 30,
      durationSeconds: 10,
      lanes: [
        {
          id: "clip-lane",
          type: "clip",
          actorId: "actor1",
          keyframes: [
            { timeSeconds: 0, value: "sit" },
            { timeSeconds: 4, value: "stand" },
          ]
        },
        {
          id: "cam-lane",
          type: "camera",
          keyframes: [
            { timeSeconds: 2, value: "cam_2" },
          ]
        }
      ]
    };

    let state = evaluateSequence(seq, 1);
    assert.strictEqual(state.clipTargets["actor1"], "sit");
    assert.strictEqual(state.cameraTarget, undefined);

    state = evaluateSequence(seq, 3);
    assert.strictEqual(state.clipTargets["actor1"], "sit"); // still playing sit
    assert.strictEqual(state.cameraTarget, "cam_2"); // camera cut at 2s

    state = evaluateSequence(seq, 5);
    assert.strictEqual(state.clipTargets["actor1"], "stand"); // hard cut to stand, no crossfade logic here
    assert.strictEqual(state.cameraTarget, "cam_2");
  });

  await t.test("Catmull-Rom interpolation calculation", () => {
    const seq = {
      id: "1",
      name: "test",
      version: 1,
      fps: 30,
      durationSeconds: 10,
      lanes: [
        {
          id: "cam-lane",
          type: "camera",
          keyframes: [
            { timeSeconds: 0, value: 0, interpolation: "catmull-rom" },
            { timeSeconds: 2, value: 10, interpolation: "catmull-rom" },
            { timeSeconds: 4, value: 20, interpolation: "catmull-rom" },
            { timeSeconds: 6, value: 30, interpolation: "catmull-rom" },
          ]
        }
      ]
    };

    // At exactly time 2, should be 10
    let state = evaluateSequence(seq, 2);
    assert.strictEqual(state.cameraTarget, 10);
    
    // At time 3, it should interpolate between 10 and 20
    state = evaluateSequence(seq, 3);
    assert.ok(state.cameraTarget > 10 && state.cameraTarget < 20);
  });
});

