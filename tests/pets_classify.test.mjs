import assert from "node:assert/strict";
import { test } from "node:test";
import {
  extractJson,
  parseAndValidateClassify,
  classifyPetImage,
  ClassifySchema,
} from "../server/petClassify.ts";
import { resolveBreedProfile } from "../server/breedProfiles.ts";

const GOOD = {
  breed: "Pug",
  breed_confidence: 0.82,
  breed_top3: ["Pug", "French Bulldog", "Boston Terrier"],
  size_class: "small",
  build: {
    legLengthRatio: 0.4,
    snoutLengthRatio: 0.2,
    earType: "floppy",
    tailType: "curly",
    coat: "short",
  },
  temperament: {
    energy: 0.4,
    sociability: 0.8,
    stubbornness: 0.6,
    foodMotivation: 0.9,
    vocality: 0.5,
  },
  faceLandmarks: { leftEye: [0.4, 0.5], rightEye: [0.6, 0.5], nose: [0.5, 0.6] },
};

test("extractJson strips markdown fences", () => {
  const wrapped = "```json\n" + JSON.stringify(GOOD) + "\n```";
  const out = JSON.parse(extractJson(wrapped));
  assert.equal(out.breed, "Pug");
});

test("valid payload parses and clamps units to [0,1]", () => {
  const over = { ...GOOD, breed_confidence: 1.5, temperament: { ...GOOD.temperament, energy: 2 } };
  const parsed = parseAndValidateClassify(JSON.stringify(over));
  assert.equal(parsed.breed_confidence, 1);
  assert.equal(parsed.temperament.energy, 1);
});

test("malformed JSON throws", () => {
  assert.throws(() => parseAndValidateClassify("not json at all"));
});

test("missing required field fails zod", () => {
  const bad = { ...GOOD };
  delete bad.size_class;
  assert.throws(() => ClassifySchema.parse(bad));
});

test("classifyPetImage succeeds on first good response", async () => {
  let calls = 0;
  const gen = async () => {
    calls++;
    return JSON.stringify(GOOD);
  };
  const r = await classifyPetImage(gen, { imageBase64: "x" });
  assert.equal(calls, 1);
  assert.equal(r.breed, "Pug");
});

test("classifyPetImage retries once at temperature 0 on bad first response", async () => {
  const temps = [];
  let calls = 0;
  const gen = async ({ temperature }) => {
    temps.push(temperature);
    calls++;
    return calls === 1 ? "garbage {not json" : JSON.stringify(GOOD);
  };
  const r = await classifyPetImage(gen, { imageBase64: "x" });
  assert.equal(calls, 2);
  assert.equal(temps[1], 0, "retry is deterministic (temp 0)");
  assert.equal(r.breed, "Pug");
});

test("classifyPetImage throws when both attempts fail", async () => {
  const gen = async () => "still not json";
  await assert.rejects(() => classifyPetImage(gen, { imageBase64: "x" }));
});

test("breed profile resolves known breed, else size fallback", () => {
  assert.equal(resolveBreedProfile("Pug", "small").barkSet, "snort");
  assert.equal(resolveBreedProfile("Siberian Husky", "large").exerciseNeed, 1.6);
  // unknown breed → size_class fallback
  assert.equal(resolveBreedProfile("Totally Made Up Breed", "giant").scale, 1.3);
});
