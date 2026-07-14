/**
 * Tests for webhook CRC endpoint and signature verification.
 *
 * Spec: X_DM_REFINEMENT_SPEC.md §5.2
 */

import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import crypto from 'node:crypto';
import { createWebhookRouter, verifySignature } from '../src/routes/webhooks.js';

const TEST_CONSUMER_SECRET = 'fixture-only-signing-material'; // gitleaks:allow - immutable test fixture

// ---------------------------------------------------------------------------
// Helper: create a test app with the webhook router mounted
// ---------------------------------------------------------------------------

function createTestApp(): express.Express {
  const app = express();
  // Raw body parser before everything (§7.3 requirement)
  app.use('/webhooks/x', express.raw({ type: '*/*' }));
  app.use('/webhooks/x', createWebhookRouter(TEST_CONSUMER_SECRET));
  return app;
}

// ---------------------------------------------------------------------------
// CRC endpoint tests
// ---------------------------------------------------------------------------

describe('CRC endpoint (GET /webhooks/x)', () => {
  it('should return a valid sha256 response_token for a crc_token query', async () => {
    const app = createTestApp();
    const crcToken = 'test-crc-token-abc123';

    const res = await request(app)
      .get('/webhooks/x')
      .query({ crc_token: crcToken });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('response_token');

    const token = res.body.response_token as string;
    expect(token).toMatch(/^sha256=/);

    // Verify the token was computed correctly
    const expected = 'sha256=' + crypto
      .createHmac('sha256', TEST_CONSUMER_SECRET)
      .update(crcToken)
      .digest('base64');

    expect(token).toBe(expected);
  });

  it('should return 400 when crc_token is missing', async () => {
    const app = createTestApp();

    const res = await request(app).get('/webhooks/x');

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('should return 400 for empty crc_token', async () => {
    const app = createTestApp();

    const res = await request(app)
      .get('/webhooks/x')
      .query({ crc_token: '' });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('should respond within 3 seconds (spec requirement)', async () => {
    const app = createTestApp();

    const start = Date.now();
    await request(app)
      .get('/webhooks/x')
      .query({ crc_token: 'timing-test' });

    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(3000);
  });

  it('should produce a different token for different crc_tokens', async () => {
    const app = createTestApp();

    const res1 = await request(app)
      .get('/webhooks/x')
      .query({ crc_token: 'token-a' });

    const res2 = await request(app)
      .get('/webhooks/x')
      .query({ crc_token: 'token-b' });

    expect(res1.body.response_token).not.toBe(res2.body.response_token);
  });
});

// ---------------------------------------------------------------------------
// Signature verification tests
// ---------------------------------------------------------------------------

describe('verifySignature', () => {
  it('should verify a correctly computed signature', () => {
    const rawBody = Buffer.from('{"test":"payload"}', 'utf8');
    const expected = 'sha256=' + crypto
      .createHmac('sha256', TEST_CONSUMER_SECRET)
      .update(rawBody)
      .digest('base64');

    const result = verifySignature(rawBody, expected, TEST_CONSUMER_SECRET);
    expect(result).toBe(true);
  });

  it('should reject an incorrect signature', () => {
    const rawBody = Buffer.from('{"test":"payload"}', 'utf8');
    const wrongSig = 'sha256=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

    const result = verifySignature(rawBody, wrongSig, TEST_CONSUMER_SECRET);
    expect(result).toBe(false);
  });

  it('should reject a signature with wrong algorithm prefix', () => {
    const rawBody = Buffer.from('test data', 'utf8');
    const wrongAlgo = 'md5=fakehash';

    const result = verifySignature(rawBody, wrongAlgo, TEST_CONSUMER_SECRET);
    expect(result).toBe(false);
  });

  it('should use timing-safe comparison (different-length headers)', () => {
    const rawBody = Buffer.from('data', 'utf8');
    const shortSig = 'sha256=short';

    const result = verifySignature(rawBody, shortSig, TEST_CONSUMER_SECRET);
    expect(result).toBe(false);
  });

  it('should reject mismatched body content', () => {
    const rawBody = Buffer.from('{"real":"payload"}', 'utf8');
    const sigForOther = 'sha256=' + crypto
      .createHmac('sha256', TEST_CONSUMER_SECRET)
      .update(Buffer.from('{"fake":"payload"}'))
      .digest('base64');

    const result = verifySignature(rawBody, sigForOther, TEST_CONSUMER_SECRET);
    expect(result).toBe(false);
  });

  it('should vary with different consumer secrets', () => {
    const rawBody = Buffer.from('test', 'utf8');
    const sigSecretA = 'sha256=' + crypto
      .createHmac('sha256', 'secret-a')
      .update(rawBody)
      .digest('base64');

    const result = verifySignature(rawBody, sigSecretA, TEST_CONSUMER_SECRET);
    expect(result).toBe(false);
  });

  it('should handle empty body', () => {
    const rawBody = Buffer.from('', 'utf8');
    const sigForEmpty = 'sha256=' + crypto
      .createHmac('sha256', TEST_CONSUMER_SECRET)
      .update(Buffer.from(''))
      .digest('base64');

    const result = verifySignature(rawBody, sigForEmpty, TEST_CONSUMER_SECRET);
    expect(result).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Webhook POST endpoint tests
// ---------------------------------------------------------------------------

describe('POST /webhooks/x', () => {
  it('should reject requests without signature header', async () => {
    const app = createTestApp();

    const res = await request(app)
      .post('/webhooks/x')
      .send('{"test":"payload"}');

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('should reject requests with invalid signature', async () => {
    const app = createTestApp();

    const res = await request(app)
      .post('/webhooks/x')
      .set('x-twitter-webhooks-signature', 'sha256=invalid')
      .send('{"test":"payload"}');

    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error');
  });

  it('should accept requests with valid signature', async () => {
    const app = createTestApp();
    const rawBody = JSON.stringify({ type: 'dm.received', id: '1234' });

    const expectedSig = 'sha256=' + crypto
      .createHmac('sha256', TEST_CONSUMER_SECRET)
      .update(Buffer.from(rawBody, 'utf8'))
      .digest('base64');

    const res = await request(app)
      .post('/webhooks/x')
      .set('x-twitter-webhooks-signature', expectedSig)
      .send(rawBody);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});
