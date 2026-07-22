import { z } from "zod";
import { IsoDateTimeSchema, Sha256Schema } from "./contracts.ts";
import { sha256Canonical } from "./canonical.ts";

export const ProviderOrderStateSchema = z.enum([
  "awaiting_payment",
  "ready_to_submit",
  "submission_pending",
  "submitted",
  "processing",
  "fulfilled",
  "failed_retryable",
  "failed_terminal",
  "canceled",
  "reconciliation_required",
]);

export const ProviderSubmissionSchema = z.object({
  schemaVersion: z.literal("fulfillment.submission.v1"),
  localOrderUuid: z.string().uuid(),
  provider: z.enum(["printful", "slant3d"]),
  printManifestHash: Sha256Schema,
  idempotencyKey: z.string().regex(/^fulfillment-v1-[a-f0-9]{64}$/),
  paymentState: z.enum(["unpaid", "paid", "refunded"]),
  state: ProviderOrderStateSchema,
  providerOrderId: z.string().trim().min(1).max(200).nullable(),
  appliedEventIds: z.array(z.string().trim().min(1).max(200)).max(2000),
  stateChangedAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
}).strict();

const ProviderOrderId = z.string().trim().min(1).max(200);
const EventBase = {
  eventId: z.string().trim().min(1).max(200),
  occurredAt: IsoDateTimeSchema,
};

export const ProviderEventSchema = z.discriminatedUnion("type", [
  z.object({ ...EventBase, type: z.literal("payment_confirmed") }).strict(),
  z.object({ ...EventBase, type: z.literal("submission_started") }).strict(),
  z.object({ ...EventBase, type: z.literal("submission_acknowledged"), providerOrderId: ProviderOrderId }).strict(),
  z.object({ ...EventBase, type: z.literal("provider_processing"), providerOrderId: ProviderOrderId }).strict(),
  z.object({ ...EventBase, type: z.literal("provider_fulfilled"), providerOrderId: ProviderOrderId }).strict(),
  z.object({ ...EventBase, type: z.literal("provider_failed"), providerOrderId: ProviderOrderId.nullable(), retryable: z.boolean() }).strict(),
  z.object({ ...EventBase, type: z.literal("cancellation_confirmed"), providerOrderId: ProviderOrderId.nullable() }).strict(),
  z.object({ ...EventBase, type: z.literal("outcome_uncertain") }).strict(),
]);

export const ProviderTransitionResultSchema = z.object({
  snapshot: ProviderSubmissionSchema,
  changed: z.boolean(),
  disposition: z.enum(["applied", "duplicate", "ignored_stale", "requires_reconciliation"]),
  reason: z.string().trim().min(1).max(300),
}).strict();

export const ProviderObservationSchema = z.discriminatedUnion("availability", [
  z.object({ availability: z.literal("unavailable"), checkedAt: IsoDateTimeSchema }).strict(),
  z.object({ availability: z.literal("not_found"), checkedAt: IsoDateTimeSchema }).strict(),
  z.object({
    availability: z.literal("found"),
    checkedAt: IsoDateTimeSchema,
    providerOrderId: ProviderOrderId,
    state: z.enum(["submitted", "processing", "fulfilled", "failed_retryable", "failed_terminal", "canceled"]),
  }).strict(),
]);

export const ReconciliationDecisionSchema = z.object({
  action: z.enum(["none", "query_provider", "adopt_provider_state", "retry_submission_same_key", "retry_later", "manual_review"]),
  reason: z.string().trim().min(1).max(400),
  targetState: ProviderOrderStateSchema.optional(),
  providerOrderId: ProviderOrderId.optional(),
  idempotencyKey: z.string().regex(/^fulfillment-v1-[a-f0-9]{64}$/).optional(),
}).strict();

export const RefundEvidenceSchema = z.object({
  chargedAmountMinor: z.number().int().nonnegative(),
  refundableAmountMinor: z.number().int().nonnegative(),
  refundState: z.enum(["not_requested", "requested", "processing", "succeeded", "failed", "unknown"]),
  refundedAmountMinor: z.number().int().nonnegative(),
  providerRefundId: z.string().trim().min(1).max(200).nullable(),
  lastErrorCode: z.string().trim().min(1).max(120).nullable(),
}).strict().superRefine((value, context) => {
  if (value.refundableAmountMinor > value.chargedAmountMinor) {
    context.addIssue({ code: "custom", message: "Refundable amount cannot exceed the charged amount." });
  }
  if (value.refundedAmountMinor > value.chargedAmountMinor) {
    context.addIssue({ code: "custom", message: "Refunded amount cannot exceed the charged amount." });
  }
});

export const RefundDispositionSchema = z.object({
  status: z.enum(["not_due", "pending", "returned", "partial", "failed", "manual_review"]),
  returnedAmountMinor: z.number().int().nonnegative(),
  message: z.string().trim().min(1).max(400),
}).strict();

export type ProviderSubmission = z.infer<typeof ProviderSubmissionSchema>;
export type ProviderEvent = z.infer<typeof ProviderEventSchema>;
export type ProviderObservation = z.infer<typeof ProviderObservationSchema>;
export type ProviderTransitionResult = z.infer<typeof ProviderTransitionResultSchema>;
export type ReconciliationDecision = z.infer<typeof ReconciliationDecisionSchema>;
export type RefundEvidence = z.infer<typeof RefundEvidenceSchema>;

const STATE_RANK: Record<z.infer<typeof ProviderOrderStateSchema>, number> = {
  awaiting_payment: 0,
  ready_to_submit: 1,
  submission_pending: 2,
  submitted: 3,
  processing: 4,
  fulfilled: 5,
  failed_retryable: 2,
  failed_terminal: 5,
  canceled: 5,
  reconciliation_required: 2,
};

export function providerIdempotencyKey(provider: "printful" | "slant3d", localOrderUuid: string, printManifestHash: string): string {
  const digest = sha256Canonical({ provider, localOrderUuid, printManifestHash, version: 1 });
  return `fulfillment-v1-${digest}`;
}

export function createProviderSubmission(input: {
  localOrderUuid: string;
  provider: "printful" | "slant3d";
  printManifestHash: string;
  paymentState: "unpaid" | "paid";
  createdAt: string;
}): ProviderSubmission {
  const idempotencyKey = providerIdempotencyKey(input.provider, input.localOrderUuid, input.printManifestHash);
  return ProviderSubmissionSchema.parse({
    schemaVersion: "fulfillment.submission.v1",
    localOrderUuid: input.localOrderUuid,
    provider: input.provider,
    printManifestHash: input.printManifestHash,
    paymentState: input.paymentState,
    idempotencyKey,
    state: input.paymentState === "paid" ? "ready_to_submit" : "awaiting_payment",
    providerOrderId: null,
    appliedEventIds: [],
    stateChangedAt: input.createdAt,
    updatedAt: input.createdAt,
  });
}

function withEvent(snapshot: ProviderSubmission, event: ProviderEvent, changes: Partial<ProviderSubmission>): ProviderSubmission {
  const stateChanged = changes.state !== undefined && changes.state !== snapshot.state;
  return ProviderSubmissionSchema.parse({
    ...snapshot,
    ...changes,
    appliedEventIds: [...snapshot.appliedEventIds, event.eventId],
    stateChangedAt: stateChanged ? event.occurredAt : snapshot.stateChangedAt,
    updatedAt: Date.parse(event.occurredAt) >= Date.parse(snapshot.updatedAt) ? event.occurredAt : snapshot.updatedAt,
  });
}

export function applyProviderEvent(rawSnapshot: ProviderSubmission, rawEvent: ProviderEvent): ProviderTransitionResult {
  const snapshot = ProviderSubmissionSchema.parse(rawSnapshot);
  const event = ProviderEventSchema.parse(rawEvent);
  if (snapshot.appliedEventIds.includes(event.eventId)) {
    return { snapshot, changed: false, disposition: "duplicate", reason: "Provider event was already applied." };
  }

  const incomingProviderId = "providerOrderId" in event ? event.providerOrderId : null;
  if (incomingProviderId && snapshot.providerOrderId && incomingProviderId !== snapshot.providerOrderId) {
    return {
      snapshot: withEvent(snapshot, event, { state: "reconciliation_required" }),
      changed: true,
      disposition: "requires_reconciliation",
      reason: "Provider event references a different provider order identifier.",
    };
  }

  const conflictsWithTerminalOutcome =
    (snapshot.state === "fulfilled" && ["provider_failed", "cancellation_confirmed"].includes(event.type))
    || (["failed_terminal", "canceled"].includes(snapshot.state) && event.type === "provider_fulfilled");
  if (conflictsWithTerminalOutcome) {
    return {
      snapshot: withEvent(snapshot, event, { state: "reconciliation_required" }),
      changed: true,
      disposition: "requires_reconciliation",
      reason: "Provider evidence contradicts the previously recorded terminal outcome.",
    };
  }
  if (snapshot.paymentState !== "paid" && ["submission_acknowledged", "provider_processing", "provider_fulfilled"].includes(event.type)) {
    return {
      snapshot: withEvent(snapshot, event, { state: "reconciliation_required" }),
      changed: true,
      disposition: "requires_reconciliation",
      reason: "Provider activity exists without durable paid-payment evidence.",
    };
  }

  let changes: Partial<ProviderSubmission> | null = null;
  switch (event.type) {
    case "payment_confirmed":
      if (snapshot.paymentState === "unpaid" && snapshot.state === "awaiting_payment") {
        changes = { paymentState: "paid", state: "ready_to_submit" };
      }
      break;
    case "submission_started":
      if (["ready_to_submit", "failed_retryable", "reconciliation_required"].includes(snapshot.state)) {
        changes = { state: "submission_pending" };
      }
      break;
    case "submission_acknowledged":
      if (snapshot.paymentState === "paid" && STATE_RANK[snapshot.state] < STATE_RANK.submitted) {
        changes = { state: "submitted", providerOrderId: event.providerOrderId };
      }
      break;
    case "provider_processing":
      if (snapshot.paymentState === "paid" && STATE_RANK[snapshot.state] < STATE_RANK.processing) {
        changes = { state: "processing", providerOrderId: event.providerOrderId };
      }
      break;
    case "provider_fulfilled":
      if (snapshot.paymentState === "paid" && snapshot.state !== "canceled") {
        changes = { state: "fulfilled", providerOrderId: event.providerOrderId };
      }
      break;
    case "provider_failed":
      if (!(["fulfilled", "canceled"].includes(snapshot.state))) {
        changes = {
          state: event.retryable ? "failed_retryable" : "failed_terminal",
          providerOrderId: event.providerOrderId ?? snapshot.providerOrderId,
        };
      }
      break;
    case "cancellation_confirmed":
      if (snapshot.state !== "fulfilled") {
        changes = { state: "canceled", providerOrderId: event.providerOrderId ?? snapshot.providerOrderId };
      }
      break;
    case "outcome_uncertain":
      if (!(["fulfilled", "canceled", "failed_terminal"].includes(snapshot.state))) {
        changes = { state: "reconciliation_required" };
      }
      break;
  }

  if (!changes) {
    return {
      snapshot: withEvent(snapshot, event, {}),
      changed: false,
      disposition: "ignored_stale",
      reason: "Event cannot move the order backward or contradict a terminal outcome.",
    };
  }
  return {
    snapshot: withEvent(snapshot, event, changes),
    changed: true,
    disposition: "applied",
    reason: "Provider event advanced the durable order state.",
  };
}

export function decideProviderReconciliation(
  rawSnapshot: ProviderSubmission,
  rawObservation: ProviderObservation | null,
  now: string,
  staleAfterSeconds = 300,
): ReconciliationDecision {
  const snapshot = ProviderSubmissionSchema.parse(rawSnapshot);
  const nowMs = Date.parse(IsoDateTimeSchema.parse(now));
  const ageSeconds = Math.max(0, (nowMs - Date.parse(snapshot.stateChangedAt)) / 1000);
  if (!rawObservation) {
    if (["fulfilled", "failed_terminal", "canceled"].includes(snapshot.state)) {
      return ReconciliationDecisionSchema.parse({ action: "none", reason: "Local order is already terminal and has no contradictory observation." });
    }
    return ReconciliationDecisionSchema.parse({ action: "query_provider", reason: "Provider state must be queried to repair possible webhook loss." });
  }
  const observation = ProviderObservationSchema.parse(rawObservation);
  if (observation.availability === "unavailable") {
    if (["fulfilled", "failed_terminal", "canceled"].includes(snapshot.state)) {
      return ReconciliationDecisionSchema.parse({ action: "none", reason: "Provider is unavailable, but no evidence contradicts the local terminal outcome." });
    }
    return ReconciliationDecisionSchema.parse({ action: "retry_later", reason: "Provider is unavailable; the same identity must be retained." });
  }
  if (observation.availability === "not_found") {
    if (snapshot.providerOrderId) {
      return ReconciliationDecisionSchema.parse({ action: "manual_review", reason: "Provider cannot find a previously acknowledged order." });
    }
    if (ageSeconds >= staleAfterSeconds && ["submission_pending", "reconciliation_required", "failed_retryable"].includes(snapshot.state)) {
      return ReconciliationDecisionSchema.parse({
        action: "retry_submission_same_key",
        reason: "No provider order exists after the submission lease expired; retry with the original idempotency key.",
        idempotencyKey: snapshot.idempotencyKey,
      });
    }
    return ReconciliationDecisionSchema.parse({ action: "retry_later", reason: "Submission is not old enough to retry safely." });
  }
  if (["fulfilled", "failed_terminal", "canceled"].includes(snapshot.state)) {
    if (snapshot.state !== observation.state) {
      return ReconciliationDecisionSchema.parse({ action: "manual_review", reason: "Provider observation contradicts the local terminal outcome." });
    }
    return ReconciliationDecisionSchema.parse({ action: "none", reason: "Local and provider terminal outcomes agree." });
  }
  if (snapshot.providerOrderId && snapshot.providerOrderId !== observation.providerOrderId) {
    return ReconciliationDecisionSchema.parse({ action: "manual_review", reason: "Observed provider order identity conflicts with the durable identity." });
  }
  if (snapshot.state === observation.state && snapshot.providerOrderId === observation.providerOrderId) {
    return ReconciliationDecisionSchema.parse({ action: "none", reason: "Local and provider states agree." });
  }
  return ReconciliationDecisionSchema.parse({
    action: "adopt_provider_state",
    reason: "Provider state is authoritative evidence that repairs a missing or delayed webhook.",
    targetState: observation.state,
    providerOrderId: observation.providerOrderId,
  });
}

export function describeRefund(rawEvidence: RefundEvidence): z.infer<typeof RefundDispositionSchema> {
  const evidence = RefundEvidenceSchema.parse(rawEvidence);
  if (evidence.refundableAmountMinor === 0) {
    return { status: "not_due", returnedAmountMinor: 0, message: "No refundable amount is due." };
  }
  if (evidence.refundState === "succeeded" && evidence.providerRefundId) {
    if (evidence.refundedAmountMinor >= evidence.refundableAmountMinor) {
      return { status: "returned", returnedAmountMinor: evidence.refundedAmountMinor, message: "Provider-confirmed refund evidence is recorded." };
    }
    return { status: "partial", returnedAmountMinor: evidence.refundedAmountMinor, message: "Only part of the refundable amount is provider-confirmed." };
  }
  if (["requested", "processing"].includes(evidence.refundState)) {
    return { status: "pending", returnedAmountMinor: 0, message: "Refund was requested but has not been confirmed by the provider." };
  }
  if (evidence.refundState === "failed") {
    return { status: "failed", returnedAmountMinor: 0, message: "Refund failed and no returned funds are claimed." };
  }
  if (evidence.refundState === "not_requested") {
    return { status: "not_due", returnedAmountMinor: 0, message: "No refund has been requested." };
  }
  return { status: "manual_review", returnedAmountMinor: 0, message: "Refund outcome is unknown and requires reconciliation." };
}
