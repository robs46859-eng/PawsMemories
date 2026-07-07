import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ACTIONS,
  weightsFromTemperament,
  selectAction,
  scoreAction,
  actionById,
  makeRng,
  FUZZ,
} from "../src/brain/index.ts";

const temperament = {
  energy: 0.6,
  sociability: 0.5,
  stubbornness: 0.4,
  foodMotivation: 0.7,
  vocality: 0.3,
};

function ctx(overrides = {}) {
  return {
    drives: { hunger: 20, thirst: 20, tiredness: 20, playfulness: 40, happiness: 70 },
    hormones: { excitement: 20, stress: 10, affection: 40 },
    temperament,
    stimuli: [],
    now: 1000,
    currentAction: null,
    commanded: null,
    ...overrides,
  };
}

const noNoise = () => 0.5; // rng=0.5 → (1 + (0.5*2-1)*FUZZ) = 1, i.e. no noise

test("starving pet selects eat as the top action", () => {
  const weights = weightsFromTemperament(temperament);
  const scored = selectAction(
    ACTIONS,
    weights,
    ctx({ drives: { hunger: 95, thirst: 20, tiredness: 20, playfulness: 40, happiness: 70 } }),
    noNoise
  );
  assert.equal(scored[0].id, "eat");
});

test("exhausted, unplayful pet selects nap over fetch", () => {
  const weights = weightsFromTemperament(temperament);
  const scored = selectAction(
    ACTIONS,
    weights,
    ctx({ drives: { hunger: 10, thirst: 10, tiredness: 95, playfulness: 5, happiness: 70 } }),
    noNoise
  );
  const nap = scored.find((s) => s.id === "nap").utility;
  const fetch = scored.find((s) => s.id === "fetch").utility;
  assert.ok(nap > fetch, "nap should outrank fetch when tired and not playful");
});

test("a zero consideration vetoes an action (product = 0)", () => {
  const eat = actionById("eat");
  // hunger 0 → the hunger consideration linear(0.3,1) maps to 0 → whole product 0
  const u = scoreAction(eat, 1, ctx({ drives: { hunger: 0, thirst: 0, tiredness: 0, playfulness: 0, happiness: 50 } }));
  assert.equal(u, 0);
});

test("fuzzy noise stays within +/-8% of the base score", () => {
  const weights = weightsFromTemperament(temperament);
  const c = ctx({ drives: { hunger: 80, thirst: 20, tiredness: 20, playfulness: 40, happiness: 70 } });
  const base = scoreAction(actionById("eat"), weights.eat, c);
  const rng = makeRng(12345);
  for (let i = 0; i < 500; i++) {
    const scored = selectAction([actionById("eat")], weights, c, rng);
    const u = scored[0].utility;
    assert.ok(u >= base * (1 - FUZZ) - 1e-9 && u <= base * (1 + FUZZ) + 1e-9, `within bounds: ${u} vs ${base}`);
  }
});

test("commanded boost lifts the commanded action", () => {
  const weights = weightsFromTemperament(temperament);
  const withoutCmd = selectAction(ACTIONS, weights, ctx(), noNoise).find((s) => s.id === "dig").utility;
  const withCmd = selectAction(
    ACTIONS,
    weights,
    ctx({ commanded: { action: "dig", until: 5000 } }),
    noNoise
  ).find((s) => s.id === "dig").utility;
  assert.ok(withCmd > withoutCmd, "command should raise dig utility");
});

test("selectAction returns actions sorted by utility desc", () => {
  const weights = weightsFromTemperament(temperament);
  const scored = selectAction(ACTIONS, weights, ctx(), noNoise);
  for (let i = 1; i < scored.length; i++) {
    assert.ok(scored[i - 1].utility >= scored[i].utility, "sorted desc");
  }
});
