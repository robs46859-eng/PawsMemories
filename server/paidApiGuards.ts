/**
 * server/paidApiGuards.ts — H2/H7 hardening for the paid AR endpoints
 * (`/api/pets/classify`, `/api/pets/:id/rig`, `/api/ar/semantic-scan`).
 *
 * Pure config logic only: kill-switches + per-user daily caps derived from env.
 * No DB or express imports, so it is unit-testable in isolation. The daily
 * counter lives in `db.ts` (`bumpDailyUsage`) and the express wiring — rate
 * limiter + 503/429 responses — lives in `server.ts`.
 *
 * Env contract:
 *   PETSIM_PAID_APIS_ENABLED   master kill-switch for all three (default: on)
 *   PETSIM_CLASSIFY_ENABLED    per-endpoint switch (default: on)
 *   PETSIM_SEMANTIC_SCAN_ENABLED per-endpoint switch (default: on)
 *   PETSIM_RIG_ENABLED         per-endpoint switch (default: OFF, historical)
 *   PETSIM_CLASSIFY_DAILY_CAP  per-user/day cap (default: 25)
 *   PETSIM_RIG_DAILY_CAP       per-user/day cap (default: 5)
 *   PETSIM_SEMANTIC_SCAN_DAILY_CAP per-user/day cap (default: 50)
 */

export type PaidEndpoint = "classify" | "rig" | "semantic_scan";

export const PAID_ENDPOINTS: PaidEndpoint[] = ["classify", "rig", "semantic_scan"];

type Env = Record<string, string | undefined>;

/** Uppercase env token for each endpoint (used to build flag/cap keys). */
const ENV_TOKEN: Record<PaidEndpoint, string> = {
  classify: "CLASSIFY",
  rig: "RIG",
  semantic_scan: "SEMANTIC_SCAN",
};

/** Default per-user, per-day request caps. */
const DEFAULT_DAILY_CAPS: Record<PaidEndpoint, number> = {
  classify: 25,
  rig: 5,
  semantic_scan: 50,
};

/** Per-endpoint default for the enable flag. Rig stays off by default (historical). */
const DEFAULT_ENABLED: Record<PaidEndpoint, boolean> = {
  classify: true,
  rig: false,
  semantic_scan: true,
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
  const raw = env[`PETSIM_${ENV_TOKEN[ep]}_DAILY_CAP`];
  const n = raw == null || String(raw).trim() === "" ? NaN : Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : DEFAULT_DAILY_CAPS[ep];
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
