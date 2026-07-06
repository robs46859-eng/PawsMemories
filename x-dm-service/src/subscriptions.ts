/**
 * DM event subscriptions manager (§5.3).
 *
 * Ensures dm.received + dm.sent subscriptions exist for X_BOT_USER_ID
 * bound to our webhook_id. Idempotent on boot.
 *
 * Uses the bot user OAuth token (not app-only) — dm.received/dm.sent
 * event types require user context. Webhook management (webhookManager.ts)
 * stays on the app-only bearer token.
 *
 * If no bot token is available (OAuth not yet seeded via /oauth/start),
 * logs a warning and skips without error.
 *
 * Spec: X_DM_REFINEMENT_SPEC.md §5.3
 *
 * TODO(§7.6): Verify the exact endpoint and body shape for activity subscriptions
 * against https://docs.x.com/x-api/activity/introduction for the account's tier.
 */

import { getConfig } from './config.js';
import { kvSet, KV_KEYS } from './db.js';
import { xFetch } from './xClient.js';
import { getBotUserToken, refreshAndPersist } from './botTokenStore.js';
import { signRequest } from './oauth1.js';

// ---------------------------------------------------------------------------
// API Base
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Auth helpers — OAuth 1.0a preferred, OAuth 2.0 user token fallback
// ---------------------------------------------------------------------------

const API_V2 = 'https://api.x.com/2';

/**
 * Do we have OAuth 1.0a credentials configured?
 * The /2/activity/subscriptions endpoint requires OAuth 1.0a user context
 * and returns bare 403 with OAuth 2.0 user tokens.
 */
function haveOAuth1Creds(): boolean {
  const cfg = getConfig();
  return !!(cfg.X_CONSUMER_KEY && cfg.X_ACCESS_TOKEN && cfg.X_ACCESS_TOKEN_SECRET);
}

/**
 * Fetch using OAuth 1.0a signed request (raw fetch, no Bearer token).
 * Called when 1.0a credentials are available.
 */
async function oauth1Fetch(
  url: string,
  opts: { method: string; body?: string },
): Promise<Response> {
  const authHeader = signRequest(opts.method, url);
  const headers: Record<string, string> = {
    Authorization: authHeader,
  };
  if (opts.body) {
    headers['Content-Type'] = 'application/json';
  }
  return fetch(url, {
    method: opts.method,
    headers,
    body: opts.body,
  });
}

/**
 * Get the bot OAuth 2.0 user token, returning null if not yet seeded.
 */
async function getBotTokenSafe(): Promise<string | null> {
  try {
    return await getBotUserToken();
  } catch (err) {
    const msg = (err as Error).message;
    if (
      msg.includes('No bot user token available') ||
      msg.includes('No refresh token')
    ) {
      return null;
    }
    throw err;
  }
}

/**
 * Make an X API v2 call for subscription management.
 *
 * Auth priority: OAuth 1.0a > OAuth 2.0 user token > skip (return null).
 * OAuth 2.0 path includes 401→refresh→retry (same pattern as dmSender).
 *
 * @returns The Response on success, or null when no auth is available.
 */
async function fetchWithAuth(
  url: string,
  opts: { method: string; body?: string },
): Promise<Response | null> {
  // --- OAuth 1.0a path (preferred) ---
  if (haveOAuth1Creds()) {
    return oauth1Fetch(url, opts);
  }

  // --- OAuth 2.0 user token path (fallback) ---
  let token = await getBotTokenSafe();
  if (!token) return null;

  let retried = false;

  for (let attempt = 0; attempt < 2; attempt++) {
    const resp = await xFetch(url, {
      method: opts.method,
      token,
      headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
      body: opts.body,
    });

    if (resp.ok) return resp;

    if (resp.status === 401 && !retried) {
      console.log('[Subscriptions] 401 — refreshing bot token and retrying...');
      try {
        token = await refreshAndPersist();
        retried = true;
        continue;
      } catch (refreshErr) {
        console.error(`[Subscriptions] Token refresh failed: ${(refreshErr as Error).message}`);
        throw new Error('Subscriptions failed: token refresh failed after 401');
      }
    }

    return resp;
  }

  return null;
}

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
// A6/A7 — Create subscription
// ---------------------------------------------------------------------------

/**
 * POST /2/activity/subscriptions — create a DM event subscription.
 *
 * @param webhookId - The registered webhook id.
 * @param eventType - 'dm.received' or 'dm.sent'.
 * @param tag - Human-readable tag for the subscription.
 * @returns The subscription id, or empty string if token unavailable.
 */
export async function createSubscription(
  webhookId: string,
  eventType: 'dm.received' | 'dm.sent',
  tag: string,
): Promise<string> {
  const cfg = getConfig();

  const body = {
    event_type: eventType,
    filter: { user_id: cfg.X_BOT_USER_ID },
    tag,
    webhook_id: webhookId,
  };

  const resp = await fetchWithAuth(`${API_V2}/activity/subscriptions`, {
    method: 'POST',
    body: JSON.stringify(body),
  });

  if (!resp) {
    console.warn('[Subscriptions] Bot token not available — skipping subscription creation');
    return '';
  }

  if (!resp.ok) {
    const text = await resp.text().catch(() => 'unknown');
    // 409 Conflict is fine — subscription already exists
    if (resp.status === 409) {
      const js = (await resp.json().catch(() => ({}))) as { data?: { id?: string } };
      const id = js.data?.id;
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
 * Returns empty array if token unavailable.
 */
export async function listSubscriptions(): Promise<ListSubscriptionsResponse['data']> {
  const resp = await fetchWithAuth(`${API_V2}/activity/subscriptions`, {
    method: 'GET',
  });

  if (!resp) {
    console.warn('[Subscriptions] Bot token not available — cannot list subscriptions');
    return [];
  }

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
  const body = { webhook_id: newWebhookId };

  const resp = await fetchWithAuth(
    `${API_V2}/activity/subscriptions/${subscriptionId}`,
    { method: 'PUT', body: JSON.stringify(body) },
  );

  if (!resp) {
    console.warn('[Subscriptions] Bot token not available — cannot update subscription');
    return;
  }

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
  const resp = await fetchWithAuth(
    `${API_V2}/activity/subscriptions/${subscriptionId}`,
    { method: 'DELETE' },
  );

  if (!resp) {
    console.warn('[Subscriptions] Bot token not available — cannot delete subscription');
    return;
  }

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
 * If the bot OAuth token has not been seeded yet, logs a warning and skips
 * without error.
 */
export async function ensureSubscriptions(webhookId: string): Promise<void> {
  if (!webhookId) {
    console.warn('[Subscriptions] No webhook_id — skipping subscription setup');
    return;
  }

  // Check if any auth path is available before doing work
  const token = await getBotTokenSafe();
  const haveAnyAuth = token || haveOAuth1Creds();
  if (!haveAnyAuth) {
    console.log('[Subscriptions] waiting for bot OAuth seeding — subscriptions will be created once /oauth/callback completes');
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