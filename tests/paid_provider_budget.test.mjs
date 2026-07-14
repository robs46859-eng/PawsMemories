import assert from "node:assert/strict";
import test from "node:test";
import { reservePaidProviderBudget } from "../server/paidProviderBudget.ts";

const enabled = {
  PETSIM_PAID_APIS_ENABLED: "true",
  PETSIM_VIDEO_ENABLED: "true",
  PETSIM_VIDEO_DAILY_CAP: "2",
  PETSIM_VIDEO_GLOBAL_DAILY_CAP: "20",
  PETSIM_VIDEO_ESTIMATED_COST_MICRO_USD: "1000000",
  PETSIM_VIDEO_GLOBAL_DAILY_COST_MICRO_USD: "20000000",
};

test("disabled provider does not reserve", async () => {
  let calls = 0;
  const decision = await reservePaidProviderBudget(
    "owner",
    "video",
    async () => {
      calls += 1;
      throw new Error("must not reserve");
    },
    { ...enabled, PETSIM_VIDEO_ENABLED: "false" },
  );
  assert.equal(decision.allowed, false);
  assert.equal(decision.status, 503);
  assert.equal(decision.reason, "disabled");
  assert.equal(calls, 0);
});

test("user cap maps to 429 and aggregate caps map to 503", async () => {
  for (const [reason, status] of [["user_cap", 429], ["global_cap", 503], ["global_cost_cap", 503]]) {
    const decision = await reservePaidProviderBudget(
      "owner",
      "video",
      async () => ({
        allowed: false,
        reason,
        userCount: 2,
        globalCount: 20,
        globalReservedCostMicroUsd: 20_000_000,
      }),
      enabled,
    );
    assert.equal(decision.allowed, false);
    assert.equal(decision.status, status);
    assert.equal(decision.reason, reason);
  }
});

test("successful reservations expose the exact configured limits", async () => {
  const decision = await reservePaidProviderBudget(
    "owner",
    "video",
    async (_owner, endpoint, limits) => {
      assert.equal(endpoint, "video");
      assert.equal(limits.estimatedCostMicroUsd, 1_000_000);
      return {
        allowed: true,
        userCount: 1,
        globalCount: 1,
        globalReservedCostMicroUsd: 1_000_000,
      };
    },
    enabled,
  );
  assert.equal(decision.allowed, true);
  assert.equal(decision.limits.userDailyCap, 2);
});
