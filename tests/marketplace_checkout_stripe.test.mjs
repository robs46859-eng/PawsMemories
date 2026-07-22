import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Marketplace one-time digital checkout — wiring contract.
 *
 * The Stripe session creation was always present in the route; what was missing
 * was the `checkout_url` column it writes to. checkoutDigital() SELECTs that
 * column to resume an in-flight purchase by Idempotency-Key, and
 * 011_marketplace.sql never created it — so every checkout threw
 * ER_BAD_FIELD_ERROR before reaching Stripe. Verified against production: the
 * table had 12 columns and checkout_url was not among them.
 *
 * These tests pin the three halves that have to agree: the column exists in
 * both the migration and db.ts init, the session metadata matches what the
 * webhook dispatches on, and the URL is persisted for idempotent resume.
 */

const repoRoot = path.resolve(import.meta.dirname, "..");
const read = (p) => readFileSync(path.join(repoRoot, p), "utf8");
const server = read("server.ts");
const publicSrc = read("server/marketplacePublic.ts");

test("checkout_url exists in both the migration and the db.ts initializer", () => {
  const migration = read("server/migrations/013_marketplace_checkout_url.sql");
  assert.match(migration, /ADD COLUMN checkout_url/);

  // db.ts is what actually runs — the .sql files are reference only, since this
  // app has no migration runner. Both must carry the change or a fresh deploy
  // silently lacks the column again.
  const db = read("db.ts");
  assert.match(db, /marketplace_digital_orders ADD COLUMN checkout_url/);
  assert.match(db, /information_schema\.COLUMNS/, "the add must be guarded, not unconditional");
});

test("checkoutDigital resumes an in-flight order instead of double-charging", () => {
  assert.match(
    publicSrc,
    /SELECT id, status, stripe_session_id, checkout_url\s+FROM marketplace_digital_orders/,
    "resume lookup must read the stored session and URL",
  );
  assert.match(publicSrc, /idempotency_key = \?/);
});

test("the Stripe session metadata matches what the webhook dispatches on", () => {
  const route = server.slice(
    server.indexOf('app.post("/api/marketplace/listings/:uuid/checkout"'),
    server.indexOf('app.get("/api/marketplace/listings/:uuid/download"'),
  );
  // The webhook branches on exactly these four keys; a mismatch means a paid
  // order that never grants an entitlement.
  for (const key of ["marketplace_digital", "digitalOrderId", "userPhone", "listingId"]) {
    assert.ok(route.includes(key), `session metadata must carry ${key}`);
  }
  const webhook = server.slice(server.indexOf('metadata.type === "marketplace_digital"'), server.indexOf('metadata.type === "marketplace_digital"') + 1200);
  assert.match(webhook, /marketplace_entitlements/, "webhook must grant the entitlement");
  assert.match(webhook, /ON DUPLICATE KEY UPDATE/, "granting must be idempotent");
});

test("one-time payment only — no async settlement methods", () => {
  const route = server.slice(
    server.indexOf('app.post("/api/marketplace/listings/:uuid/checkout"'),
    server.indexOf('app.get("/api/marketplace/listings/:uuid/download"'),
  );
  assert.match(route, /mode: "payment"/, "must be a one-time payment, not a subscription");
  assert.match(route, /payment_method_types: \["card"\]/);

  // ACH/Cash App can settle days later; entitlements only grant on
  // checkout.session.completed, so the buyer would wait with no explanation.
  //
  // Strip comments before asserting — an earlier version of this test matched
  // the explanatory comment that NAMES those methods and failed on correct
  // code. Assertions about behaviour must read code, not prose.
  const code = route.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
  assert.doesNotMatch(code, /us_bank_account|cashapp/, "async payment methods need a pending-state UI first");
});

test("the session id and URL are persisted so a retry resumes", () => {
  const route = server.slice(
    server.indexOf('app.post("/api/marketplace/listings/:uuid/checkout"'),
    server.indexOf('app.get("/api/marketplace/listings/:uuid/download"'),
  );
  assert.match(route, /SET stripe_session_id = \?, checkout_url = \?/);
  assert.match(route, /if \(result\.checkoutUrl\)/, "an existing URL must short-circuit before a second session");
});

test("the buyer sees the listing name, not a generic label", () => {
  assert.match(publicSrc, /SELECT id, name, digital_price_cents/, "the schema's name column must be fetched");
  assert.match(publicSrc, /title: String\(listing\.name/, "name must map to the route's title contract");
  const route = server.slice(
    server.indexOf('app.post("/api/marketplace/listings/:uuid/checkout"'),
    server.indexOf('app.get("/api/marketplace/listings/:uuid/download"'),
  );
  assert.match(route, /name: result\.title/, "the Stripe product must use the listing title");
});

test("entitlement is granted by the webhook, never by the success redirect", () => {
  const route = server.slice(
    server.indexOf('app.post("/api/marketplace/listings/:uuid/checkout"'),
    server.indexOf('app.get("/api/marketplace/listings/:uuid/download"'),
  );
  // A success_url can be opened by anyone who guesses it; only a signed webhook
  // proves payment. The redirect must poll, not grant.
  assert.doesNotMatch(route, /marketplace_entitlements/, "the checkout route must not grant entitlements");
  assert.match(route, /success_url/);
});
