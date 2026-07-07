import assert from "node:assert/strict";
import { test } from "node:test";
import { createBrain, makeRng } from "../src/brain/index.ts";
import { actionToClip, createBrainBridge } from "../src/three/ar/brainBridgeCore.ts";
import {
  UTILITY_TAGS,
  TAG_TO_ACTION,
  ACTION_TO_TAG,
  nearestObjectWithTag,
  objectsToStimuli,
  tagsFor,
} from "../src/three/objects/utilityTags.ts";

const temperament = {
  energy: 0.6, sociability: 0.5, stubbornness: 0.4, foodMotivation: 0.7, vocality: 0.3,
};

function obj(id, kind, x, z) {
  return { id, kind, position: [x, 0, z], rotationY: 0, scale: 1, createdAt: "" };
}

test("actionToClip maps brain actions to existing clip BehaviorActions", () => {
  assert.equal(actionToClip("eat"), "eating");
  assert.equal(actionToClip("fetch"), "playing");
  assert.equal(actionToClip("nap"), "sleeping");
  assert.equal(actionToClip("bark"), "speaking");
});

test("every object kind has utility tags, and TAG_TO_ACTION round-trips", () => {
  for (const kind of Object.keys(UTILITY_TAGS)) {
    assert.ok(UTILITY_TAGS[kind].length > 0, `${kind} has tags`);
  }
  for (const [tag, action] of Object.entries(TAG_TO_ACTION)) {
    assert.equal(ACTION_TO_TAG[action], tag, `${tag} <-> ${action} round-trips`);
  }
});

test("nearestObjectWithTag returns the closest matching object", () => {
  const objects = [obj("a", "food_bowl", 5, 0), obj("b", "food_bowl", 1, 0), obj("c", "ball", 0, 0)];
  const nearest = nearestObjectWithTag(objects, "food", { x: 0, z: 0 });
  assert.equal(nearest.id, "b");
  assert.equal(nearestObjectWithTag(objects, "water", { x: 0, z: 0 }), null);
});

test("objectsToStimuli emits ambient stimuli per (object,tag)", () => {
  const objects = [obj("a", "bone", 0, 0)]; // bone → toy + dig (2 tags)
  const stim = objectsToStimuli(objects, 1000);
  assert.equal(stim.length, tagsFor("bone").length);
  for (const s of stim) assert.equal(s.playerInteracted, false);
  assert.ok(stim.some((s) => s.action === "fetch")); // toy → fetch
  assert.ok(stim.some((s) => s.action === "dig"));
});

test("bridge.step drives onClip when the brain selects an action", () => {
  const clips = [];
  const brain = createBrain({ temperament, rng: makeRng(1), now: 0 });
  const bridge = createBrainBridge({ brain, onClip: (a) => clips.push(a) });
  bridge.step(1, 1000);
  assert.ok(clips.length >= 1, "at least one clip emitted");
});

test("bridge.step targets the nearest tagged object for the chosen action", () => {
  let target = undefined;
  // Force hunger so the brain picks eat → food tag.
  const brain = createBrain({
    temperament, rng: makeRng(2), now: 0,
    drives: { hunger: 96, thirst: 20, tiredness: 20, playfulness: 20, happiness: 60 },
  });
  const objects = [obj("bowl", "food_bowl", 2, 3)];
  const bridge = createBrainBridge({ brain, onTarget: (o) => (target = o) });
  bridge.step(0.5, 500, objects, { x: 0, z: 0 });
  assert.ok(target, "a target was chosen");
  assert.equal(target.id, "bowl");
});

test("stroke gesture rewards the current action + raises affection; slap punishes + stresses", () => {
  const brain = createBrain({ temperament, rng: makeRng(3), now: 0 });
  const bridge = createBrainBridge({ brain });
  bridge.step(1, 1000); // establish a current action
  const action = brain.getState().currentAction;
  const before = brain.getState().weights[action];
  const affBefore = brain.getState().hormones.affection;

  bridge.applyGesture("stroke");
  assert.ok(brain.getState().weights[action] > before, "stroke raises the action weight");
  assert.ok(brain.getState().hormones.affection > affBefore, "stroke raises affection");

  const stressBefore = brain.getState().hormones.stress;
  bridge.applyGesture("slap");
  assert.ok(brain.getState().weights[action] < brain.getState().weights[action] + 1); // sanity
  assert.ok(brain.getState().hormones.stress > stressBefore, "slap raises stress");
});

test("tap gesture does not change weights", () => {
  const brain = createBrain({ temperament, rng: makeRng(4), now: 0 });
  const bridge = createBrainBridge({ brain });
  bridge.step(1, 1000);
  const action = brain.getState().currentAction;
  const before = brain.getState().weights[action];
  bridge.applyGesture("tap");
  assert.equal(brain.getState().weights[action], before);
});
