import assert from "node:assert/strict";
import { test } from "node:test";

const {
  CLASS_DEFINITIONS,
  REFERENCE_STYLE_HUMAN,
  HUMAN_ANATOMY_SPEC,
  HUMAN_PROPORTION_SPEC,
  HUMAN_FULLBODY_SPEC,
  buildReferencePrompt,
  buildHumanReferenceStyle,
  humanStyleClause,
  selectedStyleClause,
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
  // Also includes the full-body spec
  assert.ok(REFERENCE_STYLE_HUMAN.includes(HUMAN_FULLBODY_SPEC));
});

test("buildReferencePrompt(human) carries the anatomy/proportion guidance", () => {
  const p = buildReferencePrompt("human");
  assert.match(p, /five distinct fingers|five fingers/i);
  assert.match(p, /head-height/i);
});

// ── New tests for full-body + style implementation ──────────────────────────

test("HUMAN_ANATOMY_SPEC now enforces five toes per foot", () => {
  const a = HUMAN_ANATOMY_SPEC.toLowerCase();
  assert.ok(a.includes("five toes") || a.includes("five distinct toes"),
    "expected the anatomy spec to require five toes per foot");
});

test("HUMAN_FULLBODY_SPEC forces a complete, uncropped standing figure", () => {
  const f = HUMAN_FULLBODY_SPEC.toLowerCase();
  assert.match(f, /full[- ]?body|entire person|head down to/i);
  assert.match(f, /both feet/i);
  assert.match(f, /not a bust|not.*cropped|nothing is cropped/i);
});

test("buildReferencePrompt(human) defaults to hyper-realistic and stays anatomically complete", () => {
  const p = buildReferencePrompt("human").toLowerCase();
  assert.match(p, /hyper-realistic|photoreal/i);       // default look
  assert.match(p, /five distinct fingers|five fingers/i);
  assert.match(p, /five toes/i);
  assert.match(p, /both feet/i);
});

test("buildReferencePrompt(human, …, 'pixar') switches the look but keeps anatomy", () => {
  const p = buildReferencePrompt("human", null, false, 1, "pixar").toLowerCase();
  assert.match(p, /pixar/i);
  assert.match(p, /five toes/i);       // anatomy is style-independent
  assert.match(p, /both feet/i);
});

test("humanStyleClause maps auto/undefined to hyper-realistic", () => {
  assert.match(humanStyleClause(undefined), /hyper-realistic|photoreal/i);
  assert.match(humanStyleClause("auto"), /hyper-realistic|photoreal/i);
  assert.match(humanStyleClause("chibi"), /chibi/i);
});

test("pet and object prompts honor distinct selected output styles", () => {
  const petClay = buildReferencePrompt("dog", null, false, 1, "claymation").toLowerCase();
  const petVoxel = buildReferencePrompt("dog", null, false, 1, "voxel").toLowerCase();
  const objectWood = buildReferencePrompt("object", null, false, 1, "wood").toLowerCase();
  assert.match(petClay, /claymation|modeling-clay/);
  assert.match(petVoxel, /voxel|cubic blocks/);
  assert.match(objectWood, /wood grain|wooden/);
  assert.notEqual(petClay, petVoxel);
});

test("pet Auto is neutral and does not silently force a glossy cartoon finish", () => {
  const automatic = selectedStyleClause("auto").toLowerCase();
  const prompt = buildReferencePrompt("dog", null, false, 1, "auto").toLowerCase();
  assert.match(automatic, /reconstruction|accurate proportions|surface details/);
  assert.doesNotMatch(automatic, /pixar|vinyl|glossy/);
  assert.match(prompt, /do not impose.*cartoon.*glossy.*pixar/);
});
