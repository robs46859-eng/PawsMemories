import type {
  AnnualIncentivePolicy,
  ExistingGrant,
  PaymentCoverage,
  SealedWagsPackVersion,
  WagsSubscription,
} from "./contracts.ts";
import type {
  CheckoutReservation,
  CreateCheckoutRequest,
  ListPublishedPacksQuery,
  NormalizedStripeEvent,
  PublishedPackPage,
  WagsCheckoutPlanRecord,
  WagsSubscriptionRecord,
} from "./apiContracts.ts";
import type { WagsDeliveryRepositoryPort } from "./ports.ts";

export interface ReserveCheckoutInput {
  checkoutUuid: string;
  ownerUuid: string;
  idempotencyKey: string;
  requestHash: string;
  request: CreateCheckoutRequest;
}

export interface CompleteCheckoutInput {
  checkoutUuid: string;
  providerSessionRef: string;
  checkoutUrl: string;
  expiresAt: string;
}

export interface WagsSubscriptionTransactionPort {
  /** UNIQUE(provider, provider_event_id); a conflicting payload hash must throw. */
  claimProviderEvent(input: {
    provider: "stripe";
    providerEventId: string;
    eventHash: string;
    subscriptionUuid: string;
    receivedAt: string;
  }): Promise<"inserted" | "existing_same">;
  getSubscriptionForUpdate(subscriptionUuid: string): Promise<WagsSubscriptionRecord | null>;
  saveSubscription(subscription: WagsSubscription): Promise<void>;
  upsertPaymentCoverage(payment: PaymentCoverage, providerEventId: string): Promise<void>;
  markProviderEventProcessed(providerEventId: string, disposition: string, processedAt: string): Promise<void>;
}

export interface WagsApiRepositoryPort extends WagsDeliveryRepositoryPort {
  listPublishedPackVersions(query: ListPublishedPacksQuery): Promise<PublishedPackPage>;
  getPublishedPackVersion(packUuid: string, versionNumber: number): Promise<SealedWagsPackVersion | null>;
  getSubscriptionForOwner(ownerUuid: string, subscriptionUuid: string): Promise<WagsSubscriptionRecord | null>;
  getPaymentCoverageForPeriod(subscriptionUuid: string, startsAt: string, endsAt: string): Promise<PaymentCoverage | null>;
  getPaymentCoverageByUuid(subscriptionUuid: string, paymentUuid: string): Promise<PaymentCoverage | null>;
  listExistingGrants(deliveryIdentity: string): Promise<ExistingGrant[]>;
  listOwnedDeliverableKeys(ownerUuid: string): Promise<string[]>;
  isPackEligibleForSubscription(subscription: WagsSubscription, pack: SealedWagsPackVersion): Promise<boolean>;
  getAnnualIncentivePolicy(policyUuid: string, versionNumber: number): Promise<AnnualIncentivePolicy | null>;

  getCheckoutPlan(planUuid: string, versionNumber: number, cadence: CreateCheckoutRequest["cadence"]): Promise<WagsCheckoutPlanRecord | null>;
  /** Transactionally reserves UNIQUE(owner_uuid, idempotency_key) before any provider call. */
  reserveCheckout(input: ReserveCheckoutInput): Promise<{ disposition: "call_provider" | "existing"; reservation: CheckoutReservation }>;
  completeCheckout(input: CompleteCheckoutInput): Promise<CheckoutReservation>;
  failCheckout(checkoutUuid: string, failureCode: string): Promise<void>;

  /** The callback is the complete SQL transaction; no network/provider calls are allowed inside it. */
  withSubscriptionLock<T>(subscriptionUuid: string, work: (transaction: WagsSubscriptionTransactionPort) => Promise<T>): Promise<T>;
}

export interface CheckoutProviderPort {
  createCheckoutSession(input: {
    checkoutUuid: string;
    ownerUuid: string;
    providerPriceRef: string;
    cadence: CreateCheckoutRequest["cadence"];
    successUrl: string;
    cancelUrl: string;
    idempotencyKey: string;
  }): Promise<{
    providerSessionRef: string;
    checkoutUrl: string;
    expiresAt: string;
  }>;
}

export interface StripeWebhookVerifierPort {
  /** Verifies the Stripe signature against the unmodified request bytes. */
  verifyAndNormalize(rawBody: Buffer, signature: string): Promise<NormalizedStripeEvent>;
}

export interface SubscriptionReconciliationProviderPort {
  /** Fetches Stripe state outside all repository transactions. */
  fetchVerifiedSnapshot(input: {
    subscriptionUuid: string;
    providerSubscriptionRef: string;
    reason: "manual" | "scheduled" | "missing_webhook";
  }): Promise<NormalizedStripeEvent>;
}
