import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../src/components/PawlisherScreen.tsx", import.meta.url), "utf8");

test("Fido's Styles viewer has no Edison bulb feature", () => {
  assert.doesNotMatch(source, /Edison bulb|Lightbulb|lightSettings|pawlisher_light/);
  assert.doesNotMatch(source, /sphereGeometry|cylinderGeometry/);
});

test("360 viewer uses shadow-only grounding without a solid turntable slab", () => {
  assert.match(source, /<ContactShadows\b/);
  assert.doesNotMatch(source, /circleGeometry|planeGeometry/);
  assert.match(source, /360 turntable/);
});
