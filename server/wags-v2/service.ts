import crypto from "node:crypto";
import { z } from "zod";
import {
  AnnualIncentiveResultSchema,
  CheckoutReservationSchema,
  CheckoutSessionResponseSchema,
  CreateCheckoutRequestSchema,
  DeliverAnnualIncentiveRequestSchema,
  DeliverPeriodRequestSchema,
  DeliveryResultSchema,
  LifecycleProcessingResultSchema,
  ListPublishedPacksQuerySchema,
  NormalizedStripeEventSchema,
  PublishedPackPageSchema,
  PublicUuidSchema,
  ReconcileSubscriptionRequestSchema,
  WagsCheckoutPlanRecordSchema,
  WagsSubscriptionRecordSchema,
  type AnnualIncentiveResult,
  type CheckoutSessionResponse,
  type CreateCheckoutRequest,
  type DeliverAnnualIncentiveRequest,
  type DeliverPeriodRequest,
  type DeliveryResult,
  type LifecycleProcessingResult,
  type ListPublishedPacksQuery,
  type NormalizedStripeEvent,
  type PublishedPackPage,
} from "./apiContracts.ts";
import {
  PaymentCoverageSchema,
  SealedWagsPackVersionSchema,
  WagsSubscriptionSchema,
  type SealedWagsPackVersion,
  type WagsSubscription,
} from "./contracts.ts";
import {
  buildMonthlyEntitlementPeriods,
  decidePeriodEntitlement,
  planAnnualIncentive,
  planPackGrants,
  verifyPackVersion,
} from "./entitlements.ts";
import { annualIncentiveDeliveryIdentity, deliveryIdentity, hashIdentity } from "./identity.ts";
import { applySubscriptionLifecycleEvent } from "./lifecycle.ts";
import {
  persistAnnualIncentiveExactlyOnce,
  persistGrantPlanExactlyOnce,
} from "./ports.ts";
import type {
  CheckoutProviderPort,
  StripeWebhookVerifierPort,
  SubscriptionReconciliationProviderPort,
  WagsApiRepositoryPort,
  WagsSubscriptionTransactionPort,
} from "./repository.ts";

export type WagsApiErrorCode =
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "INVALID_STATE"
  | "PAYMENT_REQUIRED"
  | "PACK_INELIGIBLE"
  | "HASH_MISMATCH"
  | "IDEMPOTENCY_CONFLICT"
  | "CHECKOUT_IN_PROGRESS"
  | "PROVIDER_UNAVAILABLE"
  | "WEBHOOK_UNAUTHORIZED"
  | "RAW_BODY_REQUIRED";

export class WagsApiError extends Error {
  constructor(message: string, public readonly code: WagsApiErrorCode) {
    super(message);
    this.name = "WagsApiError";
  }
}

const CheckoutProviderResultSchema = z.object({
  providerSessionRef: z.string().trim().min(1).max(255),
  checkoutUrl: z.string().url().max(2048),
  expiresAt: z.string().datetime({ offset: true }),
}).strict();

export interface WagsApiServiceDependencies {
  repository: WagsApiRepositoryPort;
  checkoutProvider: CheckoutProviderPort;
  stripeVerifier: StripeWebhookVerifierPort;
  reconciliationProvider: SubscriptionReconciliationProviderPort;
  now?: () => Date;
  randomUuid?: () => string;
}

export class WagsApiService {
  private readonly now: () => Date;
  private readonly randomUuid: () => string;

  constructor(private readonly dependencies: WagsApiServiceDependencies) {
    this.now = dependencies.now || (() => new Date());
    this.randomUuid = dependencies.randomUuid || crypto.randomUUID;
  }

  async listPublishedPacks(rawQuery: ListPublishedPacksQuery): Promise<PublishedPackPage> {
    const query = ListPublishedPacksQuerySchema.parse(rawQuery);
    return PublishedPackPageSchema.parse(await this.dependencies.repository.listPublishedPackVersions(query));
  }

  async listActivePlans() {
    return this.dependencies.repository.listActiveCheckoutPlans();
  }

  async listSubscriptions(ownerUuid: string) {
    const owner = PublicUuidSchema.parse(ownerUuid);
    const subscriptions = await this.dependencies.repository.listSubscriptionsForOwner(owner);
    return subscriptions.map(publicSubscription);
  }

  async getPublishedPack(packUuid: string, versionNumber: number): Promise<SealedWagsPackVersion> {
    const uuid = PublicUuidSchema.parse(packUuid);
    const version = z.number().int().positive().parse(versionNumber);
    const pack = await this.dependencies.repository.getPublishedPackVersion(uuid, version);
    if (!pack) throw new WagsApiError("Published pack version was not found.", "NOT_FOUND");
    const parsed = SealedWagsPackVersionSchema.parse(pack);
    if (!verifyPackVersion(parsed)) throw new WagsApiError("Published pack hash does not match its immutable contents.", "HASH_MISMATCH");
    return parsed;
  }

  async getSubscription(ownerUuid: string, subscriptionUuid: string): Promise<WagsSubscription> {
    const subscription = await this.requireOwnedSubscription(ownerUuid, subscriptionUuid);
    return publicSubscription(subscription);
  }

  async createCheckout(ownerUuid: string, rawRequest: CreateCheckoutRequest): Promise<CheckoutSessionResponse> {
    const owner = PublicUuidSchema.parse(ownerUuid);
    const request = CreateCheckoutRequestSchema.parse(rawRequest);
    const plan = await this.dependencies.repository.getCheckoutPlan(request.planUuid, request.planVersionNumber, request.cadence);
    if (!plan) throw new WagsApiError("Subscription plan version was not found.", "NOT_FOUND");
    const parsedPlan = WagsCheckoutPlanRecordSchema.parse(plan);
    if (!parsedPlan.active) throw new WagsApiError("Subscription plan version is not available for checkout.", "INVALID_STATE");

    const requestHash = hashIdentity(request);
    const reserved = await this.dependencies.repository.reserveCheckout({
      checkoutUuid: this.randomUuid(),
      ownerUuid: owner,
      idempotencyKey: request.idempotencyKey,
      requestHash,
      request,
    });
    const reservation = CheckoutReservationSchema.parse(reserved.reservation);
    if (reservation.ownerUuid !== owner || reservation.requestHash !== requestHash) {
      throw new WagsApiError("Checkout idempotency key was reused with different input.", "IDEMPOTENCY_CONFLICT");
    }
    if (reserved.disposition === "existing") {
      if (reservation.state !== "complete" || !reservation.checkoutUrl || !reservation.expiresAt) {
        throw new WagsApiError("An identical checkout request is already being created.", "CHECKOUT_IN_PROGRESS");
      }
      return CheckoutSessionResponseSchema.parse({
        checkoutUuid: reservation.checkoutUuid,
        checkoutUrl: reservation.checkoutUrl,
        expiresAt: reservation.expiresAt,
        replayed: true,
      });
    }

    try {
      // The provider call is deliberately outside every repository transaction.
      const providerResult = CheckoutProviderResultSchema.parse(await this.dependencies.checkoutProvider.createCheckoutSession({
        checkoutUuid: reservation.checkoutUuid,
        ownerUuid: owner,
        providerPriceRef: parsedPlan.providerPriceRef,
        cadence: request.cadence,
        successUrl: request.successUrl,
        cancelUrl: request.cancelUrl,
        idempotencyKey: request.idempotencyKey,
      }));
      const completed = CheckoutReservationSchema.parse(await this.dependencies.repository.completeCheckout({
        checkoutUuid: reservation.checkoutUuid,
        ...providerResult,
      }));
      return CheckoutSessionResponseSchema.parse({
        checkoutUuid: completed.checkoutUuid,
        checkoutUrl: completed.checkoutUrl,
        expiresAt: completed.expiresAt,
        replayed: false,
      });
    } catch (error) {
      await this.dependencies.repository.failCheckout(reservation.checkoutUuid, "provider_or_persistence_failure").catch(() => undefined);
      if (error instanceof WagsApiError || error instanceof z.ZodError) throw error;
      throw new WagsApiError("Checkout provider is temporarily unavailable.", "PROVIDER_UNAVAILABLE");
    }
  }

  async deliverSubscriptionPeriod(
    ownerUuid: string,
    subscriptionUuid: string,
    periodKey: string,
    rawRequest: DeliverPeriodRequest,
  ): Promise<DeliveryResult> {
    const owner = PublicUuidSchema.parse(ownerUuid);
    const request = DeliverPeriodRequestSchema.parse(rawRequest);
    const subscription = await this.requireOwnedSubscription(owner, subscriptionUuid);
    const domainSubscription = publicSubscription(subscription);
    const period = buildMonthlyEntitlementPeriods(subscription.serviceStartsAt, subscription.serviceEndsAt)
      .find((candidate) => candidate.periodKey === periodKey);
    if (!period) throw new WagsApiError("Entitlement period is outside the subscription term.", "NOT_FOUND");
    const payment = await this.dependencies.repository.getPaymentCoverageForPeriod(
      subscription.subscriptionUuid,
      period.startsAt,
      period.endsAt,
    );
    const decision = decidePeriodEntitlement({ subscription: domainSubscription, period, payment });
    if (decision.action !== "deliver") {
      return DeliveryResultSchema.parse({
        subscriptionUuid: subscription.subscriptionUuid,
        periodKey: period.periodKey,
        disposition: decision.action === "hold" ? "held" : "skipped",
        reason: decision.reason,
        deliveryIdentity: null,
        insertedGrantCount: 0,
        existingGrantCount: 0,
        skippedSlots: [],
      });
    }

    const pack = await this.getPublishedPack(request.packUuid, request.packVersionNumber);
    if (pack.releasePeriod !== period.periodKey) {
      throw new WagsApiError("Pack release period does not match the requested entitlement period.", "PACK_INELIGIBLE");
    }
    if (!await this.dependencies.repository.isPackEligibleForSubscription(domainSubscription, pack)) {
      throw new WagsApiError("Pack tier is not included in this subscription plan version.", "PACK_INELIGIBLE");
    }
    const stableDeliveryIdentity = deliveryIdentity({
      subscriptionUuid: subscription.subscriptionUuid,
      periodKey: period.periodKey,
      packUuid: pack.packUuid,
      packVersionNumber: pack.versionNumber,
    });
    const [ownedDeliverableKeys, existingGrants] = await Promise.all([
      this.dependencies.repository.listOwnedDeliverableKeys(owner),
      this.dependencies.repository.listExistingGrants(stableDeliveryIdentity),
    ]);
    const plan = planPackGrants({ subscription: domainSubscription, period, pack, ownedDeliverableKeys, existingGrants });
    const persisted = await persistGrantPlanExactlyOnce(this.dependencies.repository, plan);
    const inserted = persisted.insertedGrantIdentities.length;
    return DeliveryResultSchema.parse({
      subscriptionUuid: subscription.subscriptionUuid,
      periodKey: period.periodKey,
      disposition: inserted > 0 ? "delivered" : "replayed",
      reason: inserted > 0 ? "Paid period grants were persisted exactly once." : "Existing period grants were replayed without duplication.",
      deliveryIdentity: persisted.deliveryIdentity,
      insertedGrantCount: inserted,
      existingGrantCount: persisted.existingGrantIdentities.length,
      skippedSlots: plan.skippedSlots.map((item) => item.slotKey),
    });
  }

  async deliverAnnualIncentive(
    ownerUuid: string,
    subscriptionUuid: string,
    rawRequest: DeliverAnnualIncentiveRequest,
  ): Promise<AnnualIncentiveResult> {
    const request = DeliverAnnualIncentiveRequestSchema.parse(rawRequest);
    const subscription = await this.requireOwnedSubscription(ownerUuid, subscriptionUuid);
    const domainSubscription = publicSubscription(subscription);
    const [payment, policy] = await Promise.all([
      this.dependencies.repository.getPaymentCoverageByUuid(subscription.subscriptionUuid, request.paymentUuid),
      this.dependencies.repository.getAnnualIncentivePolicy(request.policyUuid, request.policyVersionNumber),
    ]);
    if (!payment) throw new WagsApiError("Paid annual coverage was not found.", "PAYMENT_REQUIRED");
    const parsedPayment = PaymentCoverageSchema.parse(payment);
    if (!policy) throw new WagsApiError("Annual incentive policy version was not found.", "NOT_FOUND");
    const stableDeliveryIdentity = annualIncentiveDeliveryIdentity({
      subscriptionUuid: subscription.subscriptionUuid,
      termStartsAt: request.termStartsAt,
      termEndsAt: request.termEndsAt,
      policyUuid: request.policyUuid,
      policyVersionNumber: request.policyVersionNumber,
    });
    const existingGrants = await this.dependencies.repository.listExistingGrants(stableDeliveryIdentity);
    let plan;
    try {
      plan = planAnnualIncentive({
        subscription: domainSubscription,
        termStartsAt: request.termStartsAt,
        termEndsAt: request.termEndsAt,
        payment: parsedPayment,
        policy,
        existingGrants,
      });
    } catch (error) {
      throw new WagsApiError(error instanceof Error ? error.message : "Annual incentive is not earned.", "PAYMENT_REQUIRED");
    }
    const persisted = await persistAnnualIncentiveExactlyOnce(this.dependencies.repository, {
      ...plan,
      subscriptionUuid: subscription.subscriptionUuid,
      policyUuid: request.policyUuid,
      policyVersionNumber: request.policyVersionNumber,
      termStartsAt: request.termStartsAt,
      termEndsAt: request.termEndsAt,
    });
    return AnnualIncentiveResultSchema.parse({
      subscriptionUuid: subscription.subscriptionUuid,
      policyUuid: request.policyUuid,
      policyVersionNumber: request.policyVersionNumber,
      deliveryIdentity: persisted.deliveryIdentity,
      disposition: persisted.insertedGrantIdentities.length > 0 ? "delivered" : "replayed",
      insertedGrantCount: persisted.insertedGrantIdentities.length,
      existingGrantCount: persisted.existingGrantIdentities.length,
    });
  }

  async handleStripeWebhook(rawBody: Buffer, signature: string): Promise<LifecycleProcessingResult> {
    if (!Buffer.isBuffer(rawBody)) throw new WagsApiError("Stripe webhook requires the unmodified request bytes.", "RAW_BODY_REQUIRED");
    if (!signature) throw new WagsApiError("Stripe signature is required.", "WEBHOOK_UNAUTHORIZED");
    let event: NormalizedStripeEvent;
    try {
      // Signature verification and normalization happen before opening a database transaction.
      event = NormalizedStripeEventSchema.parse(await this.dependencies.stripeVerifier.verifyAndNormalize(rawBody, signature));
    } catch {
      throw new WagsApiError("Stripe webhook signature or payload is invalid.", "WEBHOOK_UNAUTHORIZED");
    }
    const eventHash = crypto.createHash("sha256").update(rawBody).digest("hex");
    return this.applyVerifiedLifecycleEvent(event, eventHash);
  }

  async reconcileSubscription(
    ownerUuid: string,
    subscriptionUuid: string,
    rawRequest: { reason?: "manual" | "scheduled" | "missing_webhook" },
  ): Promise<LifecycleProcessingResult> {
    const request = ReconcileSubscriptionRequestSchema.parse(rawRequest);
    const subscription = await this.requireOwnedSubscription(ownerUuid, subscriptionUuid);
    // The Stripe read is outside the repository transaction by construction.
    const snapshot = NormalizedStripeEventSchema.parse(await this.dependencies.reconciliationProvider.fetchVerifiedSnapshot({
      subscriptionUuid: subscription.subscriptionUuid,
      providerSubscriptionRef: subscription.providerSubscriptionRef,
      reason: request.reason,
    }));
    if (snapshot.subscriptionUuid !== subscription.subscriptionUuid || snapshot.providerSubscriptionRef !== subscription.providerSubscriptionRef) {
      throw new WagsApiError("Reconciliation evidence does not match the requested subscription.", "FORBIDDEN");
    }
    return this.applyVerifiedLifecycleEvent(snapshot, hashIdentity(snapshot));
  }

  private async applyVerifiedLifecycleEvent(
    rawEvent: NormalizedStripeEvent,
    eventHash: string,
  ): Promise<LifecycleProcessingResult> {
    const event = NormalizedStripeEventSchema.parse(rawEvent);
    const now = this.now().toISOString();
    return this.dependencies.repository.withSubscriptionLock(event.subscriptionUuid, async (transaction) => {
      const claim = await transaction.claimProviderEvent({
        provider: "stripe",
        providerEventId: event.providerEventId,
        eventHash,
        subscriptionUuid: event.subscriptionUuid,
        receivedAt: now,
      });
      const subscription = await this.requireTransactionSubscription(transaction, event.subscriptionUuid);
      if (subscription.providerSubscriptionRef !== event.providerSubscriptionRef) {
        throw new WagsApiError("Provider subscription reference does not match.", "FORBIDDEN");
      }
      if (claim === "existing_same") {
        return LifecycleProcessingResultSchema.parse({
          subscriptionUuid: subscription.subscriptionUuid,
          providerEventId: event.providerEventId,
          disposition: "duplicate",
          status: subscription.status,
          changed: false,
        });
      }
      const transition = applySubscriptionLifecycleEvent(publicSubscription(subscription), event.lifecycleEvent);
      await transaction.saveSubscription(transition.subscription);
      if (event.paymentCoverage) {
        await transaction.upsertPaymentCoverage(event.paymentCoverage, event.providerEventId);
      }
      await transaction.markProviderEventProcessed(event.providerEventId, transition.disposition, now);
      return LifecycleProcessingResultSchema.parse({
        subscriptionUuid: transition.subscription.subscriptionUuid,
        providerEventId: event.providerEventId,
        disposition: transition.disposition,
        status: transition.subscription.status,
        changed: transition.changed,
      });
    });
  }

  private async requireOwnedSubscription(ownerUuid: string, subscriptionUuid: string) {
    const owner = PublicUuidSchema.parse(ownerUuid);
    const uuid = PublicUuidSchema.parse(subscriptionUuid);
    const subscription = await this.dependencies.repository.getSubscriptionForOwner(owner, uuid);
    if (!subscription) throw new WagsApiError("Subscription was not found.", "NOT_FOUND");
    const parsed = WagsSubscriptionRecordSchema.parse(subscription);
    if (parsed.ownerUuid !== owner) throw new WagsApiError("Subscription does not belong to this account.", "FORBIDDEN");
    return parsed;
  }

  private async requireTransactionSubscription(transaction: WagsSubscriptionTransactionPort, subscriptionUuid: string) {
    const subscription = await transaction.getSubscriptionForUpdate(subscriptionUuid);
    if (!subscription) throw new WagsApiError("Subscription was not found.", "NOT_FOUND");
    return WagsSubscriptionRecordSchema.parse(subscription);
  }
}

function publicSubscription(subscription: z.infer<typeof WagsSubscriptionRecordSchema>): WagsSubscription {
  const { providerSubscriptionRef: _privateProviderReference, ...publicValue } = subscription;
  return WagsSubscriptionSchema.parse(publicValue);
}
