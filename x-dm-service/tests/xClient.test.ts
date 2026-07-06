/**
 * Tests for getAppOnlyBearerToken — X_BEARER_TOKEN short-circuit and legacy endpoint fallback.
 *
 * Spec: X_DM_REFINEMENT_SPEC.md §4.2
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Shared mutable config object so tests can mutate X_BEARER_TOKEN
const testConfig: Record<string, unknown> = {
  X_CLIENT_ID: 'test-client-id',
  X_CLIENT_SECRET: 'test-client-secret',
  X_BEARER_TOKEN: '',
};

vi.mock('../src/config.js', () => ({
  getConfig: vi.fn(() => testConfig),
}));

import { getConfig } from '../src/config.js';
import { getAppOnlyBearerToken } from '../src/xClient.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTokenResponse(token: string): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      access_token: token,
      expires_in: 7200,
      token_type: 'bearer',
    }),
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

describe('getAppOnlyBearerToken', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.fetch = originalFetch;
    // Reset config defaults
    testConfig.X_BEARER_TOKEN = '';
    testConfig.X_CLIENT_ID = 'test-client-id';
    testConfig.X_CLIENT_SECRET = 'test-client-secret';
  });

  // -----------------------------------------------------------------------
  // X_BEARER_TOKEN short-circuit (§4.2 — portal-issued token)
  // -----------------------------------------------------------------------

  it('should return the portal-issued token directly when X_BEARER_TOKEN is set', async () => {
    testConfig.X_BEARER_TOKEN = 'portal-bearer-token-abc';

    const result = await getAppOnlyBearerToken('ignored-key', 'ignored-secret');

    expect(result.access_token).toBe('portal-bearer-token-abc');
    expect(result.expires_in).toBeGreaterThanOrEqual(86_400 * 364); // ~1 year
    expect(result.token_type).toBe('bearer');
  });

  it('should NOT call fetch when X_BEARER_TOKEN is set', async () => {
    testConfig.X_BEARER_TOKEN = 'portal-bearer-token-abc';
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy;

    await getAppOnlyBearerToken('ignored-key', 'ignored-secret');

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('should ignore arguments when X_BEARER_TOKEN is set', async () => {
    testConfig.X_BEARER_TOKEN = 'static-bearer-token';

    const result = await getAppOnlyBearerToken('', ''); // empty credentials

    expect(result.access_token).toBe('static-bearer-token');
  });

  // -----------------------------------------------------------------------
  // Legacy endpoint fallback (no X_BEARER_TOKEN)
  // -----------------------------------------------------------------------

  it('should POST to legacy app-only endpoint when X_BEARER_TOKEN is empty', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(makeTokenResponse('legacy-token'));

    const result = await getAppOnlyBearerToken('my-key', 'my-secret');

    expect(result.access_token).toBe('legacy-token');
  });

  it('should use the legacy URL api.x.com/oauth2/token (no /2/)', async () => {
    let calledUrl = '';
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      calledUrl = url;
      return Promise.resolve(makeTokenResponse('t'));
    });

    await getAppOnlyBearerToken('k', 's');

    expect(calledUrl).toBe('https://api.x.com/oauth2/token');
    expect(calledUrl).not.toContain('/2/');
  });

  it('should include Authorization: Basic with URL-encoded credentials', async () => {
    let authHeader = '';
    globalThis.fetch = vi.fn().mockImplementation((_url: string, opts: RequestInit) => {
      authHeader = (opts.headers as Record<string, string>)?.Authorization ?? '';
      return Promise.resolve(makeTokenResponse('t'));
    });

    await getAppOnlyBearerToken('key-123', 'sec-456');

    // Base64 of urlencode('key-123'):urlencode('sec-456')
    const expectedRaw = 'key-123:sec-456';
    const expectedB64 = Buffer.from(expectedRaw).toString('base64');
    expect(authHeader).toBe(`Basic ${expectedB64}`);
  });

  it('should URL-encode special characters in key/secret', async () => {
    let authHeader = '';
    globalThis.fetch = vi.fn().mockImplementation((_url: string, opts: RequestInit) => {
      authHeader = (opts.headers as Record<string, string>)?.Authorization ?? '';
      return Promise.resolve(makeTokenResponse('t'));
    });

    await getAppOnlyBearerToken('key@#$', 'sec :/=');

    const expectedRaw = `${encodeURIComponent('key@#$')}:${encodeURIComponent('sec :/=')}`;
    const expectedB64 = Buffer.from(expectedRaw).toString('base64');
    expect(authHeader).toBe(`Basic ${expectedB64}`);
  });

  it('should include grant_type=client_credentials in request body', async () => {
    let bodyStr = '';
    globalThis.fetch = vi.fn().mockImplementation((_url: string, opts: RequestInit) => {
      bodyStr = String(opts.body);
      return Promise.resolve(makeTokenResponse('t'));
    });

    await getAppOnlyBearerToken('k', 's');

    expect(bodyStr).toContain('grant_type=client_credentials');
  });

  it('should set Content-Type header', async () => {
    let ct = '';
    globalThis.fetch = vi.fn().mockImplementation((_url: string, opts: RequestInit) => {
      const headers = opts.headers as Record<string, string>;
      ct = headers['Content-Type'] ?? headers['content-type'] ?? '';
      return Promise.resolve(makeTokenResponse('t'));
    });

    await getAppOnlyBearerToken('k', 's');

    expect(ct).toBe('application/x-www-form-urlencoded');
  });

  it('should throw on HTTP error response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(makeErrorResponse(403, 'Forbidden'));

    await expect(getAppOnlyBearerToken('k', 's')).rejects.toThrow('App-only token failed (403): Forbidden');
  });
});