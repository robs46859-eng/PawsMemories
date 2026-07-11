import test from "node:test";
import assert from "node:assert";
import { SCENE_SCRIPT_SCHEMA, PRESET_SCRIPTS } from "../server/animator/sceneScripts.ts";

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
});
