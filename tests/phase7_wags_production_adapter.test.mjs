import test from "node:test";
import assert from "node:assert/strict";

import { MysqlWagsApiRepository } from "../server/wags-v2/mysqlAdapter.ts";
import { createWagsV2Production } from "../server/wags-v2/production.ts";
import {
  StripeWagsCheckoutProvider,
  StripeWagsReconciliationProvider,
  StripeWagsWebhookVerifier,
  normalizeStripeEvent,
} from "../server/wags-v2/stripeAdapter.ts";

const OWNER_UUID = "11111111-1111-4111-8111-111111111111";
const SUBSCRIPTION_UUID = "22222222-2222-4222-8222-222222222222";
const CHECKOUT_UUID = "33333333-3333-4333-8333-333333333333";
const PLAN_UUID = "44444444-4444-4444-8444-444444444444";
const DELIVERY_IDENTITY = `wags-delivery-v1-${"a".repeat(64)}`;
const GRANT_IDENTITY = `wags-grant-v1-${"b".repeat(64)}`;

function stripeEvent(overrides = {}) {
  return {
    id: "evt_paid_001",
    type: "invoice.paid",
    created: 1_767_225_600,
    data: {
      object: {
        id: "in_001",
        metadata: { wags_subscription_uuid: SUBSCRIPTION_UUID },
        subscription: {
          id: "sub_private_001",
          metadata: { wags_subscription_uuid: SUBSCRIPTION_UUID },
        },
        lines: { data: [{ period: { start: 1_767_225_600, end: 1_769_904_000 } }] },
      },
    },
    ...overrides,
  };
}

test("Phase 7 production factory fails closed without real Stripe secrets", () => {
  assert.throws(
    () => createWagsV2Production({ env: {}, pool: {} }),
    /STRIPE_SECRET_KEY is missing or invalid/,
  );
  assert.throws(
    () => createWagsV2Production({ env: { STRIPE_SECRET_KEY: "sk_test_ok" }, pool: {} }),
    /WAGS_STRIPE_WEBHOOK_SECRET is missing or invalid/,
  );
  assert.throws(
    () => createWagsV2Production({
      env: { STRIPE_SECRET_KEY: "replace_me", WAGS_STRIPE_WEBHOOK_SECRET: "whsec_ok" },
      pool: {},
    }),
    /STRIPE_SECRET_KEY is missing or invalid/,
  );
});

test("Phase 7 signed webhook adapter verifies raw bytes before normalization", async () => {
  const calls = [];
  const stripe = {
    webhooks: {
      constructEvent(body, signature, secret) {
        calls.push({ body, signature, secret });
        return stripeEvent();
      },
    },
  };
  const verifier = new StripeWagsWebhookVerifier(stripe, "whsec_test_123");
  const raw = Buffer.from('{"id":"evt_paid_001"}');
  const normalized = await verifier.verifyAndNormalize(raw, "signed-header");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body, raw);
  assert.equal(calls[0].signature, "signed-header");
  assert.equal(normalized.subscriptionUuid, SUBSCRIPTION_UUID);
  assert.equal(normalized.providerSubscriptionRef, "sub_private_001");
  assert.equal(normalized.lifecycleEvent.type, "payment_succeeded");
  assert.equal(normalized.paymentCoverage.status, "paid");
  assert.match(normalized.paymentCoverage.paymentUuid, /^[a-f0-9-]{36}$/);
});

test("Phase 7 Stripe normalization rejects unsupported or unbound events", () => {
  assert.throws(
    () => normalizeStripeEvent(stripeEvent({ type: "charge.succeeded" })),
    /Unsupported Stripe event type/,
  );
  const event = stripeEvent();
  delete event.data.object.metadata.wags_subscription_uuid;
  delete event.data.object.subscription.metadata.wags_subscription_uuid;
  assert.throws(() => normalizeStripeEvent(event));
});

test("Phase 7 Stripe checkout uses subscription mode and provider idempotency", async () => {
  let captured;
  const stripe = {
    checkout: {
      sessions: {
        async create(payload, options) {
          captured = { payload, options };
          return {
            id: "cs_private_001",
            url: "https://checkout.stripe.test/session",
            expires_at: 1_767_229_200,
          };
        },
      },
    },
  };
  const provider = new StripeWagsCheckoutProvider(stripe, {
    getStripeCheckoutMetadata: async () => ({
      checkoutUuid: CHECKOUT_UUID,
      subscriptionUuid: SUBSCRIPTION_UUID,
      ownerUuid: OWNER_UUID,
      planUuid: PLAN_UUID,
      planVersionNumber: 2,
      cadence: "annual_prepaid",
    }),
  });
  const result = await provider.createCheckoutSession({
    checkoutUuid: CHECKOUT_UUID,
    ownerUuid: OWNER_UUID,
    providerPriceRef: "price_private_001",
    cadence: "annual_prepaid",
    successUrl: "https://app.example.test/success",
    cancelUrl: "https://app.example.test/cancel",
    idempotencyKey: "checkout-key-001",
  });
  assert.equal(captured.payload.mode, "subscription");
  assert.equal(captured.payload.client_reference_id, OWNER_UUID);
  assert.equal(captured.payload.subscription_data.metadata.wags_owner_uuid, OWNER_UUID);
  assert.equal(captured.payload.subscription_data.metadata.wags_subscription_uuid, SUBSCRIPTION_UUID);
  assert.equal(captured.payload.subscription_data.metadata.wags_plan_uuid, PLAN_UUID);
  assert.equal(captured.options.idempotencyKey, "wags:checkout-key-001");
  assert.equal(result.providerSessionRef, "cs_private_001");
});

test("Phase 7 signed subscription creation bootstraps only from bound checkout metadata", async () => {
  const subscription = {
    id: "sub_private_001",
    status: "active",
    cancel_at_period_end: false,
    metadata: {
      wags_checkout_uuid: CHECKOUT_UUID,
      wags_subscription_uuid: SUBSCRIPTION_UUID,
      wags_owner_uuid: OWNER_UUID,
      wags_plan_uuid: PLAN_UUID,
      wags_plan_version_number: "2",
      wags_cadence: "annual_prepaid",
    },
    items: { data: [{ current_period_start: 1_767_225_600, current_period_end: 1_798_761_600 }] },
  };
  const bootstraps = [];
  const verifier = new StripeWagsWebhookVerifier({
    webhooks: {
      constructEvent: () => ({
        id: "evt_subscription_created",
        type: "customer.subscription.created",
        created: 1_767_225_600,
        data: { object: subscription },
      }),
    },
  }, "whsec_phase7", {
    ensureSubscriptionFromStripe: async (input) => bootstraps.push(input),
  });
  const normalized = await verifier.verifyAndNormalize(Buffer.from("{}"), "signature");
  assert.equal(normalized.subscriptionUuid, SUBSCRIPTION_UUID);
  assert.equal(bootstraps.length, 1);
  assert.equal(bootstraps[0].checkoutUuid, CHECKOUT_UUID);
  assert.equal(bootstraps[0].providerSubscriptionRef, subscription.id);
  assert.equal(bootstraps[0].planUuid, PLAN_UUID);
});

test("Phase 7 reconciliation verifies provider metadata and records evidence", async () => {
  const records = [];
  const subscription = {
    id: "sub_private_001",
    status: "active",
    cancel_at_period_end: false,
    metadata: { wags_subscription_uuid: SUBSCRIPTION_UUID },
    items: { data: [{ current_period_start: 1_767_225_600, current_period_end: 1_769_904_000 }] },
  };
  const provider = new StripeWagsReconciliationProvider({
    subscriptions: { retrieve: async () => subscription },
  }, {
    beginReconciliation: async (input) => records.push({ kind: "begin", ...input }),
    finishReconciliation: async (input) => records.push({ kind: "finish", ...input }),
  });
  const snapshot = await provider.fetchVerifiedSnapshot({
    subscriptionUuid: SUBSCRIPTION_UUID,
    providerSubscriptionRef: subscription.id,
    reason: "manual",
  });
  assert.equal(snapshot.lifecycleEvent.type, "resumed");
  assert.equal(records[0].kind, "begin");
  assert.equal(records[1].kind, "finish");
  assert.match(records[1].providerSnapshotHash, /^[a-f0-9]{64}$/);

  subscription.metadata.wags_subscription_uuid = OWNER_UUID;
  await assert.rejects(
    () => provider.fetchVerifiedSnapshot({
      subscriptionUuid: SUBSCRIPTION_UUID,
      providerSubscriptionRef: subscription.id,
      reason: "missing_webhook",
    }),
    /does not match/,
  );
  assert.equal(records.at(-1).failureCode, "stripe_snapshot_failed");
});

function creditPool({ failLedger = false } = {}) {
  const log = [];
  const connection = {
    async beginTransaction() { log.push("BEGIN"); },
    async commit() { log.push("COMMIT"); },
    async rollback() { log.push("ROLLBACK"); },
    release() { log.push("RELEASE"); },
    async query(sql, params = []) {
      const normalized = sql.replace(/\s+/g, " ").trim();
      log.push({ sql: normalized, params });
      if (normalized.includes("GET_LOCK")) return [[{ acquired: 1 }]];
      if (normalized.includes("RELEASE_LOCK")) return [[{ released: 1 }]];
      if (normalized.includes("FROM wags_deliveries_v2 d") && normalized.includes("JOIN wags_owner_identities_v2")) {
        return [[{ id: 17, owner_identity_id: 9, auth_subject: "+15551234567" }]];
      }
      if (normalized.includes("FROM wags_grants_v2 g") && normalized.includes("g.grant_identity")) return [[]];
      if (normalized.startsWith("SELECT id FROM credit_transactions")) return [[]];
      if (normalized.startsWith("SELECT credits FROM users")) return [[{ credits: 10 }]];
      if (normalized.startsWith("UPDATE users SET credits")) return [{ affectedRows: 1 }];
      if (normalized.startsWith("INSERT INTO credit_transactions")) {
        if (failLedger) throw new Error("ledger unavailable");
        return [{ affectedRows: 1, insertId: 71 }];
      }
      if (normalized.startsWith("INSERT INTO wags_grants_v2")) return [{ affectedRows: 1 }];
      throw new Error(`Unexpected SQL: ${normalized}`);
    },
  };
  return {
    pool: { getConnection: async () => connection },
    log,
  };
}

test("Phase 7 credit grant inserts wallet, canonical ledger, and linked grant in one transaction", async () => {
  const harness = creditPool();
  const repository = new MysqlWagsApiRepository(harness.pool);
  const outcome = await repository.withDeliveryLock(DELIVERY_IDENTITY, (transaction) => transaction.insertGrantIfAbsent({
    grantIdentity: GRANT_IDENTITY,
    deliveryIdentity: DELIVERY_IDENTITY,
    slotKey: "monthly_credits",
    disposition: "primary",
    deliverable: { kind: "credits", amount: 25, ledgerCode: "wags-plus" },
  }));
  assert.equal(outcome, "inserted");
  const sql = harness.log.filter((entry) => typeof entry === "object").map((entry) => entry.sql);
  const grantIndex = sql.findIndex((value) => value.startsWith("INSERT INTO wags_grants_v2"));
  const walletIndex = sql.findIndex((value) => value.startsWith("UPDATE users SET credits"));
  const ledgerIndex = sql.findIndex((value) => value.startsWith("INSERT INTO credit_transactions"));
  assert.ok(walletIndex >= 0 && ledgerIndex > walletIndex && grantIndex > ledgerIndex);
  assert.ok(harness.log.includes("COMMIT"));
  assert.equal(harness.log.includes("ROLLBACK"), false);
});

test("Phase 7 credit ledger failure rolls back the entire delivery grant", async () => {
  const harness = creditPool({ failLedger: true });
  const repository = new MysqlWagsApiRepository(harness.pool);
  await assert.rejects(
    () => repository.withDeliveryLock(DELIVERY_IDENTITY, (transaction) => transaction.insertGrantIfAbsent({
      grantIdentity: GRANT_IDENTITY,
      deliveryIdentity: DELIVERY_IDENTITY,
      slotKey: "monthly_credits",
      disposition: "primary",
      deliverable: { kind: "credits", amount: 25, ledgerCode: "wags-plus" },
    })),
    /ledger unavailable/,
  );
  assert.ok(harness.log.includes("ROLLBACK"));
  assert.equal(harness.log.includes("COMMIT"), false);
});

test("Phase 7 production factory exposes router-ready service without enabling the feature flag", () => {
  const fakeStripe = {
    webhooks: { constructEvent: () => stripeEvent() },
    checkout: { sessions: { create: async () => ({}) } },
    subscriptions: { retrieve: async () => ({}) },
  };
  const production = createWagsV2Production({
    env: {
      STRIPE_SECRET_KEY: "sk_test_phase7",
      WAGS_STRIPE_WEBHOOK_SECRET: "whsec_phase7",
    },
    pool: {},
    stripe: fakeStripe,
  });
  assert.equal(typeof production.service.createCheckout, "function");
  assert.equal(typeof production.resolveOwnerUuid, "function");
  assert.equal(process.env.WAGS_V2_ENABLED, undefined);
});
