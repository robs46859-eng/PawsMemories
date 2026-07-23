import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
  DEFAULT_MODEL_YAW_CORRECTION_DEGREES,
  modelViewerOrientation,
  radiansForModelYaw,
} from "../src/three/modelPresentation.ts";

test("legacy provider models receive the canonical 90-degree presentation correction", () => {
  assert.equal(DEFAULT_MODEL_YAW_CORRECTION_DEGREES, 90);
  assert.equal(radiansForModelYaw(), Math.PI / 2);
  assert.equal(modelViewerOrientation(), "0deg 90deg 0deg");
});

test("model-viewer remains static and applies presentation orientation", () => {
  const source = fs.readFileSync("src/components/PetModelViewer.tsx", "utf8");
  assert.match(source, /orientation=\{modelViewerOrientation\(yawCorrectionDegrees\)\}/);
  assert.match(source, /autoplay=\{false\}/);
});
