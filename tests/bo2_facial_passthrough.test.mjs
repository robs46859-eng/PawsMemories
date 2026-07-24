import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  parseVisemeResult,
  facialPassthroughMetadata,
} from "../agent/graph/nodes/facialVisemes.ts";

// ---------------------------------------------------------------------------
// parseVisemeResult — measured truth extraction from the passthrough script
// ---------------------------------------------------------------------------

test("parseVisemeResult reads an available result with shapes", () => {
  const stdout = [
    "some blender noise",
    'VISEME_RESULT:{"available": true, "shapes": ["viseme_A", "viseme_D"], "detail": "Provider targets preserved; otherwise jaw fallback."}',
  ].join("\n");
  const parsed = parseVisemeResult(stdout);
  assert.ok(parsed);
  assert.equal(parsed.available, true);
  assert.deepEqual(parsed.shapes, ["viseme_A", "viseme_D"]);
});

test("parseVisemeResult treats available:true with zero shapes as unavailable", () => {
  const parsed = parseVisemeResult('VISEME_RESULT:{"available": true, "shapes": [], "detail": "x"}');
  assert.ok(parsed);
  assert.equal(parsed.available, false, "no measured shapes means no capability");
});

test("parseVisemeResult reads the no-face-mesh result", () => {
  const parsed = parseVisemeResult('VISEME_RESULT:{"available": false, "detail": "No face mesh found; jaw fallback remains active."}');
  assert.ok(parsed);
  assert.equal(parsed.available, false);
  assert.deepEqual(parsed.shapes, []);
  assert.match(parsed.detail, /jaw fallback/i);
});

test("parseVisemeResult returns null for missing marker, garbage JSON, and non-strings", () => {
  assert.equal(parseVisemeResult("no marker here"), null);
  assert.equal(parseVisemeResult("VISEME_RESULT:{not json"), null);
  assert.equal(parseVisemeResult(undefined), null);
  assert.equal(parseVisemeResult(42), null);
});

test("parseVisemeResult uses the LAST marker line and filters non-string shapes", () => {
  const stdout = [
    'VISEME_RESULT:{"available": false, "detail": "first run"}',
    'VISEME_RESULT:{"available": true, "shapes": ["viseme_X", 7, null, ""], "detail": "second run"}',
  ].join("\n");
  const parsed = parseVisemeResult(stdout);
  assert.ok(parsed);
  assert.deepEqual(parsed.shapes, ["viseme_X"]);
  assert.equal(parsed.detail, "second run");
});

// ---------------------------------------------------------------------------
// facialPassthroughMetadata — no fabricated capability claims
// ---------------------------------------------------------------------------

test("unpurchased facial add-on reports source none and no shapes", () => {
  const meta = facialPassthroughMetadata(
    { available: true, shapes: ["viseme_A"], detail: "" },
    false,
  );
  assert.equal(meta.facial.source, "none");
  assert.equal(meta.facial.purchased, false);
  assert.equal("shapes" in meta.facial, false, "unpurchased metadata must not carry shapes");
});

test("purchased but unavailable reports jaw fallback with empty shapes", () => {
  const meta = facialPassthroughMetadata(null, true);
  assert.equal(meta.facial.source, "provider_morph_passthrough");
  assert.equal(meta.facial.available, false);
  assert.deepEqual(meta.facial.shapes, []);
  assert.equal(meta.facial.fallback, "jaw_bone");
});

test("purchased and measured reports the exact sorted shape list", () => {
  const meta = facialPassthroughMetadata(
    { available: true, shapes: ["viseme_D", "viseme_A"], detail: "ok" },
    true,
  );
  assert.equal(meta.facial.available, true);
  assert.deepEqual(meta.facial.shapes, ["viseme_A", "viseme_D"]);
});

test("metadata never claims the full contract string unconditionally", () => {
  const meta = facialPassthroughMetadata(null, true);
  assert.equal(
    JSON.stringify(meta).includes("viseme_A..viseme_X"),
    false,
    "the hardcoded contract-range claim must be gone",
  );
});

// ---------------------------------------------------------------------------
// Source guards — the fabricated claim cannot silently return
// ---------------------------------------------------------------------------

const here = path.dirname(fileURLToPath(import.meta.url));

test("finalize.ts no longer hardcodes facialVisemeContract", () => {
  const source = readFileSync(path.join(here, "../agent/graph/nodes/finalize.ts"), "utf8");
  assert.equal(source.includes('facialVisemeContract: "viseme_A..viseme_X"'), false);
  assert.match(source, /facialPassthroughMetadata\(/, "finalize must derive facial metadata from the measured passthrough");
});

test("the passthrough script still refuses to fabricate mouth shapes", () => {
  const source = readFileSync(path.join(here, "../agent/graph/nodes/facialVisemes.ts"), "utf8");
  assert.match(source, /Never fabricate a mouth shape/i);
  assert.match(source, /passthrough/i, "module must self-describe as a passthrough, not a facial rig");
});

test("act.ts captures the measured passthrough result into build state", () => {
  const source = readFileSync(path.join(here, "../agent/graph/nodes/act.ts"), "utf8");
  assert.match(source, /parseVisemeResult\(/);
  assert.match(source, /facialPassthrough,/, "export branch must return the captured passthrough");
});
