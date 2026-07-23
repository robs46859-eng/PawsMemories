import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const routes = fs.readFileSync(new URL("../server/wags-v2/routes.ts", import.meta.url), "utf8");
const service = fs.readFileSync(new URL("../server/wags-v2/service.ts", import.meta.url), "utf8");
const repository = fs.readFileSync(new URL("../server/wags-v2/repository.ts", import.meta.url), "utf8");
const adapter = fs.readFileSync(new URL("../server/wags-v2/mysqlAdapter.ts", import.meta.url), "utf8");
const inbox = fs.readFileSync(new URL("../src/components/WagsInboxScreen.tsx", import.meta.url), "utf8");

test("Wags v2 exposes active plans and the authenticated owner's subscriptions", () => {
  assert.match(routes, /router\.get\(\"\/plans\"/);
  assert.match(routes, /router\.get\(\"\/subscriptions\"/);
  assert.match(service, /listActivePlans/);
  assert.match(service, /listSubscriptions/);
  assert.match(repository, /listActiveCheckoutPlans/);
  assert.match(repository, /listSubscriptionsForOwner/);
  assert.match(adapter, /FROM wags_plan_versions_v2/);
});

test("Wags customer UI treats no subscription as a valid subscribe state", () => {
  assert.match(inbox, /\/api\/wags-v2\/plans/);
  assert.match(inbox, /\/api\/wags-v2\/subscriptions/);
  assert.match(inbox, /\/api\/wags-v2\/checkout\/sessions/);
  assert.match(inbox, /Subscribe to Wardrobe Wags/);
  assert.equal(inbox.includes('throw new Error("Subscription not found'), false);
});

test("Wags checkout uses browser success and cancel return URLs", () => {
  assert.match(inbox, /successUrl:/);
  assert.match(inbox, /cancelUrl:/);
  assert.match(inbox, /window\.location\.assign/);
});
