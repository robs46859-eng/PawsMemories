import assert from "node:assert/strict";
import { test } from "node:test";
import {
  parseAndValidateZones,
  semanticScan,
  ZonesSchema,
  extractJson,
} from "../server/semanticScan.ts";
import {
  costAtPoint,
  isWalkable,
  behaviorAtPoint,
  pointInPolygon,
  pathCrossesClass,
  ZONE_COST,
} from "../src/three/ar/navmesh.ts";
import { sampleAmbient, warmthFromRGB } from "../src/three/ar/luminance.ts";

const GOOD = {
  zones: [
    { cls: "natural_ground", points: [[0, 0], [1, 0], [1, 1]] },
    { cls: "water", points: [[0.2, 0.2], [0.4, 0.2], [0.4, 0.4], [0.2, 0.4]] },
  ],
};

// ---- semantic scan (LLM parse/validate) ----

test("extractJson strips fences", () => {
  assert.equal(JSON.parse(extractJson("```json\n" + JSON.stringify(GOOD) + "\n```")).zones.length, 2);
});

test("valid zones parse; unit coords clamp", () => {
  const z = parseAndValidateZones(JSON.stringify({ zones: [{ cls: "water", points: [[2, -1], [0.5, 0.5], [0.1, 0.9]] }] }));
  assert.equal(z.zones[0].points[0][0], 1); // 2 → clamp 1
  assert.equal(z.zones[0].points[0][1], 0); // -1 → clamp 0
});

test("polygon with < 3 points is rejected", () => {
  assert.throws(() => ZonesSchema.parse({ zones: [{ cls: "water", points: [[0, 0], [1, 1]] }] }));
});

test("bad class is rejected", () => {
  assert.throws(() => ZonesSchema.parse({ zones: [{ cls: "lava", points: [[0, 0], [1, 0], [1, 1]] }] }));
});

test("semanticScan retries once at temp 0 on bad first response", async () => {
  const temps = [];
  let n = 0;
  const gen = async ({ temperature }) => {
    temps.push(temperature);
    n++;
    return n === 1 ? "not json" : JSON.stringify(GOOD);
  };
  const z = await semanticScan(gen, { imageBase64: "x" });
  assert.equal(n, 2);
  assert.equal(temps[1], 0);
  assert.equal(z.zones.length, 2);
});

test("empty zones array defaults cleanly", () => {
  assert.deepEqual(parseAndValidateZones(JSON.stringify({})).zones, []);
});

// ---- navmesh geometry ----

const zones = [
  { cls: "vegetation", points: [[0, 0], [2, 0], [2, 2], [0, 2]] }, // impassable square
  { cls: "water", points: [[5, 5], [7, 5], [7, 7], [5, 7]] },
];

test("pointInPolygon inside vs outside", () => {
  assert.equal(pointInPolygon([1, 1], zones[0].points), true);
  assert.equal(pointInPolygon([3, 3], zones[0].points), false);
});

test("costAtPoint: free ground = 1, water = 5, vegetation = Infinity", () => {
  assert.equal(costAtPoint(zones, [10, 10]), 1.0);
  assert.equal(costAtPoint(zones, [6, 6]), ZONE_COST.water);
  assert.equal(costAtPoint(zones, [1, 1]), Infinity);
});

test("isWalkable false inside vegetation, true on open ground", () => {
  assert.equal(isWalkable(zones, [1, 1]), false);
  assert.equal(isWalkable(zones, [10, 10]), true);
});

test("behaviorAtPoint maps water → drink", () => {
  assert.equal(behaviorAtPoint(zones, [6, 6]), "drink");
  assert.equal(behaviorAtPoint(zones, [10, 10]), null);
});

test("pathCrossesClass detects a furniture crossing", () => {
  const seat = [{ cls: "seating", points: [[4, -1], [6, -1], [6, 1], [4, 1]] }];
  assert.equal(pathCrossesClass(seat, [0, 0], [10, 0]), true); // passes through the seating box
  assert.equal(pathCrossesClass(seat, [0, 5], [10, 5]), false); // misses it
});

// ---- luminance ----

test("sampleAmbient averages RGBA and computes luminance", () => {
  // two white pixels + two black pixels → mid grey
  const rgba = [255, 255, 255, 255, 0, 0, 0, 255];
  const s = sampleAmbient(rgba);
  assert.ok(Math.abs(s.luminance - 0.5) < 0.01);
});

test("warmthFromRGB positive for reddish, negative for bluish", () => {
  assert.ok(warmthFromRGB({ luminance: 0.5, r: 0.9, g: 0.3, b: 0.1 }) > 0);
  assert.ok(warmthFromRGB({ luminance: 0.5, r: 0.1, g: 0.3, b: 0.9 }) < 0);
});
