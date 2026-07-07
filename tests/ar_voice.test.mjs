import assert from "node:assert/strict";
import { test } from "node:test";
import {
  phoneticKey,
  phraseKey,
  levenshtein,
  matchCommand,
  shouldPerform,
  MATCH_THRESHOLD,
} from "../src/three/ar/voice.ts";
import {
  isSteppingOn,
  distanceToButton,
  reinforceAssociation,
  linkActionOnTap,
  buttonUnderPet,
} from "../src/three/ar/buttons.ts";
import { decayCompliance } from "../src/brain/index.ts";

// ---- phonetic + matching ----

test("phoneticKey normalizes similar spellings close together", () => {
  assert.equal(phoneticKey("sit"), phoneticKey("Sit"));
  // near-homophones should be within a small edit distance
  assert.ok(levenshtein(phoneticKey("sit"), phoneticKey("sitt")) <= 1);
  assert.ok(levenshtein(phoneticKey("fone"), phoneticKey("phone")) <= 1);
});

test("phraseKey handles multi-word phrases", () => {
  assert.equal(phraseKey("  roll  over "), [phoneticKey("roll"), phoneticKey("over")].join(" "));
});

const commands = [
  { id: 1, action: "nap", keys: [phraseKey("lie down")], compliance: 0.8 },
  { id: 2, action: "fetch", keys: [phraseKey("fetch")], compliance: 0.6 },
];

test("matchCommand: exact-ish → comply", () => {
  const r = matchCommand("fetch", commands);
  assert.equal(r.decision, "comply");
  assert.equal(r.command.id, 2);
  assert.ok(r.distance <= MATCH_THRESHOLD);
});

test("matchCommand: moderately off → confuse", () => {
  // 'fetchy' differs from 'fetch' phonetically by a little
  const r = matchCommand("fetchez", commands);
  assert.ok(["confuse", "comply"].includes(r.decision));
});

test("matchCommand: unrelated word → ignore", () => {
  const r = matchCommand("banana pancakes", commands);
  assert.equal(r.decision, "ignore");
  assert.equal(r.command, null);
});

test("shouldPerform respects compliance and stubbornness", () => {
  assert.equal(shouldPerform(1, 0.99, 0), true); // p=1
  assert.equal(shouldPerform(0, 0.0, 0), false); // p=0
  // stubbornness halves at 1.0: p = 0.8*0.5 = 0.4
  assert.equal(shouldPerform(0.8, 0.5, 1), false);
  assert.equal(shouldPerform(0.8, 0.3, 1), true);
});

test("commands forget toward baseline over days", () => {
  assert.ok(decayCompliance(0.9, 30, 0.5) < 0.9);
  assert.equal(decayCompliance(0.9, 0, 0.5), 0.9);
});

// ---- spatial buttons ----

const btn = { id: "b1", label: "Play", audioUrl: "u", linkedAction: null, associationStrength: 0, anchor: { x: 1, y: 0, z: 1 } };

test("distanceToButton + isSteppingOn use planar XZ distance", () => {
  assert.ok(Math.abs(distanceToButton(btn, { x: 1, z: 1 })) < 1e-9);
  assert.equal(isSteppingOn(btn, { x: 1, z: 1 }), true);
  assert.equal(isSteppingOn(btn, { x: 5, z: 5 }), false);
});

test("reinforceAssociation clamps to [0,1]", () => {
  let s = 0.95;
  for (let i = 0; i < 5; i++) s = reinforceAssociation(s);
  assert.ok(s <= 1);
});

test("linkActionOnTap links an unlinked button and bumps association", () => {
  const linked = linkActionOnTap(btn, "fetch");
  assert.equal(linked.linkedAction, "fetch");
  assert.ok(linked.associationStrength > btn.associationStrength);
  // does not overwrite an existing link
  const relinked = linkActionOnTap(linked, "nap");
  assert.equal(relinked.linkedAction, "fetch");
});

test("buttonUnderPet returns the nearest button within radius", () => {
  const buttons = [
    { ...btn, id: "far", anchor: { x: 10, y: 0, z: 10 } },
    { ...btn, id: "near", anchor: { x: 0.1, y: 0, z: 0 } },
  ];
  assert.equal(buttonUnderPet(buttons, { x: 0, z: 0 }).id, "near");
  assert.equal(buttonUnderPet(buttons, { x: 5, z: 5 }), null);
});
