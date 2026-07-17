import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";

const studio = fs.readFileSync("src/components/PawprintsStudio.tsx", "utf8");
const server = fs.readFileSync("server.ts", "utf8");
const routeStart = server.indexOf('app.post("/api/pawprints/generate"');
const routeEnd = server.indexOf('app.post("/api/streak/claim"', routeStart);
const pawprintsRoute = server.slice(routeStart, routeEnd);

test("Pawprints Studio is a click-through manual editor with eight variations", () => {
  assert.match(studio, /What are you creating\?/);
  assert.match(studio, /Choose a starting layout/);
  assert.match(studio, /Choose a variation/);
  assert.match(studio, /"classic"[\s\S]*"overlay"[\s\S]*"split"[\s\S]*"frame"/);
  assert.match(studio, /"story"[\s\S]*"filmstrip"[\s\S]*"circles"[\s\S]*"mosaic"/);
  assert.match(studio, /Minimum 600 × 600/);
  assert.match(studio, /renderPawprint/);
});

test("Pawprints saves a selected rendered canvas and never asks an LLM to write copy", () => {
  assert.ok(routeStart >= 0 && routeEnd > routeStart);
  assert.match(pawprintsRoute, /renderedImage/);
  assert.match(pawprintsRoute, /limitInputPixels: 16_000_000/);
  assert.match(pawprintsRoute, /sharp\(sourceBuffer, sharpInputOptions\)/);
  assert.match(pawprintsRoute, /\.webp\(\{ quality: 92/);
  assert.doesNotMatch(pawprintsRoute, /generateContent/);
  assert.doesNotMatch(pawprintsRoute, /generatedText/);
});

test("Pawprints remains separate from the Animator component tree", () => {
  assert.doesNotMatch(studio, /AnimatorScreen|SceneSequence|AnimationController|onGoToAnimator/);
});
