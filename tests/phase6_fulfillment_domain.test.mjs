import test from "node:test";
import assert from "node:assert/strict";

import {
  applyProviderEvent,
  createProviderSubmission,
  decideProviderReconciliation,
  describeRefund,
  providerIdempotencyKey,
} from "../server/stationery-v2/fulfillment.ts";

const ORDER_UUID = "44444444-4444-4444-8444-444444444444";
const MANIFEST_HASH = "d".repeat(64);

function event(eventId, occurredAt, type, detail = {}) {
  return { eventId, occurredAt, type, ...detail };
}

test("Phase 6 provider identity is deterministic and payment-gated", () => {
  const first = providerIdempotencyKey("printful", ORDER_UUID, MANIFEST_HASH);
  const second = providerIdempotencyKey("printful", ORDER_UUID, MANIFEST_HASH);
  assert.equal(first, second);
  assert.notEqual(first, providerIdempotencyKey("slant3d", ORDER_UUID, MANIFEST_HASH));
  const unpaid = createProviderSubmission({ localOrderUuid: ORDER_UUID, provider: "printful", printManifestHash: MANIFEST_HASH, paymentState: "unpaid", createdAt: "2026-07-22T12:00:00.000Z" });
  assert.equal(unpaid.state, "awaiting_payment");
});

test("Phase 6 duplicate delivery webhooks are no-ops", () => {
  let snapshot = createProviderSubmission({ localOrderUuid: ORDER_UUID, provider: "printful", printManifestHash: MANIFEST_HASH, paymentState: "paid", createdAt: "2026-07-22T12:00:00.000Z" });
  snapshot = applyProviderEvent(snapshot, event("submit", "2026-07-22T12:01:00.000Z", "submission_started")).snapshot;
  const fulfilledEvent = event("fulfilled-1", "2026-07-22T12:03:00.000Z", "provider_fulfilled", { providerOrderId: "PF-123" });
  const first = applyProviderEvent(snapshot, fulfilledEvent);
  assert.equal(first.snapshot.state, "fulfilled");
  const replay = applyProviderEvent(first.snapshot, fulfilledEvent);
  assert.equal(replay.disposition, "duplicate");
  assert.equal(replay.changed, false);
  assert.deepEqual(replay.snapshot, first.snapshot);
});

test("Phase 6 ignores an out-of-order provider state after fulfillment", () => {
  let snapshot = createProviderSubmission({ localOrderUuid: ORDER_UUID, provider: "printful", printManifestHash: MANIFEST_HASH, paymentState: "paid", createdAt: "2026-07-22T12:00:00.000Z" });
  snapshot = applyProviderEvent(snapshot, event("done", "2026-07-22T12:04:00.000Z", "provider_fulfilled", { providerOrderId: "PF-123" })).snapshot;
  const stale = applyProviderEvent(snapshot, event("processing-late", "2026-07-22T12:02:00.000Z", "provider_processing", { providerOrderId: "PF-123" }));
  assert.equal(stale.disposition, "ignored_stale");
  assert.equal(stale.snapshot.state, "fulfilled");
  assert.equal(stale.snapshot.updatedAt, "2026-07-22T12:04:00.000Z");
});

test("Phase 6 contradictory terminal outcomes require reconciliation", () => {
  let snapshot = createProviderSubmission({ localOrderUuid: ORDER_UUID, provider: "printful", printManifestHash: MANIFEST_HASH, paymentState: "paid", createdAt: "2026-07-22T12:00:00.000Z" });
  snapshot = applyProviderEvent(snapshot, event("done", "2026-07-22T12:04:00.000Z", "provider_fulfilled", { providerOrderId: "PF-123" })).snapshot;
  const conflict = applyProviderEvent(snapshot, event("failed-late", "2026-07-22T12:06:00.000Z", "provider_failed", { providerOrderId: "PF-123", retryable: false }));
  assert.equal(conflict.disposition, "requires_reconciliation");
  assert.equal(conflict.snapshot.state, "reconciliation_required");
});

test("Phase 6 provider activity without durable payment requires reconciliation", () => {
  const snapshot = createProviderSubmission({ localOrderUuid: ORDER_UUID, provider: "printful", printManifestHash: MANIFEST_HASH, paymentState: "unpaid", createdAt: "2026-07-22T12:00:00.000Z" });
  const conflict = applyProviderEvent(snapshot, event("unexpected", "2026-07-22T12:01:00.000Z", "provider_processing", { providerOrderId: "PF-123" }));
  assert.equal(conflict.disposition, "requires_reconciliation");
});

test("Phase 6 webhook-loss reconciliation adopts provider completion", () => {
  let snapshot = createProviderSubmission({ localOrderUuid: ORDER_UUID, provider: "printful", printManifestHash: MANIFEST_HASH, paymentState: "paid", createdAt: "2026-07-22T12:00:00.000Z" });
  snapshot = applyProviderEvent(snapshot, event("submit", "2026-07-22T12:01:00.000Z", "submission_started")).snapshot;
  const decision = decideProviderReconciliation(snapshot, {
    availability: "found",
    checkedAt: "2026-07-22T12:10:00.000Z",
    providerOrderId: "PF-123",
    state: "fulfilled",
  }, "2026-07-22T12:10:00.000Z");
  assert.equal(decision.action, "adopt_provider_state");
  assert.equal(decision.targetState, "fulfilled");
});

test("Phase 6 retries a lost submission only with its original idempotency key", () => {
  let snapshot = createProviderSubmission({ localOrderUuid: ORDER_UUID, provider: "slant3d", printManifestHash: MANIFEST_HASH, paymentState: "paid", createdAt: "2026-07-22T12:00:00.000Z" });
  snapshot = applyProviderEvent(snapshot, event("submit", "2026-07-22T12:01:00.000Z", "submission_started")).snapshot;
  const decision = decideProviderReconciliation(snapshot, {
    availability: "not_found",
    checkedAt: "2026-07-22T12:20:00.000Z",
  }, "2026-07-22T12:20:00.000Z", 300);
  assert.equal(decision.action, "retry_submission_same_key");
  assert.equal(decision.idempotencyKey, snapshot.idempotencyKey);
});

test("Phase 6 refund messaging never claims unconfirmed funds were returned", () => {
  const pending = describeRefund({ chargedAmountMinor: 2500, refundableAmountMinor: 2500, refundState: "requested", refundedAmountMinor: 0, providerRefundId: null, lastErrorCode: null });
  assert.equal(pending.status, "pending");
  assert.equal(pending.returnedAmountMinor, 0);
  const unknown = describeRefund({ chargedAmountMinor: 2500, refundableAmountMinor: 2500, refundState: "unknown", refundedAmountMinor: 0, providerRefundId: null, lastErrorCode: null });
  assert.equal(unknown.status, "manual_review");
  const returned = describeRefund({ chargedAmountMinor: 2500, refundableAmountMinor: 2500, refundState: "succeeded", refundedAmountMinor: 2500, providerRefundId: "re_123", lastErrorCode: null });
  assert.equal(returned.status, "returned");
  assert.throws(() => describeRefund({ chargedAmountMinor: 2500, refundableAmountMinor: 2500, refundState: "succeeded", refundedAmountMinor: 3000, providerRefundId: "re_bad", lastErrorCode: null }));
});
