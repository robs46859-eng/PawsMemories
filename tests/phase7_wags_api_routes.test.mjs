import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import request from "supertest";

import { createWagsV2Router } from "../server/wags-v2/routes.ts";

const OWNER_UUID = "11111111-1111-4111-8111-111111111111";
const SUBSCRIPTION_UUID = "22222222-2222-4222-8222-222222222222";

function serviceStub(overrides = {}) {
  return {
    listPublishedPacks: async () => ({ items: [], nextCursor: null }),
    getPublishedPack: async () => ({ ok: true }),
    getSubscription: async (ownerUuid, subscriptionUuid) => ({ ownerUuid, subscriptionUuid }),
    createCheckout: async () => ({ checkoutUuid: "33333333-3333-4333-8333-333333333333" }),
    deliverSubscriptionPeriod: async () => ({ disposition: "delivered" }),
    deliverAnnualIncentive: async () => ({ disposition: "delivered" }),
    reconcileSubscription: async () => ({ disposition: "applied" }),
    handleStripeWebhook: async (body, signature) => ({ byteLength: body.length, signature }),
    ...overrides,
  };
}

function makeApp({ enabled = true, authenticated = true, service = serviceStub() } = {}) {
  const app = express();
  app.use("/api/wags-v2", createWagsV2Router({
    service,
    env: enabled ? { WAGS_V2_ENABLED: "true" } : {},
    authMiddleware: (req, _res, next) => {
      if (authenticated) req.user = { phone: "legacy_subject", uid: 1 };
      next();
    },
    resolveOwnerUuid: async (subject) => {
      assert.equal(subject, "legacy_subject");
      return OWNER_UUID;
    },
  }));
  return app;
}

test("Phase 7 router is disabled unless explicitly enabled", async () => {
  const response = await request(makeApp({ enabled: false })).get("/api/wags-v2/packs");
  assert.equal(response.status, 503);
  assert.equal(response.body.code, "FEATURE_DISABLED");
});

test("Phase 7 user endpoints require authenticated owner context", async () => {
  const response = await request(makeApp({ authenticated: false })).get("/api/wags-v2/packs");
  assert.equal(response.status, 401);
  assert.equal(response.body.code, "UNAUTHORIZED");
});

test("Phase 7 router resolves auth subject to public owner UUID", async () => {
  const response = await request(makeApp()).get(`/api/wags-v2/subscriptions/${SUBSCRIPTION_UUID}`);
  assert.equal(response.status, 200);
  assert.equal(response.body.ownerUuid, OWNER_UUID);
  assert.equal(response.body.subscriptionUuid, SUBSCRIPTION_UUID);
});

test("Phase 7 router rejects unknown checkout input fields", async () => {
  const response = await request(makeApp())
    .post("/api/wags-v2/checkout/sessions")
    .send({
      planUuid: "33333333-3333-4333-8333-333333333333",
      planVersionNumber: 1,
      cadence: "monthly",
      idempotencyKey: "checkout-key-001",
      successUrl: "https://app.example.test/success",
      cancelUrl: "https://app.example.test/cancel",
      internalPlanId: 42,
    });
  assert.equal(response.status, 400);
  assert.equal(response.body.code, "VALIDATION_ERROR");
});

test("Phase 7 Stripe route accepts raw bytes and passes signature evidence", async () => {
  const response = await request(makeApp())
    .post("/api/wags-v2/stripe/webhooks")
    .set("Content-Type", "application/json")
    .set("stripe-signature", "test-signature")
    .send('{"id":"evt_1"}');
  assert.equal(response.status, 200);
  assert.equal(response.body.signature, "test-signature");
  assert.equal(response.body.byteLength, Buffer.byteLength('{"id":"evt_1"}'));
});

test("Phase 7 Stripe route rejects parsed/non-byte payloads", async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/wags-v2", createWagsV2Router({
    service: serviceStub(),
    env: { WAGS_V2_ENABLED: "true" },
    authMiddleware: (_req, _res, next) => next(),
    resolveOwnerUuid: async () => OWNER_UUID,
  }));
  const response = await request(app)
    .post("/api/wags-v2/stripe/webhooks")
    .set("stripe-signature", "test-signature")
    .send({ id: "evt_1" });
  assert.equal(response.status, 415);
  assert.equal(response.body.code, "RAW_BODY_REQUIRED");
});
