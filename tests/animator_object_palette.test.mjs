import test from "node:test";
import assert from "node:assert";
import { ALL_OBJECT_KINDS, OBJECT_CATALOG } from "../src/three/objects/catalog.ts";
import fs from "fs";
import path from "path";

test("animator_object_palette", async (t) => {
  await t.test("every catalog kind has a valid glbUrl", () => {
    for (const kind of ALL_OBJECT_KINDS) {
      const def = OBJECT_CATALOG[kind];
      assert.ok(def.glbUrl, `kind ${kind} missing glbUrl`);
      assert.ok(def.glbUrl.endsWith(".glb"), `kind ${kind} glbUrl must be a .glb file`);
      assert.ok(def.glbUrl.startsWith("/objects/"), `kind ${kind} glbUrl must be in /objects/`);
    }
  });

  await t.test("catalog defines emoji and label for all objects", () => {
    for (const kind of ALL_OBJECT_KINDS) {
      const def = OBJECT_CATALOG[kind];
      assert.ok(def.label, `kind ${kind} missing label`);
      assert.ok(def.emoji, `kind ${kind} missing emoji`);
    }
  });
});
