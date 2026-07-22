import { z } from "zod";

export const WagsIsoDateTimeSchema = z.string().datetime({ offset: true });
export const WagsSha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
export const PeriodKeySchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

export const WagsAssetDeliverableSchema = z.object({
  kind: z.literal("asset"),
  assetUuid: z.string().uuid(),
  versionNumber: z.number().int().positive(),
  assetType: z.enum(["mini_model", "accessory", "material", "stationery", "animation", "early_access"]),
}).strict();

export const WagsCreditDeliverableSchema = z.object({
  kind: z.literal("credits"),
  amount: z.number().int().positive().max(1_000_000),
  ledgerCode: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,79}$/),
}).strict();

export const WagsBenefitDeliverableSchema = z.object({
  kind: z.literal("benefit"),
  benefitSku: z.string().regex(/^[A-Z0-9][A-Z0-9_-]{0,79}$/),
  quantity: z.number().int().positive().max(10_000),
}).strict();

export const WagsDeliverableSchema = z.discriminatedUnion("kind", [
  WagsAssetDeliverableSchema,
  WagsCreditDeliverableSchema,
  WagsBenefitDeliverableSchema,
]);

export const WagsPackItemSchema = z.object({
  slotKey: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/),
  title: z.string().trim().min(1).max(160),
  primary: WagsDeliverableSchema,
  substitutions: z.array(WagsAssetDeliverableSchema).max(20),
  ownedFallback: z.discriminatedUnion("kind", [WagsCreditDeliverableSchema, WagsBenefitDeliverableSchema]).nullable(),
}).strict().superRefine((value, context) => {
  if (value.primary.kind !== "asset" && value.substitutions.length > 0) {
    context.addIssue({ code: "custom", message: "Only asset grants may define asset substitutions." });
  }
  if (value.primary.kind === "asset") {
    const primaryAssetType = value.primary.assetType;
    if (value.substitutions.some((item) => item.assetType !== primaryAssetType)) {
      context.addIssue({ code: "custom", message: "Substitutions must preserve the primary asset type." });
    }
  }
});

export const WagsPackVersionInputSchema = z.object({
  schemaVersion: z.literal("wags.pack.v1"),
  packUuid: z.string().uuid(),
  versionNumber: z.number().int().positive(),
  releasePeriod: PeriodKeySchema,
  title: z.string().trim().min(1).max(160),
  tier: z.enum(["basic", "plus"]),
  items: z.array(WagsPackItemSchema).min(1).max(100),
  publishedAt: WagsIsoDateTimeSchema,
}).strict().superRefine((value, context) => {
  const slots = value.items.map((item) => item.slotKey);
  if (new Set(slots).size !== slots.length) {
    context.addIssue({ code: "custom", message: "Pack slotKey values must be unique." });
  }
});

export const SealedWagsPackVersionSchema = WagsPackVersionInputSchema.extend({
  packHash: WagsSha256Schema,
}).strict();

export const EntitlementPeriodSchema = z.object({
  periodKey: PeriodKeySchema,
  startsAt: WagsIsoDateTimeSchema,
  endsAt: WagsIsoDateTimeSchema,
}).strict().refine((period) => Date.parse(period.startsAt) < Date.parse(period.endsAt), {
  message: "Entitlement period must end after it starts.",
});

export const WagsSubscriptionSchema = z.object({
  schemaVersion: z.literal("wags.subscription.v1"),
  subscriptionUuid: z.string().uuid(),
  ownerUuid: z.string().uuid(),
  planUuid: z.string().uuid(),
  planVersionNumber: z.number().int().positive(),
  cadence: z.enum(["monthly", "annual_prepaid"]),
  status: z.enum(["checkout_pending", "active", "past_due", "cancel_at_period_end", "canceled", "expired"]),
  serviceStartsAt: WagsIsoDateTimeSchema,
  serviceEndsAt: WagsIsoDateTimeSchema,
  cancelEffectiveAt: WagsIsoDateTimeSchema.nullable(),
  lastLifecycleEventAt: WagsIsoDateTimeSchema.nullable(),
  appliedEventIds: z.array(z.string().trim().min(1).max(200)).max(2000),
}).strict().refine((subscription) => Date.parse(subscription.serviceStartsAt) < Date.parse(subscription.serviceEndsAt), {
  message: "Subscription service interval must be positive.",
});

export const PaymentCoverageSchema = z.object({
  paymentUuid: z.string().uuid(),
  status: z.enum(["pending", "paid", "failed", "refunded"]),
  coversFrom: WagsIsoDateTimeSchema,
  coversUntil: WagsIsoDateTimeSchema,
}).strict().refine((payment) => Date.parse(payment.coversFrom) < Date.parse(payment.coversUntil), {
  message: "Payment coverage interval must be positive.",
});

export const ExistingGrantSchema = z.object({
  grantIdentity: z.string().regex(/^wags-grant-v1-[a-f0-9]{64}$/),
  deliveryIdentity: z.string().regex(/^wags-delivery-v1-[a-f0-9]{64}$/),
  slotKey: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/),
  deliverable: WagsDeliverableSchema,
}).strict();

export const PlannedGrantSchema = ExistingGrantSchema.extend({
  disposition: z.enum(["primary", "substitution", "owned_fallback", "replay"]),
}).strict();

export const GrantPlanSchema = z.object({
  schemaVersion: z.literal("wags.grant-plan.v1"),
  deliveryIdentity: z.string().regex(/^wags-delivery-v1-[a-f0-9]{64}$/),
  subscriptionUuid: z.string().uuid(),
  period: EntitlementPeriodSchema,
  packUuid: z.string().uuid(),
  packVersionNumber: z.number().int().positive(),
  packHash: WagsSha256Schema,
  newGrants: z.array(PlannedGrantSchema),
  replayedGrants: z.array(PlannedGrantSchema),
  skippedSlots: z.array(z.object({
    slotKey: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/),
    reason: z.literal("already_owned_no_substitution"),
  }).strict()),
}).strict();

export const AnnualIncentivePolicySchema = z.object({
  policyUuid: z.string().uuid(),
  versionNumber: z.number().int().positive(),
  incentiveSku: z.string().regex(/^[A-Z0-9][A-Z0-9_-]{0,79}$/),
  grants: z.array(z.object({
    slotKey: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/),
    deliverable: WagsDeliverableSchema,
  }).strict()).min(1).max(50),
}).strict().superRefine((value, context) => {
  const slots = value.grants.map((grant) => grant.slotKey);
  if (new Set(slots).size !== slots.length) {
    context.addIssue({ code: "custom", message: "Annual incentive slotKey values must be unique." });
  }
});

export const SubscriptionLifecycleEventSchema = z.discriminatedUnion("type", [
  z.object({ eventId: z.string().trim().min(1).max(200), occurredAt: WagsIsoDateTimeSchema, type: z.literal("payment_succeeded") }).strict(),
  z.object({ eventId: z.string().trim().min(1).max(200), occurredAt: WagsIsoDateTimeSchema, type: z.literal("payment_failed") }).strict(),
  z.object({ eventId: z.string().trim().min(1).max(200), occurredAt: WagsIsoDateTimeSchema, type: z.literal("cancel_requested"), mode: z.enum(["immediate", "period_end"]), effectiveAt: WagsIsoDateTimeSchema }).strict(),
  z.object({ eventId: z.string().trim().min(1).max(200), occurredAt: WagsIsoDateTimeSchema, type: z.literal("resumed") }).strict(),
  z.object({ eventId: z.string().trim().min(1).max(200), occurredAt: WagsIsoDateTimeSchema, type: z.literal("service_period_ended") }).strict(),
]);

export type WagsDeliverable = z.infer<typeof WagsDeliverableSchema>;
export type WagsAssetDeliverable = z.infer<typeof WagsAssetDeliverableSchema>;
export type WagsPackVersionInput = z.infer<typeof WagsPackVersionInputSchema>;
export type SealedWagsPackVersion = z.infer<typeof SealedWagsPackVersionSchema>;
export type EntitlementPeriod = z.infer<typeof EntitlementPeriodSchema>;
export type WagsSubscription = z.infer<typeof WagsSubscriptionSchema>;
export type PaymentCoverage = z.infer<typeof PaymentCoverageSchema>;
export type ExistingGrant = z.infer<typeof ExistingGrantSchema>;
export type PlannedGrant = z.infer<typeof PlannedGrantSchema>;
export type GrantPlan = z.infer<typeof GrantPlanSchema>;
export type AnnualIncentivePolicy = z.infer<typeof AnnualIncentivePolicySchema>;
export type SubscriptionLifecycleEvent = z.infer<typeof SubscriptionLifecycleEventSchema>;
