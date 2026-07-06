/**
 * Entry point for x-dm-service.
 *
 * Express + TypeScript server implementing:
 *   - Webhook CRC + event delivery (§5.2)
 *   - DM event processing with dedupe (§5.7)
 *   - Webhook lifecycle management (§5.1)
 *   - DM event subscriptions (§5.3)
 *   - Polling fallback (§5.4)
 *   - DM conversation state machine (M3+)
 *   - Trend harvester (M6+)
 *
 * Spec: X_DM_REFINEMENT_SPEC.md
 */

import express from 'express';
import { getConfig } from './config.js';
import { createWebhookRouter } from './routes/webhooks.js';
import { createOAuthRouter } from './routes/oauth.js';
import { ensureWebhookRegistered } from './webhookManager.js';
import { ensureSubscriptions } from './subscriptions.js';
import { startPoller } from './poller.js';

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

// Load + validate config early — exits loudly on failure
const config = getConfig();
console.log(`[Boot] x-dm-service starting...`);
console.log(`[Boot] PORT=${config.PORT}`);

const app = express();

// ---------------------------------------------------------------------------
// Webhook routes — raw body parser MUST come before global JSON parser (§7.3)
// ---------------------------------------------------------------------------

// Mount raw body parser on /webhooks/x so signature verification works
// over the original bytes (timing-safe compare requires raw body).
app.use('/webhooks/x', express.raw({ type: '*/*' }));

// Attach webhook router
app.use('/webhooks/x', createWebhookRouter(config.X_CONSUMER_SECRET));

// ---------------------------------------------------------------------------
// Global middleware
// ---------------------------------------------------------------------------

// JSON parser for all other routes
app.use(express.json());

// ---------------------------------------------------------------------------
// OAuth routes — PKCE flow for bot token seeding (§4.1)
// ---------------------------------------------------------------------------

app.use('/oauth', createOAuthRouter());

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'x-dm-service' });
});

app.get('/', (_req, res) => {
  res.json({
    service: 'x-dm-service',
    version: '1.0.0',
    milestone: 'M2',
    docs: 'https://github.com/...',
  });
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

app.listen(config.PORT, async () => {
  console.log(`[Boot] x-dm-service listening on :${config.PORT}`);

  // Boot-time webhook lifecycle (§5.1)
  const webhookId = await ensureWebhookRegistered();

  // Boot-time subscription setup (§5.3)
  await ensureSubscriptions(webhookId);

  // Start polling fallback (§5.4) — activates only when webhook is invalid/stale
  startPoller();
});

export default app;

// ---------------------------------------------------------------------------
// Global error handlers — keep the server alive for DB/network failures
// ---------------------------------------------------------------------------

process.on('unhandledRejection', (reason) => {
  console.error('[Process] UNHANDLED REJECTION — server stays alive');
  console.error(`  Reason: ${(reason as Error)?.message ?? reason}`);
  if ((reason as Error)?.stack) {
    const lines = (reason as Error).stack!.split('\n').slice(0, 5).join('\n');
    console.error(`  Stack (top 5):\n${lines}`);
  }
});

process.on('uncaughtException', (err) => {
  console.error('[Process] UNCAUGHT EXCEPTION — server stays alive');
  console.error(`  Error: ${err.message}`);
  console.error(`  Stack (top 5):\n${err.stack?.split('\n').slice(0, 5).join('\n') ?? 'none'}`);
});