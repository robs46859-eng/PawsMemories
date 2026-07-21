import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const read = (p) => readFileSync(path.join(repoRoot, p), "utf8");

const server = read("server.ts");
const publicModule = read("server/marketplacePublic.ts");

test("public marketplace routes are mounted", () => {
  assert.ok(server.includes('app.get("/api/marketplace/listings"'));
  assert.ok(server.includes('app.get("/api/marketplace/listings/:uuid"'));
});

test("authenticated marketplace routes are mounted", () => {
  assert.ok(server.includes('app.post("/api/marketplace/listings/:uuid/checkout"'));
  assert.ok(server.includes('app.get("/api/marketplace/orders/:id"'));
  assert.ok(server.includes('app.get("/api/marketplace/entitlements"'));
  assert.ok(server.includes('app.get("/api/marketplace/listings/:uuid/download"'));
  
  const checkoutIdx = server.indexOf('app.post("/api/marketplace/listings/:uuid/checkout"');
  const body = server.slice(checkoutIdx, checkoutIdx + 150);
  assert.ok(body.includes("requireAuth"));
});

test("checkoutDigital enforces Idempotency-Key", () => {
  const checkoutIdx = server.indexOf('app.post("/api/marketplace/listings/:uuid/checkout"');
  const body = server.slice(checkoutIdx, checkoutIdx + 400);
  assert.match(body, /Idempotency-Key/i);
});

test("webhook handles marketplace_digital and uses ON DUPLICATE KEY UPDATE", () => {
  const webhookIdx = server.indexOf("marketplace_digital");
  assert.ok(webhookIdx > -1, "webhook missing marketplace_digital case");
  const webhookBody = server.slice(webhookIdx, webhookIdx + 2000);
  assert.match(webhookBody, /INSERT INTO marketplace_entitlements/);
  assert.match(webhookBody, /ON DUPLICATE KEY UPDATE/);
  assert.match(webhookBody, /digital_order_id/);
});

test("publicListings hides object_key and includes signed previews", () => {
  const start = publicModule.indexOf("export async function publicListings");
  const end = publicModule.indexOf("export async function publicListing(", start);
  const fn = publicModule.slice(start, end);
  assert.ok(!fn.includes("object_key"), "should not select raw object_key for listings");
  assert.match(publicModule, /getPrivateSignedUrl/); // Previews should be signed
});

test("downloadDigital verifies entitlement and revoked_at", () => {
  const fn = publicModule.slice(publicModule.indexOf("export async function digitalDownload"));
  // Must join entitlements and check revoked_at IS NULL
  assert.match(fn, /marketplace_entitlements/);
  assert.match(fn, /revoked_at IS NULL/);
  // Must mint signed URL
  assert.match(fn, /getPrivateSignedUrl/);
});
