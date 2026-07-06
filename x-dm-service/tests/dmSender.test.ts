/**
 * Tests for dmSender — endpoint selection, daily cap, 401→refresh→retry, 403 no-retry.
 *
 * Spec: X_DM_REFINEMENT_SPEC.md §5.5, §7.1
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sendDm } from '../src/dmSender.js';

// Mock db
vi.mock('../src/db.js', () => ({
  kvGet: vi.fn(),
  kvSet: vi.fn(),
  KV_KEYS: {
    DM_DAILY_DATE: 'dm_daily_date',
    DM_DAILY_COUNT: 'dm_daily_count',
  },
}));

// Mock xClient
vi.mock('../src/xClient.js', () => ({
  xFetch: vi.fn(),
}));

// Mock botTokenStore
vi.mock('../src/botTokenStore.js', () => ({
  getBotUserToken: vi.fn(),
  refreshAndPersist: vi.fn(),
}));

import { kvGet, kvSet } from '../src/db.js';
import { xFetch } from '../src/xClient.js';
import { getBotUserToken, refreshAndPersist } from '../src/botTokenStore.js';

// Mock the config
vi.mock('../src/config.js', () => ({
  getConfig: vi.fn(() => ({
    DM_DAILY_SEND_CAP: 5,
    X_CLIENT_ID: 'test-client-id',
    X_CLIENT_SECRET: 'test-client-secret',
  })),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeOkResponse(eventId?: string): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      data: { dm_event_id: eventId ?? 'evt-sent-001' },
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

describe('sendDm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(kvGet).mockReset();
    vi.mocked(kvSet).mockReset();
    vi.mocked(getBotUserToken).mockReset();
    vi.mocked(getBotUserToken).mockResolvedValue('test-bot-token');
    vi.mocked(refreshAndPersist).mockReset();
    vi.mocked(refreshAndPersist).mockResolvedValue('new-token');
  });

  it('should use A17 (dm_conversations/:id/messages) when conversationId is provided', async () => {
    vi.mocked(kvGet).mockResolvedValue('2026-07-06'); // same day
    vi.mocked(kvGet).mockResolvedValueOnce('2026-07-06').mockResolvedValueOnce('2'); // count=2
    vi.mocked(xFetch).mockResolvedValue(makeOkResponse());

    const result = await sendDm({
      conversationId: 'conv-001',
      text: 'Hello!',
    });

    expect(result).toBe('evt-sent-001');
    const url = vi.mocked(xFetch).mock.calls[0][0] as string;
    expect(url).toContain('/dm_conversations/conv-001/messages');
    expect(url).not.toContain('/dm_conversations/with/');
  });

  it('should use A16 (dm_conversations/with/:participant_id/messages) when only participantId is provided', async () => {
    vi.mocked(kvGet).mockResolvedValueOnce('2026-07-06').mockResolvedValueOnce('1');
    vi.mocked(xFetch).mockResolvedValue(makeOkResponse());

    const result = await sendDm({
      participantId: 'user-999',
      text: 'Hello there!',
    });

    expect(result).toBe('evt-sent-001');
    const url = vi.mocked(xFetch).mock.calls[0][0] as string;
    expect(url).toContain('/dm_conversations/with/user-999/messages');
  });

  it('should include mediaId in the body when provided', async () => {
    vi.mocked(kvGet).mockResolvedValueOnce('2026-07-06').mockResolvedValueOnce('0');
    vi.mocked(xFetch).mockResolvedValue(makeOkResponse());

    await sendDm({
      conversationId: 'conv-001',
      text: 'Check this out!',
      mediaId: 'media_12345',
    });

    const body = JSON.parse(vi.mocked(xFetch).mock.calls[0][1]?.body as string);
    expect(body.text).toBe('Check this out!');
    expect(body.attachments).toEqual([{ media_id: 'media_12345' }]);
  });

  it('should refuse to send when daily cap is reached', async () => {
    // Already at cap
    vi.mocked(kvGet).mockResolvedValueOnce('2026-07-06').mockResolvedValueOnce('5');
    vi.mocked(getBotUserToken).mockResolvedValue('test-bot-token');

    const result = await sendDm({
      conversationId: 'conv-001',
      text: 'This should not send',
    });

    expect(result).toBeNull();
    expect(xFetch).not.toHaveBeenCalled();
  });

  it('should reset daily counter for a new UTC day', async () => {
    // Stored date is yesterday
    vi.mocked(kvGet).mockResolvedValueOnce('2026-07-05').mockResolvedValueOnce('99');
    vi.mocked(xFetch).mockResolvedValue(makeOkResponse());

    const result = await sendDm({
      conversationId: 'conv-001',
      text: 'New day message',
    });

    expect(result).toBe('evt-sent-001');
    // Should have reset counter
    expect(kvSet).toHaveBeenCalledWith('dm_daily_date', expect.stringMatching(/^2026-07-0[67]/));
    expect(kvSet).toHaveBeenCalledWith('dm_daily_count', '1');
  });

  it('should retry once on 401 after token refresh', async () => {
    vi.mocked(kvGet).mockResolvedValueOnce('2026-07-06').mockResolvedValueOnce('0');
    (getBotUserToken as unknown as { mockResolvedValue: (v: string) => void }).mockResolvedValue('stale-token');

    // First call returns 401, second (after refresh) returns 200
    vi.mocked(xFetch)
      .mockResolvedValueOnce(makeErrorResponse(401))
      .mockResolvedValueOnce(makeOkResponse('evt-retry-001'));

    const result = await sendDm({
      conversationId: 'conv-001',
      text: 'Should retry',
    });

    expect(result).toBe('evt-retry-001');
    expect(refreshAndPersist).toHaveBeenCalledTimes(1);
    expect(xFetch).toHaveBeenCalledTimes(2);

    // Verify second call used new token
    const secondOpts = vi.mocked(xFetch).mock.calls[1][1] as { token?: string };
    expect(secondOpts?.token).toBe('new-token');
  });

  it('should NOT retry on 403 (blocked/closed DMs)', async () => {
    vi.mocked(kvGet).mockResolvedValueOnce('2026-07-06').mockResolvedValueOnce('0');
    vi.mocked(xFetch).mockResolvedValue(makeErrorResponse(403));

    const result = await sendDm({
      conversationId: 'conv-001',
      text: 'Should not retry',
    });

    expect(result).toBeNull();
    expect(xFetch).toHaveBeenCalledTimes(1); // no retry
    expect(refreshAndPersist).not.toHaveBeenCalled();
  });

  it('should throw on missing conversationId and participantId', async () => {
    await expect(sendDm({ text: 'bad' })).rejects.toThrow(
      'requires either conversationId or participantId',
    );
  });

  it('should increment daily counter on successful send', async () => {
    vi.mocked(kvGet).mockResolvedValueOnce('2026-07-06').mockResolvedValueOnce('0');
    vi.mocked(xFetch).mockResolvedValue(makeOkResponse());

    await sendDm({
      conversationId: 'conv-001',
      text: 'Counter test',
    });

    // Counter should be incremented from 0 to 1
    expect(kvSet).toHaveBeenCalledWith('dm_daily_count', '1');
  });
});