import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";

test("creations hub surfaces saved videos and Pawprints", () => {
  const source = fs.readFileSync("src/components/CreationsScreen.tsx", "utf8");
  assert.match(source, /creation\.video_url/);
  assert.match(source, /preset_name\?\.toLowerCase\(\) === "pawprint"/);
  assert.match(source, /Create a video/);
  assert.match(source, /Make a Pawprint/);
});

test("creation routes and completion handlers refresh the shared library", () => {
  const app = fs.readFileSync("src/App.tsx", "utf8");
  const animator = fs.readFileSync("src/components/AnimationStudio.tsx", "utf8");
  const pawprints = fs.readFileSync("src/components/PawprintsStudio.tsx", "utf8");
  assert.match(app, /\[Screen\.CREATIONS\]: "\/creations"/);
  assert.match(app, /onCreationsChanged=\{refreshCreations\}/);
  assert.match(app, /onCreationSaved=\{refreshCreations\}/);
  assert.match(animator, /await onCreationsChanged\?\.\(\)/);
  assert.match(pawprints, /await onCreationSaved\?\.\(\)/);
});
