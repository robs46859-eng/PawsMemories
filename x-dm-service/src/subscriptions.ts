/**
 * DM event subscriptions manager (§5.3).
 *
 * Ensures dm.received + dm.sent subscriptions exist for X_BOT_USER_ID
 * bound to our webhook_id. Idempotent on boot.
 *
 * Uses app-only bearer token (same as webhook manager).
 *
 * Spec: X_DM_REFINEMENT_SPEC.md §5.3
 *
 * TODO(§7.6): Verify the exact endpoint and body shape for activity subscriptions
 * against https://docs.x.com/x-api/activity/introduction for the account's tier.
 */

import { getConfig } from './config.js';
import { kvSet, KV_KEYS } from './db.js';
import { getAppOnlyBearerToken, xFetch } from './xClient.js';

// ---------------------------------------------------------------------------
// API Base
// ---------------------------------------------------------------------------

const API_V2 = 'https://api.x.com/2';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SubscriptionResponse {
  data?: {
    id: string;
    event_type: string;
    tag?: string;
    webhook_id: string;
    filter?: { user_id: string };
  };
  errors?: Array<{ code?: string; message: string }>;
}

interface ListSubscriptionsResponse {
  data: Array<{
    id: string;
    event_type: string;
    tag?: string;
    webhook_id: string;
    filter?: { user_id: string };
  }>;
}

// ---------------------------------------------------------------------------
// App-only token (reuse cache from webhookManager)
// ---------------------------------------------------------------------------

let appOnlyToken: string | null = null;
let appOnlyTokenExpiry: number = 0;

async function getAppToken(): Promise<string> {
  const now = Date.now();
  if (appOnlyToken && now < appOnlyTokenExpiry) {
    return appOnlyToken;
  }
  const cfg = getConfig();
  const resp = await getAppOnlyBearerToken(cfg.X_CLIENT_ID, cfg.X_CLIENT_SECRET);
  appOnlyToken = resp.access_token;
  appOnlyTokenExpiry = now + (resp.expires_in - 60) * 1000;
  return appOnlyToken!;
}

// ---------------------------------------------------------------------------
// A6/A7 — Create subscription
// ---------------------------------------------------------------------------

/**
 * POST /2/activity/subscriptions — create a DM event subscription.
 *
 * @param webhookId - The registered webhook id.
 * @param eventType - 'dm.received' or 'dm.sent'.
 * @param tag - Human-readable tag for the subscription.
 * @returns The subscription id.
 */
export async function createSubscription(
  webhookId: string,
  eventType: 'dm.received' | 'dm.sent',
  tag: string,
): Promise<string> {
  const cfg = getConfig();
  const token = await getAppToken();

  const body = {
    event_type: eventType,
    filter: { user_id: cfg.X_BOT_USER_ID },
    tag,
    webhook_id: webhookId,
  };

  const resp = await xFetch(`${API_V2}/activity/subscriptions`, {
    method: 'POST',
    token,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => 'unknown');
    // 409 Conflict is fine — subscription already exists
    if (resp.status === 409) {
      const js = await resp.json().catch(() => ({})) as { data?: { id?: string } };
      const id = (js as { data?: { id?: string } }).data?.id;
      if (id) return id;
      console.warn(`[Subscriptions] ${eventType} already exists (conflict), continuing`);
      return '';
    }
    throw new Error(`Subscription create failed for ${eventType}: HTTP ${resp.status} — ${text}`);
  }

  const js = (await resp.json()) as SubscriptionResponse;
  const subId = js.data?.id;
  if (!subId) {
    throw new Error(`Subscription created for ${eventType} but no id returned`);
  }

  console.log(`[Subscriptions] Created ${eventType} subscription: ${subId}`);
  return subId;
}

// ---------------------------------------------------------------------------
// A8 — List subscriptions
// ---------------------------------------------------------------------------

/**
 * GET /2/activity/subscriptions — list all subscriptions.
 */
export async function listSubscriptions(): Promise<ListSubscriptionsResponse['data']> {
  const token = await getAppToken();
  const resp = await xFetch(`${API_V2}/activity/subscriptions`, {
    method: 'GET',
    token,
  });

  if (!resp.ok) {
    throw new Error(`List subscriptions failed: HTTP ${resp.status}`);
  }

  const js = (await resp.json()) as ListSubscriptionsResponse;
  return js.data ?? [];
}

// ---------------------------------------------------------------------------
// A9 — Update subscription (move to new webhook_id)
// ---------------------------------------------------------------------------

/**
 * PUT /2/activity/subscriptions/:id — move subscription to a new webhook_id.
 */
export async function updateSubscription(
  subscriptionId: string,
  newWebhookId: string,
): Promise<void> {
  const token = await getAppToken();
  const body = { webhook_id: newWebhookId };

  const resp = await xFetch(`${API_V2}/activity/subscriptions/${subscriptionId}`, {
    method: 'PUT',
    token,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    throw new Error(`Update subscription ${subscriptionId} failed: HTTP ${resp.status}`);
  }

  console.log(`[Subscriptions] Updated subscription ${subscriptionId} → webhook ${newWebhookId}`);
}

// ---------------------------------------------------------------------------
// A10 — Delete subscription
// ---------------------------------------------------------------------------

/**
 * DELETE /2/activity/subscriptions/:id — teardown.
 */
export async function deleteSubscription(subscriptionId: string): Promise<void> {
  const token = await getAppToken();
  const resp = await xFetch(`${API_V2}/activity/subscriptions/${subscriptionId}`, {
    method: 'DELETE',
    token,
  });

  if (!resp.ok) {
    throw new Error(`Delete subscription ${subscriptionId} failed: HTTP ${resp.status}`);
  }

  console.log(`[Subscriptions] Deleted subscription ${subscriptionId}`);
}

// ---------------------------------------------------------------------------
// Boot-time idempotent setup
// ---------------------------------------------------------------------------

/**
 * Called once on service boot. Ensures dm.received and dm.sent subscriptions
 * exist for the bot user, bound to the given webhook_id.
 *
 * Idempotent — skips creation if a matching subscription already exists.
 */
export async function ensureSubscriptions(webhookId: string): Promise<void> {
  if (!webhookId) {
    console.warn('[Subscriptions] No webhook_id — skipping subscription setup');
    return;
  }

  console.log('[Subscriptions] Ensuring DM event subscriptions...');

  try {
    const existing = await listSubscriptions();

    const needsReceived = !existing.some(
      (s) => s.event_type === 'dm.received' && s.webhook_id === webhookId,
    );
    const needsSent = !existing.some(
      (s) => s.event_type === 'dm.sent' && s.webhook_id === webhookId,
    );

    if (needsReceived) {
      const id = await createSubscription(webhookId, 'dm.received', 'pawsome3d-dm-in');
      if (id) await kvSet(KV_KEYS.SUBSCRIPTION_DM_RECEIVED, id);
    }

    if (needsSent) {
      const id = await createSubscription(webhookId, 'dm.sent', 'pawsome3d-dm-out');
      if (id) await kvSet(KV_KEYS.SUBSCRIPTION_DM_SENT, id);
    }

    if (!needsReceived && !needsSent) {
      console.log('[Subscriptions] Both subscriptions already exist');
    }
  } catch (err) {
    console.error(`[Subscriptions] Boot-time setup failed: ${(err as Error).message}`);
    console.warn('[Subscriptions] Will retry on next health check');
  }
}