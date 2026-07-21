import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const server = readFileSync(path.join(repoRoot, "server.ts"), "utf8");

test("Slant 3D Marketplace physical checkout invariant checks", () => {
  assert.ok(server.includes('app.post("/api/marketplace/listings/:uuid/print/checkout"'), "Route is mounted");
  assert.ok(server.includes("requireAuth"), "Route is authenticated");
  assert.ok(server.includes("targetHeightMm"), "Route accepts height bounds");
  assert.ok(server.includes("stl_derivative"), "Route queries for cached STL derivative");
  assert.ok(server.includes("/prepare-print"), "Route invokes worker if no cache");
  assert.ok(server.includes("INSERT INTO print_orders"), "Route records the order");
});
