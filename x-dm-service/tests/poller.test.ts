/**
 * Tests for the poller — pagination stop condition, poll cycle.
 *
 * Spec: X_DM_REFINEMENT_SPEC.md §5.4, §7.1
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { pollOnce } from '../src/poller.js';

// Mock db
vi.mock('../src/db.js', () => ({
  kvGet: vi.fn(),
  kvSet: vi.fn(),
  KV_KEYS: {
    LAST_SEEN_EVENT_ID: 'last_seen_event_id',
    LAST_WEBHOOK_EVENT_AT: 'last_webhook_event_at',
    WEBHOOK_VALID: 'webhook_valid',
  },
}));

// Mock xClient
vi.mock('../src/xClient.js', () => ({
  xFetch: vi.fn(),
  getBotToken: vi.fn(() => 'test-bot-token'),
}));

// Mock eventProcessor
vi.mock('../src/eventProcessor.js', () => ({
  processWebhookPayload: vi.fn(),
}));

import { kvGet, kvSet } from '../src/db.js';
import { xFetch } from '../src/xClient.js';
import { processWebhookPayload } from '../src/eventProcessor.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeEvent(id: string): Record<string, unknown> {
  return {
    id,
    text: `Message ${id}`,
    event_type: 'MessageCreate',
    dm_conversation_id: 'conv-001',
    sender_id: 'user-999',
    created_at: '2026-07-06T12:00:00Z',
  };
}

function makeResponse(
  events: Record<string, unknown>[],
  nextToken?: string,
): unknown {
  return {
    data: events,
    meta: {
      result_count: events.length,
      ...(nextToken ? { next_token: nextToken } : {}),
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('pollOnce', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(kvGet).mockReset();
    vi.mocked(kvSet).mockReset();
    vi.mocked(processWebhookPayload).mockReset();
    vi.mocked(processWebhookPayload).mockResolvedValue([]);
  });

  it('should fetch one page of events and stop when no next_token', async () => {
    vi.mocked(kvGet).mockResolvedValue(null); // no last_seen_event_id
    vi.mocked(xFetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => makeResponse([makeEvent('evt-1'), makeEvent('evt-2')]),
      headers: new Headers(),
      text: async () => '',
    } as Response);

    const count = await pollOnce();
    expect(count).toBe(0); // processWebhookPayload returns []
    expect(xFetch).toHaveBeenCalledTimes(1);
  });

  it('should paginate until last_seen_event_id is found', async () => {
    vi.mocked(kvGet).mockResolvedValue('evt-3'); // last seen
    vi.mocked(processWebhookPayload).mockResolvedValue(['evt-1', 'evt-2', 'evt-3']);

    // Page 1: events 1-2, next_token
    // Page 2: event 3 (the last seen), no next_token — should stop
    vi.mocked(xFetch)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => makeResponse(
          [makeEvent('evt-1'), makeEvent('evt-2')],
          'next-page-2',
        ),
        headers: new Headers(),
        text: async () => '',
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => makeResponse([makeEvent('evt-3')]),
        headers: new Headers(),
        text: async () => '',
      } as Response);

    const count = await pollOnce();

    expect(xFetch).toHaveBeenCalledTimes(2);
    // Verify second call includes pagination_token
    const secondCall = vi.mocked(xFetch).mock.calls[1][0] as string;
    expect(secondCall).toContain('pagination_token=next-page-2');
  });

  it('should not paginate when first page contains last_seen_event_id', async () => {
    vi.mocked(kvGet).mockResolvedValue('evt-2'); // last seen
    vi.mocked(processWebhookPayload).mockResolvedValue(['evt-1', 'evt-2']);

    vi.mocked(xFetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => makeResponse(
        [makeEvent('evt-1'), makeEvent('evt-2')],
        'next-page', // would paginate, but should stop
      ),
      headers: new Headers(),
      text: async () => '',
    } as Response);

    const count = await pollOnce();

    // Even though next_token exists, it stops because evt-2 (last seen) is in the page
    expect(xFetch).toHaveBeenCalledTimes(1);
  });

  it('should handle empty response from API', async () => {
    vi.mocked(kvGet).mockResolvedValue(null);
    vi.mocked(xFetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => makeResponse([]),
      headers: new Headers(),
      text: async () => '',
    } as Response);

    const count = await pollOnce();
    expect(count).toBe(0);
    expect(xFetch).toHaveBeenCalledTimes(1);
  });

  it('should handle API error gracefully without crashing', async () => {
    vi.mocked(kvGet).mockResolvedValue(null);
    vi.mocked(xFetch).mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'Internal Server Error',
      headers: new Headers(),
    } as Response);

    // Should not throw
    const count = await pollOnce();
    expect(count).toBe(0);
    expect(xFetch).toHaveBeenCalledTimes(1);
  });

  it('should build the correct query params from spec §5.4', async () => {
    vi.mocked(kvGet).mockResolvedValue(null);
    vi.mocked(xFetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => makeResponse([]),
      headers: new Headers(),
      text: async () => '',
    } as Response);

    await pollOnce();

    const url = vi.mocked(xFetch).mock.calls[0][0] as string;
    expect(url).toContain('dm_event.fields=id');
    expect(url).toContain('event_type');
    expect(url).toContain('dm_conversation_id');
    expect(url).toContain('sender_id');
    expect(url).toContain('created_at');
    expect(url).toContain('attachments');
    expect(url).toContain('expansions=attachments.media_keys');
    expect(url).toContain('sender_id');
    expect(url).toContain('media.fields=url');
    expect(url).toContain('type');
    expect(url).toContain('width');
    expect(url).toContain('height');
    expect(url).toContain('max_results=100');
  });

  it('should use bot token for auth', async () => {
    vi.mocked(kvGet).mockResolvedValue(null);
    vi.mocked(xFetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => makeResponse([]),
      headers: new Headers(),
      text: async () => '',
    } as Response);

    await pollOnce();

    const opts = vi.mocked(xFetch).mock.calls[0][1] as { token?: string };
    expect(opts?.token).toBe('test-bot-token');
  });

  it('should limit pagination to MAX_PAGES (10)', async () => {
    vi.mocked(kvGet).mockResolvedValue(null);
    vi.mocked(processWebhookPayload).mockResolvedValue([]);

    // Generate 10 pages of responses with next_token
    const pageResponses = Array.from({ length: 11 }, (_, i) => ({
      ok: true,
      status: 200,
      json: async () => makeResponse(
        [makeEvent(`evt-page-${i}`)],
        i < 10 ? `next-page-${i + 1}` : undefined,
      ),
      headers: new Headers(),
      text: async () => '',
    } as Response));

    vi.mocked(xFetch).mockImplementation(() => Promise.resolve(pageResponses.shift()!));

    const count = await pollOnce();

    // MAX_PAGES = 10, so at most 10 calls
    expect(xFetch).toHaveBeenCalledTimes(10);
  });
});