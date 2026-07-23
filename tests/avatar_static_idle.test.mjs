import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { resolvePresentationClipName } from "../src/three/modelPresentation.ts";

test("static idle never selects provider idle, breath, or stand clips", () => {
  assert.equal(resolvePresentationClipName("idle", ["Idle", "Breathing", "Stand"], "dog"), null);
  assert.equal(resolvePresentationClipName("idle", ["idle_human"], "human"), null);
});

test("explicit non-idle actions may still select their authored clip", () => {
  assert.equal(resolvePresentationClipName("walking", ["Idle", "WalkCycle"], "dog"), "WalkCycle");
});

test("AvatarModel applies yaw to the model, not the steering root", () => {
  const source = fs.readFileSync("src/three/AvatarModel.tsx", "utf8");
  assert.match(source, /rotation-y=\{radiansForModelYaw\(yawCorrectionDegrees\)\}/);
  assert.match(source, /resolvePresentationClipName\(action/);
});
