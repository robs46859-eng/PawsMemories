import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import * as THREE from "three";
import { LipSyncPlayer } from "../src/animator/viseme/LipSyncPlayer.ts";
import { findVisemeMorphIndex } from "../src/animator/viseme/visemeBindings.ts";
import { facialVisemeBpyScript } from "../agent/graph/nodes/facialVisemes.ts";

test("common provider blendshape names resolve to the canonical viseme contract", () => {
  assert.equal(findVisemeMorphIndex({ jawOpen: 4 }, "D"), 4);
  assert.equal(findVisemeMorphIndex({ viseme_FV: 2 }, "G"), 2);
  assert.equal(findVisemeMorphIndex({ viseme_X: 1 }, "X"), 1);
});

test("lip-sync drives an aliased provider blendshape instead of falling back to a static jaw", () => {
  const root = new THREE.Group();
  const mesh = new THREE.Mesh();
  mesh.morphTargetDictionary = { jawOpen: 0 };
  mesh.morphTargetInfluences = [0];
  root.add(mesh);
  const player = new LipSyncPlayer(root, { version: 1, fps: 30, source: "rhubarb", durationSec: 1, anticipationSec: 0, cues: [{ t: 0, v: "D" }] }, { getClock: () => 0.08 });
  player.start(0);
  player.update(0.08);
  assert.ok(mesh.morphTargetInfluences[0] > 0.9);
});

test("the Blender bake worker exports canonical facial morphs and records validation", async () => {
  const source = await readFile(new URL("../blender-worker/jobs/bake_lod.py", import.meta.url), "utf8");
  assert.match(source, /ensure_viseme_blendshapes/);
  assert.match(source, /"viseme_" \+ shape/);
  assert.match(source, /ANIM-LIP-03-viseme-contract/);
});

test("the normal Furball3D export runs facial viseme synthesis before its GLB is written", async () => {
  const finalize = await readFile(new URL("../agent/graph/nodes/finalize.ts", import.meta.url), "utf8");
  const act = await readFile(new URL("../agent/graph/nodes/act.ts", import.meta.url), "utf8");
  const script = facialVisemeBpyScript();
  assert.match(finalize, /execute_bpy/);
  assert.match(finalize, /facialVisemeBpyScript/);
  assert.match(act, /facialVisemeBpyScript\(\)/);
  for (const name of ["viseme_A", "viseme_D", "viseme_G", "viseme_H", "viseme_X"]) assert.match(script, new RegExp(name));
});
