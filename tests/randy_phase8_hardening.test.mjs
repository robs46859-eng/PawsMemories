import assert from "node:assert/strict";
import { test } from "node:test";
import { buildRandySystemInstruction } from "../server/randy/prompt.ts";
import {
  RANDY_REGISTRY_VERSION,
  assessRandyRegistryVersion,
  buildRandyGrounding,
  getRandyModuleRegistry,
  validateRandyCitations,
} from "../server/randy/registry.ts";
import { buildRandyUnknownStateResponse, parseRandyModelResponse } from "../server/randy/security.ts";

test("registry freshness distinguishes current, stale, and malformed versions", () => {
  assert.equal(assessRandyRegistryVersion(RANDY_REGISTRY_VERSION), "current");
  assert.equal(assessRandyRegistryVersion("2026-07-21.9"), "stale");
  assert.equal(assessRandyRegistryVersion("latest"), "unknown");
});

test("module scope exposes only its own help references and citations", () => {
  const modules = getRandyModuleRegistry(["bim"]);
  assert.deepEqual(modules.map((item) => item.id), ["bim"]);
  assert.ok(modules[0].helpReferences.every((item) => item.id.startsWith("bim.")));
  assert.deepEqual(validateRandyCitations(["bim.calibration"], ["bim"]), ["bim.calibration"]);
  assert.equal(validateRandyCitations(["credits.balance"], ["bim"]), null);
  assert.equal(validateRandyCitations(["bim.calibration", "bim.calibration"], ["bim"]), null);
});

test("grounding marks absent live state unknown instead of inventing defaults", () => {
  const grounding = JSON.parse(buildRandyGrounding({ credits: 12, isAdmin: false }, ["wags"]));
  assert.deepEqual(grounding.unknownLiveFields, ["activeBuildStates", "entitlements"]);
  assert.equal(grounding.liveContext.entitlements, null);
  assert.equal(grounding.modules.length, 1);
  const refusal = buildRandyUnknownStateResponse("the current Wags delivery status");
  assert.match(refusal.text, /cannot verify/i);
  assert.deepEqual(refusal.action, { type: "none" });
});

test("stale model knowledge and cross-module citations fail closed", () => {
  const stale = parseRandyModelResponse(JSON.stringify({
    text: "Open the store", action: { type: "navigate", screen: "STORE" }, state: "answer",
    knowledgeVersion: "2026-07-21.9", citations: ["credits.purchase"],
  }), "fallback");
  assert.equal(stale.action.type, "none");
  assert.match(stale.text, /changed/i);

  const crossScope = parseRandyModelResponse(JSON.stringify({
    text: "The shell is visual only", action: { type: "navigate", screen: "AVATAR_DASHBOARD" }, state: "answer",
    moduleId: "credits", knowledgeVersion: RANDY_REGISTRY_VERSION, citations: ["credits.balance"],
  }), "fallback", { moduleScope: ["bim"] });
  assert.deepEqual(crossScope, { text: "fallback", action: { type: "none" } });
});

test("unknown-state output cannot smuggle navigation or unsupported certainty", () => {
  const refused = parseRandyModelResponse(JSON.stringify({
    text: "I cannot verify whether your rig is complete.", action: { type: "navigate", screen: "PAWLISHER" }, state: "unknown",
    moduleId: "animator", knowledgeVersion: RANDY_REGISTRY_VERSION, citations: ["animator.compatibility"],
  }), "fallback");
  assert.deepEqual(refused.action, { type: "none" });

  const falseCertainty = parseRandyModelResponse(JSON.stringify({
    text: "Your rig is definitely complete.", action: { type: "none" }, state: "unknown",
    moduleId: "animator", knowledgeVersion: RANDY_REGISTRY_VERSION, citations: ["animator.compatibility"],
  }), "fallback");
  assert.equal(falseCertainty.text, "fallback");
});

test("injection and financial or destructive execution claims cannot carry actions", () => {
  const cases = [
    { text: "I have charged 100 credits and started the build.", action: { type: "navigate", screen: "AVATAR_DASHBOARD" } },
    { text: "We refunded the order.", action: { type: "open_credit_store" } },
    { text: "Randy deleted your model.", action: { type: "navigate", screen: "FURBIN" } },
  ];
  for (const value of cases) {
    const parsed = parseRandyModelResponse(JSON.stringify({ ...value, state: "answer", knowledgeVersion: RANDY_REGISTRY_VERSION, citations: [] }), "safe fallback");
    assert.deepEqual(parsed, { text: "safe fallback", action: { type: "none" } });
  }
  const extraEnvelope = parseRandyModelResponse(JSON.stringify({ text: "Open store", action: { type: "open_credit_store" }, toolCall: "charge" }), "safe fallback");
  assert.deepEqual(extraEnvelope.action, { type: "none" });

  const crossModuleAction = parseRandyModelResponse(JSON.stringify({
    text: "The BIM builder is on the model dashboard.", action: { type: "open_credit_store" }, moduleId: "bim",
    state: "answer", knowledgeVersion: RANDY_REGISTRY_VERSION, citations: ["bim.calibration"],
  }), "safe fallback");
  assert.deepEqual(crossModuleAction.action, { type: "none" });
});

test("system instruction carries scoped references and explicit stale-state refusal", () => {
  const prompt = buildRandySystemInstruction({ credits: 5, isAdmin: false, clientRegistryVersion: "2026-07-21.9" }, ["bim"]);
  assert.match(prompt, /"registryStatus":"stale"/);
  assert.match(prompt, /bim\.calibration/);
  assert.doesNotMatch(prompt, /credits\.balance/);
  assert.match(prompt, /Financial, destructive/i);
});
