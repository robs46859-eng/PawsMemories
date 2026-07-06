/**
 * DM sender — sends DMs via the X API v2 (§5.5).
 *
 * - Prefers A17 (POST /2/dm_conversations/:id/messages) when conversationId
 *   is known, else A16 (POST /2/dm_conversations/with/:participant_id/messages).
 * - Uses bot USER token (not app-only).
 * - On 401 → refresh token once, retry.
 * - On 403 → mark and don't retry (§7.1).
 * - Daily send counter against DM_DAILY_SEND_CAP (§5.10).
 *
 * Spec: X_DM_REFINEMENT_SPEC.md §5.5, §7.1
 *
 * TODO(§7.6): Verify exact endpoint paths and response shapes for DM send
 * against https://docs.x.com/x-api/direct-messages/manage/integrate .
 */

import { getConfig } from './config.js';
import { xFetch } from './xClient.js';
import { getBotUserToken, refreshAndPersist } from './botTokenStore.js';
import { kvGet, kvSet, KV_KEYS } from './db.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SendDmOptions {
  /** Known X DM conversation id (preferred — uses A17) */
  conversationId?: string;
  /** Participant id for 1:1 message (fallback — uses A16) */
  participantId?: string;
  /** Message text */
  text: string;
  /** Optional media_id for attachment */
  mediaId?: string;
}

interface DmSendResponse {
  data?: {
    dm_conversation_id?: string;
    dm_event_id?: string;
  };
  errors?: Array<{ code?: string; message: string }>;
}

// ---------------------------------------------------------------------------
// Daily send cap
// ---------------------------------------------------------------------------

/**
 * Check and increment the daily DM send counter.
 * Returns true if allowed, false if cap exceeded.
 */
async function checkDailyCap(): Promise<boolean> {
  const cfg = getConfig();
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD UTC

  const storedDate = await kvGet(KV_KEYS.DM_DAILY_DATE);
  let count = 0;

  if (storedDate === today) {
    const storedCount = await kvGet(KV_KEYS.DM_DAILY_COUNT);
    count = storedCount ? Number(storedCount) : 0;
  } else {
    // New day — reset counter
    await kvSet(KV_KEYS.DM_DAILY_DATE, today);
    await kvSet(KV_KEYS.DM_DAILY_COUNT, '0');
  }

  if (count >= cfg.DM_DAILY_SEND_CAP) {
    console.error(`[DmSender] DAILY DM CAP REACHED: ${count}/${cfg.DM_DAILY_SEND_CAP} — refusing send`);
    return false;
  }

  // Increment
  await kvSet(KV_KEYS.DM_DAILY_COUNT, String(count + 1));
  return true;
}

// ---------------------------------------------------------------------------
// Send DM
// ---------------------------------------------------------------------------

/**
 * Send a DM via the X API.
 *
 * @returns The dm_event_id on success, or null if rate-capped.
 * @throws On non-recoverable errors (403, unexpected API errors).
 */
export async function sendDm(options: SendDmOptions): Promise<string | null> {
  const { conversationId, participantId, text, mediaId } = options;

  // Validate: must have at least conversationId or participantId
  if (!conversationId && !participantId) {
    throw new Error('sendDm requires either conversationId or participantId');
  }

  // Check daily cap
  const allowed = await checkDailyCap();
  if (!allowed) return null;

  // Build body
  const body: Record<string, unknown> = { text };
  if (mediaId) {
    body.attachments = [{ media_id: mediaId }];
  }

  // Build URL — prefer A17 (by conversation id)
  let url: string;
  if (conversationId) {
    url = `https://api.x.com/2/dm_conversations/${conversationId}/messages`;
  } else {
    url = `https://api.x.com/2/dm_conversations/with/${participantId}/messages`;
  }

  // Send with retry on 401
  const result = await sendWithRetry(url, body);
  return result;
}

/**
 * Send the DM request, retrying once on 401 after token refresh.
 * On 403, does NOT retry and logs the permanent block.
 */
async function sendWithRetry(
  url: string,
  body: Record<string, unknown>,
): Promise<string | null> {
  let token = await getBotUserToken();
  let retried = false;

  for (let attempt = 0; attempt < 2; attempt++) {
    const resp = await xFetch(url, {
      method: 'POST',
      token,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    // Success
    if (resp.ok) {
      const js = (await resp.json()) as DmSendResponse;
      const eventId = js.data?.dm_event_id;
      if (eventId) {
        console.log(`[DmSender] Sent DM: ${eventId}`);
      }
      return eventId ?? null;
    }

    // 403 — user blocked or closed DMs (§7.1)
    if (resp.status === 403) {
      console.warn(`[DmSender] 403 — recipient blocked DMs or unknown: ${url}`);
      return null; // Don't retry
    }

    // 401 — token may be expired (§7.1)
    if (resp.status === 401 && !retried) {
      console.log('[DmSender] 401 — refreshing token and retrying...');
      try {
        token = await refreshAndPersist();
        retried = true;
        continue; // Retry with new token
      } catch (refreshErr) {
        console.error(`[DmSender] Token refresh failed: ${(refreshErr as Error).message}`);
        throw new Error('DM send failed: token refresh failed after 401');
      }
    }

    // Other errors
    const text = await resp.text().catch(() => 'unknown');
    throw new Error(`DM send failed: HTTP ${resp.status} — ${text}`);
  }

  return null;
}