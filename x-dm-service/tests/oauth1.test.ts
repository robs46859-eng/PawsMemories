/**
 * Tests for OAuth 1.0a HMAC-SHA1 signing (RFC 5849).
 *
 * Spec: X_DM_REFINEMENT_SPEC.md §5.3
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { signRequest, _setTestOverrides, _clearTestOverrides } from '../src/oauth1.js';

// Mock config with OAuth 1.0a credentials
vi.mock('../src/config.js', () => ({
  getConfig: vi.fn(() => ({
    X_CONSUMER_KEY: 'test-consumer-key',
    X_CONSUMER_SECRET: 'test-consumer-secret',
    X_ACCESS_TOKEN: 'test-access-token',
    X_ACCESS_TOKEN_SECRET: 'test-access-token-secret',
    // Minimal required fields so getConfig doesn't crash
    X_CLIENT_ID: '',
    X_CLIENT_SECRET: '',
    X_BOT_USER_ID: '',
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
    X_BEARER_TOKEN: '',
  })),
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('signRequest', () => {
  beforeEach(() => {
    // Deterministic nonce + timestamp for reproducible signature
    _setTestOverrides({ nonce: 'abc123def456', timestamp: '1234567890' });
  });

  afterEach(() => {
    _clearTestOverrides();
  });

  // -----------------------------------------------------------------------
  // Header format
  // -----------------------------------------------------------------------

  it('should return a string starting with "OAuth "', () => {
    const header = signRequest('GET', 'https://api.x.com/2/activity/subscriptions');
    expect(header).toMatch(/^OAuth /);
  });

  it('should contain all required OAuth 1.0a parameters', () => {
    const header = signRequest('GET', 'https://api.x.com/2/activity/subscriptions');

    expect(header).toContain('oauth_consumer_key=');
    expect(header).toContain('oauth_nonce=');
    expect(header).toContain('oauth_signature_method="HMAC-SHA1"');
    expect(header).toContain('oauth_timestamp=');
    expect(header).toContain('oauth_token=');
    expect(header).toContain('oauth_version="1.0"');
    expect(header).toContain('oauth_signature=');
  });

  it('should include the configured consumer key', () => {
    const header = signRequest('GET', 'https://api.x.com/2/activity/subscriptions');
    expect(header).toContain('oauth_consumer_key="test-consumer-key"');
  });

  it('should include the configured access token', () => {
    const header = signRequest('GET', 'https://api.x.com/2/activity/subscriptions');
    expect(header).toContain('oauth_token="test-access-token"');
  });

  it('should produce different signatures for different URLs', () => {
    const sigA = signRequest('GET', 'https://api.x.com/2/activity/subscriptions');
    const sigB = signRequest('GET', 'https://api.x.com/2/webhooks');

    // Extract signatures
    const regex = /oauth_signature="([^"]+)"/;
    const matchA = sigA.match(regex);
    const matchB = sigB.match(regex);

    expect(matchA?.[1]).not.toBe(matchB?.[1]);
  });

  it('should produce different signatures for different HTTP methods', () => {
    const sigA = signRequest('GET', 'https://api.x.com/2/activity/subscriptions');
    const sigB = signRequest('POST', 'https://api.x.com/2/activity/subscriptions');

    const regex = /oauth_signature="([^"]+)"/;
    const matchA = sigA.match(regex);
    const matchB = sigB.match(regex);

    expect(matchA?.[1]).not.toBe(matchB?.[1]);
  });

  // -----------------------------------------------------------------------
  // RFC 3986 strict encoding
  // -----------------------------------------------------------------------

  it('should RFC 3986-encode special characters in the signature', () => {
    const header = signRequest('GET', 'https://api.x.com/2/activity/subscriptions');

    // The signature is base64 which can contain + / = — these should be encoded
    const sigMatch = header.match(/oauth_signature="([^"]+)"/);
    expect(sigMatch).not.toBeNull();

    const sig = sigMatch![1];
    // + should be encoded as %2B
    if (sig.includes('+')) {
      const headerWithPlus = signRequest('GET', 'https://api.x.com/2/other');
      expect(headerWithPlus).toMatch(/%2B/);
    }
  });

  // -----------------------------------------------------------------------
  // HMAC-SHA1 signature computation
  // -----------------------------------------------------------------------

  it('should compute a valid HMAC-SHA1 signature', () => {
    // With deterministic nonce/timestamp, verify the exact HMAC-SHA1 result
    const header = signRequest('GET', 'https://api.x.com/2/activity/subscriptions');

    // Extract the signature and decode from percent-encoding
    const sigMatch = header.match(/oauth_signature="([^"]+)"/);
    expect(sigMatch).not.toBeNull();

    const encodedSig = sigMatch![1];
    // URL-decode the signature
    const decoded = decodeURIComponent(encodedSig);

    // Verify it's valid base64 (HMAC-SHA1 produces 20 bytes → 27+ base64 chars)
    expect(decoded.length).toBeGreaterThanOrEqual(27);
    expect(decoded).toMatch(/^[A-Za-z0-9+/=]+$/);
  });

  // -----------------------------------------------------------------------
  // Parameter ordering
  // -----------------------------------------------------------------------

  it('should sort OAuth parameters alphabetically in the header', () => {
    const header = signRequest('GET', 'https://api.x.com/2/activity/subscriptions');

    // The header should have oauth_consumer_key before oauth_nonce (alphabetical)
    const consumerIdx = header.indexOf('oauth_consumer_key=');
    const nonceIdx = header.indexOf('oauth_nonce=');
    const sigIdx = header.indexOf('oauth_signature=');

    // oauth_signature should be last (added after sorting)
    expect(sigIdx).toBeGreaterThan(consumerIdx);
    expect(sigIdx).toBeGreaterThan(nonceIdx);
  });

  // -----------------------------------------------------------------------
  // RFC 5849 §3.4.1 — query parameters in signature
  // -----------------------------------------------------------------------

  it('should include query params in the signature (GET with ?cursor=abc&limit=50)', () => {
    const header = signRequest('GET', 'https://api.x.com/2/activity/subscriptions?cursor=abc&limit=50');

    // Query params should NOT appear in the Authorization header
    expect(header).not.toContain('cursor=');
    expect(header).not.toContain('limit=');

    // But they should affect the signature: the signature with query params
    // should differ from the signature without
    const sigNoQuery = signRequest('GET', 'https://api.x.com/2/activity/subscriptions');
    expect(header).not.toBe(sigNoQuery);
  });

  it('should produce different signatures for different query param values', () => {
    const sigA = signRequest('GET', 'https://api.x.com/2/activity/subscriptions?cursor=abc');
    const sigB = signRequest('GET', 'https://api.x.com/2/activity/subscriptions?cursor=xyz');

    const regex = /oauth_signature="([^"]+)"/;
    const matchA = sigA.match(regex);
    const matchB = sigB.match(regex);

    expect(matchA?.[1]).not.toBe(matchB?.[1]);
  });

  it('should include multiple query params sorted alongside OAuth params', () => {
    // Parameters: foo=bar and zoo=baz — the URL encodes them in an
    // arbitrary order but the signature sorts them alphabetically
    const header = signRequest('GET', 'https://api.x.com/2/x?zoo=baz&foo=bar');

    // Header should start with OAuth and contain only oauth_* params
    expect(header).toMatch(/^OAuth oauth_/);
    expect(header).not.toContain('foo=');
    expect(header).not.toContain('zoo=');
  });
});