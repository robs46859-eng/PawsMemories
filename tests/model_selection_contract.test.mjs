import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const [dialog, dashboard, server] = await Promise.all([
  readFile(new URL("../src/components/CreateAvatarDialog.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/components/AvatarDashboard.tsx", import.meta.url), "utf8"),
  readFile(new URL("../server.ts", import.meta.url), "utf8"),
]);

test("model creation exposes auto detection plus explicit animal, human, and object workflows", () => {
  for (const label of ["Auto Detect", "Animal", "Human", "Object"]) assert.match(dialog, new RegExp(label));
  assert.match(dialog, /selectionMode/);
  assert.match(dialog, /subjectSubtype/);
  assert.match(dashboard, /selection_mode: options\.selectionMode/);
  assert.match(dashboard, /subject_subtype: options\.subjectSubtype/);
});

test("server makes the automatic detected type authoritative before it generates the model", () => {
  assert.match(server, /selectionMode === "auto"/);
  assert.match(server, /avatarType = autoDetection\.subjectClass/);
  assert.match(server, /const avatarCost = avatarGenerationCost\(avatarType, inputMode\)/);
  assert.match(server, /selectionMode === "manual"/);
});
