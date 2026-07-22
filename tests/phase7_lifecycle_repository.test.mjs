import test from "node:test";
import assert from "node:assert/strict";

import { buildMonthlyEntitlementPeriods, planPackGrants, sealPackVersion } from "../server/wags-v2/entitlements.ts";
import { applySubscriptionLifecycleEvent } from "../server/wags-v2/lifecycle.ts";
import { persistGrantPlanExactlyOnce } from "../server/wags-v2/ports.ts";

const IDS = {
  subscription: "11111111-1111-4111-8111-111111111111",
  owner: "22222222-2222-4222-8222-222222222222",
  plan: "33333333-3333-4333-8333-333333333333",
  pack: "44444444-4444-4444-8444-444444444444",
  asset: "55555555-5555-4555-8555-555555555555",
};

function subscription(overrides = {}) {
  return {
    schemaVersion: "wags.subscription.v1",
    subscriptionUuid: IDS.subscription,
    ownerUuid: IDS.owner,
    planUuid: IDS.plan,
    planVersionNumber: 1,
    cadence: "monthly",
    status: "active",
    serviceStartsAt: "2026-01-01T00:00:00.000Z",
    serviceEndsAt: "2026-12-01T00:00:00.000Z",
    cancelEffectiveAt: null,
    lastLifecycleEventAt: null,
    appliedEventIds: [],
    ...overrides,
  };
}

test("Phase 7 duplicate lifecycle events do not apply twice", () => {
  const event = { eventId: "evt_failed", occurredAt: "2026-02-01T00:00:00.000Z", type: "payment_failed" };
  const first = applySubscriptionLifecycleEvent(subscription(), event);
  assert.equal(first.subscription.status, "past_due");
  const replay = applySubscriptionLifecycleEvent(first.subscription, event);
  assert.equal(replay.disposition, "duplicate");
  assert.deepEqual(replay.subscription, first.subscription);
});

test("Phase 7 out-of-order payment cannot undo a newer cancellation", () => {
  const canceled = applySubscriptionLifecycleEvent(subscription(), {
    eventId: "evt_cancel",
    occurredAt: "2026-03-01T00:00:00.000Z",
    type: "cancel_requested",
    mode: "immediate",
    effectiveAt: "2026-03-01T00:00:00.000Z",
  });
  const stale = applySubscriptionLifecycleEvent(canceled.subscription, {
    eventId: "evt_paid_old",
    occurredAt: "2026-02-28T23:00:00.000Z",
    type: "payment_succeeded",
  });
  assert.equal(stale.disposition, "ignored_out_of_order");
  assert.equal(stale.subscription.status, "canceled");
  assert.equal(stale.subscription.lastLifecycleEventAt, "2026-03-01T00:00:00.000Z");
});

test("Phase 7 cancellation-at-period-end becomes canceled at the effective boundary", () => {
  const scheduled = applySubscriptionLifecycleEvent(subscription(), {
    eventId: "evt_schedule_cancel",
    occurredAt: "2026-03-10T00:00:00.000Z",
    type: "cancel_requested",
    mode: "period_end",
    effectiveAt: "2026-04-01T00:00:00.000Z",
  });
  assert.equal(scheduled.subscription.status, "cancel_at_period_end");
  const ended = applySubscriptionLifecycleEvent(scheduled.subscription, {
    eventId: "evt_period_end",
    occurredAt: "2026-04-01T00:00:00.000Z",
    type: "service_period_ended",
  });
  assert.equal(ended.subscription.status, "canceled");
});

class MemoryRepository {
  constructor() {
    this.deliveries = new Set();
    this.grants = new Map();
    this.locks = new Map();
  }

  async withDeliveryLock(identity, work) {
    const previous = this.locks.get(identity) ?? Promise.resolve();
    let release;
    const current = new Promise((resolve) => { release = resolve; });
    this.locks.set(identity, previous.then(() => current));
    await previous;
    const transaction = {
      insertDeliveryIfAbsent: async () => {
        if (this.deliveries.has(identity)) return "existing";
        this.deliveries.add(identity);
        return "inserted";
      },
      listGrantIdentitiesForUpdate: async () => new Set(this.grants.keys()),
      insertGrantIfAbsent: async (grant) => {
        if (this.grants.has(grant.grantIdentity)) return "existing";
        this.grants.set(grant.grantIdentity, grant);
        return "inserted";
      },
      markDeliveryComplete: async () => {},
    };
    try {
      return await work(transaction);
    } finally {
      release();
      if (this.locks.get(identity) === current) this.locks.delete(identity);
    }
  }
}

function grantPlan() {
  const period = buildMonthlyEntitlementPeriods("2026-01-01T00:00:00.000Z", "2026-02-01T00:00:00.000Z")[0];
  const pack = sealPackVersion({
    schemaVersion: "wags.pack.v1",
    packUuid: IDS.pack,
    versionNumber: 1,
    releasePeriod: "2026-01",
    title: "January",
    tier: "basic",
    items: [
      { slotKey: "asset", title: "Mini model", primary: { kind: "asset", assetUuid: IDS.asset, versionNumber: 1, assetType: "mini_model" }, substitutions: [], ownedFallback: null },
      { slotKey: "credits", title: "Credits", primary: { kind: "credits", amount: 20, ledgerCode: "wags-monthly" }, substitutions: [], ownedFallback: null },
    ],
    publishedAt: "2025-12-20T00:00:00.000Z",
  });
  return planPackGrants({ subscription: subscription(), period, pack, ownedDeliverableKeys: [], existingGrants: [] });
}

test("Phase 7 concurrent delivery attempts create no duplicate asset or credit grants", async () => {
  const repository = new MemoryRepository();
  const plan = grantPlan();
  const [first, second] = await Promise.all([
    persistGrantPlanExactlyOnce(repository, plan),
    persistGrantPlanExactlyOnce(repository, plan),
  ]);
  assert.equal(repository.grants.size, 2);
  assert.equal([...repository.grants.values()].filter((grant) => grant.deliverable.kind === "asset").length, 1);
  assert.equal([...repository.grants.values()].filter((grant) => grant.deliverable.kind === "credits").length, 1);
  assert.equal(first.insertedGrantIdentities.length + second.insertedGrantIdentities.length, 2);
  assert.equal(first.existingGrantIdentities.length + second.existingGrantIdentities.length, 2);
});
