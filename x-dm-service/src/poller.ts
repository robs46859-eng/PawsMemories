/**
 * Polling fallback for DM events (§5.4).
 *
 * When the webhook is invalid or no webhook events have arrived in 15 minutes,
 * this poller fetches all DM events via A12 (GET /2/dm_events) on a 60s interval,
 * paginates until the last-seen event id, and feeds events through the same
 * eventProcessor path (received_via='poll').
 *
 * Spec: X_DM_REFINEMENT_SPEC.md §5.4, §7.1
 *
 * TODO(§7.6): Before wiring, verify the exact query parameters and response shape
 * for GET /2/dm_events against https://docs.x.com/x-api/direct-messages/lookup/introduction.
 */

import { kvGet, kvSet, KV_KEYS } from './db.js';
import { xFetch, getBotToken } from './xClient.js';
import { processWebhookPayload } from './eventProcessor.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DmEventResponse {
  data?: Array<{
    id: string;
    text?: string;
    event_type?: string;
    dm_conversation_id?: string;
    sender_id?: string;
    created_at?: string;
    attachments?: {
      media_keys?: string[];
    };
  }>;
  meta?: {
    result_count?: number;
    next_token?: string;
    previous_token?: string;
  };
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let pollInterval: ReturnType<typeof setInterval> | null = null;
let lastWebhookEventAt: number = 0;
let isPolling: boolean = false;

/**
 * Record that a webhook event was received (called by the webhook handler).
 * This is used to decide whether polling fallback should be active.
 */
export function recordWebhookEvent(): void {
  lastWebhookEventAt = Date.now();
}

/**
 * Check whether polling fallback should be active.
 * Returns true when:
 *   - Webhook is known to be invalid (from kv store), OR
 *   - No webhook event in the last 15 minutes while processing is active.
 */
async function shouldPoll(): Promise<boolean> {
  // Check webhook validity from kv store
  const valid = await kvGet(KV_KEYS.WEBHOOK_VALID);
  if (valid === 'false') {
    return true;
  }

  // Check if 15 min has elapsed since last webhook event
  const sinceLast = Date.now() - lastWebhookEventAt;
  if (sinceLast > 15 * 60 * 1000 && lastWebhookEventAt > 0) {
    console.log('[Poller] No webhook event in 15+ min — activating poll fallback');
    return true;
  }

  // If we never received a webhook event and are within the grace period, don't poll
  if (lastWebhookEventAt === 0) {
    // Check from kv store if we've ever received one
    const stored = await kvGet(KV_KEYS.LAST_WEBHOOK_EVENT_AT);
    if (stored) {
      lastWebhookEventAt = Number(stored);
      return Date.now() - lastWebhookEventAt > 15 * 60 * 1000;
    }
  }

  return false;
}

// ---------------------------------------------------------------------------
// Poll execution
// ---------------------------------------------------------------------------

/**
 * Execute one poll cycle: fetch all DM events via A12, paginate until
 * last-seen event id, feed through eventProcessor.
 */
export async function pollOnce(): Promise<number> {
  if (isPolling) return 0;
  isPolling = true;

  let totalProcessed = 0;
  let paginationToken: string | undefined;
  let hasMore = true;
  let iterations = 0;
  const MAX_PAGES = 10; // safety limit per poll cycle

  try {
    const token = getBotToken();
    const lastSeenId = await kvGet(KV_KEYS.LAST_SEEN_EVENT_ID);

    while (hasMore && iterations < MAX_PAGES) {
      iterations++;

      // Build the query string with the exact params from spec §5.4
      const baseParams = new URLSearchParams({
        'dm_event.fields': 'id,text,event_type,dm_conversation_id,sender_id,created_at,attachments',
        'expansions': 'attachments.media_keys,sender_id',
        'media.fields': 'url,type,width,height',
        'max_results': '100',
      });

      if (paginationToken) {
        baseParams.set('pagination_token', paginationToken);
      }

      // TODO(§7.6): Verify the exact endpoint path for DM event lookup.
      // The spec uses GET /2/dm_events but the docs.x.com may use a different path.
      const url = `https://api.x.com/2/dm_events?${baseParams.toString()}`;

      const resp = await xFetch(url, { method: 'GET', token });

      if (!resp.ok) {
        // 429 is handled by xFetch, other errors should stop polling
        const text = await resp.text().catch(() => 'unknown');
        console.error(`[Poller] DM events fetch failed: HTTP ${resp.status} — ${text}`);
        break;
      }

      const js = (await resp.json()) as DmEventResponse;
      const events = js.data ?? [];

      // Process each event (dedupe against dm_events_log happens inside)
      for (const ev of events) {
        // Normalize poll response shape to match what processWebhookPayload expects
        const normalized = {
          dm_event: {
            id: ev.id,
            text: ev.text ?? null,
            event_type: ev.event_type ?? 'MessageCreate',
            dm_conversation_id: ev.dm_conversation_id,
            sender_id: ev.sender_id,
            created_at: ev.created_at,
            attachments: ev.attachments ? { media_keys: ev.attachments.media_keys } : undefined,
          },
        };

        const processed = await processWebhookPayload(normalized, 'poll');
        totalProcessed += processed.length;
      }

      // Stop paginating if we hit the last-seen event id
      if (lastSeenId && events.some((ev) => ev.id === lastSeenId)) {
        hasMore = false;
      } else {
        paginationToken = js.meta?.next_token;
        hasMore = !!paginationToken && events.length > 0;
      }
    }
  } catch (err) {
    console.error(`[Poller] Error during poll cycle: ${(err as Error).message}`);
  } finally {
    isPolling = false;
  }

  if (totalProcessed > 0) {
    console.log(`[Poller] Poll cycle complete — processed ${totalProcessed} new events (${iterations} page(s))`);
  }

  return totalProcessed;
}

// ---------------------------------------------------------------------------
// Start / Stop
// ---------------------------------------------------------------------------

/**
 * Start the polling loop. Runs every 60 seconds, but only actually calls
 * pollOnce() when shouldPoll() returns true (webhook invalid or stale).
 */
export function startPoller(): void {
  if (pollInterval) {
    console.warn('[Poller] Already running');
    return;
  }

  console.log('[Poller] Starting polling loop (60s interval)');
  pollInterval = setInterval(async () => {
    try {
      const active = await shouldPoll();
      if (active) {
        await pollOnce();
      }
    } catch (err) {
      console.error(`[Poller] Cycle error: ${(err as Error).message}`);
    }
  }, 60_000);

  // Also run an immediate check
  shouldPoll().then((active) => {
    if (active) pollOnce();
  });
}

/**
 * Stop the polling loop.
 */
export function stopPoller(): void {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
    console.log('[Poller] Stopped');
  }
}

/**
 * Manually mark webhook as invalid (triggers poll fallback on next tick).
 */
export function markWebhookInvalid(): void {
  kvSet(KV_KEYS.WEBHOOK_VALID, 'false').catch(() => {});
  console.log('[Poller] Webhook marked invalid — poll fallback will activate');
}