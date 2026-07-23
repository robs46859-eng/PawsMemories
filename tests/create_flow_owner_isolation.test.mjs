import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
  activeModelJobStorageKey,
  createInitialCreateFlowState,
} from "../src/components/create-flow/createFlowPersistence.ts";

function memoryStorage(entries = {}) {
  const values = new Map(Object.entries(entries));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

test("active build recovery is namespaced by authenticated owner", () => {
  assert.notEqual(activeModelJobStorageKey("alice@example.com"), activeModelJobStorageKey("bob@example.com"));
});

test("a new owner receives no prior candidate, source photo, or session id", () => {
  const aliceKey = activeModelJobStorageKey("alice@example.com");
  const storage = memoryStorage({ [aliceKey]: "alice-job-uuid" });
  const bob = createInitialCreateFlowState("bob@example.com", storage);

  assert.equal(bob.activeJobUuid, undefined);
  assert.equal(bob.sessionId, undefined);
  assert.equal(bob.inputPhotoUrl, undefined);
  assert.equal(bob.candidateImageUrl, undefined);
});

test("CreateFlowProvider resets on owner changes and never stores sensitive image state", () => {
  const source = fs.readFileSync("src/components/create-flow/CreateFlowContext.tsx", "utf8");
  assert.match(source, /ownerKey/);
  assert.match(source, /useEffect\([\s\S]*createInitialCreateFlowState\(ownerKey/);
  assert.doesNotMatch(source, /sessionStorage\.setItem\([^,]+,\s*(?:next\.)?(?:candidateImageUrl|inputPhotoUrl|sessionId)/);
});

test("reference generation waits for ready input and uses a guarded request key", () => {
  const source = fs.readFileSync("src/components/create-flow/CreateReferenceScreen.tsx", "utf8");
  assert.match(source, /generationStartedForRef/);
  assert.match(source, /generationStartedForRef\.current !== generationKey/);
  assert.match(source, /state\.inputPhotoUrl,[\s\S]*state\.textPrompt,/);
});
