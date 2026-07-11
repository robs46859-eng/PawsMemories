import test from "node:test";
import assert from "node:assert";
import { SCENE_SCRIPT_SCHEMA, PRESET_SCRIPTS } from "../server/animator/sceneScripts.ts";
import { runScript } from "../src/animator/scenes/SceneSequence.ts";

test("scene_scripts_director", async (t) => {
  await t.test("all preset scripts match schema and duration limits", () => {
    for (const script of PRESET_SCRIPTS) {
      const parsed = SCENE_SCRIPT_SCHEMA.parse(script);
      assert.ok(parsed.durationSeconds >= 8 && parsed.durationSeconds <= 10, `Script ${script.name} duration out of bounds`);
    }
  });

  await t.test("scripts contain at least one role and event", () => {
    for (const script of PRESET_SCRIPTS) {
      assert.ok(script.roles.length > 0, `Script ${script.name} has no roles`);
      assert.ok(script.events.length > 0, `Script ${script.name} has no events`);
    }
  });

  await t.test("runScript surfaces light, sound, and weather targets", () => {
    const dummyScript = {
      events: [
        { time: 0, type: 'light', value: 'evening' },
        { time: 1, type: 'weather', value: 'rain' },
        { time: 2, type: 'sound', value: 'thunder.mp3' },
      ]
    };
    
    let state = runScript(dummyScript, 0.5);
    assert.strictEqual(state.lightTarget, 'evening');
    assert.strictEqual(state.weatherTarget, null);
    assert.strictEqual(state.soundTarget, null);

    state = runScript(dummyScript, 1.5);
    assert.strictEqual(state.lightTarget, 'evening');
    assert.strictEqual(state.weatherTarget, 'rain');
    assert.strictEqual(state.soundTarget, null);

    state = runScript(dummyScript, 2.5);
    assert.strictEqual(state.lightTarget, 'evening');
    assert.strictEqual(state.weatherTarget, 'rain');
    assert.strictEqual(state.soundTarget, 'thunder.mp3');
  });
});
