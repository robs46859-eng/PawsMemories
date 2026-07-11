import test from "node:test";
import assert from "node:assert";
import { runScript } from "../src/animator/scenes/SceneSequence.ts";

test("director_cast", async (t) => {
  await t.test("runScript correctly maps multiple actor clips by roleId", () => {
    const script = {
      events: [
        { time: 0, type: "clip", roleId: "hero", value: "idle" },
        { time: 0, type: "clip", roleId: "sidekick", value: "sit" },
        { time: 2, type: "clip", roleId: "hero", value: "run" }
      ]
    };

    let state = runScript(script, 0.5);
    assert.strictEqual(state.clipTargets["hero"].name, "idle");
    assert.strictEqual(state.clipTargets["sidekick"].name, "sit");

    state = runScript(script, 2.5);
    assert.strictEqual(state.clipTargets["hero"].name, "run");
    assert.strictEqual(state.clipTargets["sidekick"].name, "sit");
  });
});
