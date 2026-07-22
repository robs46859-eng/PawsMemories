import crypto from "node:crypto";
import Stripe from "stripe";
import {
  NormalizedStripeEventSchema,
  PublicUuidSchema,
  type NormalizedStripeEvent,
} from "./apiContracts.ts";
import type {
  CheckoutProviderPort,
  StripeWebhookVerifierPort,
  SubscriptionReconciliationProviderPort,
} from "./repository.ts";
import { hashIdentity } from "./identity.ts";

interface ReconciliationRecorder {
  beginReconciliation(input: {
    reconciliationUuid: string;
    subscriptionUuid: string;
    reason: string;
  }): Promise<void>;
  finishReconciliation(input: {
    reconciliationUuid: string;
    providerSnapshotHash?: string;
    providerEventId?: string;
    failureCode?: string;
  }): Promise<void>;
}

export interface StripeCheckoutMetadata {
  checkoutUuid: string;
  subscriptionUuid: string;
  ownerUuid: string;
  planUuid: string;
  planVersionNumber: number;
  cadence: "monthly" | "annual_prepaid";
}

interface CheckoutMetadataResolver {
  getStripeCheckoutMetadata(checkoutUuid: string, ownerUuid: string): Promise<StripeCheckoutMetadata>;
}

interface SubscriptionBootstrapper {
  ensureSubscriptionFromStripe(input: StripeCheckoutMetadata & {
    providerSubscriptionRef: string;
    serviceStartsAt: string;
    serviceEndsAt: string;
  }): Promise<void>;
}

function deterministicUuid(seed: string): string {
  const bytes = Buffer.from(crypto.createHash("sha256").update(seed).digest().subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function isoFromUnix(value: unknown, field: string): string {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) throw new Error(`Stripe ${field} is missing or invalid.`);
  return new Date(Number(value) * 1000).toISOString();
}

function metadataUuid(object: any): string {
  return PublicUuidSchema.parse(object?.metadata?.wags_subscription_uuid);
}

function checkoutMetadata(object: any): StripeCheckoutMetadata {
  const version = Number(object?.metadata?.wags_plan_version_number);
  const cadence = object?.metadata?.wags_cadence;
  if (!Number.isSafeInteger(version) || version <= 0) throw new Error("Stripe Wags plan version metadata is invalid.");
  if (cadence !== "monthly" && cadence !== "annual_prepaid") throw new Error("Stripe Wags cadence metadata is invalid.");
  return {
    checkoutUuid: PublicUuidSchema.parse(object?.metadata?.wags_checkout_uuid),
    subscriptionUuid: PublicUuidSchema.parse(object?.metadata?.wags_subscription_uuid),
    ownerUuid: PublicUuidSchema.parse(object?.metadata?.wags_owner_uuid),
    planUuid: PublicUuidSchema.parse(object?.metadata?.wags_plan_uuid),
    planVersionNumber: version,
    cadence,
  };
}

function objectId(value: unknown): string {
  if (typeof value === "string" && value) return value;
  if (value && typeof value === "object" && typeof (value as { id?: unknown }).id === "string") {
    return (value as { id: string }).id;
  }
  throw new Error("Stripe subscription reference is missing.");
}

function invoiceSubscription(invoice: any): { id: string; metadata: Record<string, string> } {
  const direct = invoice.subscription;
  if (direct) {
    return {
      id: objectId(direct),
      metadata: typeof direct === "object" && direct.metadata ? direct.metadata : invoice.subscription_details?.metadata || {},
    };
  }
  const nested = invoice.parent?.subscription_details?.subscription;
  return {
    id: objectId(nested),
    metadata: invoice.parent?.subscription_details?.metadata || invoice.subscription_details?.metadata || {},
  };
}

function invoicePeriod(invoice: any): { startsAt: string; endsAt: string } {
  const recurringLine = invoice.lines?.data?.find((line: any) => line.period?.start && line.period?.end);
  if (!recurringLine) throw new Error("Stripe invoice lacks service-period evidence.");
  return {
    startsAt: isoFromUnix(recurringLine.period.start, "invoice period start"),
    endsAt: isoFromUnix(recurringLine.period.end, "invoice period end"),
  };
}

function subscriptionPeriod(subscription: any): { startsAt: string; endsAt: string } {
  const item = subscription.items?.data?.[0];
  const starts = subscription.current_period_start ?? item?.current_period_start;
  const ends = subscription.current_period_end ?? item?.current_period_end;
  return {
    startsAt: isoFromUnix(starts, "subscription period start"),
    endsAt: isoFromUnix(ends, "subscription period end"),
  };
}

function normalizeInvoice(event: Stripe.Event, invoice: any): NormalizedStripeEvent {
  const subscription = invoiceSubscription(invoice);
  const subscriptionUuid = PublicUuidSchema.parse(
    invoice.metadata?.wags_subscription_uuid || subscription.metadata?.wags_subscription_uuid,
  );
  const occurredAt = isoFromUnix(event.created, "event timestamp");
  if (event.type === "invoice.paid" || event.type === "invoice.payment_succeeded") {
    const period = invoicePeriod(invoice);
    return NormalizedStripeEventSchema.parse({
      schemaVersion: "wags.stripe-event.v1",
      providerEventId: event.id,
      providerSubscriptionRef: subscription.id,
      subscriptionUuid,
      lifecycleEvent: { eventId: event.id, occurredAt, type: "payment_succeeded" },
      paymentCoverage: {
        paymentUuid: deterministicUuid(`stripe-payment:${event.id}`),
        status: "paid",
        coversFrom: period.startsAt,
        coversUntil: period.endsAt,
      },
    });
  }
  if (event.type === "invoice.payment_failed") {
    return NormalizedStripeEventSchema.parse({
      schemaVersion: "wags.stripe-event.v1",
      providerEventId: event.id,
      providerSubscriptionRef: subscription.id,
      subscriptionUuid,
      lifecycleEvent: { eventId: event.id, occurredAt, type: "payment_failed" },
      paymentCoverage: null,
    });
  }
  throw new Error(`Unsupported Stripe invoice event: ${event.type}`);
}

function lifecycleForSubscription(subscription: any, eventId: string, occurredAt: string) {
  const period = subscriptionPeriod(subscription);
  if (subscription.status === "canceled") {
    return { eventId, occurredAt, type: "service_period_ended" as const };
  }
  if (subscription.cancel_at_period_end) {
    return {
      eventId,
      occurredAt,
      type: "cancel_requested" as const,
      mode: "period_end" as const,
      effectiveAt: period.endsAt,
    };
  }
  if (["past_due", "unpaid", "incomplete", "incomplete_expired", "paused"].includes(subscription.status)) {
    return { eventId, occurredAt, type: "payment_failed" as const };
  }
  if (["active", "trialing"].includes(subscription.status)) {
    return { eventId, occurredAt, type: "resumed" as const };
  }
  throw new Error(`Unsupported Stripe subscription status: ${subscription.status}`);
}

function normalizeSubscription(event: Stripe.Event, subscription: any): NormalizedStripeEvent {
  const subscriptionUuid = metadataUuid(subscription);
  const occurredAt = isoFromUnix(event.created, "event timestamp");
  return NormalizedStripeEventSchema.parse({
    schemaVersion: "wags.stripe-event.v1",
    providerEventId: event.id,
    providerSubscriptionRef: objectId(subscription),
    subscriptionUuid,
    lifecycleEvent: lifecycleForSubscription(subscription, event.id, occurredAt),
    paymentCoverage: null,
  });
}

export function normalizeStripeEvent(event: Stripe.Event): NormalizedStripeEvent {
  if (event.type === "invoice.paid" || event.type === "invoice.payment_succeeded" || event.type === "invoice.payment_failed") {
    return normalizeInvoice(event, event.data.object);
  }
  if (event.type === "customer.subscription.created" || event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted") {
    return normalizeSubscription(event, event.data.object);
  }
  throw new Error(`Unsupported Stripe event type: ${event.type}`);
}

export class StripeWagsWebhookVerifier implements StripeWebhookVerifierPort {
  constructor(
    private readonly stripe: Stripe,
    private readonly webhookSecret: string,
    private readonly subscriptionBootstrapper?: SubscriptionBootstrapper,
  ) {
    if (!webhookSecret) throw new Error("WAGS_STRIPE_WEBHOOK_SECRET is required.");
  }

  async verifyAndNormalize(rawBody: Buffer, signature: string): Promise<NormalizedStripeEvent> {
    if (!Buffer.isBuffer(rawBody)) throw new Error("Stripe webhook body must be raw bytes.");
    if (!signature) throw new Error("Stripe signature is required.");
    const event = this.stripe.webhooks.constructEvent(rawBody, signature, this.webhookSecret);
    const normalized = normalizeStripeEvent(event);
    if (event.type === "customer.subscription.created" && this.subscriptionBootstrapper) {
      const subscription: any = event.data.object;
      const period = subscriptionPeriod(subscription);
      await this.subscriptionBootstrapper.ensureSubscriptionFromStripe({
        ...checkoutMetadata(subscription),
        providerSubscriptionRef: objectId(subscription),
        serviceStartsAt: period.startsAt,
        serviceEndsAt: period.endsAt,
      });
    }
    return normalized;
  }
}

export class StripeWagsCheckoutProvider implements CheckoutProviderPort {
  constructor(
    private readonly stripe: Stripe,
    private readonly metadataResolver: CheckoutMetadataResolver,
  ) {}

  async createCheckoutSession(input: {
    checkoutUuid: string;
    ownerUuid: string;
    providerPriceRef: string;
    cadence: CreateCheckoutCadence;
    successUrl: string;
    cancelUrl: string;
    idempotencyKey: string;
  }) {
    const checkoutUuid = PublicUuidSchema.parse(input.checkoutUuid);
    const ownerUuid = PublicUuidSchema.parse(input.ownerUuid);
    const metadata = await this.metadataResolver.getStripeCheckoutMetadata(checkoutUuid, ownerUuid);
    if (metadata.checkoutUuid !== checkoutUuid || metadata.ownerUuid !== ownerUuid || metadata.cadence !== input.cadence) {
      throw new Error("Checkout provider metadata does not match the durable reservation.");
    }
    const session = await this.stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: input.providerPriceRef, quantity: 1 }],
      client_reference_id: ownerUuid,
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      metadata: {
        wags_checkout_uuid: metadata.checkoutUuid,
        wags_subscription_uuid: metadata.subscriptionUuid,
        wags_owner_uuid: metadata.ownerUuid,
        wags_plan_uuid: metadata.planUuid,
        wags_plan_version_number: String(metadata.planVersionNumber),
        wags_cadence: metadata.cadence,
      },
      subscription_data: {
        metadata: {
          wags_checkout_uuid: metadata.checkoutUuid,
          wags_subscription_uuid: metadata.subscriptionUuid,
          wags_owner_uuid: metadata.ownerUuid,
          wags_plan_uuid: metadata.planUuid,
          wags_plan_version_number: String(metadata.planVersionNumber),
          wags_cadence: metadata.cadence,
        },
      },
    }, { idempotencyKey: `wags:${input.idempotencyKey}` });
    if (!session.url || !session.expires_at) throw new Error("Stripe returned an incomplete checkout session.");
    return {
      providerSessionRef: session.id,
      checkoutUrl: session.url,
      expiresAt: isoFromUnix(session.expires_at, "checkout expiration"),
    };
  }
}

type CreateCheckoutCadence = "monthly" | "annual_prepaid";

export class StripeWagsReconciliationProvider implements SubscriptionReconciliationProviderPort {
  constructor(
    private readonly stripe: Stripe,
    private readonly recorder?: ReconciliationRecorder,
  ) {}

  async fetchVerifiedSnapshot(input: {
    subscriptionUuid: string;
    providerSubscriptionRef: string;
    reason: "manual" | "scheduled" | "missing_webhook";
  }): Promise<NormalizedStripeEvent> {
    const subscriptionUuid = PublicUuidSchema.parse(input.subscriptionUuid);
    const reconciliationUuid = crypto.randomUUID();
    await this.recorder?.beginReconciliation({ reconciliationUuid, subscriptionUuid, reason: input.reason });
    try {
      // This provider call is deliberately outside a repository transaction.
      const subscription: any = await this.stripe.subscriptions.retrieve(input.providerSubscriptionRef, {
        expand: ["items.data.price"],
      });
      if (objectId(subscription) !== input.providerSubscriptionRef || metadataUuid(subscription) !== subscriptionUuid) {
        throw new Error("Stripe subscription snapshot does not match the requested Wags subscription.");
      }
      const period = subscriptionPeriod(subscription);
      const providerEventId = [
        "reconcile",
        subscription.id,
        subscription.status,
        String(subscription.cancel_at_period_end),
        period.endsAt,
      ].join(":").slice(0, 200);
      const snapshot = NormalizedStripeEventSchema.parse({
        schemaVersion: "wags.stripe-event.v1",
        providerEventId,
        providerSubscriptionRef: subscription.id,
        subscriptionUuid,
        lifecycleEvent: lifecycleForSubscription(subscription, providerEventId, new Date().toISOString()),
        paymentCoverage: null,
      });
      await this.recorder?.finishReconciliation({
        reconciliationUuid,
        providerSnapshotHash: hashIdentity(snapshot),
        providerEventId,
      });
      return snapshot;
    } catch (error) {
      await this.recorder?.finishReconciliation({
        reconciliationUuid,
        failureCode: "stripe_snapshot_failed",
      }).catch(() => undefined);
      throw error;
    }
  }
}
