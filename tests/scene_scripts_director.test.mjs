import test from "node:test";
import assert from "node:assert";
import { SCENE_SCRIPT_SCHEMA, PRESET_SCRIPTS, getDirectorScripts } from "../server/animator/sceneScripts.ts";
import { getVoiceoverScripts } from "../server/animator/scripts.ts";
import { runScript } from "../src/animator/scenes/SceneSequence.ts";

test("scene_scripts_director", async (t) => {
  await t.test("all preset scripts match schema and duration limits", () => {
    assert.ok(PRESET_SCRIPTS.length >= 100, "Animator must ship at least 100 director scripts");
    assert.equal(new Set(PRESET_SCRIPTS.map((script) => script.id)).size, PRESET_SCRIPTS.length, "director script IDs must be unique");
    for (const script of PRESET_SCRIPTS) {
      const parsed = SCENE_SCRIPT_SCHEMA.parse(script);
      assert.ok(parsed.durationSeconds >= 8 && parsed.durationSeconds <= 10, `Script ${script.name} duration out of bounds`);
    }
  });

  await t.test("voiceover catalog contains at least 100 distinct scripts", () => {
    const scripts = getVoiceoverScripts("catalog-test");
    assert.ok(scripts.length >= 100, "Animator must ship at least 100 voice scripts");
    assert.equal(new Set(scripts.map((script) => script.text)).size, scripts.length, "voice scripts must be distinct");
    assert.ok(scripts.every((script) => script.estimatedSeconds <= 10), "voice scripts must fit the preview cap");
  });

  await t.test("seed changes ordering without changing the validated catalog", () => {
    const first = getDirectorScripts("first");
    const second = getDirectorScripts("second");
    assert.equal(first.length, PRESET_SCRIPTS.length);
    assert.equal(second.length, PRESET_SCRIPTS.length);
    assert.notDeepEqual(first.slice(0, 10).map((script) => script.id), second.slice(0, 10).map((script) => script.id));
    assert.deepEqual(new Set(first.map((script) => script.id)), new Set(second.map((script) => script.id)));
  });

  await t.test("scripts contain at least one role and event", () => {
    for (const script of PRESET_SCRIPTS) {
      assert.ok(script.roles.length > 0, `Script ${script.name} has no roles`);
      assert.ok(script.events.length > 0, `Script ${script.name} has no events`);
      assert.ok(script.events.some((event) => event.type === "clip"), `Script ${script.name} has no animation action`);
      assert.ok(script.events.some((event) => event.type === "camera"), `Script ${script.name} has no camera action`);
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
