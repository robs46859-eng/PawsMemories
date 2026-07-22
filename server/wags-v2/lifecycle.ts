import {
  SubscriptionLifecycleEventSchema,
  WagsSubscriptionSchema,
  type SubscriptionLifecycleEvent,
  type WagsSubscription,
} from "./contracts.ts";

export interface SubscriptionTransitionResult {
  subscription: WagsSubscription;
  changed: boolean;
  disposition: "applied" | "duplicate" | "ignored_out_of_order" | "ignored_terminal";
  reason: string;
}

function recordEvent(subscription: WagsSubscription, event: SubscriptionLifecycleEvent, changes: Partial<WagsSubscription>): WagsSubscription {
  return WagsSubscriptionSchema.parse({
    ...subscription,
    ...changes,
    appliedEventIds: [...subscription.appliedEventIds, event.eventId],
    lastLifecycleEventAt: event.occurredAt,
  });
}

export function applySubscriptionLifecycleEvent(
  rawSubscription: WagsSubscription,
  rawEvent: SubscriptionLifecycleEvent,
): SubscriptionTransitionResult {
  const subscription = WagsSubscriptionSchema.parse(rawSubscription);
  const event = SubscriptionLifecycleEventSchema.parse(rawEvent);
  if (subscription.appliedEventIds.includes(event.eventId)) {
    return { subscription, changed: false, disposition: "duplicate", reason: "Lifecycle event was already handled." };
  }
  if (subscription.lastLifecycleEventAt && Date.parse(event.occurredAt) < Date.parse(subscription.lastLifecycleEventAt)) {
    return {
      subscription: WagsSubscriptionSchema.parse({
        ...subscription,
        appliedEventIds: [...subscription.appliedEventIds, event.eventId],
      }),
      changed: false,
      disposition: "ignored_out_of_order",
      reason: "Older lifecycle evidence cannot overwrite a newer subscription decision.",
    };
  }

  let changes: Partial<WagsSubscription> | null = null;
  switch (event.type) {
    case "payment_succeeded":
      if (subscription.status === "checkout_pending" || subscription.status === "past_due") {
        changes = { status: subscription.cancelEffectiveAt ? "cancel_at_period_end" : "active" };
      }
      else if (subscription.status === "active" || subscription.status === "cancel_at_period_end") changes = {};
      break;
    case "payment_failed":
      if (!["canceled", "expired"].includes(subscription.status)) changes = { status: "past_due" };
      break;
    case "cancel_requested":
      if (!["canceled", "expired"].includes(subscription.status)) {
        changes = {
          status: event.mode === "immediate" ? "canceled" : "cancel_at_period_end",
          cancelEffectiveAt: event.effectiveAt,
        };
      }
      break;
    case "resumed":
      if (subscription.status === "cancel_at_period_end") changes = { status: "active", cancelEffectiveAt: null };
      else if (subscription.status === "past_due" && subscription.cancelEffectiveAt) changes = { cancelEffectiveAt: null };
      break;
    case "service_period_ended":
      if (subscription.cancelEffectiveAt && Date.parse(subscription.cancelEffectiveAt) <= Date.parse(event.occurredAt)) {
        changes = { status: "canceled" };
      } else if (Date.parse(subscription.serviceEndsAt) <= Date.parse(event.occurredAt)) {
        changes = { status: "expired" };
      } else {
        changes = {};
      }
      break;
  }

  if (changes === null) {
    return {
      subscription: recordEvent(subscription, event, {}),
      changed: false,
      disposition: "ignored_terminal",
      reason: "Event cannot reopen or contradict the current subscription state.",
    };
  }
  const next = recordEvent(subscription, event, changes);
  return {
    subscription: next,
    changed: next.status !== subscription.status || next.cancelEffectiveAt !== subscription.cancelEffectiveAt,
    disposition: "applied",
    reason: "Lifecycle evidence was applied deterministically.",
  };
}
