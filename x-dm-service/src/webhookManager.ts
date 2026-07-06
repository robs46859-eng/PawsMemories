/**
 * Webhook lifecycle manager (§5.1).
 *
 * Manages the X Activity API webhook registration using the app-only bearer token.
 *
 * On boot:
 *   1. GET /2/webhooks (A2) — list existing webhooks.
 *   2. If our X_WEBHOOK_URL is missing from the list → POST /2/webhooks (A1).
 *   3. If valid:false → PUT /2/webhooks/:id (A3) to re-trigger CRC.
 *   4. Persist webhook_id in kv store.
 *
 * Handles documented failure codes on A1: CrcValidationFailed, UrlValidationFailed,
 * DuplicateUrlFailed, WebhookLimitExceeded.
 *
 * Also provides a replay function (A5) but does not schedule it.
 *
 * Spec: X_DM_REFINEMENT_SPEC.md §5.1
 *
 * TODO(§7.6): Before wiring, verify exact endpoint paths and payload shapes
 * against https://docs.x.com/x-api/webhooks/quickstart for the account's tier.
 */

import { getConfig } from './config.js';
import { kvSet, kvDelete, KV_KEYS } from './db.js';
import { getAppOnlyBearerToken, xFetch } from './xClient.js';

// ---------------------------------------------------------------------------
// App-only bearer token cache
// ---------------------------------------------------------------------------

let appOnlyToken: string | null = null;
let appOnlyTokenExpiry: number = 0; // epoch ms

/**
 * Get a cached app-only bearer token, refreshing if expired.
 */
async function getAppToken(): Promise<string> {
  const now = Date.now();
  if (appOnlyToken && now < appOnlyTokenExpiry) {
    return appOnlyToken;
  }
  const cfg = getConfig();
  // The spec says API Key (consumer key) and API Key Secret (consumer secret)
  // are used for app-only bearer. We use X_CLIENT_ID and X_CLIENT_SECRET as the
  // consumer key/secret pair.
  // TODO(§7.6): Confirm whether X_CLIENT_ID/X_CLIENT_SECRET or the OAuth 1.0a
  // consumer key/secret pair is required for app-only auth on the current tier.
  const resp = await getAppOnlyBearerToken(cfg.X_CLIENT_ID, cfg.X_CLIENT_SECRET);
  appOnlyToken = resp.access_token;
  appOnlyTokenExpiry = now + (resp.expires_in - 60) * 1000; // 60s safety margin
  console.log('[WebhookManager] App-only bearer token refreshed');
  return appOnlyToken!;
}

// ---------------------------------------------------------------------------
// API Base
// ---------------------------------------------------------------------------

const API_V2 = 'https://api.x.com/2';

// ---------------------------------------------------------------------------
// A1 — Register webhook
// ---------------------------------------------------------------------------

export interface WebhookResponse {
  id: string;
  url: string;
  valid: boolean;
  created_at?: string;
}

interface RegisterWebhookResponse {
  data: WebhookResponse;
  errors?: Array<{ code?: string; message: string }>;
}

const REGISTER_ERROR_CODES = [
  'CrcValidationFailed',
  'UrlValidationFailed',
  'DuplicateUrlFailed',
  'WebhookLimitExceeded',
] as const;

/**
 * POST /2/webhooks — register a new webhook endpoint.
 * X fires CRC immediately on success.
 *
 * @returns The webhook id on success.
 * @throws on failure with the X error detail.
 */
export async function registerWebhook(): Promise<string> {
  const cfg = getConfig();
  const token = await getAppToken();
  const url = `${API_V2}/webhooks`;

  const resp = await xFetch(url, {
    method: 'POST',
    token,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: cfg.X_WEBHOOK_URL }),
  });

  if (!resp.ok) {
    const body = await resp.json().catch(() => ({}));
    const details = body as RegisterWebhookResponse;
    const errMsg = details.errors?.[0]?.message || `HTTP ${resp.status}`;
    const errCode = details.errors?.[0]?.code;

    // Log the specific failure code for diagnostics
    if (errCode && REGISTER_ERROR_CODES.includes(errCode as typeof REGISTER_ERROR_CODES[number])) {
      console.error(`[WebhookManager] Registration failed: ${errCode} — ${errMsg}`);
    }

    throw new Error(`Webhook registration failed: ${errMsg}`);
  }

  const body = (await resp.json()) as RegisterWebhookResponse;
  const webhookId = body.data?.id;
  if (!webhookId) {
    throw new Error('Webhook registration returned no id');
  }

  await kvSet(KV_KEYS.WEBHOOK_ID, webhookId);
  await kvSet(KV_KEYS.WEBHOOK_VALID, 'true');
  console.log(`[WebhookManager] Registered webhook ${webhookId}`);
  return webhookId;
}

// ---------------------------------------------------------------------------
// A2 — List webhooks
// ---------------------------------------------------------------------------

interface ListWebhooksResponse {
  data: WebhookResponse[];
}

/**
 * GET /2/webhooks — list all registered webhooks.
 * Returns the full list; caller matches by URL.
 */
export async function listWebhooks(): Promise<WebhookResponse[]> {
  const token = await getAppToken();
  const resp = await xFetch(`${API_V2}/webhooks`, { method: 'GET', token });

  if (!resp.ok) {
    throw new Error(`List webhooks failed: HTTP ${resp.status}`);
  }

  const body = (await resp.json()) as ListWebhooksResponse;
  return body.data ?? [];
}

// ---------------------------------------------------------------------------
// A3 — Re-validate webhook (re-trigger CRC)
// ---------------------------------------------------------------------------

/**
 * PUT /2/webhooks/:webhook_id — re-trigger CRC to re-enable an invalidated webhook.
 * Returns true if the webhook is now valid.
 */
export async function revalidateWebhook(webhookId: string): Promise<boolean> {
  const token = await getAppToken();
  const resp = await xFetch(`${API_V2}/webhooks/${webhookId}`, {
    method: 'PUT',
    token,
  });

  if (!resp.ok) {
    throw new Error(`Webhook revalidation failed: HTTP ${resp.status}`);
  }

  const body = (await resp.json()) as RegisterWebhookResponse;
  const valid = body.data?.valid ?? false;
  await kvSet(KV_KEYS.WEBHOOK_VALID, String(valid));
  console.log(`[WebhookManager] Revalidated webhook ${webhookId}: valid=${valid}`);
  return valid;
}

// ---------------------------------------------------------------------------
// A4 — Delete webhook
// ---------------------------------------------------------------------------

/**
 * DELETE /2/webhooks/:webhook_id — teardown.
 */
export async function deleteWebhook(webhookId: string): Promise<void> {
  const token = await getAppToken();
  const resp = await xFetch(`${API_V2}/webhooks/${webhookId}`, {
    method: 'DELETE',
    token,
  });

  if (!resp.ok) {
    const body = await resp.json().catch(() => ({}));
    throw new Error(`Webhook deletion failed: HTTP ${resp.status} — ${JSON.stringify(body)}`);
  }

  await kvDelete(KV_KEYS.WEBHOOK_ID);
  await kvSet(KV_KEYS.WEBHOOK_VALID, 'false');
  console.log(`[WebhookManager] Deleted webhook ${webhookId}`);
}

// ---------------------------------------------------------------------------
// A5 — Replay webhook (recover missed events after outage)
// ---------------------------------------------------------------------------

/**
 * POST /2/webhooks/:webhook_id/replay — triggers a replay job.
 * Does NOT schedule recurring replay; callers manage that.
 *
 * @param webhookId - The webhook to replay missed events for.
 * @param fromEventId - Replay events after this event id (optional).
 */
export async function replayWebhook(
  webhookId: string,
  fromEventId?: string,
): Promise<void> {
  const token = await getAppToken();
  const body: Record<string, unknown> = {};

  if (fromEventId) {
    body.from_event_id = fromEventId;
  }

  const resp = await xFetch(`${API_V2}/webhooks/${webhookId}/replay`, {
    method: 'POST',
    token,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => 'unknown');
    throw new Error(`Webhook replay failed: HTTP ${resp.status} — ${text}`);
  }

  console.log(`[WebhookManager] Replay triggered for webhook ${webhookId}`);
}

// ---------------------------------------------------------------------------
// Boot-time webhook lifecycle
// ---------------------------------------------------------------------------

/**
 * Persist a webhook's identity into the kv store and revalidate if invalid.
 * Shared by exact and case-insensitive match paths.
 */
async function adoptWebhook(wh: WebhookResponse): Promise<void> {
  console.log(`[WebhookManager] Adopting webhook ${wh.id} (valid=${wh.valid})`);
  await kvSet(KV_KEYS.WEBHOOK_ID, wh.id);
  await kvSet(KV_KEYS.WEBHOOK_VALID, String(wh.valid));

  if (!wh.valid) {
    console.log('[WebhookManager] Webhook is invalid — revalidating...');
    await revalidateWebhook(wh.id);
  }
}

/**
 * Called once on service boot. Ensures our webhook is registered and valid.
 *
 * 1. List existing webhooks.
 * 2. If our X_WEBHOOK_URL is found (exact or case-insensitive): adopt it.
 * 3. If not found: register a new webhook.
 *
 * Returns the active webhook id.
 *
 * Case-insensitive matching prevents a permanent wedge (WebhookLimitExceeded)
 * when the stored webhook URL has different casing than the env var.
 */
export async function ensureWebhookRegistered(): Promise<string> {
  const cfg = getConfig();

  if (!cfg.X_WEBHOOK_URL) {
    console.warn('[WebhookManager] X_WEBHOOK_URL is empty — skipping webhook registration');
    return '';
  }

  console.log('[WebhookManager] Ensuring webhook is registered...');

  try {
    const webhooks = await listWebhooks();

    // Find our webhook by URL match — exact first, then case-insensitive.
    // A case-insensitive match prevents a permanent wedge (WebhookLimitExceeded)
    // when the stored URL has different casing than the env var (e.g. old deploy
    // wrote /Webhooks/X but current config uses /webhooks/x).
    const exact = webhooks.find((wh) => wh.url === cfg.X_WEBHOOK_URL);
    if (exact) {
      await adoptWebhook(exact);
      return exact.id;
    }

    const fuzzy = webhooks.find(
      (wh) => wh.url.toLowerCase() === cfg.X_WEBHOOK_URL.toLowerCase(),
    );
    if (fuzzy) {
      console.warn(
        `[WebhookManager] Found webhook ${fuzzy.id} at URL "${fuzzy.url}" — ` +
        `adopting despite case mismatch with configured "${cfg.X_WEBHOOK_URL}"`,
      );
      await adoptWebhook(fuzzy);
      return fuzzy.id;
    }

    // Register a new webhook
    console.log('[WebhookManager] No existing webhook found — registering...');
    const webhookId = await registerWebhook();
    return webhookId;
  } catch (err) {
    console.error(`[WebhookManager] Boot-time setup failed: ${(err as Error).message}`);
    console.warn('[WebhookManager] Will retry on next health check. Polling fallback may activate.');
    return '';
  }
}