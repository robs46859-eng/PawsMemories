import { z } from "zod";
import {
  AnnualIncentivePolicySchema,
  PaymentCoverageSchema,
  PeriodKeySchema,
  SealedWagsPackVersionSchema,
  SubscriptionLifecycleEventSchema,
  WagsIsoDateTimeSchema,
  WagsSubscriptionSchema,
} from "./contracts.ts";

export const PublicUuidSchema = z.string().uuid();
export const PublicVersionSchema = z.number().int().positive();
export const WagsIdempotencyKeySchema = z.string().trim().min(8).max(160)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);

export const ListPublishedPacksQuerySchema = z.object({
  periodKey: PeriodKeySchema.optional(),
  tier: z.enum(["basic", "plus"]).optional(),
  cursor: z.string().trim().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
}).strict();

export const PublishedPackSummarySchema = z.object({
  packUuid: PublicUuidSchema,
  versionNumber: PublicVersionSchema,
  releasePeriod: PeriodKeySchema,
  title: z.string().trim().min(1).max(160),
  tier: z.enum(["basic", "plus"]),
  packHash: z.string().regex(/^[a-f0-9]{64}$/),
  publishedAt: WagsIsoDateTimeSchema,
}).strict();

export const PublishedPackPageSchema = z.object({
  items: z.array(PublishedPackSummarySchema).max(50),
  nextCursor: z.string().trim().min(1).max(512).nullable(),
}).strict();

export const PackIdentityParamsSchema = z.object({
  packUuid: PublicUuidSchema,
  versionNumber: z.coerce.number().int().positive(),
}).strict();

export const SubscriptionIdentityParamsSchema = z.object({
  subscriptionUuid: PublicUuidSchema,
}).strict();

export const PeriodDeliveryParamsSchema = z.object({
  subscriptionUuid: PublicUuidSchema,
  periodKey: PeriodKeySchema,
}).strict();

export const DeliverPeriodRequestSchema = z.object({
  packUuid: PublicUuidSchema,
  packVersionNumber: PublicVersionSchema,
}).strict();

export const DeliveryResultSchema = z.object({
  subscriptionUuid: PublicUuidSchema,
  periodKey: PeriodKeySchema,
  disposition: z.enum(["delivered", "replayed", "held", "skipped"]),
  reason: z.string().trim().min(1).max(500),
  deliveryIdentity: z.string().regex(/^wags-delivery-v1-[a-f0-9]{64}$/).nullable(),
  insertedGrantCount: z.number().int().nonnegative(),
  existingGrantCount: z.number().int().nonnegative(),
  skippedSlots: z.array(z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/)),
}).strict();

export const DeliverAnnualIncentiveRequestSchema = z.object({
  policyUuid: PublicUuidSchema,
  policyVersionNumber: PublicVersionSchema,
  paymentUuid: PublicUuidSchema,
  termStartsAt: WagsIsoDateTimeSchema,
  termEndsAt: WagsIsoDateTimeSchema,
}).strict().refine((value) => Date.parse(value.termStartsAt) < Date.parse(value.termEndsAt), {
  message: "Annual incentive term must be a positive interval.",
});

export const AnnualIncentiveResultSchema = z.object({
  subscriptionUuid: PublicUuidSchema,
  policyUuid: PublicUuidSchema,
  policyVersionNumber: PublicVersionSchema,
  deliveryIdentity: z.string().regex(/^wags-delivery-v1-[a-f0-9]{64}$/),
  disposition: z.enum(["delivered", "replayed"]),
  insertedGrantCount: z.number().int().nonnegative(),
  existingGrantCount: z.number().int().nonnegative(),
}).strict();

export const CreateCheckoutRequestSchema = z.object({
  planUuid: PublicUuidSchema,
  planVersionNumber: PublicVersionSchema,
  cadence: z.enum(["monthly", "annual_prepaid"]),
  idempotencyKey: WagsIdempotencyKeySchema,
  successUrl: z.string().url().max(2048),
  cancelUrl: z.string().url().max(2048),
}).strict().superRefine((value, context) => {
  for (const [field, url] of [["successUrl", value.successUrl], ["cancelUrl", value.cancelUrl]] as const) {
    if (!url.startsWith("https://") && process.env.NODE_ENV === "production") {
      context.addIssue({ code: "custom", path: [field], message: "Checkout return URLs must use HTTPS in production." });
    }
  }
});

export const CheckoutSessionResponseSchema = z.object({
  checkoutUuid: PublicUuidSchema,
  checkoutUrl: z.string().url().max(2048),
  expiresAt: WagsIsoDateTimeSchema,
  replayed: z.boolean(),
}).strict();

const NormalizedStripeEventShape = {
  schemaVersion: z.literal("wags.stripe-event.v1"),
  providerEventId: z.string().trim().min(1).max(200),
  providerSubscriptionRef: z.string().trim().min(1).max(255),
  subscriptionUuid: PublicUuidSchema,
  lifecycleEvent: SubscriptionLifecycleEventSchema,
  paymentCoverage: PaymentCoverageSchema.nullable(),
} as const;

function validateNormalizedStripeEvidence(
  value: {
    providerEventId: string;
    lifecycleEvent?: z.infer<typeof SubscriptionLifecycleEventSchema>;
    paymentCoverage?: z.infer<typeof PaymentCoverageSchema> | null;
  },
  context: z.RefinementCtx,
): void {
  if (!value.lifecycleEvent) return;
  if (value.providerEventId !== value.lifecycleEvent.eventId) {
    context.addIssue({ code: "custom", path: ["lifecycleEvent", "eventId"], message: "Lifecycle event ID must match the authenticated provider event ID." });
  }
  if (value.lifecycleEvent.type === "payment_succeeded" && value.paymentCoverage?.status !== "paid") {
    context.addIssue({ code: "custom", path: ["paymentCoverage"], message: "Successful payment evidence must include paid coverage." });
  }
}

export const NormalizedStripeEventSchema = z.object(NormalizedStripeEventShape)
  .strict()
  .superRefine(validateNormalizedStripeEvidence);

export const LifecycleProcessingResultSchema = z.object({
  subscriptionUuid: PublicUuidSchema,
  providerEventId: z.string().trim().min(1).max(200),
  disposition: z.enum(["applied", "duplicate", "ignored_out_of_order", "ignored_terminal"]),
  status: WagsSubscriptionSchema.shape.status,
  changed: z.boolean(),
}).strict();

export const ReconcileSubscriptionRequestSchema = z.object({
  reason: z.enum(["manual", "scheduled", "missing_webhook"]).default("manual"),
}).strict();

export const WagsCheckoutPlanRecordSchema = z.object({
  planUuid: PublicUuidSchema,
  versionNumber: PublicVersionSchema,
  cadence: z.enum(["monthly", "annual_prepaid"]),
  active: z.boolean(),
  providerPriceRef: z.string().trim().min(1).max(255),
}).strict();

export const WagsCheckoutPlanSummarySchema = WagsCheckoutPlanRecordSchema.omit({
  providerPriceRef: true,
}).extend({
  tier: z.enum(["basic", "plus"]),
}).strict();

export const WagsSubscriptionRecordSchema = WagsSubscriptionSchema.extend({
  providerSubscriptionRef: z.string().trim().min(1).max(255),
}).strict();

export const CheckoutReservationSchema = z.object({
  checkoutUuid: PublicUuidSchema,
  ownerUuid: PublicUuidSchema,
  requestHash: z.string().regex(/^[a-f0-9]{64}$/),
  state: z.enum(["reserved", "complete", "failed"]),
  providerSessionRef: z.string().trim().min(1).max(255).nullable(),
  checkoutUrl: z.string().url().max(2048).nullable(),
  expiresAt: WagsIsoDateTimeSchema.nullable(),
}).strict();

// Reconciliation shares the evidence contract but has distinct provenance.
// Build a fresh object so Zod does not discard or overwrite the refinements.
export const VerifiedReconciliationSnapshotSchema = z.object({
  ...NormalizedStripeEventShape,
  schemaVersion: z.literal("wags.reconciliation.v1"),
}).strict().superRefine(validateNormalizedStripeEvidence);

export type ListPublishedPacksQuery = z.infer<typeof ListPublishedPacksQuerySchema>;
export type PublishedPackPage = z.infer<typeof PublishedPackPageSchema>;
export type DeliverPeriodRequest = z.infer<typeof DeliverPeriodRequestSchema>;
export type DeliveryResult = z.infer<typeof DeliveryResultSchema>;
export type DeliverAnnualIncentiveRequest = z.infer<typeof DeliverAnnualIncentiveRequestSchema>;
export type AnnualIncentiveResult = z.infer<typeof AnnualIncentiveResultSchema>;
export type CreateCheckoutRequest = z.infer<typeof CreateCheckoutRequestSchema>;
export type CheckoutSessionResponse = z.infer<typeof CheckoutSessionResponseSchema>;
export type WagsCheckoutPlanSummary = z.infer<typeof WagsCheckoutPlanSummarySchema>;
export type NormalizedStripeEvent = z.infer<typeof NormalizedStripeEventSchema>;
export type LifecycleProcessingResult = z.infer<typeof LifecycleProcessingResultSchema>;
export type WagsCheckoutPlanRecord = z.infer<typeof WagsCheckoutPlanRecordSchema>;
export type WagsSubscriptionRecord = z.infer<typeof WagsSubscriptionRecordSchema>;
export type CheckoutReservation = z.infer<typeof CheckoutReservationSchema>;
export type VerifiedReconciliationSnapshot = z.infer<typeof VerifiedReconciliationSnapshotSchema>;
export type AnnualIncentivePolicyRecord = z.infer<typeof AnnualIncentivePolicySchema>;
export type PublishedPackVersion = z.infer<typeof SealedWagsPackVersionSchema>;
