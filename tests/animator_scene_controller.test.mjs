import test from "node:test";
import assert from "node:assert";
import { createSceneController } from "../src/animator/controller/createSceneController.ts";
import { ANIMATOR_DEFAULTS } from "../src/animator/defaults.ts";

import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

test("SceneController - addActor assigns unique actorIds and non-overlapping placement", async () => {
  // Mock loadAsync to avoid real fetch/DOM requirements in tests
  const originalLoadAsync = GLTFLoader.prototype.loadAsync;
  GLTFLoader.prototype.loadAsync = async () => ({
    scene: new THREE.Scene(),
    scenes: [new THREE.Scene()],
    animations: [],
    cameras: [],
    asset: {}
  });

  try {
    const ctrl = createSceneController();
    
    const id1 = await ctrl.addActor("asset1");
    const id2 = await ctrl.addActor("asset2");
  
  assert.notStrictEqual(id1, id2);
  
  const actors = ctrl.listActors();
  assert.strictEqual(actors.length, 2);
  assert.strictEqual(actors[0].actorId, id1);
  assert.strictEqual(actors[1].actorId, id2);
  
  // placement is deterministic
  assert.strictEqual(actors[0].transform.position[0], 0);
  assert.strictEqual(actors[1].transform.position[0], ANIMATOR_DEFAULTS.actor.spacingX);
  
    ctrl.removeActor(id1);
    assert.strictEqual(ctrl.listActors().length, 1);
  } finally {
    GLTFLoader.prototype.loadAsync = originalLoadAsync;
  }
});

test("SceneController - seekAll fans out to every actor without throwing", async () => {
  const originalLoadAsync = GLTFLoader.prototype.loadAsync;
  GLTFLoader.prototype.loadAsync = async () => ({
    scene: new THREE.Scene(),
    scenes: [new THREE.Scene()],
    animations: [],
    cameras: [],
    asset: {}
  });

  try {
    const ctrl = createSceneController();
    const id1 = await ctrl.addActor("asset1");
    const id2 = await ctrl.addActor("asset2");

    // seekAll must reach every actor's controller and not throw (clamped per-actor).
    assert.doesNotThrow(() => ctrl.seekAll(1.5));
    assert.ok(ctrl.getActorController(id1));
    assert.ok(ctrl.getActorController(id2));
  } finally {
    GLTFLoader.prototype.loadAsync = originalLoadAsync;
  }
});
