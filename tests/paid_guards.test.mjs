import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PAID_ENDPOINTS,
  dailyCapFor,
  estimatedCostMicroUsdFor,
  globalDailyCapFor,
  globalDailyCostMicroUsdFor,
  isEndpointEnabled,
  paidUsageLimitsFor,
  parseBoolFlag,
  withinDailyCap,
} from "../server/paidApiGuards.ts";

const ENV_TOKENS = {
  classify: "CLASSIFY",
  semantic_scan: "SEMANTIC_SCAN",
  rig: "RIG",
  video: "VIDEO",
  talking_video: "TALKING_VIDEO",
  model_3d: "MODEL_3D",
  image_generation: "IMAGE_GENERATION",
  pawprint: "PAWPRINT",
};

const DEFAULT_LIMITS = {
  classify: {
    userDailyCap: 10,
    globalDailyCap: 100,
    estimatedCostMicroUsd: 20_000,
    globalDailyCostMicroUsd: 2_000_000,
  },
  semantic_scan: {
    userDailyCap: 20,
    globalDailyCap: 200,
    estimatedCostMicroUsd: 20_000,
    globalDailyCostMicroUsd: 4_000_000,
  },
  rig: {
    userDailyCap: 0,
    globalDailyCap: 0,
    estimatedCostMicroUsd: 1_000_000,
    globalDailyCostMicroUsd: 0,
  },
  video: {
    userDailyCap: 2,
    globalDailyCap: 20,
    estimatedCostMicroUsd: 1_000_000,
    globalDailyCostMicroUsd: 20_000_000,
  },
  talking_video: {
    userDailyCap: 1,
    globalDailyCap: 10,
    estimatedCostMicroUsd: 2_000_000,
    globalDailyCostMicroUsd: 20_000_000,
  },
  model_3d: {
    userDailyCap: 2,
    globalDailyCap: 20,
    estimatedCostMicroUsd: 1_000_000,
    globalDailyCostMicroUsd: 20_000_000,
  },
  image_generation: {
    userDailyCap: 5,
    globalDailyCap: 50,
    estimatedCostMicroUsd: 1_000_000,
    globalDailyCostMicroUsd: 50_000_000,
  },
  pawprint: {
    userDailyCap: 3,
    globalDailyCap: 50,
    estimatedCostMicroUsd: 100_000,
    globalDailyCostMicroUsd: 5_000_000,
  },
};

test("parseBoolFlag accepts explicit values and defaults malformed values", () => {
  for (const value of ["1", "true", "TRUE", "yes", "on", " On "]) {
    assert.equal(parseBoolFlag(value, false), true, `${value} should be true`);
  }
  for (const value of ["0", "false", "no", "off", "OFF", " No "]) {
    assert.equal(parseBoolFlag(value, true), false, `${value} should be false`);
  }
  for (const value of [undefined, "", "   ", "banana"]) {
    assert.equal(parseBoolFlag(value, true), true);
    assert.equal(parseBoolFlag(value, false), false);
  }
});

test("paid endpoint list and launch defaults cover every production operation", () => {
  assert.deepEqual(PAID_ENDPOINTS, [
    "classify",
    "semantic_scan",
    "rig",
    "video",
    "talking_video",
    "model_3d",
    "image_generation",
    "pawprint",
  ]);

  for (const endpoint of PAID_ENDPOINTS) {
    assert.deepEqual(paidUsageLimitsFor(endpoint, {}), DEFAULT_LIMITS[endpoint], endpoint);
  }
});

test("all endpoint limit fields support integer environment overrides", () => {
  for (const endpoint of PAID_ENDPOINTS) {
    const token = ENV_TOKENS[endpoint];
    const env = {
      [`PETSIM_${token}_DAILY_CAP`]: "7",
      [`PETSIM_${token}_GLOBAL_DAILY_CAP`]: "11",
      [`PETSIM_${token}_ESTIMATED_COST_MICRO_USD`]: "123456",
      [`PETSIM_${token}_GLOBAL_DAILY_COST_MICRO_USD`]: "7654321",
    };
    assert.deepEqual(paidUsageLimitsFor(endpoint, env), {
      userDailyCap: 7,
      globalDailyCap: 11,
      estimatedCostMicroUsd: 123_456,
      globalDailyCostMicroUsd: 7_654_321,
    });
  }
});

test("zero request and aggregate cost caps are preserved", () => {
  const env = {
    PETSIM_VIDEO_DAILY_CAP: "0",
    PETSIM_VIDEO_GLOBAL_DAILY_CAP: "0",
    PETSIM_VIDEO_ESTIMATED_COST_MICRO_USD: "0",
    PETSIM_VIDEO_GLOBAL_DAILY_COST_MICRO_USD: "0",
  };
  assert.deepEqual(paidUsageLimitsFor("video", env), {
    userDailyCap: 0,
    globalDailyCap: 0,
    estimatedCostMicroUsd: 1_000_000,
    globalDailyCostMicroUsd: 0,
  });
});

test("malformed, negative, fractional, and unsafe limits fall back", () => {
  const malformedValues = ["", "nope", "-1", "1.5", "Infinity", "9007199254740992"];

  for (const value of malformedValues) {
    assert.equal(dailyCapFor("classify", { PETSIM_CLASSIFY_DAILY_CAP: value }), 10, value);
    assert.equal(
      globalDailyCapFor("classify", { PETSIM_CLASSIFY_GLOBAL_DAILY_CAP: value }),
      100,
      value,
    );
    assert.equal(
      estimatedCostMicroUsdFor("classify", {
        PETSIM_CLASSIFY_ESTIMATED_COST_MICRO_USD: value,
      }),
      20_000,
      value,
    );
    assert.equal(
      globalDailyCostMicroUsdFor("classify", {
        PETSIM_CLASSIFY_GLOBAL_DAILY_COST_MICRO_USD: value,
      }),
      2_000_000,
      value,
    );
  }
});

test("endpoint switches default on except rig", () => {
  for (const endpoint of PAID_ENDPOINTS) {
    assert.equal(isEndpointEnabled(endpoint, {}), endpoint !== "rig", endpoint);
  }
});

test("every endpoint switch supports explicit overrides", () => {
  for (const endpoint of PAID_ENDPOINTS) {
    const token = ENV_TOKENS[endpoint];
    assert.equal(isEndpointEnabled(endpoint, { [`PETSIM_${token}_ENABLED`]: "false" }), false);
    assert.equal(isEndpointEnabled(endpoint, { [`PETSIM_${token}_ENABLED`]: "true" }), true);
  }
});

test("malformed endpoint switches return endpoint defaults", () => {
  assert.equal(isEndpointEnabled("video", { PETSIM_VIDEO_ENABLED: "sometimes" }), true);
  assert.equal(isEndpointEnabled("rig", { PETSIM_RIG_ENABLED: "sometimes" }), false);
});

test("master kill-switch overrides all endpoint switches", () => {
  const env = {
    PETSIM_PAID_APIS_ENABLED: "false",
    PETSIM_RIG_ENABLED: "true",
    PETSIM_VIDEO_ENABLED: "true",
  };
  for (const endpoint of PAID_ENDPOINTS) {
    assert.equal(isEndpointEnabled(endpoint, env), false, endpoint);
  }
});

test("withinDailyCap includes the boundary and rejects a zero cap", () => {
  const env = { PETSIM_VIDEO_DAILY_CAP: "2" };
  assert.equal(withinDailyCap("video", 1, env), true);
  assert.equal(withinDailyCap("video", 2, env), true);
  assert.equal(withinDailyCap("video", 3, env), false);
  assert.equal(withinDailyCap("rig", 1, {}), false);
});
