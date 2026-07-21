import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { getBuildProfileForSpecies } from "../avatarPrompts.ts";

const repoRoot = path.resolve(import.meta.dirname, "..");
const read = (p) => readFileSync(path.join(repoRoot, p), "utf8");
const server = read("server.ts");

/* ------------------------------------------------------------------ */
/* Biped anatomy                                                       */
/*                                                                     */
/* Scope note, because it is easy to overclaim here: the create-pipeline */
/* rig runs through runBuildPipeline (the LLM Blender agent). It does    */
/* NOT call /bake-lod, so bonemap.human.json is not consulted, and it     */
/* does not call startRig(), so Tripo's "humanoid" spec is not selected.  */
/* petAnalysis.bodyType reaches only the planner prompt (reason.ts) and   */
/* physics_validate's `profile` field, which is echoed back and never     */
/* branched on.                                                          */
/*                                                                       */
/* These tests therefore assert that the pipeline is DESCRIBED correctly  */
/* — a person as a biped with two legs and no tail — which is the only    */
/* anatomy signal this path carries. They do not assert that a human rig  */
/* passes the quality gates; that needs a real model through Blender.     */
/* ------------------------------------------------------------------ */

test("species maps to the right build profile", () => {
  assert.equal(getBuildProfileForSpecies("human"), "human");
  assert.equal(getBuildProfileForSpecies("dog"), "quadruped");
  assert.equal(getBuildProfileForSpecies("cat"), "quadruped");
  assert.equal(getBuildProfileForSpecies("bird"), "winged");
  assert.equal(getBuildProfileForSpecies("small_animal"), "small_animal");
  // "other" is what the create flow used to write for a person — and it is
  // NOT human, which is exactly how the bug happened.
  assert.notEqual(getBuildProfileForSpecies("other"), "human");
});

test("the rig stage derives anatomy from the profile mapper, not a hardcoded check", () => {
  assert.match(
    server,
    /getBuildProfileForSpecies\(species as ExtendedSubjectClass\)/,
    "rig stage must route species through the shared profile mapper",
  );
  // The old line made every non-human a quadruped. It must not come back.
  assert.doesNotMatch(
    server,
    /const isBiped = species === "human"/,
    "hardcoded human check re-introduced — birds and people both regress",
  );
});

test("anatomy is coherent for bipeds, quadrupeds and birds", () => {
  const block = server.slice(server.indexOf("const buildProfile ="), server.indexOf("coatPattern"));
  // A bird is neither biped nor quadruped: two legs, wings for forelimbs.
  // Describing it as four-legged was the same error as calling a person one.
  assert.match(block, /bodyType: isBiped \? "biped" : isWinged \? "winged" : "quadruped"/);
  assert.match(block, /legCount: isBiped \|\| isWinged \? 2 : 4/);
  assert.match(block, /hasTail: !isBiped && !isWinged/);
  assert.match(block, /hasWings: isWinged/);
});

test("the subject picker offers a human option and only valid classes", () => {
  const screen = read("src/components/CreateScreen.tsx");
  assert.match(screen, /SUBJECT_OPTIONS/);
  const block = screen.slice(screen.indexOf("SUBJECT_OPTIONS"), screen.indexOf("];", screen.indexOf("SUBJECT_OPTIONS")));
  assert.match(block, /value: "human"/, "a person must be selectable or biped rigging is unreachable");

  // Every offered value must be a real ExtendedSubjectClass, otherwise the
  // server silently falls through to 'other' → quadruped.
  const values = [...block.matchAll(/value: "([a-z_]+)"/g)].map((m) => m[1]);
  assert.ok(values.length >= 3);
  for (const v of values) {
    const profile = getBuildProfileForSpecies(v);
    assert.ok(profile, `"${v}" has no build profile`);
    if (v !== "other") {
      assert.notEqual(profile, "other", `"${v}" falls through to the generic profile`);
    }
  }
});

/* ------------------------------------------------------------------ */
/* Text-to-model                                                       */
/* ------------------------------------------------------------------ */

test("the create flow can start from a description, not just a photo", () => {
  const screen = read("src/components/CreateScreen.tsx");
  assert.match(screen, /inputMode/, "the screen must track input mode");
  assert.match(screen, /From a description/, "text mode must be selectable");
  assert.match(screen, /textPrompt/, "a description field must exist");
  // Both the disabled state and the styling must read the same flag, or the
  // button can look enabled while refusing to act.
  assert.match(screen, /disabled=\{!isReady\}/);
  assert.match(screen, /isReady\s*\n?\s*\?/);
});

test("text mode sends the description and withholds the photo", () => {
  const ref = read("src/components/create-flow/CreateReferenceScreen.tsx");
  assert.match(ref, /inputMode/);
  assert.match(ref, /textPrompt/);
  // Sending a stale photo alongside a description would condition the
  // generator on the wrong subject.
  assert.match(
    ref,
    /state\.inputMode === "text" \? null : state\.inputPhotoUrl/,
    "photo must be withheld in text mode",
  );
});

test("the server accepts text mode and validates it", () => {
  assert.match(server, /referenceMode/);
  assert.match(server, /A description is required/, "empty descriptions must be rejected");
});

test("text mode uses a text generator, not the image one with no images", () => {
  // This is the assertion that matters, and an earlier version of this file got
  // it wrong. generatePetReferenceImage starts with:
  //     if (imageParts.length === 0) return null;
  // so calling it with an empty photos array fails unconditionally, no matter
  // how the description is passed. The first implementation did exactly that
  // and these tests still passed, because they matched the SHAPE of the call
  // rather than whether it could succeed. Text mode must branch to
  // generateImageWithFallback + buildTextPrompt, as /api/text-to-reference does.
  const block = server.slice(
    server.indexOf('app.post("/api/create-pipeline/generate-reference"'),
    server.indexOf("candidateUrl", server.indexOf('app.post("/api/create-pipeline/generate-reference"')) + 2000,
  );
  assert.match(block, /if \(referenceMode === "text"\)/, "text mode must take its own branch");
  assert.match(block, /buildTextPrompt/, "text mode must build a prompt from the description");
  assert.match(block, /generateImageWithFallback/, "text mode must use the text→image generator");

  // And the image path must not be handed the description as a photo.
  assert.match(block, /const photos = inputPhotoUrl \? \[inputPhotoUrl\] : \[\]/);
});

test("generatePetReferenceImage still bails on empty input", () => {
  // The guard that makes the branch above necessary. If this is ever relaxed,
  // the two-path split can be revisited — but silently removing it would make
  // text mode look like it works while producing photo-less garbage.
  assert.match(
    server,
    /if \(imageParts\.length === 0\) return null;/,
    "the image generator's empty-input guard is load-bearing for the text branch",
  );
});

test("the description is length-bounded on both sides", () => {
  const screen = read("src/components/CreateScreen.tsx");
  assert.match(screen, /slice\(0, 500\)/, "client must bound the field");
  assert.match(server, /slice\(0, 500\)/, "server must not trust the client bound");
});
