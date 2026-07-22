import test from "node:test";
import assert from "node:assert/strict";

import { isWagsV2Enabled } from "../server/wags-v2/featureFlag.ts";
import { sealPackVersion } from "../server/wags-v2/entitlements.ts";
import { WagsApiService, WagsApiError } from "../server/wags-v2/service.ts";

const IDS = {
  owner: "11111111-1111-4111-8111-111111111111",
  subscription: "22222222-2222-4222-8222-222222222222",
  plan: "33333333-3333-4333-8333-333333333333",
  pack: "44444444-4444-4444-8444-444444444444",
  primaryAsset: "55555555-5555-4555-8555-555555555555",
  substituteAsset: "66666666-6666-4666-8666-666666666666",
  payment: "77777777-7777-4777-8777-777777777777",
  policy: "88888888-8888-4888-8888-888888888888",
  checkout: "99999999-9999-4999-8999-999999999999",
};

function makeSubscription(overrides = {}) {
  return {
    schemaVersion: "wags.subscription.v1",
    subscriptionUuid: IDS.subscription,
    ownerUuid: IDS.owner,
    planUuid: IDS.plan,
    planVersionNumber: 1,
    cadence: "annual_prepaid",
    status: "active",
    serviceStartsAt: "2026-01-01T00:00:00.000Z",
    serviceEndsAt: "2027-01-01T00:00:00.000Z",
    cancelEffectiveAt: null,
    lastLifecycleEventAt: null,
    appliedEventIds: [],
    providerSubscriptionRef: "sub_private_123",
    ...overrides,
  };
}

function makePayment(overrides = {}) {
  return {
    paymentUuid: IDS.payment,
    status: "paid",
    coversFrom: "2026-01-01T00:00:00.000Z",
    coversUntil: "2027-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makePack() {
  return sealPackVersion({
    schemaVersion: "wags.pack.v1",
    packUuid: IDS.pack,
    versionNumber: 3,
    releasePeriod: "2026-01",
    title: "January Makers Pack",
    tier: "plus",
    items: [
      {
        slotKey: "model",
        title: "Mini pet",
        primary: { kind: "asset", assetUuid: IDS.primaryAsset, versionNumber: 1, assetType: "mini_model" },
        substitutions: [{ kind: "asset", assetUuid: IDS.substituteAsset, versionNumber: 2, assetType: "mini_model" }],
        ownedFallback: { kind: "credits", amount: 10, ledgerCode: "owned-fallback" },
      },
      {
        slotKey: "credits",
        title: "Monthly credits",
        primary: { kind: "credits", amount: 25, ledgerCode: "wags-plus" },
        substitutions: [],
        ownedFallback: null,
      },
    ],
    publishedAt: "2025-12-15T00:00:00.000Z",
  });
}

class MemoryWagsRepository {
  constructor() {
    this.subscription = makeSubscription();
    this.pack = makePack();
    this.payment = makePayment();
    this.policy = {
      policyUuid: IDS.policy,
      versionNumber: 1,
      incentiveSku: "WAGS_ANNUAL_2026",
      grants: [
        { slotKey: "annual_credits", deliverable: { kind: "credits", amount: 100, ledgerCode: "wags-annual" } },
      ],
    };
    this.owned = new Set([`asset:${IDS.primaryAsset}`]);
    this.deliveries = new Map();
    this.grants = new Map();
    this.deliveryLocks = new Map();
    this.subscriptionTail = Promise.resolve();
    this.providerEvents = new Map();
    this.checkouts = new Map();
    this.inTransaction = false;
    this.subscriptionSaves = 0;
  }

  async listPublishedPackVersions() {
    const { items: _items, schemaVersion: _schemaVersion, ...summary } = this.pack;
    return { items: [summary], nextCursor: null };
  }
  async getPublishedPackVersion(uuid, version) {
    return uuid === this.pack.packUuid && version === this.pack.versionNumber ? structuredClone(this.pack) : null;
  }
  async getSubscriptionForOwner(owner, uuid) {
    return owner === this.subscription.ownerUuid && uuid === this.subscription.subscriptionUuid ? structuredClone(this.subscription) : null;
  }
  async getPaymentCoverageForPeriod() { return structuredClone(this.payment); }
  async getPaymentCoverageByUuid(_subscription, paymentUuid) { return paymentUuid === this.payment.paymentUuid ? structuredClone(this.payment) : null; }
  async listExistingGrants(identity) {
    return [...this.grants.values()]
      .filter((grant) => grant.deliveryIdentity === identity)
      .map(({ disposition: _disposition, ...grant }) => structuredClone(grant));
  }
  async listOwnedDeliverableKeys() { return [...this.owned]; }
  async isPackEligibleForSubscription() { return true; }
  async getAnnualIncentivePolicy(uuid, version) { return uuid === this.policy.policyUuid && version === this.policy.versionNumber ? structuredClone(this.policy) : null; }
  async getCheckoutPlan(uuid, version, cadence) {
    if (uuid !== IDS.plan || version !== 1) return null;
    return { planUuid: uuid, versionNumber: version, cadence, active: true, providerPriceRef: "price_private_123" };
  }
  async reserveCheckout(input) {
    const key = `${input.ownerUuid}:${input.idempotencyKey}`;
    const prior = this.checkouts.get(key);
    if (prior) return { disposition: "existing", reservation: structuredClone(prior) };
    const reservation = {
      checkoutUuid: input.checkoutUuid,
      ownerUuid: input.ownerUuid,
      requestHash: input.requestHash,
      state: "reserved",
      providerSessionRef: null,
      checkoutUrl: null,
      expiresAt: null,
    };
    this.checkouts.set(key, reservation);
    return { disposition: "call_provider", reservation: structuredClone(reservation) };
  }
  async completeCheckout(input) {
    const entry = [...this.checkouts.values()].find((item) => item.checkoutUuid === input.checkoutUuid);
    Object.assign(entry, input, { state: "complete" });
    return structuredClone(entry);
  }
  async failCheckout(checkoutUuid) {
    const entry = [...this.checkouts.values()].find((item) => item.checkoutUuid === checkoutUuid);
    if (entry && entry.state !== "complete") entry.state = "failed";
  }

  async withDeliveryLock(identity, work) {
    const previous = this.deliveryLocks.get(identity) || Promise.resolve();
    let release;
    const current = new Promise((resolve) => { release = resolve; });
    this.deliveryLocks.set(identity, previous.then(() => current));
    await previous;
    const transaction = {
      insertDeliveryIfAbsent: async (header) => {
        if (this.deliveries.has(identity)) return "existing";
        this.deliveries.set(identity, structuredClone(header));
        return "inserted";
      },
      listGrantIdentitiesForUpdate: async () => new Set(
        [...this.grants.values()].filter((grant) => grant.deliveryIdentity === identity).map((grant) => grant.grantIdentity),
      ),
      insertGrantIfAbsent: async (grant) => {
        if (this.grants.has(grant.grantIdentity)) return "existing";
        this.grants.set(grant.grantIdentity, structuredClone(grant));
        return "inserted";
      },
      markDeliveryComplete: async () => undefined,
    };
    try { return await work(transaction); }
    finally { release(); }
  }

  async withSubscriptionLock(_identity, work) {
    const previous = this.subscriptionTail;
    let release;
    this.subscriptionTail = new Promise((resolve) => { release = resolve; });
    await previous;
    this.inTransaction = true;
    const transaction = {
      claimProviderEvent: async (input) => {
        const existing = this.providerEvents.get(input.providerEventId);
        if (existing && existing.eventHash !== input.eventHash) throw new Error("provider event hash conflict");
        if (existing) return "existing_same";
        this.providerEvents.set(input.providerEventId, structuredClone(input));
        return "inserted";
      },
      getSubscriptionForUpdate: async () => structuredClone(this.subscription),
      saveSubscription: async (subscription) => {
        this.subscription = { ...structuredClone(subscription), providerSubscriptionRef: this.subscription.providerSubscriptionRef };
        this.subscriptionSaves += 1;
      },
      upsertPaymentCoverage: async (payment) => { this.payment = structuredClone(payment); },
      markProviderEventProcessed: async (eventId, disposition) => { this.providerEvents.get(eventId).disposition = disposition; },
    };
    try { return await work(transaction); }
    finally {
      this.inTransaction = false;
      release();
    }
  }
}

function makeHarness() {
  const repository = new MemoryWagsRepository();
  let checkoutCalls = 0;
  let verifierCalls = 0;
  let reconciliationCalls = 0;
  const paidEvent = {
    schemaVersion: "wags.stripe-event.v1",
    providerEventId: "evt_paid_001",
    providerSubscriptionRef: "sub_private_123",
    subscriptionUuid: IDS.subscription,
    lifecycleEvent: { eventId: "evt_paid_001", occurredAt: "2026-01-02T00:00:00.000Z", type: "payment_succeeded" },
    paymentCoverage: makePayment(),
  };
  const service = new WagsApiService({
    repository,
    randomUuid: () => IDS.checkout,
    now: () => new Date("2026-01-02T00:00:01.000Z"),
    checkoutProvider: {
      createCheckoutSession: async () => {
        assert.equal(repository.inTransaction, false);
        checkoutCalls += 1;
        return { providerSessionRef: "cs_test_123", checkoutUrl: "https://checkout.example.test/session", expiresAt: "2026-01-02T01:00:00.000Z" };
      },
    },
    stripeVerifier: {
      verifyAndNormalize: async (_raw, signature) => {
        assert.equal(repository.inTransaction, false);
        assert.equal(signature, "valid-signature");
        verifierCalls += 1;
        return structuredClone(paidEvent);
      },
    },
    reconciliationProvider: {
      fetchVerifiedSnapshot: async () => {
        assert.equal(repository.inTransaction, false);
        reconciliationCalls += 1;
        return {
          ...structuredClone(paidEvent),
          providerEventId: "reconcile_001",
          lifecycleEvent: { eventId: "reconcile_001", occurredAt: "2026-01-03T00:00:00.000Z", type: "payment_succeeded" },
        };
      },
    },
  });
  return { service, repository, counters: () => ({ checkoutCalls, verifierCalls, reconciliationCalls }) };
}

test("Phase 7 Wags v2 is fail-closed by default", () => {
  assert.equal(isWagsV2Enabled({}), false);
  assert.equal(isWagsV2Enabled({ WAGS_V2_ENABLED: "true" }), true);
  assert.equal(isWagsV2Enabled({ WAGS_V2_ENABLED: "TRUE" }), false);
});

test("Phase 7 public subscription omits provider and database identities", async () => {
  const { service } = makeHarness();
  const subscription = await service.getSubscription(IDS.owner, IDS.subscription);
  assert.equal(subscription.subscriptionUuid, IDS.subscription);
  assert.equal("providerSubscriptionRef" in subscription, false);
  assert.equal("id" in subscription, false);
});

test("Phase 7 checkout is idempotent and redirect completion never grants", async () => {
  const { service, repository, counters } = makeHarness();
  const request = {
    planUuid: IDS.plan,
    planVersionNumber: 1,
    cadence: "annual_prepaid",
    idempotencyKey: "checkout-key-001",
    successUrl: "https://app.example.test/wags/success",
    cancelUrl: "https://app.example.test/wags/cancel",
  };
  const first = await service.createCheckout(IDS.owner, request);
  const replay = await service.createCheckout(IDS.owner, request);
  assert.equal(first.replayed, false);
  assert.equal(replay.replayed, true);
  assert.equal(first.checkoutUuid, replay.checkoutUuid);
  assert.equal(counters().checkoutCalls, 1);
  assert.equal(repository.grants.size, 0);
});

test("Phase 7 concurrent period delivery persists one substituted asset and one credit grant", async () => {
  const { service, repository } = makeHarness();
  const request = { packUuid: IDS.pack, packVersionNumber: 3 };
  const [first, second] = await Promise.all([
    service.deliverSubscriptionPeriod(IDS.owner, IDS.subscription, "2026-01", request),
    service.deliverSubscriptionPeriod(IDS.owner, IDS.subscription, "2026-01", request),
  ]);
  assert.equal(repository.grants.size, 2);
  assert.deepEqual(new Set([first.disposition, second.disposition]), new Set(["delivered", "replayed"]));
  const assetGrant = [...repository.grants.values()].find((grant) => grant.deliverable.kind === "asset");
  assert.equal(assetGrant.deliverable.assetUuid, IDS.substituteAsset);
  assert.equal([...repository.grants.values()].filter((grant) => grant.deliverable.kind === "credits").length, 1);
});

test("Phase 7 unpaid period is held without creating a delivery", async () => {
  const { service, repository } = makeHarness();
  repository.payment = makePayment({ status: "failed" });
  const result = await service.deliverSubscriptionPeriod(IDS.owner, IDS.subscription, "2026-01", { packUuid: IDS.pack, packVersionNumber: 3 });
  assert.equal(result.disposition, "held");
  assert.equal(repository.deliveries.size, 0);
  assert.equal(repository.grants.size, 0);
});

test("Phase 7 annual prepaid incentive replays without duplicate credits", async () => {
  const { service, repository } = makeHarness();
  const request = {
    policyUuid: IDS.policy,
    policyVersionNumber: 1,
    paymentUuid: IDS.payment,
    termStartsAt: "2026-01-01T00:00:00.000Z",
    termEndsAt: "2027-01-01T00:00:00.000Z",
  };
  const first = await service.deliverAnnualIncentive(IDS.owner, IDS.subscription, request);
  const replay = await service.deliverAnnualIncentive(IDS.owner, IDS.subscription, request);
  assert.equal(first.disposition, "delivered");
  assert.equal(replay.disposition, "replayed");
  assert.equal([...repository.grants.values()].filter((grant) => grant.deliverable.kind === "credits" && grant.deliverable.ledgerCode === "wags-annual").length, 1);
});

test("Phase 7 Stripe events authenticate before the transaction and deduplicate atomically", async () => {
  const { service, repository, counters } = makeHarness();
  repository.subscription = makeSubscription({ status: "past_due" });
  const raw = Buffer.from('{"id":"evt_paid_001"}');
  const first = await service.handleStripeWebhook(raw, "valid-signature");
  const replay = await service.handleStripeWebhook(raw, "valid-signature");
  assert.equal(first.status, "active");
  assert.equal(replay.disposition, "duplicate");
  assert.equal(repository.subscriptionSaves, 1);
  assert.equal(counters().verifierCalls, 2);
});

test("Phase 7 rejects non-byte or unauthenticated webhook input", async () => {
  const { service } = makeHarness();
  await assert.rejects(() => service.handleStripeWebhook(Buffer.from("{}"), ""), (error) => error instanceof WagsApiError && error.code === "WEBHOOK_UNAUTHORIZED");
  await assert.rejects(() => service.handleStripeWebhook({}, "valid-signature"), (error) => error instanceof WagsApiError && error.code === "RAW_BODY_REQUIRED");
});

test("Phase 7 reconciliation fetches provider state outside SQL and applies it once", async () => {
  const { service, repository, counters } = makeHarness();
  repository.subscription = makeSubscription({ status: "past_due" });
  const result = await service.reconcileSubscription(IDS.owner, IDS.subscription, { reason: "missing_webhook" });
  assert.equal(result.status, "active");
  assert.equal(counters().reconciliationCalls, 1);
});
