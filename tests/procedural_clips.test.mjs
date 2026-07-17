import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";
import { createProceduralClips } from "../src/animator/controller/proceduralClips.ts";

function quadrupedRig() {
  const root = new THREE.Group();
  for (const name of ["chest", "head", "front_leg_upper.L", "front_leg_upper.R", "back_leg_upper.L", "back_leg_upper.R", "tail_01"]) {
    root.add(Object.assign(new THREE.Bone(), { name }));
  }
  return root;
}

test("procedural clips give an unanimated rig the canonical quadruped actions", () => {
  const clips = createProceduralClips(quadrupedRig());
  const names = clips.map(({ name }) => name);
  for (const name of ["idle", "walk", "run", "sit", "tail_wave", "head_tilt", "bark_speak"]) {
    assert.ok(names.includes(name), `${name} must be available to the animator`);
  }
  assert.ok(clips.find(({ name }) => name === "walk")?.tracks.length);
});

test("procedural clips do not pretend that a non-rigged object can animate", () => {
  assert.deepEqual(createProceduralClips(new THREE.Group()), []);
});
