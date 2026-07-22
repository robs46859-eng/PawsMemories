import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import supertest from "supertest";

import { signToken } from "../auth.ts";
import { createStationeryV2Router } from "../server/stationery-v2/routes.ts";
import { StationeryApiError } from "../server/stationery-v2/service.ts";

const USER = { phone: "u_phase6_route", uid: 42 };

function appWith(service, authenticators = {}) {
  const app = express();
  app.use(express.json({
    verify(req, _res, buffer) {
      req.rawBody = Buffer.from(buffer);
    },
  }));
  app.use("/api/stationery-v2", createStationeryV2Router(service, {
    providerWebhookAuthenticator: authenticators.provider ?? { authenticate: async () => false },
    renderCallbackAuthenticator: authenticators.renderer ?? { authenticate: async () => false },
  }));
  return app;
}

function serviceStub() {
  return {
    getTemplateVersion: async () => { throw new Error("unexpected"); },
    createRenderJob: async () => { throw new Error("unexpected"); },
    getRenderJob: async () => { throw new Error("unexpected"); },
    completeRenderJob: async () => { throw new Error("unexpected"); },
    createPrintOrder: async () => { throw new Error("unexpected"); },
    getPrintOrder: async () => { throw new Error("unexpected"); },
    submitPrintOrder: async () => { throw new Error("unexpected"); },
    reconcilePrintOrder: async () => { throw new Error("unexpected"); },
    applyAuthenticatedProviderEvent: async () => { throw new Error("unexpected"); },
  };
}

test("Phase 6 router is default-off before authentication or work begins", async () => {
  delete process.env.STATIONERY_V2_ENABLED;
  const response = await supertest(appWith(serviceStub()))
    .get("/api/stationery-v2/templates/11111111-1111-4111-8111-111111111111/versions/1");
  assert.equal(response.status, 503);
  assert.equal(response.body.code, "FEATURE_DISABLED");
});

test("Phase 6 user routes require account authentication and strict bodies", async () => {
  process.env.STATIONERY_V2_ENABLED = "true";
  process.env.JWT_SECRET = "phase6-route-test-secret";
  const app = appWith(serviceStub());
  const unauthenticated = await supertest(app)
    .get("/api/stationery-v2/render-jobs/11111111-1111-4111-8111-111111111111");
  assert.equal(unauthenticated.status, 401);

  const token = signToken(USER);
  const strict = await supertest(app)
    .post("/api/stationery-v2/render-jobs")
    .set("Authorization", `Bearer ${token}`)
    .send({ unexpected: true });
  assert.equal(strict.status, 400);
  assert.equal(strict.body.code, "INVALID_REQUEST");
});

test("Phase 6 provider webhooks require verified raw bytes before service execution", async () => {
  process.env.STATIONERY_V2_ENABLED = "true";
  let calls = 0;
  const service = serviceStub();
  service.applyAuthenticatedProviderEvent = async () => {
    calls += 1;
    throw new StationeryApiError("Service boundary reached.", "BOUNDARY_REACHED", 409);
  };
  const app = appWith(service, {
    provider: {
      async authenticate({ headers, rawBody }) {
        return headers["x-provider-signature"] === "valid" && rawBody.includes(Buffer.from("provider_fulfilled"));
      },
    },
  });
  const body = {
    localOrderUuid: "11111111-1111-4111-8111-111111111111",
    event: {
      eventId: "evt-1",
      occurredAt: "2026-07-22T12:00:00.000Z",
      type: "provider_fulfilled",
      providerOrderId: "PF-100",
    },
  };
  const rejected = await supertest(app)
    .post("/api/stationery-v2/provider-events/printful")
    .set("x-provider-signature", "invalid")
    .send(body);
  assert.equal(rejected.status, 401);
  assert.equal(calls, 0);

  const verified = await supertest(app)
    .post("/api/stationery-v2/provider-events/printful")
    .set("x-provider-signature", "valid")
    .send(body);
  assert.equal(verified.status, 409);
  assert.equal(verified.body.code, "BOUNDARY_REACHED");
  assert.equal(calls, 1);
});

test("Phase 6 render completion uses a separate trusted-callback authenticator", async () => {
  process.env.STATIONERY_V2_ENABLED = "true";
  let called = false;
  const service = serviceStub();
  service.completeRenderJob = async () => {
    called = true;
    throw new Error("must not run");
  };
  const app = appWith(service, {
    renderer: { authenticate: async () => false },
  });
  const response = await supertest(app)
    .post("/api/stationery-v2/render-jobs/11111111-1111-4111-8111-111111111111/complete")
    .send({});
  assert.equal(response.status, 401);
  assert.equal(response.body.code, "CALLBACK_UNAUTHORIZED");
  assert.equal(called, false);
});
