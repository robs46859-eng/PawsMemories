import assert from "node:assert/strict";
import { test } from "node:test";

const {
  CLASS_DEFINITIONS,
  REFERENCE_STYLE_HUMAN,
  HUMAN_ANATOMY_SPEC,
  HUMAN_PROPORTION_SPEC,
  buildReferencePrompt,
} = await import("../avatarPrompts.ts");

test("CLASS_DEFINITIONS states canonical human anatomy counts", () => {
  const d = CLASS_DEFINITIONS.toLowerCase();
  for (const kw of ["two eyes", "two ears", "two nostrils", "five fingers"]) {
    assert.ok(d.includes(kw), `expected human definition to mention "${kw}"`);
  }
});

test("CLASS_DEFINITIONS distinguishes the six object subcategories", () => {
  for (const cat of ["structure", "prop", "plant", "food", "part", "blueprint"]) {
    assert.match(CLASS_DEFINITIONS, new RegExp(`"${cat}"`), `missing objectCategory "${cat}"`);
  }
  // Key distinctions are spelled out.
  assert.match(CLASS_DEFINITIONS, /habitable|inside/i);   // structure vs prop
  assert.match(CLASS_DEFINITIONS, /eaten|consumed/i);      // food vs plant
  assert.match(CLASS_DEFINITIONS, /2D|drawing|plan/i);     // blueprint vs part
});

test("HUMAN_PROPORTION_SPEC gives head-height ratio ranges", () => {
  assert.match(HUMAN_PROPORTION_SPEC, /head-height/i);
  assert.match(HUMAN_PROPORTION_SPEC, /torso/i);
  assert.match(HUMAN_PROPORTION_SPEC, /legs/i);
  assert.match(HUMAN_PROPORTION_SPEC, /\d(\.\d)?\s*to\s*\d/); // an explicit numeric range
});

test("REFERENCE_STYLE_HUMAN embeds the anatomy and proportion specs", () => {
  assert.ok(REFERENCE_STYLE_HUMAN.includes(HUMAN_ANATOMY_SPEC));
  assert.ok(REFERENCE_STYLE_HUMAN.includes(HUMAN_PROPORTION_SPEC));
});

test("buildReferencePrompt(human) carries the anatomy/proportion guidance", () => {
  const p = buildReferencePrompt("human");
  assert.match(p, /five distinct fingers|five fingers/i);
  assert.match(p, /head-height/i);
});
