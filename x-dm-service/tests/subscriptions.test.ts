/**
 * Tests for subscriptions — user-token auth, no-token skip, 401→retry.
 *
 * Spec: X_DM_REFINEMENT_SPEC.md §5.3
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock botTokenStore
vi.mock('../src/botTokenStore.js', () => ({
  getBotUserToken: vi.fn(),
  refreshAndPersist: vi.fn(),
}));

// Mock xClient
vi.mock('../src/xClient.js', () => ({
  xFetch: vi.fn(),
}));

// Mock oauth1 — checks config internally, we mock config instead
vi.mock('../src/oauth1.js', () => ({
  signRequest: vi.fn(),
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
import { signRequest } from '../src/oauth1.js';
import { getConfig } from '../src/config.js';
import {
  ensureSubscriptions,
  createSubscription,
  listSubscriptions,
} from '../src/subscriptions.js';

// Mock config — use a mutable object that tests can directly modify
const mockConfig: Record<string, unknown> = {
  X_CLIENT_ID: 'test-client-id',
  X_CLIENT_SECRET: 'test-client-secret',
  X_BOT_USER_ID: 'bot-user-12345',
  X_CONSUMER_KEY: '',
  X_CONSUMER_SECRET: '',
  X_ACCESS_TOKEN: '',
  X_ACCESS_TOKEN_SECRET: '',
  X_BEARER_TOKEN: '',
  X_BOT_ACCESS_TOKEN: '',
  X_BOT_REFRESH_TOKEN: '',
  X_WEBHOOK_URL: '',
  DB_HOST: '',
  DB_NAME: '',
  DB_USER: '',
  DB_PASSWORD: '',
  BLENDER_WORKER_URL: '',
  WORKER_SHARED_SECRET: '',
  LLM_API_KEY: '',
  LLM_MODEL: '',
  MEDIA_BUCKET_NAME: '',
  MEDIA_BUCKET_URL: '',
  MEDIA_BUCKET_KEY: '',
  MEDIA_BUCKET_SECRET: '',
  DM_DAILY_SEND_CAP: 400,
  HARVEST_MAX_POSTS_PER_RUN: 300,
  PORT: 3001,
};
vi.mock('../src/config.js', () => ({
  getConfig: vi.fn(() => mockConfig),
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
  const data = body ?? { data: existingSubscriptions };
  const text = '';
  return {
    ok: true,
    status: 200,
    json: async () => data,
    text: async () => text,
    clone: () => ({ json: async () => data, text: async () => text, ok: true, status: 200, headers: new Headers() } as Response),
    headers: new Headers(),
  } as Response;
}

function makeErrorResponse(status: number, body?: string): Response {
  const text = body ?? 'error';
  return {
    ok: false,
    status,
    text: async () => text,
    clone: () => ({ text: async () => text, ok: false, status, headers: new Headers() } as Response),
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

  // -----------------------------------------------------------------------
  // OAuth 1.0a auth path (preferred over OAuth 2.0 user token)
  // -----------------------------------------------------------------------

  describe('with OAuth 1.0a credentials', () => {
    const originalFetch = globalThis.fetch;

    beforeEach(() => {
      vi.clearAllMocks();
      mockConfig.X_CONSUMER_KEY = 'test-consumer-key';
      mockConfig.X_CONSUMER_SECRET='***';
      mockConfig.X_ACCESS_TOKEN='***';
      mockConfig.X_ACCESS_TOKEN_SECRET='***';
      vi.mocked(signRequest).mockReturnValue(
        'OAuth oauth_consumer_key="test-consumer-key", oauth_nonce="abc", oauth_signature="test-sig"',
      );
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
      mockConfig.X_CONSUMER_KEY = '';
      mockConfig.X_CONSUMER_SECRET = '';
      mockConfig.X_ACCESS_TOKEN = '';
      mockConfig.X_ACCESS_TOKEN_SECRET = '';
    });

    it('should use OAuth 1.0a signing instead of user token', async () => {
      let capturedAuthHeader = '';
      globalThis.fetch = vi.fn().mockImplementation(
        (_url: string, opts: RequestInit) => {
          capturedAuthHeader = (opts.headers as Record<string, string>)?.Authorization ?? '';
          return Promise.resolve(makeOkResponse({ data: existingSubscriptions }));
        },
      );

      await listSubscriptions();

      expect(signRequest).toHaveBeenCalledWith('GET', 'https://api.x.com/2/activity/subscriptions');
      expect(capturedAuthHeader).toContain('OAuth oauth_consumer_key=');
      expect(xFetch).not.toHaveBeenCalled();
    });

    it('should sign POST requests for createSubscription', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        makeOkResponse({
          data: { id: 'sub-1a', event_type: 'dm.received', webhook_id: 'wh-001' },
        }),
      );

      const result = await createSubscription('wh-001', 'dm.received', 'test-tag');

      expect(result).toBe('sub-1a');
      expect(signRequest).toHaveBeenCalledWith('POST', 'https://api.x.com/2/activity/subscriptions');
      expect(xFetch).not.toHaveBeenCalled();
    });

    it('ensureSubscriptions should run verify_credentials before listing subscriptions', async () => {
      // Mock verify_credentials endpoint
      globalThis.fetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ screen_name: 'Pawsome3D' }),
          text: async () => '',
          headers: new Headers(),
        } as Response)
        // Then list subscriptions
        .mockResolvedValueOnce(makeOkResponse());

      await ensureSubscriptions('wh-001');

      // First fetch call should be to verify_credentials
      const firstUrl = vi.mocked(globalThis.fetch).mock.calls[0][0] as string;
      expect(firstUrl).toContain('verify_credentials.json');

      // Second fetch call should be to activity/subscriptions (list)
      const secondUrl = vi.mocked(globalThis.fetch).mock.calls[1][0] as string;
      expect(secondUrl).toContain('/2/activity/subscriptions');

      // Should have signed both requests
      expect(signRequest).toHaveBeenCalledWith('GET', expect.stringContaining('verify_credentials.json'));
      expect(signRequest).toHaveBeenCalledWith('GET', expect.stringContaining('activity/subscriptions'));
    });
  });

  // -----------------------------------------------------------------------
  // No auth available
  // -----------------------------------------------------------------------

  describe('with no auth available (neither OAuth 1.0a nor OAuth 2.0)', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      mockConfig.X_CONSUMER_KEY = '';
      mockConfig.X_CONSUMER_SECRET = '';
      mockConfig.X_ACCESS_TOKEN = '';
      mockConfig.X_ACCESS_TOKEN_SECRET = '';
      vi.mocked(getBotUserToken).mockRejectedValue(
        new Error('No bot user token available — complete OAuth flow at /oauth/start'),
      );
    });

    it('ensureSubscriptions should log waiting message and skip gracefully', async () => {
      await expect(ensureSubscriptions('wh-001')).resolves.toBeUndefined();
      expect(xFetch).not.toHaveBeenCalled();
    });
  });
});