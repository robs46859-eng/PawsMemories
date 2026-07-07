/**
 * OAuth 1.0a HMAC-SHA1 request signing (RFC 5849).
 *
 * Generates the Authorization header for X API v2 endpoints that reject
 * OAuth 2.0 user tokens and require OAuth 1.0a user context
 * (notably POST /2/activity/subscriptions).
 *
 * No external dependencies — uses only node:crypto (createHmac, randomBytes).
 * Percent-encoding is RFC 3986 strict: encodeURIComponent is post-processed
 * to additionally encode ! * ' ( ) which encodeURIComponent leaves alone.
 */

import { createHmac, randomBytes } from 'node:crypto';
import { getConfig } from './config.js';

// ---------------------------------------------------------------------------
// RFC 3986 strict percent-encoding
// ---------------------------------------------------------------------------

/**
 * RFC 3986 §2.3 unreserved characters: A-Z a-z 0-9 - _ . ~
 * encodeURIComponent leaves ! * ' ( ) unencoded — this replaces them.
 */
function rfc3986(str: string): string {
  return encodeURIComponent(str)
    .replace(/[!*'()]/g, (c) =>
      '%' + c.charCodeAt(0).toString(16).toUpperCase(),
    );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Generate a random nonce (32 hex chars). */
function oauthNonce(): string {
  return randomBytes(16).toString('hex');
}

/** Current Unix timestamp as a string. */
function oauthTimestamp(): string {
  return Math.floor(Date.now() / 1000).toString();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Exported for deterministic testing — overrides nonce/timestamp. */
export let _testOverrides: { nonce?: string; timestamp?: string } | null = null;

/** Reset test overrides (called by tests). */
export function _clearTestOverrides(): void {
  _testOverrides = null;
}

/** Set test overrides for deterministic signature generation. */
export function _setTestOverrides(o: { nonce: string; timestamp: string }): void {
  _testOverrides = o;
}

/**
 * Build an OAuth 1.0a Authorization header value for an X API v2 request.
 *
 * Steps (RFC 5849 §3.4):
 *   1. Collect OAuth parameters (consumer_key, nonce, signature_method,
 *      timestamp, token, version).
 *   2. Parse query-string parameters — include them in the signature (but
 *      NOT in the Authorization header) per RFC 5849 §3.4.1.1.
 *   3. Normalize the request URL: lowercase scheme+host, remove default
 *      port (80 for http, 443 for https), path without query string.
 *   4. Percent-encode each key/value (RFC 3986 strict).
 *   5. Sort by encoded key (ASCII), build parameter string.
 *   6. Build signature base string: METHOD & normalized_url & parameter_string.
 *   7. Build signing key: consumer_secret & token_secret (RFC 5849 §3.4.2).
 *   8. HMAC-SHA1 → base64 → add to oauth_signature param.
 *   9. Return "OAuth key=val, ..." header string.
 *
 * JSON bodies are NOT included in the signature per RFC 5849 §3.4.1.3
 * (only application/x-www-form-urlencoded bodies contribute parameters).
 *
 * @param method - HTTP method (GET, POST, PUT, DELETE).
 * @param url    - Full request URL (query params are parsed and included
 *                 in the signature base string per spec).
 */
export function signRequest(method: string, url: string): string {
  const cfg = getConfig();

  // --- Step 1: OAuth parameters -------------------------------------------

  const to = _testOverrides;
  const nonce = to?.nonce ?? oauthNonce();
  const timestamp = to?.timestamp ?? oauthTimestamp();

  const oauth: Record<string, string> = {
    oauth_consumer_key: cfg.X_CONSUMER_KEY,
    oauth_nonce: nonce,
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: timestamp,
    oauth_token: cfg.X_ACCESS_TOKEN,
    oauth_version: '1.0',
  };

  // --- Step 2 & 3: Parse URL for query params + normalization -------------

  const parsedUrl = new URL(url);
  const scheme = parsedUrl.protocol.toLowerCase();
  const host = parsedUrl.hostname.toLowerCase();
  const port = parsedUrl.port;
  // Remove default ports per RFC 5849 §3.4.1.2
  const portStr =
    !port ||
    (port === '80' && scheme === 'http:') ||
    (port === '443' && scheme === 'https:')
      ? ''
      : `:${port}`;
  const normalizedBaseUrl = `${scheme}//${host}${portStr}${parsedUrl.pathname}`;

  // --- Step 4: Collect all parameters (OAuth + query) ---------------------

  const allParams: Record<string, string> = { ...oauth };
  for (const [k, v] of parsedUrl.searchParams.entries()) {
    allParams[k] = v;
  }

  // --- Step 5: Encode and sort --------------------------------------------

  const sorted = Object.entries(allParams)
    .map(([k, v]) => [rfc3986(k), rfc3986(v)] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));

  const paramString = sorted.map(([k, v]) => `${k}=${v}`).join('&');

  // --- Step 6: Signature base string ---------------------------------------

  const baseString = [
    method.toUpperCase(),
    rfc3986(normalizedBaseUrl),
    rfc3986(paramString),
  ].join('&');

  // --- Step 7 & 8: Sign ----------------------------------------------------

  const signingKey = `${rfc3986(cfg.X_CONSUMER_SECRET)}&${rfc3986(cfg.X_ACCESS_TOKEN_SECRET)}`;
  const sig = createHmac('sha1', signingKey)
    .update(baseString)
    .digest('base64');
  const encodedSig = rfc3986(sig);

  // --- Step 9: Build Authorization header (OAuth params only) -------------

  const oauthParts = sorted
    .filter(([k]) => k.startsWith('oauth_'))
    .map(([k, v]) => `${k}="${v}"`);

  oauthParts.push(`oauth_signature="${encodedSig}"`);

  return `OAuth ${oauthParts.join(', ')}`;
}
