import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const read = (relativePath) => readFileSync(path.join(repoRoot, relativePath), "utf8");

const marketplacePublic = read("server/marketplacePublic.ts");
const server = read("server.ts");

function functionBody(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing ${startMarker}`);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(end, -1, `missing ${endMarker}`);
  return source.slice(start, end);
}

test("digital checkout maps the marketplace name column to the title response", () => {
  const checkout = functionBody(
    marketplacePublic,
    "export async function checkoutDigital",
    "export async function getOrderStatus",
  );

  assert.match(checkout, /SELECT id, name, digital_price_cents FROM marketplace_listings/);
  assert.doesNotMatch(checkout, /SELECT id, title,/);
  assert.match(checkout, /title: String\(listing\.name \|\| "Digital 3D Model"\)/);
});

test("marketplace STL cache uses the dedicated derivative height column", () => {
  const checkout = functionBody(
    server,
    'app.post("/api/marketplace/listings/:uuid/print/checkout"',
    "// 4. Draft Slant 3D order",
  );

  assert.match(checkout, /derivative_height_mm = \?/);
  assert.doesNotMatch(checkout, /status = 'active' AND sort_order = \?/);
});

test("marketplace STL persistence satisfies the marketplace_assets schema", () => {
  const checkout = functionBody(
    server,
    'app.post("/api/marketplace/listings/:uuid/print/checkout"',
    "// 4. Draft Slant 3D order",
  );
  const insertStart = checkout.indexOf("INSERT INTO marketplace_assets");
  assert.notEqual(insertStart, -1, "marketplace STL asset insert is missing");
  const insert = checkout.slice(insertStart, insertStart + 1_100);

  for (const requiredColumn of [
    "listing_id",
    "asset_uuid",
    "kind",
    "bucket",
    "object_key",
    "mime_type",
    "size_bytes",
    "sha256",
    "derivative_height_mm",
  ]) {
    assert.match(insert, new RegExp(`\\b${requiredColumn}\\b`), `missing ${requiredColumn}`);
  }
  assert.match(insert, /randomUUID\(\)/);
  assert.match(insert, /storedStl\.sha256/);
  assert.match(insert, /storedStl\.sizeBytes/);
  assert.doesNotMatch(insert, /created_by_phone/);
});

test("failed STL metadata persistence removes the orphaned private object", () => {
  const checkout = functionBody(
    server,
    'app.post("/api/marketplace/listings/:uuid/print/checkout"',
    "// 4. Draft Slant 3D order",
  );

  assert.match(checkout, /catch \(persistError/);
  assert.match(checkout, /deletePrivateObject\(storedStl\.objectKey\)/);
  assert.match(checkout, /persistence and cleanup failed/);
  assert.match(checkout, /throw persistError/);
});
