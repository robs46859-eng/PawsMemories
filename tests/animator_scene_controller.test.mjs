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
    
    const id1 = await ctrl.addActor("/asset1.glb");
    const id2 = await ctrl.addActor("/asset2.glb");
  
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
    const id1 = await ctrl.addActor("/asset1.glb");
    const id2 = await ctrl.addActor("/asset2.glb");

    // seekAll must reach every actor's controller and not throw (clamped per-actor).
    assert.doesNotThrow(() => ctrl.seekAll(1.5));
    assert.ok(ctrl.getActorController(id1));
    assert.ok(ctrl.getActorController(id2));
  } finally {
    GLTFLoader.prototype.loadAsync = originalLoadAsync;
  }
});

test("SceneController authenticates protected asset resolution", async () => {
  const originalLoadAsync = GLTFLoader.prototype.loadAsync;
  const originalFetch = global.fetch;
  const originalLocalStorage = global.localStorage;
  let authorization = null;

  GLTFLoader.prototype.loadAsync = async () => ({
    scene: new THREE.Scene(), scenes: [new THREE.Scene()], animations: [], cameras: [], asset: {}
  });
  global.localStorage = { getItem: () => "signed-test-token" };
  global.fetch = async (url, init) => {
    authorization = new Headers(init?.headers).get("Authorization");
    return { ok: true, json: async () => [{ url: "/resolved-model.glb" }] };
  };

  try {
    const ctrl = createSceneController();
    const actorId = await ctrl.addActor("36");
    assert.ok(actorId);
    assert.strictEqual(authorization, "Bearer signed-test-token");
  } finally {
    GLTFLoader.prototype.loadAsync = originalLoadAsync;
    global.fetch = originalFetch;
    if (originalLocalStorage === undefined) delete global.localStorage;
    else global.localStorage = originalLocalStorage;
  }
});
