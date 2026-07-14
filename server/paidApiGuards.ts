/**
 * server/paidApiGuards.ts - launch limits for production paid operations.
 *
 * Pure config logic only: kill-switches + per-user and aggregate daily budgets
 * derived from env.
 * No DB or Express imports, so it is unit-testable in isolation. Atomic daily
 * reservation lives in `db.ts` (`reservePaidUsage`); route adapters call these
 * helpers before invoking paid providers.
 *
 * Env contract:
 *   PETSIM_PAID_APIS_ENABLED   master kill-switch (default: on)
 *   PETSIM_<ENDPOINT>_ENABLED  per-endpoint switch (default: on except rig)
 *   PETSIM_<ENDPOINT>_DAILY_CAP per-user/day request cap
 *   PETSIM_<ENDPOINT>_GLOBAL_DAILY_CAP aggregate request cap
 *   PETSIM_<ENDPOINT>_ESTIMATED_COST_MICRO_USD reserved cost per provider call
 *   PETSIM_<ENDPOINT>_GLOBAL_DAILY_COST_MICRO_USD aggregate reserved-cost cap
 */

export type PaidEndpoint =
  | "classify"
  | "semantic_scan"
  | "rig"
  | "video"
  | "talking_video"
  | "model_3d"
  | "image_generation"
  | "pawprint";

export const PAID_ENDPOINTS: PaidEndpoint[] = [
  "classify",
  "semantic_scan",
  "rig",
  "video",
  "talking_video",
  "model_3d",
  "image_generation",
  "pawprint",
];

type Env = Record<string, string | undefined>;

/** Uppercase env token for each endpoint (used to build flag/cap keys). */
const ENV_TOKEN: Record<PaidEndpoint, string> = {
  classify: "CLASSIFY",
  semantic_scan: "SEMANTIC_SCAN",
  rig: "RIG",
  video: "VIDEO",
  talking_video: "TALKING_VIDEO",
  model_3d: "MODEL_3D",
  image_generation: "IMAGE_GENERATION",
  pawprint: "PAWPRINT",
};

/** Default per-user, per-day request caps. */
const DEFAULT_DAILY_CAPS: Record<PaidEndpoint, number> = {
  classify: 10,
  semantic_scan: 20,
  rig: 0,
  video: 2,
  talking_video: 1,
  model_3d: 2,
  image_generation: 5,
  pawprint: 3,
};

/** Conservative aggregate request ceilings. Rig remains closed by default. */
const DEFAULT_GLOBAL_DAILY_CAPS: Record<PaidEndpoint, number> = {
  classify: 100,
  semantic_scan: 200,
  rig: 0,
  video: 20,
  talking_video: 10,
  model_3d: 20,
  image_generation: 50,
  pawprint: 50,
};

/** Upper-bound cost reservations in millionths of one US dollar. */
const DEFAULT_ESTIMATED_COST_MICRO_USD: Record<PaidEndpoint, number> = {
  classify: 20_000,
  semantic_scan: 20_000,
  rig: 1_000_000,
  video: 1_000_000,
  talking_video: 2_000_000,
  model_3d: 1_000_000,
  image_generation: 1_000_000,
  pawprint: 100_000,
};

/** Aggregate daily reserved-cost ceilings in millionths of one US dollar. */
const DEFAULT_GLOBAL_DAILY_COST_MICRO_USD: Record<PaidEndpoint, number> = {
  classify: 2_000_000,
  semantic_scan: 4_000_000,
  rig: 0,
  video: 20_000_000,
  talking_video: 20_000_000,
  model_3d: 20_000_000,
  image_generation: 50_000_000,
  pawprint: 5_000_000,
};

/** Per-endpoint default for the enable flag. Rig stays off by default (historical). */
const DEFAULT_ENABLED: Record<PaidEndpoint, boolean> = {
  classify: true,
  semantic_scan: true,
  rig: false,
  video: true,
  talking_video: true,
  model_3d: true,
  image_generation: true,
  pawprint: true,
};

/**
 * Parse a boolean-ish env flag. Truthy: 1/true/yes/on. Falsy: 0/false/no/off.
 * Empty / undefined / unrecognised returns the supplied default.
 */
export function parseBoolFlag(raw: string | undefined, dflt: boolean): boolean {
  if (raw == null) return dflt;
  const v = String(raw).trim().toLowerCase();
  if (v === "") return dflt;
  if (v === "1" || v === "true" || v === "yes" || v === "on") return true;
  if (v === "0" || v === "false" || v === "no" || v === "off") return false;
  return dflt;
}

/**
 * Per-user daily cap for an endpoint. A non-negative integer; 0 effectively
 * disables the endpoint via the cap. Invalid/negative overrides fall back to
 * the built-in default.
 */
export function dailyCapFor(ep: PaidEndpoint, env: Env = process.env): number {
  return nonNegativeInteger(
    env[`PETSIM_${ENV_TOKEN[ep]}_DAILY_CAP`],
    DEFAULT_DAILY_CAPS[ep],
  );
}

function nonNegativeInteger(raw: string | undefined, fallback: number): number {
  const n = raw == null || String(raw).trim() === "" ? NaN : Number(raw);
  return Number.isSafeInteger(n) && n >= 0 ? n : fallback;
}

function positiveInteger(raw: string | undefined, fallback: number): number {
  const n = raw == null || String(raw).trim() === "" ? NaN : Number(raw);
  return Number.isSafeInteger(n) && n > 0 ? n : fallback;
}

/** Aggregate request cap across all users for this endpoint and UTC database day. */
export function globalDailyCapFor(ep: PaidEndpoint, env: Env = process.env): number {
  return nonNegativeInteger(
    env[`PETSIM_${ENV_TOKEN[ep]}_GLOBAL_DAILY_CAP`],
    DEFAULT_GLOBAL_DAILY_CAPS[ep],
  );
}

/** Cost reserved before one provider call, expressed as integer micro-USD. */
export function estimatedCostMicroUsdFor(ep: PaidEndpoint, env: Env = process.env): number {
  return positiveInteger(
    env[`PETSIM_${ENV_TOKEN[ep]}_ESTIMATED_COST_MICRO_USD`],
    DEFAULT_ESTIMATED_COST_MICRO_USD[ep],
  );
}

/** Aggregate daily cost ceiling, expressed as integer micro-USD. */
export function globalDailyCostMicroUsdFor(ep: PaidEndpoint, env: Env = process.env): number {
  return nonNegativeInteger(
    env[`PETSIM_${ENV_TOKEN[ep]}_GLOBAL_DAILY_COST_MICRO_USD`],
    DEFAULT_GLOBAL_DAILY_COST_MICRO_USD[ep],
  );
}

export interface PaidUsageLimits {
  userDailyCap: number;
  globalDailyCap: number;
  estimatedCostMicroUsd: number;
  globalDailyCostMicroUsd: number;
}

export type PaidUsageDenialReason = "user_cap" | "global_cap" | "global_cost_cap";

export interface PaidUsageReservation {
  allowed: boolean;
  reason?: PaidUsageDenialReason;
  userCount: number;
  globalCount: number;
  globalReservedCostMicroUsd: number;
}

export function paidUsageLimitsFor(ep: PaidEndpoint, env: Env = process.env): PaidUsageLimits {
  return {
    userDailyCap: dailyCapFor(ep, env),
    globalDailyCap: globalDailyCapFor(ep, env),
    estimatedCostMicroUsd: estimatedCostMicroUsdFor(ep, env),
    globalDailyCostMicroUsd: globalDailyCostMicroUsdFor(ep, env),
  };
}

/**
 * Kill-switch: an endpoint is enabled when the master switch is on AND the
 * per-endpoint switch is on. Master defaults on; per-endpoint defaults per
 * DEFAULT_ENABLED (rig off, others on).
 */
export function isEndpointEnabled(ep: PaidEndpoint, env: Env = process.env): boolean {
  if (!parseBoolFlag(env.PETSIM_PAID_APIS_ENABLED, true)) return false;
  return parseBoolFlag(env[`PETSIM_${ENV_TOKEN[ep]}_ENABLED`], DEFAULT_ENABLED[ep]);
}

/**
 * Whether a request is within the daily cap. `countAfterBump` is the 1-based
 * usage count returned after incrementing (so the Nth request has count N and
 * is allowed while N <= cap).
 */
export function withinDailyCap(
  ep: PaidEndpoint,
  countAfterBump: number,
  env: Env = process.env,
): boolean {
  return countAfterBump <= dailyCapFor(ep, env);
}
