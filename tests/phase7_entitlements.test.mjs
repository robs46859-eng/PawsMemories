import test from "node:test";
import assert from "node:assert/strict";

import { WagsPackVersionInputSchema } from "../server/wags-v2/contracts.ts";
import {
  buildMonthlyEntitlementPeriods,
  decidePeriodEntitlement,
  planAnnualIncentive,
  planPackGrants,
  sealPackVersion,
  verifyPackVersion,
} from "../server/wags-v2/entitlements.ts";

const SUBSCRIPTION_UUID = "11111111-1111-4111-8111-111111111111";
const OWNER_UUID = "22222222-2222-4222-8222-222222222222";
const PLAN_UUID = "33333333-3333-4333-8333-333333333333";
const PACK_UUID = "44444444-4444-4444-8444-444444444444";
const ASSET_A = "55555555-5555-4555-8555-555555555555";
const ASSET_B = "66666666-6666-4666-8666-666666666666";
const PAYMENT_UUID = "77777777-7777-4777-8777-777777777777";
const POLICY_UUID = "88888888-8888-4888-8888-888888888888";

function subscription(overrides = {}) {
  return {
    schemaVersion: "wags.subscription.v1",
    subscriptionUuid: SUBSCRIPTION_UUID,
    ownerUuid: OWNER_UUID,
    planUuid: PLAN_UUID,
    planVersionNumber: 1,
    cadence: "annual_prepaid",
    status: "active",
    serviceStartsAt: "2026-01-31T10:00:00.000Z",
    serviceEndsAt: "2027-01-31T10:00:00.000Z",
    cancelEffectiveAt: null,
    lastLifecycleEventAt: null,
    appliedEventIds: [],
    ...overrides,
  };
}

function payment(overrides = {}) {
  return {
    paymentUuid: PAYMENT_UUID,
    status: "paid",
    coversFrom: "2026-01-31T10:00:00.000Z",
    coversUntil: "2027-01-31T10:00:00.000Z",
    ...overrides,
  };
}

function sealedPack() {
  return sealPackVersion({
    schemaVersion: "wags.pack.v1",
    packUuid: PACK_UUID,
    versionNumber: 2,
    releasePeriod: "2026-01",
    title: "Winter Makers Pack",
    tier: "plus",
    items: [
      {
        slotKey: "accessory",
        title: "Winter collar",
        primary: { kind: "asset", assetUuid: ASSET_A, versionNumber: 1, assetType: "accessory" },
        substitutions: [{ kind: "asset", assetUuid: ASSET_B, versionNumber: 2, assetType: "accessory" }],
        ownedFallback: { kind: "credits", amount: 5, ledgerCode: "owned-item-fallback" },
      },
      {
        slotKey: "mini_model",
        title: "Snow friend",
        primary: { kind: "asset", assetUuid: ASSET_B, versionNumber: 2, assetType: "mini_model" },
        substitutions: [],
        ownedFallback: null,
      },
      {
        slotKey: "monthly_credits",
        title: "Monthly credit grant",
        primary: { kind: "credits", amount: 20, ledgerCode: "wags-monthly-plus" },
        substitutions: [],
        ownedFallback: null,
      },
    ],
    publishedAt: "2026-01-01T00:00:00.000Z",
  });
}

test("Phase 7 pack contracts are strict and hashes detect mutation", () => {
  const pack = sealedPack();
  assert.equal(verifyPackVersion(pack), true);
  assert.equal(verifyPackVersion({ ...pack, title: "Changed later" }), false);
  const { packHash: _packHash, ...input } = pack;
  assert.throws(() => WagsPackVersionInputSchema.parse({ ...input, mutableCatalogId: 19 }));
});

test("Phase 7 annual prepaid terms produce 12 anchored monthly periods", () => {
  const periods = buildMonthlyEntitlementPeriods("2026-01-31T10:00:00.000Z", "2027-01-31T10:00:00.000Z");
  assert.equal(periods.length, 12);
  assert.equal(periods[0].startsAt, "2026-01-31T10:00:00.000Z");
  assert.equal(periods[0].endsAt, "2026-02-28T10:00:00.000Z");
  assert.equal(periods[1].endsAt, "2026-03-31T10:00:00.000Z");
  assert.equal(periods.at(-1).endsAt, "2027-01-31T10:00:00.000Z");
});

test("Phase 7 paid cancellation-at-period-end retains the current entitlement", () => {
  const period = buildMonthlyEntitlementPeriods("2026-01-31T10:00:00.000Z", "2027-01-31T10:00:00.000Z")[0];
  const decision = decidePeriodEntitlement({
    subscription: subscription({ status: "cancel_at_period_end", cancelEffectiveAt: "2026-02-28T10:00:00.000Z" }),
    period,
    payment: payment(),
  });
  assert.equal(decision.action, "deliver");
});

test("Phase 7 cancellation and failed payment block unearned packs", () => {
  const period = buildMonthlyEntitlementPeriods("2026-02-28T10:00:00.000Z", "2026-03-31T10:00:00.000Z")[0];
  const canceled = decidePeriodEntitlement({
    subscription: subscription({ status: "canceled", cancelEffectiveAt: "2026-02-28T10:00:00.000Z" }),
    period,
    payment: payment(),
  });
  assert.equal(canceled.action, "skip");
  const failed = decidePeriodEntitlement({ subscription: subscription({ status: "past_due" }), period, payment: payment({ status: "failed" }) });
  assert.equal(failed.action, "hold");
});

test("Phase 7 substitutes owned assets and never selects one asset twice", () => {
  const period = buildMonthlyEntitlementPeriods("2026-01-31T10:00:00.000Z", "2026-02-28T10:00:00.000Z")[0];
  const plan = planPackGrants({
    subscription: subscription(),
    period,
    pack: sealedPack(),
    ownedDeliverableKeys: [`asset:${ASSET_A}`],
    existingGrants: [],
  });
  const accessory = plan.newGrants.find((grant) => grant.slotKey === "accessory");
  assert.equal(accessory.disposition, "substitution");
  assert.equal(accessory.deliverable.assetUuid, ASSET_B);
  assert.deepEqual(plan.skippedSlots, [{ slotKey: "mini_model", reason: "already_owned_no_substitution" }]);
  const selectedAssets = plan.newGrants.filter((grant) => grant.deliverable.kind === "asset").map((grant) => grant.deliverable.assetUuid);
  assert.equal(new Set(selectedAssets).size, selectedAssets.length);
});

test("Phase 7 pack replay preserves prior grant contents and identities", () => {
  const period = buildMonthlyEntitlementPeriods("2026-01-31T10:00:00.000Z", "2026-02-28T10:00:00.000Z")[0];
  const first = planPackGrants({ subscription: subscription(), period, pack: sealedPack(), ownedDeliverableKeys: [], existingGrants: [] });
  const prior = first.newGrants.map(({ disposition: _disposition, ...grant }) => grant);
  const replay = planPackGrants({
    subscription: subscription(),
    period,
    pack: sealedPack(),
    ownedDeliverableKeys: [`asset:${ASSET_A}`, `asset:${ASSET_B}`],
    existingGrants: prior,
  });
  assert.equal(replay.newGrants.length, 0);
  assert.equal(replay.replayedGrants.length, first.newGrants.length);
  assert.deepEqual(replay.replayedGrants.map((grant) => grant.deliverable), first.newGrants.map((grant) => grant.deliverable));
});

test("Phase 7 annual advance-pay incentive grants exactly once per term", () => {
  const input = {
    subscription: subscription(),
    termStartsAt: "2026-01-31T10:00:00.000Z",
    termEndsAt: "2027-01-31T10:00:00.000Z",
    payment: payment(),
    policy: {
      policyUuid: POLICY_UUID,
      versionNumber: 1,
      incentiveSku: "WAGS-ANNUAL-2026",
      grants: [
        { slotKey: "bonus_credits", deliverable: { kind: "credits", amount: 100, ledgerCode: "wags-annual-bonus" } },
        { slotKey: "exclusive_model", deliverable: { kind: "asset", assetUuid: ASSET_A, versionNumber: 1, assetType: "mini_model" } },
      ],
    },
    existingGrants: [],
  };
  const first = planAnnualIncentive(input);
  assert.equal(first.newGrants.length, 2);
  const existingGrants = first.newGrants.map(({ disposition: _disposition, ...grant }) => grant);
  const replay = planAnnualIncentive({ ...input, existingGrants });
  assert.equal(replay.deliveryIdentity, first.deliveryIdentity);
  assert.equal(replay.newGrants.length, 0);
  assert.equal(replay.replayedGrants.length, 2);
});
