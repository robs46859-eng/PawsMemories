import {
  isEndpointEnabled,
  paidUsageLimitsFor,
  type PaidEndpoint,
  type PaidUsageLimits,
  type PaidUsageReservation,
} from "./paidApiGuards";

type Env = Record<string, string | undefined>;

export type PaidProviderDecision =
  | { allowed: true; limits: PaidUsageLimits; reservation: PaidUsageReservation }
  | {
      allowed: false;
      status: 429 | 503;
      reason: "disabled" | "user_cap" | "global_cap" | "global_cost_cap";
      message: string;
      limits: PaidUsageLimits;
    };

/**
 * Shared budget decision for paid routes outside the Pet Simulator router.
 * Call only after request validation and ownership checks, immediately before
 * invoking the provider. A reservation is intentionally never bypassed for an
 * administrator because provider spend is global even when app credits are not.
 */
export async function reservePaidProviderBudget(
  owner: string,
  endpoint: PaidEndpoint,
  reserve: (
    owner: string,
    endpoint: PaidEndpoint,
    limits: PaidUsageLimits,
  ) => Promise<PaidUsageReservation>,
  env: Env = process.env,
): Promise<PaidProviderDecision> {
  const limits = paidUsageLimitsFor(endpoint, env);
  if (!isEndpointEnabled(endpoint, env)) {
    return {
      allowed: false,
      status: 503,
      reason: "disabled",
      message: "This feature is temporarily unavailable.",
      limits,
    };
  }

  const reservation = await reserve(owner, endpoint, limits);
  if (reservation.allowed) return { allowed: true, limits, reservation };

  const aggregate = reservation.reason !== "user_cap";
  return {
    allowed: false,
    status: aggregate ? 503 : 429,
    reason: reservation.reason || "global_cap",
    message: aggregate
      ? "This feature has reached its daily service budget. Please try again tomorrow."
      : `Daily limit reached (${limits.userDailyCap}/day). Please try again tomorrow.`,
    limits,
  };
}
