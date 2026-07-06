/**
 * Webhook routes for X Activity API events.
 *
 * Implements:
 *   - GET /webhooks/x — CRC challenge-response (§5.2)
 *   - POST /webhooks/x — DM event delivery with signature verification (§5.2)
 *
 * Spec: X_DM_REFINEMENT_SPEC.md §5.2, §7.3
 *
 * IMPORTANT: The raw-body parser must be registered on the /webhooks/x
 * route BEFORE any global JSON parser to preserve the signature payload.
 */

import { Router, type Request, type Response } from 'express';
import crypto from 'node:crypto';
import { processWebhookPayload } from '../eventProcessor.js';
import { recordWebhookEvent } from '../poller.js';

/** Create webhook router. Pass the consumer secret at mount time. */
export function createWebhookRouter(consumerSecret: string): Router {
  const router = Router();

  // -----------------------------------------------------------------------
  // GET /webhooks/x — CRC challenge (§5.2)
  //
  // X validates the endpoint on registration and hourly.
  // Must respond within 3 seconds.
  // -----------------------------------------------------------------------
  router.get('/', (req: Request, res: Response) => {
    const crcToken = req.query.crc_token;

    if (!crcToken || typeof crcToken !== 'string') {
      return res.status(400).json({ error: 'Missing crc_token query parameter' });
    }

    const hmac = crypto
      .createHmac('sha256', consumerSecret)
      .update(crcToken)
      .digest('base64');

    res.json({ response_token: `sha256=${hmac}` });
  });

  // -----------------------------------------------------------------------
  // POST /webhooks/x — DM event delivery with signature verification (§5.2)
  //
  // Signature header: x-twitter-webhooks-signature
  // Verifies over the RAW body (not parsed JSON). Dedupe by event id.
  //
  // Our own outbound DMs are also delivered here — filter
  // sender_id === X_BOT_USER_ID to ignore own echoes.
  //
  // IMPORTANT: Respond 200 to X immediately; process the payload async
  // after responding (X expects a 2xx within 3 seconds).
  // -----------------------------------------------------------------------
  router.post('/', (req: Request, res: Response) => {
    // req.body is a Buffer because the caller mounts express.raw() on this route
    const rawBody: Buffer = req.body;
    const signature = req.headers['x-twitter-webhooks-signature'] as string | undefined;

    if (!signature) {
      console.warn('[Webhooks] POST /webhooks/x missing signature header');
      return res.status(400).json({ error: 'Missing x-twitter-webhooks-signature header' });
    }

    if (!verifySignature(rawBody, signature, consumerSecret)) {
      console.warn('[Webhooks] POST /webhooks/x invalid signature — rejecting');
      return res.status(401).json({ error: 'Invalid signature' });
    }

    // Parse JSON from raw body
    let payload: unknown;
    try {
      payload = JSON.parse(rawBody.toString('utf8'));
    } catch {
      return res.status(400).json({ error: 'Invalid JSON body' });
    }

    // Record webhook activity for poller fallback tracking
    recordWebhookEvent();

    // Respond 200 immediately, process asynchronously
    res.status(200).json({ ok: true });

    // Async processing — fire-and-forget after response
    processWebhookPayload(payload, 'webhook').catch((err) => {
      console.error(`[Webhooks] Async event processing error: ${(err as Error).message}`);
    });
  });

  return router;
}

// -----------------------------------------------------------------------
// Signature verification (§5.2, §7.3)
//
// Uses crypto.timingSafeEqual to prevent timing attacks.
// -----------------------------------------------------------------------

/**
 * Verify the X webhook signature over a raw body buffer.
 *
 * @param rawBody - The raw request body (Buffer), NOT parsed JSON.
 * @param header - The value of the x-twitter-webhooks-signature header.
 * @param consumerSecret - The X consumer secret (API Key Secret).
 * @returns true if the signature matches.
 */
export function verifySignature(
  rawBody: Buffer,
  header: string,
  consumerSecret: string,
): boolean {
  const expected = 'sha256=' + crypto
    .createHmac('sha256', consumerSecret)
    .update(rawBody)
    .digest('base64');

  // timingSafeEqual requires equal-length buffers
  const expectedBuf = Buffer.from(expected);
  const headerBuf = Buffer.from(header);

  if (expectedBuf.length !== headerBuf.length) {
    return false;
  }

  return crypto.timingSafeEqual(expectedBuf, headerBuf);
}