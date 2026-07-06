/**
 * Tests for subscriptions — user-token auth, no-token skip, 401→retry.
 *
 * Spec: X_DM_REFINEMENT_SPEC.md §5.3
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock botTokenStore
vi.mock('../src/botTokenStore.js', () => ({
  getBotUserToken: vi.fn(),
  refreshAndPersist: vi.fn(),
}));

// Mock xClient
vi.mock('../src/xClient.js', () => ({
  xFetch: vi.fn(),
}));

// Mock db
vi.mock('../src/db.js', () => ({
  kvSet: vi.fn(),
  KV_KEYS: {
    SUBSCRIPTION_DM_RECEIVED: 'subscription_dm_received_id',
    SUBSCRIPTION_DM_SENT: 'subscription_dm_sent_id',
  },
}));

import { getBotUserToken, refreshAndPersist } from '../src/botTokenStore.js';
import { xFetch } from '../src/xClient.js';
import {
  ensureSubscriptions,
  createSubscription,
  listSubscriptions,
} from '../src/subscriptions.js';

// Mock config
vi.mock('../src/config.js', () => ({
  getConfig: vi.fn(() => ({
    X_CLIENT_ID: 'test-client-id',
    X_CLIENT_SECRET: 'test-client-secret',
    X_BOT_USER_ID: 'bot-user-12345',
  })),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const existingSubscriptions = [
  {
    id: 'sub-dm-received-001',
    event_type: 'dm.received',
    webhook_id: 'wh-001',
    tag: 'pawsome3d-dm-in',
    filter: { user_id: 'bot-user-12345' },
  },
  {
    id: 'sub-dm-sent-001',
    event_type: 'dm.sent',
    webhook_id: 'wh-001',
    tag: 'pawsome3d-dm-out',
    filter: { user_id: 'bot-user-12345' },
  },
];

function makeOkResponse(body?: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body ?? { data: existingSubscriptions },
    text: async () => '',
    headers: new Headers(),
  } as Response;
}

function makeErrorResponse(status: number, body?: string): Response {
  return {
    ok: false,
    status,
    text: async () => body ?? 'error',
    headers: new Headers(),
    json: async () => ({}),
  } as Response;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('subscriptions — user-token auth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -----------------------------------------------------------------------
  // No-token skip
  // -----------------------------------------------------------------------

  describe('when no bot token is available', () => {
    beforeEach(() => {
      vi.mocked(getBotUserToken).mockRejectedValue(
        new Error('No bot user token available — complete OAuth flow at /oauth/start'),
      );
    });

    it('ensureSubscriptions should log warning and skip gracefully', async () => {
      // Should not throw
      await expect(ensureSubscriptions('wh-001')).resolves.toBeUndefined();

      // Should not call the API
      expect(xFetch).not.toHaveBeenCalled();
    });

    it('createSubscription should return empty string without calling API', async () => {
      const result = await createSubscription('wh-001', 'dm.received', 'test-tag');

      expect(result).toBe('');
      expect(xFetch).not.toHaveBeenCalled();
    });

    it('listSubscriptions should return empty array without calling API', async () => {
      const result = await listSubscriptions();

      expect(result).toEqual([]);
      expect(xFetch).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // User token authentication
  // -----------------------------------------------------------------------

  describe('with bot token', () => {
    beforeEach(() => {
      vi.mocked(getBotUserToken).mockResolvedValue('test-bot-token');
      vi.mocked(refreshAndPersist).mockResolvedValue('refreshed-token');
    });

    it('createSubscription should use the bot user token', async () => {
      vi.mocked(xFetch).mockResolvedValue(
        makeOkResponse({
          data: { id: 'sub-new', event_type: 'dm.received', webhook_id: 'wh-001' },
        }),
      );

      const result = await createSubscription('wh-001', 'dm.received', 'test-tag');

      expect(result).toBe('sub-new');

      // Verify the token was passed to xFetch
      const opts = vi.mocked(xFetch).mock.calls[0][1] as { token?: string };
      expect(opts.token).toBe('test-bot-token');
    });

    it('listSubscriptions should use the bot user token', async () => {
      vi.mocked(xFetch).mockResolvedValue(makeOkResponse());

      await listSubscriptions();

      const opts = vi.mocked(xFetch).mock.calls[0][1] as { token?: string };
      expect(opts.token).toBe('test-bot-token');
    });

    it('should retry once on 401 after token refresh', async () => {
      // First call returns 401, second (after refresh) returns 200
      vi.mocked(xFetch)
        .mockResolvedValueOnce(makeErrorResponse(401))
        .mockResolvedValueOnce(
          makeOkResponse({
            data: { id: 'sub-retry', event_type: 'dm.received', webhook_id: 'wh-001' },
          }),
        );

      const result = await createSubscription('wh-001', 'dm.received', 'test-tag');

      expect(result).toBe('sub-retry');
      expect(refreshAndPersist).toHaveBeenCalledTimes(1);
      expect(xFetch).toHaveBeenCalledTimes(2);

      // Verify second call used new token
      const secondOpts = vi.mocked(xFetch).mock.calls[1][1] as { token?: string };
      expect(secondOpts.token).toBe('refreshed-token');
    });

    it('should propagate non-401 errors', async () => {
      vi.mocked(xFetch).mockResolvedValue(makeErrorResponse(403, 'Forbidden'));

      await expect(
        createSubscription('wh-001', 'dm.received', 'test-tag'),
      ).rejects.toThrow('Subscription create failed for dm.received: HTTP 403 — Forbidden');
    });

    it('should handle 409 (already exists) gracefully', async () => {
      vi.mocked(xFetch).mockResolvedValue(makeErrorResponse(409));

      const result = await createSubscription('wh-001', 'dm.received', 'test-tag');

      // 409 returns empty string, not an error
      expect(result).toBe('');
    });

    it('ensureSubscriptions should create missing subscriptions', async () => {
      // List returns only the 'received' subscription — needs 'sent'
      vi.mocked(xFetch)
        .mockResolvedValueOnce(
          makeOkResponse({
            data: [existingSubscriptions[0]], // only dm.received exists
          }),
        )
        .mockResolvedValueOnce(
          makeOkResponse({
            data: {
              id: 'sub-sent-new',
              event_type: 'dm.sent',
              webhook_id: 'wh-001',
            },
          }),
        );

      await ensureSubscriptions('wh-001');

      // First call: list subscriptions (GET)
      // Second call: create dm.sent (POST)
      expect(xFetch).toHaveBeenCalledTimes(2);

      const secondCallOpts = vi.mocked(xFetch).mock.calls[1][1] as {
        method?: string;
      };
      expect(secondCallOpts.method).toBe('POST');
    });

    it('ensureSubscriptions should skip when both subscriptions already exist', async () => {
      vi.mocked(xFetch).mockResolvedValue(makeOkResponse());

      await ensureSubscriptions('wh-001');

      // Only list was called, no creates
      expect(xFetch).toHaveBeenCalledTimes(1);
    });
  });
});