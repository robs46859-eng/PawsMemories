import crypto from "node:crypto";

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
        .map(([key, item]) => [key, normalize(item)]),
    );
  }
  if (typeof value === "number" && !Number.isFinite(value)) throw new Error("Identity data must contain finite numbers.");
  return value;
}

export function hashIdentity(value: unknown): string {
  return crypto.createHash("sha256").update(JSON.stringify(normalize(value))).digest("hex");
}

export function deliveryIdentity(input: { subscriptionUuid: string; periodKey: string; packUuid: string; packVersionNumber: number }): string {
  return `wags-delivery-v1-${hashIdentity(input)}`;
}

export function grantIdentity(deliveryId: string, slotKey: string): string {
  return `wags-grant-v1-${hashIdentity({ deliveryId, slotKey })}`;
}

export function annualIncentiveDeliveryIdentity(input: {
  subscriptionUuid: string;
  termStartsAt: string;
  termEndsAt: string;
  policyUuid: string;
  policyVersionNumber: number;
}): string {
  return `wags-delivery-v1-${hashIdentity({ kind: "annual_incentive", ...input })}`;
}
