import {
  AnnualIncentivePolicySchema,
  EntitlementPeriodSchema,
  ExistingGrantSchema,
  GrantPlanSchema,
  PaymentCoverageSchema,
  SealedWagsPackVersionSchema,
  WagsPackVersionInputSchema,
  WagsIsoDateTimeSchema,
  WagsSubscriptionSchema,
  type AnnualIncentivePolicy,
  type EntitlementPeriod,
  type ExistingGrant,
  type GrantPlan,
  type PlannedGrant,
  type SealedWagsPackVersion,
  type WagsDeliverable,
  type WagsPackVersionInput,
  type WagsSubscription,
  type PaymentCoverage,
} from "./contracts.ts";
import { annualIncentiveDeliveryIdentity, deliveryIdentity, grantIdentity, hashIdentity } from "./identity.ts";

export function sealPackVersion(rawPack: WagsPackVersionInput): SealedWagsPackVersion {
  const pack = WagsPackVersionInputSchema.parse(rawPack);
  return SealedWagsPackVersionSchema.parse({ ...pack, packHash: hashIdentity(pack) });
}

export function verifyPackVersion(rawPack: SealedWagsPackVersion): boolean {
  const pack = SealedWagsPackVersionSchema.parse(rawPack);
  const { packHash, ...content } = pack;
  return hashIdentity(content) === packHash;
}

function iso(date: Date): string {
  return date.toISOString();
}

function addCalendarMonthsClamped(origin: Date, months: number): Date {
  const targetYear = origin.getUTCFullYear() + Math.floor((origin.getUTCMonth() + months) / 12);
  const targetMonth = ((origin.getUTCMonth() + months) % 12 + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  return new Date(Date.UTC(
    targetYear,
    targetMonth,
    Math.min(origin.getUTCDate(), lastDay),
    origin.getUTCHours(),
    origin.getUTCMinutes(),
    origin.getUTCSeconds(),
    origin.getUTCMilliseconds(),
  ));
}

export function buildMonthlyEntitlementPeriods(termStartsAt: string, termEndsAt: string): EntitlementPeriod[] {
  const origin = new Date(WagsIsoDateTimeSchema.parse(termStartsAt));
  const end = new Date(WagsIsoDateTimeSchema.parse(termEndsAt));
  if (origin >= end) {
    throw new Error("Entitlement term must be a valid positive interval.");
  }
  const periods: EntitlementPeriod[] = [];
  for (let index = 0; index < 120; index += 1) {
    const start = addCalendarMonthsClamped(origin, index);
    if (start >= end) break;
    const next = addCalendarMonthsClamped(origin, index + 1);
    const periodEnd = next < end ? next : end;
    periods.push(EntitlementPeriodSchema.parse({
      periodKey: `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, "0")}`,
      startsAt: iso(start),
      endsAt: iso(periodEnd),
    }));
  }
  if (periods.length === 120 && Date.parse(periods[119].endsAt) < end.getTime()) {
    throw new Error("Entitlement term exceeds the supported 120-month maximum.");
  }
  return periods;
}

export function decidePeriodEntitlement(rawInput: {
  subscription: WagsSubscription;
  period: EntitlementPeriod;
  payment: PaymentCoverage | null;
}): { action: "deliver" | "hold" | "skip"; reason: string } {
  const subscription = WagsSubscriptionSchema.parse(rawInput.subscription);
  const period = EntitlementPeriodSchema.parse(rawInput.period);
  const payment = rawInput.payment ? PaymentCoverageSchema.parse(rawInput.payment) : null;
  const periodStart = Date.parse(period.startsAt);
  const periodEnd = Date.parse(period.endsAt);
  if (periodStart < Date.parse(subscription.serviceStartsAt) || periodEnd > Date.parse(subscription.serviceEndsAt)) {
    return { action: "skip", reason: "Period is outside the purchased service interval." };
  }
  if (subscription.status === "expired") return { action: "skip", reason: "Subscription is expired." };
  if (["canceled", "cancel_at_period_end"].includes(subscription.status) && subscription.cancelEffectiveAt && Date.parse(subscription.cancelEffectiveAt) <= periodStart) {
    return { action: "skip", reason: "Cancellation was effective before this entitlement period." };
  }
  if (!payment || payment.status !== "paid") {
    return { action: "hold", reason: "Paid coverage is not confirmed for this period." };
  }
  if (Date.parse(payment.coversFrom) > periodStart || Date.parse(payment.coversUntil) < periodEnd) {
    return { action: "hold", reason: "Payment evidence does not cover the full entitlement period." };
  }
  if (["checkout_pending", "past_due"].includes(subscription.status)) {
    return { action: "hold", reason: "Subscription lifecycle state requires payment reconciliation." };
  }
  return { action: "deliver", reason: "Paid service covers the immutable entitlement period." };
}

function ownershipKey(deliverable: WagsDeliverable): string | null {
  if (deliverable.kind === "asset") return `asset:${deliverable.assetUuid}`;
  if (deliverable.kind === "benefit") return `benefit:${deliverable.benefitSku}`;
  return null;
}

export function planPackGrants(rawInput: {
  subscription: WagsSubscription;
  period: EntitlementPeriod;
  pack: SealedWagsPackVersion;
  ownedDeliverableKeys: Iterable<string>;
  existingGrants: ExistingGrant[];
}): GrantPlan {
  const subscription = WagsSubscriptionSchema.parse(rawInput.subscription);
  const period = EntitlementPeriodSchema.parse(rawInput.period);
  const pack = SealedWagsPackVersionSchema.parse(rawInput.pack);
  if (!verifyPackVersion(pack)) throw new Error("Pack hash does not match its immutable contents.");
  if (pack.releasePeriod !== period.periodKey) throw new Error("Pack release period does not match the entitlement period.");
  const deliveryId = deliveryIdentity({
    subscriptionUuid: subscription.subscriptionUuid,
    periodKey: period.periodKey,
    packUuid: pack.packUuid,
    packVersionNumber: pack.versionNumber,
  });
  const existingByIdentity = new Map(rawInput.existingGrants.map((grant) => {
    const parsed = ExistingGrantSchema.parse(grant);
    return [parsed.grantIdentity, parsed] as const;
  }));
  const owned = new Set(rawInput.ownedDeliverableKeys);
  const reserved = new Set<string>();
  const newGrants: PlannedGrant[] = [];
  const replayedGrants: PlannedGrant[] = [];
  const skippedSlots: GrantPlan["skippedSlots"] = [];

  for (const item of [...pack.items].sort((left, right) => left.slotKey.localeCompare(right.slotKey))) {
    const grantId = grantIdentity(deliveryId, item.slotKey);
    const existing = existingByIdentity.get(grantId);
    if (existing) {
      if (existing.deliveryIdentity !== deliveryId || existing.slotKey !== item.slotKey) {
        throw new Error(`Existing grant ${grantId} conflicts with the deterministic delivery identity.`);
      }
      replayedGrants.push({ ...existing, disposition: "replay" });
      const key = ownershipKey(existing.deliverable);
      if (key) reserved.add(key);
      continue;
    }

    let selected: WagsDeliverable | null = item.primary;
    let disposition: PlannedGrant["disposition"] = "primary";
    if (item.primary.kind === "asset") {
      const candidates = [item.primary, ...item.substitutions];
      const matchIndex = candidates.findIndex((candidate) => {
        const key = ownershipKey(candidate);
        return key !== null && !owned.has(key) && !reserved.has(key);
      });
      if (matchIndex >= 0) {
        selected = candidates[matchIndex];
        disposition = matchIndex === 0 ? "primary" : "substitution";
      } else if (item.ownedFallback) {
        selected = item.ownedFallback;
        disposition = "owned_fallback";
      } else {
        selected = null;
      }
    }
    if (!selected) {
      skippedSlots.push({ slotKey: item.slotKey, reason: "already_owned_no_substitution" });
      continue;
    }
    const key = ownershipKey(selected);
    if (key) reserved.add(key);
    newGrants.push({ grantIdentity: grantId, deliveryIdentity: deliveryId, slotKey: item.slotKey, deliverable: selected, disposition });
  }

  return GrantPlanSchema.parse({
    schemaVersion: "wags.grant-plan.v1",
    deliveryIdentity: deliveryId,
    subscriptionUuid: subscription.subscriptionUuid,
    period,
    packUuid: pack.packUuid,
    packVersionNumber: pack.versionNumber,
    packHash: pack.packHash,
    newGrants,
    replayedGrants,
    skippedSlots,
  });
}

export function planAnnualIncentive(rawInput: {
  subscription: WagsSubscription;
  termStartsAt: string;
  termEndsAt: string;
  payment: PaymentCoverage;
  policy: AnnualIncentivePolicy;
  existingGrants: ExistingGrant[];
}): { deliveryIdentity: string; newGrants: PlannedGrant[]; replayedGrants: PlannedGrant[] } {
  const subscription = WagsSubscriptionSchema.parse(rawInput.subscription);
  const payment = PaymentCoverageSchema.parse(rawInput.payment);
  const policy = AnnualIncentivePolicySchema.parse(rawInput.policy);
  const termStartsAt = WagsIsoDateTimeSchema.parse(rawInput.termStartsAt);
  const termEndsAt = WagsIsoDateTimeSchema.parse(rawInput.termEndsAt);
  if (Date.parse(termStartsAt) >= Date.parse(termEndsAt)) throw new Error("Annual incentive term must be a positive interval.");
  if (Date.parse(termStartsAt) < Date.parse(subscription.serviceStartsAt) || Date.parse(termEndsAt) > Date.parse(subscription.serviceEndsAt)) {
    throw new Error("Annual incentive term must be within the purchased service interval.");
  }
  if (subscription.cadence !== "annual_prepaid") throw new Error("Annual incentives require an annual prepaid subscription.");
  if (buildMonthlyEntitlementPeriods(termStartsAt, termEndsAt).length !== 12) {
    throw new Error("Annual incentive requires a twelve-period prepaid term.");
  }
  if (payment.status !== "paid" || Date.parse(payment.coversFrom) > Date.parse(termStartsAt) || Date.parse(payment.coversUntil) < Date.parse(termEndsAt)) {
    throw new Error("Annual incentive requires confirmed payment covering the full prepaid term.");
  }
  const deliveryId = annualIncentiveDeliveryIdentity({
    subscriptionUuid: subscription.subscriptionUuid,
    termStartsAt,
    termEndsAt,
    policyUuid: policy.policyUuid,
    policyVersionNumber: policy.versionNumber,
  });
  const existing = new Map(rawInput.existingGrants.map((grant) => {
    const parsed = ExistingGrantSchema.parse(grant);
    return [parsed.grantIdentity, parsed] as const;
  }));
  const newGrants: PlannedGrant[] = [];
  const replayedGrants: PlannedGrant[] = [];
  for (const incentive of [...policy.grants].sort((left, right) => left.slotKey.localeCompare(right.slotKey))) {
    const identity = grantIdentity(deliveryId, incentive.slotKey);
    const prior = existing.get(identity);
    if (prior) {
      if (prior.deliveryIdentity !== deliveryId || prior.slotKey !== incentive.slotKey) {
        throw new Error(`Existing annual incentive grant ${identity} conflicts with its deterministic identity.`);
      }
      replayedGrants.push({ ...prior, disposition: "replay" });
    } else {
      newGrants.push({ grantIdentity: identity, deliveryIdentity: deliveryId, slotKey: incentive.slotKey, deliverable: incentive.deliverable, disposition: "primary" });
    }
  }
  return { deliveryIdentity: deliveryId, newGrants, replayedGrants };
}
