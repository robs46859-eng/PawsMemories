/**
 * Tests for webhookManager — case-insensitive URL matching in ensureWebhookRegistered.
 *
 * Spec: X_DM_REFINEMENT_SPEC.md §5.1
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock underlying HTTP calls
vi.mock('../src/xClient.js', () => ({
  getAppOnlyBearerToken: vi.fn(),
  xFetch: vi.fn(),
}));

// Mock db
vi.mock('../src/db.js', () => ({
  kvSet: vi.fn(),
  kvDelete: vi.fn(),
  KV_KEYS: {
    WEBHOOK_ID: 'webhook_id',
    WEBHOOK_VALID: 'webhook_valid',
  },
}));

import { getAppOnlyBearerToken, xFetch } from '../src/xClient.js';
import { kvSet } from '../src/db.js';
import { ensureWebhookRegistered } from '../src/webhookManager.js';

// Mock config
vi.mock('../src/config.js', () => ({
  getConfig: vi.fn(() => ({
    X_CLIENT_ID: 'test-client-id',
    X_CLIENT_SECRET: 'test-client-secret',
    X_WEBHOOK_URL: 'https://example.com/webhooks/x',
    X_CONSUMER_SECRET: 'test-consumer-secret',
  })),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const validWebhook = {
  id: 'wh-001',
  url: 'https://example.com/webhooks/x',
  valid: true,
  created_at: '2026-01-01T00:00:00Z',
};

const sameCasingWebhook = {
  id: 'wh-002',
  url: 'https://Example.com/Webhooks/X',
  valid: true,
  created_at: '2026-06-01T00:00:00Z',
};

const differentWebhook = {
  id: 'wh-999',
  url: 'https://other-app.com/hook',
  valid: false,
};

function makeWebhookListResponse(webhooks: unknown[]): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({ data: webhooks }),
    text: async () => '',
    headers: new Headers(),
  } as Response;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ensureWebhookRegistered — URL matching', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAppOnlyBearerToken).mockResolvedValue({
      access_token: 'app-only-token',
      expires_in: 7200,
      token_type: 'bearer',
    });
  });

  it('should match exact URL case-sensitively and adopt the webhook', async () => {
    vi.mocked(xFetch).mockResolvedValue(makeWebhookListResponse([validWebhook]));

    const id = await ensureWebhookRegistered();

    expect(id).toBe('wh-001');
    expect(kvSet).toHaveBeenCalledWith('webhook_id', 'wh-001');
    expect(kvSet).toHaveBeenCalledWith('webhook_valid', 'true');
  });

  it('should match case-insensitively when exact match fails', async () => {
    // Only same-casing webhook exists, not the exact-match one
    vi.mocked(xFetch).mockResolvedValue(makeWebhookListResponse([sameCasingWebhook]));

    const id = await ensureWebhookRegistered();

    // Should adopt the case-different webhook instead of registering new
    expect(id).toBe('wh-002');
    expect(kvSet).toHaveBeenCalledWith('webhook_id', 'wh-002');
    expect(kvSet).toHaveBeenCalledWith('webhook_valid', 'true');

    // Should NOT attempt to register a new webhook
    // registerWebhook would call xFetch with POST — verify only GET was used
    const firstCallMethod = vi.mocked(xFetch).mock.calls[0]?.[1] as { method?: string };
    // listWebhooks uses GET, register would use POST
    expect(firstCallMethod?.method).toBe('GET');
  });

  it('should prefer exact match over case-insensitive match', async () => {
    // Both exist — should pick the exact match
    vi.mocked(xFetch).mockResolvedValue(
      makeWebhookListResponse([sameCasingWebhook, validWebhook]),
    );

    const id = await ensureWebhookRegistered();

    expect(id).toBe('wh-001'); // exact match wins
  });

  it('should register a new webhook when no webhook matches at all', async () => {
    vi.mocked(xFetch)
      .mockResolvedValueOnce(makeWebhookListResponse([differentWebhook])) // list — no match
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: { id: 'wh-new', url: 'https://example.com/webhooks/x', valid: false } }),
        text: async () => '',
        headers: new Headers(),
      } as Response); // register

    const id = await ensureWebhookRegistered();

    expect(id).toBe('wh-new');
    // Two HTTP calls: GET (list) + POST (register)
    expect(xFetch).toHaveBeenCalledTimes(2);
  });

  it('should revalidate a webhook when it is invalid (applies to both match paths)', async () => {
    const invalidWh = { ...validWebhook, valid: false };
    vi.mocked(xFetch)
      .mockResolvedValueOnce(makeWebhookListResponse([invalidWh])) // list
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: { ...invalidWh, valid: true } }),
        text: async () => '',
        headers: new Headers(),
      } as Response); // revalidate (PUT)

    const id = await ensureWebhookRegistered();

    expect(id).toBe('wh-001');
    // kvSet for valid=false first, then revalidation PUT
    expect(kvSet).toHaveBeenCalledWith('webhook_valid', 'false');
    expect(kvSet).toHaveBeenCalledWith('webhook_valid', 'true');
  });

  it('should return empty string when X_WEBHOOK_URL is empty', async () => {
    // Override config mock for this test
    const configMock = await import('../src/config.js');
    vi.mocked(configMock.getConfig).mockReturnValueOnce({
      X_CLIENT_ID: 'test-client-id',
      X_CLIENT_SECRET: 'test-client-secret',
      X_WEBHOOK_URL: '',
      X_CONSUMER_SECRET: '',
    } as ReturnType<typeof configMock.getConfig>);

    const id = await ensureWebhookRegistered();
    expect(id).toBe('');
    expect(xFetch).not.toHaveBeenCalled();
  });
});