import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
  DEFAULT_MODEL_YAW_CORRECTION_DEGREES,
  modelViewerCameraOrbit,
  radiansForModelYaw,
} from "../src/three/modelPresentation.ts";

test("model geometry stays unrotated while the viewer camera moves horizontally", () => {
  assert.equal(DEFAULT_MODEL_YAW_CORRECTION_DEGREES, 0);
  assert.equal(radiansForModelYaw(), 0);
  assert.equal(modelViewerCameraOrbit(), "90deg 80deg 105%");
});

test("model-viewer remains static and applies presentation orientation", () => {
  const source = fs.readFileSync("src/components/PetModelViewer.tsx", "utf8");
  assert.match(source, /camera-orbit=\{modelViewerCameraOrbit\(cameraAzimuthDegrees\)\}/);
  assert.doesNotMatch(source, /orientation=\{/);
  assert.match(source, /autoplay=\{false\}/);
});
