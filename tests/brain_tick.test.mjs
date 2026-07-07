import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createBrain,
  makeRng,
  makeStimulus,
  neglectEnabled,
  isUnlocked,
  unlockedMechanics,
} from "../src/brain/index.ts";

const temperament = {
  energy: 0.6,
  sociability: 0.5,
  stubbornness: 0.4,
  foodMotivation: 0.7,
  vocality: 0.3,
};

test("brain.tick advances state and selects an action", () => {
  const brain = createBrain({ temperament, rng: makeRng(1), now: 0 });
  const events = brain.tick(1, { now: 1000 });
  assert.ok(events.some((e) => e.type === "action-selected"), "selects an action on first tick");
  const state = brain.getState();
  assert.ok(state.currentAction, "has a current action");
  assert.ok(state.drives.hunger > 20, "hunger decayed from default");
});

test("starving brain chooses to eat", () => {
  const brain = createBrain({
    temperament,
    rng: makeRng(7),
    now: 0,
    drives: { hunger: 96, thirst: 20, tiredness: 20, playfulness: 30, happiness: 60 },
  });
  const events = brain.tick(0.5, { now: 500 });
  const sel = events.find((e) => e.type === "action-selected");
  assert.equal(sel.action, "eat");
});

test("reselect is throttled (<1.5s keeps the same action)", () => {
  const brain = createBrain({ temperament, rng: makeRng(3), now: 0 });
  brain.tick(0.1, { now: 100 });
  const first = brain.getState().currentAction;
  const events = brain.tick(0.1, { now: 300 }); // only 200ms later
  assert.ok(!events.some((e) => e.type === "action-selected"), "no reselect within 1.5s");
  assert.equal(brain.getState().currentAction, first);
});

test("stimulus can be added without throwing and biases fetch", () => {
  const brain = createBrain({ temperament, rng: makeRng(5), now: 0 });
  brain.addStimulus(makeStimulus("ball1", "fetch", 0, true));
  const events = brain.tick(1, { now: 1000, eventForced: true });
  assert.ok(Array.isArray(events));
});

test("state is serialisable (round-trips through JSON)", () => {
  const brain = createBrain({ temperament, rng: makeRng(9), now: 0 });
  brain.tick(1, { now: 1000 });
  const state = brain.getState();
  const round = JSON.parse(JSON.stringify(state));
  assert.deepEqual(round.drives, state.drives);
  assert.deepEqual(round.weights, state.weights);
});

test("pacing gates: neglect off below S1, mechanics unlock in order", () => {
  assert.equal(neglectEnabled(10), false);
  assert.equal(neglectEnabled(60), true);
  assert.equal(isUnlocked("voiceTraining", 25), true);
  assert.equal(isUnlocked("agilityCourse", 25), false);
  const unlocked = unlockedMechanics(70);
  assert.deepEqual(unlocked, ["voiceTraining", "spatialButtons"]);
});
