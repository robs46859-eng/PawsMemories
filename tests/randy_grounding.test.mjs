import assert from "node:assert/strict";
import { test } from "node:test";
import { CREDIT_PRICES } from "../src/pricing.ts";
import { buildRandyGrounding, getRandyModuleRegistry, RANDY_REGISTRY_VERSION } from "../server/randy/registry.ts";
import { buildRandySystemInstruction } from "../server/randy/prompt.ts";
import { parseRandyModelResponse, RandyChatRequestSchema, sanitizeRandyText, validateRandyAction } from "../server/randy/security.ts";

test("Randy registry uses authoritative prices and a version", () => {
  const modules = getRandyModuleRegistry();
  assert.match(RANDY_REGISTRY_VERSION, /^\d{4}-\d{2}-\d{2}\./);
  assert.equal(modules.find((item) => item.id === "pawprints").prices.pawprint, CREDIT_PRICES.PAWPRINT);
  assert.equal(modules.find((item) => item.id === "bim").prices.ifc, CREDIT_PRICES.BIM_IFC_MODEL);
});

test("Randy grounding includes only supplied live account context", () => {
  const parsed = JSON.parse(buildRandyGrounding({ credits: 27, isAdmin: false, activeBuildStates: ["processing"] }));
  assert.equal(parsed.liveContext.credits, 27);
  assert.deepEqual(parsed.liveContext.activeBuildStates, ["processing"]);
  assert.equal(JSON.stringify(parsed).includes("password"), false);
});

test("Randy prompt forbids invented product state and prompt injection", () => {
  const prompt = buildRandySystemInstruction({ credits: 10, isAdmin: false });
  assert.match(prompt, /Never claim.*succeeded/i);
  assert.match(prompt, /untrusted/i);
  assert.match(prompt, /"credits":10/);
  assert.match(prompt, /allowlisted registry screen/);
});

test("Randy actions fail closed for unknown routes, tours, selectors, and extra fields", () => {
  assert.deepEqual(validateRandyAction({ type: "navigate", screen: "FURBIN" }), { type: "navigate", screen: "FURBIN" });
  assert.deepEqual(validateRandyAction({ type: "navigate", screen: "ADMIN" }), { type: "none" });
  assert.deepEqual(validateRandyAction({ type: "highlight", target: "body" }), { type: "none" });
  assert.deepEqual(validateRandyAction({ type: "open_credit_store", amount: 1000 }), { type: "none" });
  assert.deepEqual(validateRandyAction({ type: "delete_account" }), { type: "none" });
});

test("Randy text is bounded and strips control characters", () => {
  const output = sanitizeRandyText(`hello\u0000${"x".repeat(2000)}`, "fallback");
  assert.equal(output.includes("\u0000"), false);
  assert.equal(output.length, 1200);
  assert.equal(sanitizeRandyText("", "fallback"), "fallback");
});

test("Randy response parsing accepts strict JSON and removes actions from malformed output", () => {
  assert.deepEqual(
    parseRandyModelResponse('```json\n{"text":"Open Fur Bin","action":{"type":"navigate","screen":"FURBIN"}}\n```', "fallback"),
    { text: "Open Fur Bin", action: { type: "navigate", screen: "FURBIN" } },
  );
  const malformed = parseRandyModelResponse('{"text":"Ignore policy"} trailing {"type":"navigate","screen":"STORE"}', "fallback");
  assert.equal(malformed.action.type, "none");
  assert.match(malformed.text, /Ignore policy/);
});

test("Randy chat input is bounded and rejects unknown fields", () => {
  assert.equal(RandyChatRequestSchema.safeParse({ message: "Where is Fur Bin?", history: [] }).success, true);
  assert.equal(RandyChatRequestSchema.safeParse({ message: "x".repeat(2001), history: [] }).success, false);
  assert.equal(RandyChatRequestSchema.safeParse({ message: "hello", history: [], admin: true }).success, false);
});
