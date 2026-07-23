import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("Printful setup is an admin-only routed product sync screen", () => {
  const app = fs.readFileSync("src/App.tsx", "utf8");
  const types = fs.readFileSync("src/types.ts", "utf8");
  assert.match(types, /ADMIN_PRINTFUL/);
  assert.match(app, /PrintfulSetupScreen/);
  assert.match(app, /Printful product sync/);
  assert.match(app, /userProfile\.isAdmin/);
});

test("product sync walks connection, product, variant, printfile, price, and publish", () => {
  const source = fs.readFileSync("src/components/admin/PrintfulSetupScreen.tsx", "utf8");
  for (const contract of [
    "/api/admin/customizer/status",
    "/api/admin/customizer/products",
    "/variants",
    "/template",
    "/api/admin/customizer/customizable-products",
    "Check connection",
    "Sync catalog",
    "Print placement",
    "Retail price",
    "Publish product",
  ]) assert.match(source, new RegExp(contract.replaceAll("/", "\\/")));
  assert.doesNotMatch(source, /PRINTFUL_API_KEY|Bearer /);
});

test("server status endpoint reports configuration without exposing secrets", () => {
  const source = fs.readFileSync("server.ts", "utf8");
  const start = source.indexOf('app.get("/api/admin/customizer/status"');
  const body = source.slice(start, start + 1000);
  assert.match(body, /configured/);
  assert.match(body, /storeIdConfigured/);
  assert.doesNotMatch(body, /PRINTFUL_API_KEY.*res\\.json|token.*res\\.json/i);
});
