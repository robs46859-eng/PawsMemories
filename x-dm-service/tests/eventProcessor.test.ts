/**
 * Tests for eventProcessor — normalization, dedupe, bot-echo filtering.
 *
 * Spec: X_DM_REFINEMENT_SPEC.md §5.2, §5.7
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { normalizePayload, processEvent, type DmEvent } from '../src/eventProcessor.js';

// Mock the db module
vi.mock('../src/db.js', () => ({
  eventExists: vi.fn(),
  insertDmEvent: vi.fn(),
  kvSet: vi.fn(),
  KV_KEYS: {
    LAST_SEEN_EVENT_ID: 'last_seen_event_id',
    LAST_WEBHOOK_EVENT_AT: 'last_webhook_event_at',
  },
}));

// Mock dmSender so echo replies don't fire HTTP calls
vi.mock('../src/dmSender.js', () => ({
  sendDm: vi.fn(() => Promise.resolve('mocked-event-id')),
}));

import { eventExists, insertDmEvent, kvSet } from '../src/db.js';
import { sendDm } from '../src/dmSender.js';

// Mock the config
vi.mock('../src/config.js', () => ({
  getConfig: vi.fn(() => ({
    X_BOT_USER_ID: 'bot-user-12345',
  })),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const xActivityPayload = {
  dm_event: {
    id: 'evt-001',
    text: 'Can you make my cat look like a dragon?',
    event_type: 'MessageCreate',
    dm_conversation_id: 'conv-001',
    sender_id: 'user-999',
    created_at: '2026-07-06T12:00:00Z',
    attachments: {
      media_keys: ['media_3_12345'],
    },
  },
  users: {
    'user-999': { username: 'catfan42' },
  },
};

const xActivityPayloadNoMedia = {
  dm_event: {
    id: 'evt-002',
    text: 'Hello',
    event_type: 'MessageCreate',
    dm_conversation_id: 'conv-002',
    sender_id: 'user-888',
    created_at: '2026-07-06T12:01:00Z',
  },
  users: {
    'user-888': { username: 'testuser' },
  },
};

const legacyPayload = {
  direct_message_events: [
    {
      id: 'legacy-evt-001',
      created_timestamp: '1720000000000',
      type: 'message_create',
      message_create: {
        sender_id: 'user-777',
        target: { recipient_id: 'bot-user-12345' },
        message_data: {
          text: 'Make it more metallic',
          attachment: {
            media: { id_str: 'media_4_67890', media_url: 'https://pbs.twimg.com/media/xxx.jpg' },
          },
        },
      },
    },
    {
      id: 'legacy-evt-002',
      created_timestamp: '1720000001000',
      type: 'message_create',
      message_create: {
        sender_id: 'user-666',
        target: { recipient_id: 'bot-user-12345' },
        message_data: {
          text: 'Just a text message',
        },
      },
    },
  ],
  users: {
    'user-777': { screen_name: 'artist3d' },
    'user-666': { screen_name: 'petlover' },
  },
};

const botEchoPayload = {
  dm_event: {
    id: 'evt-bot-echo',
    text: 'Working on it!',
    event_type: 'MessageCreate',
    dm_conversation_id: 'conv-001',
    sender_id: 'bot-user-12345',
    created_at: '2026-07-06T12:05:00Z',
  },
};

const participantsJoinPayload = {
  dm_event: {
    id: 'evt-join',
    event_type: 'ParticipantsJoin',
    dm_conversation_id: 'conv-001',
    sender_id: 'user-999',
    created_at: '2026-07-06T12:00:00Z',
  },
};

// ---------------------------------------------------------------------------
// normalizePayload tests
// ---------------------------------------------------------------------------

describe('normalizePayload', () => {
  it('should normalize X Activity API envelope (dm_event)', () => {
    const events = normalizePayload(xActivityPayload);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      event_id: 'evt-001',
      dm_conversation_id: 'conv-001',
      sender_id: 'user-999',
      sender_username: 'catfan42',
      event_type: 'MessageCreate',
      text: 'Can you make my cat look like a dragon?',
      media_keys: ['media_3_12345'],
    });
    expect(events[0].raw).toEqual(xActivityPayload);
    expect(events[0].created_at).toBe('2026-07-06T12:00:00Z');
  });

  it('should normalize X Activity payload without media', () => {
    const events = normalizePayload(xActivityPayloadNoMedia);
    expect(events).toHaveLength(1);
    expect(events[0].event_id).toBe('evt-002');
    expect(events[0].media_keys).toBeNull();
    expect(events[0].text).toBe('Hello');
  });

  it('should normalize legacy Account Activity envelope (direct_message_events)', () => {
    const events = normalizePayload(legacyPayload);
    expect(events).toHaveLength(2);

    // First event
    expect(events[0]).toMatchObject({
      event_id: 'legacy-evt-001',
      sender_id: 'user-777',
      sender_username: 'artist3d',
      event_type: 'MessageCreate',
      text: 'Make it more metallic',
      media_keys: ['media_4_67890'],
    });

    // Second event (no media)
    expect(events[1]).toMatchObject({
      event_id: 'legacy-evt-002',
      sender_id: 'user-666',
      sender_username: 'petlover',
      event_type: 'MessageCreate',
      text: 'Just a text message',
      media_keys: null,
    });
  });

  it('should normalize ParticipantsJoin event type', () => {
    const events = normalizePayload(participantsJoinPayload);
    expect(events).toHaveLength(1);
    expect(events[0].event_type).toBe('ParticipantsJoin');
    expect(events[0].text).toBeNull();
  });

  it('should return empty array for null/undefined payload', () => {
    expect(normalizePayload(null)).toEqual([]);
    expect(normalizePayload(undefined)).toEqual([]);
    expect(normalizePayload('string')).toEqual([]);
    expect(normalizePayload(42)).toEqual([]);
  });

  it('should return empty array for unknown payload shape', () => {
    const unknown = { some_unknown_field: 'value' };
    expect(normalizePayload(unknown)).toEqual([]);
  });

  it('should prefer X Activity shape over legacy when both present', () => {
    // If both dm_event and direct_message_events are present, dm_event wins
    const mixed = {
      ...xActivityPayload,
      direct_message_events: [
        {
          id: 'legacy',
          type: 'message_create',
          message_create: {
            sender_id: 'user-xxx',
            message_data: { text: 'ignored' },
          },
        },
      ],
    };
    const events = normalizePayload(mixed);
    expect(events).toHaveLength(1);
    expect(events[0].event_id).toBe('evt-001');
  });

  it('should handle legacy events without dm_conversation_id', () => {
    const legacyNoConv = {
      direct_message_events: [
        {
          id: 'no-conv',
          created_timestamp: '1720000000000',
          type: 'message_create',
          message_create: {
            sender_id: 'user-555',
            target: { recipient_id: 'bot-123' },
            message_data: { text: 'hello' },
          },
        },
      ],
    };
    const events = normalizePayload(legacyNoConv);
    expect(events).toHaveLength(1);
    // dm_conversation_id should be empty string (not undefined)
    expect(events[0].dm_conversation_id).toBe('');
  });
});

// ---------------------------------------------------------------------------
// processEvent tests (dedupe, bot-echo filtering)
// ---------------------------------------------------------------------------

describe('processEvent', () => {
  const mockEvent: DmEvent = {
    event_id: 'evt-process-001',
    dm_conversation_id: 'conv-001',
    sender_id: 'user-999',
    event_type: 'MessageCreate',
    text: 'Test message',
    media_keys: null,
    raw: { test: true },
    created_at: '2026-07-06T12:00:00Z',
  };

  const botEcho: DmEvent = {
    event_id: 'evt-bot-echo',
    dm_conversation_id: 'conv-001',
    sender_id: 'bot-user-12345',
    event_type: 'MessageCreate',
    text: 'Echo from bot',
    media_keys: null,
    raw: { test: true },
    created_at: '2026-07-06T12:05:00Z',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should process a new event (not duplicate, not bot echo)', async () => {
    vi.mocked(eventExists).mockResolvedValue(false);
    vi.mocked(insertDmEvent).mockResolvedValue(true);

    const result = await processEvent(mockEvent, 'webhook');

    expect(result).toBe(true);
    expect(eventExists).toHaveBeenCalledWith('evt-process-001');
    expect(insertDmEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event_id: 'evt-process-001',
        received_via: 'webhook',
      }),
    );
    expect(kvSet).toHaveBeenCalledWith('last_webhook_event_at', expect.any(String));
  });

  it('should trigger echo reply for new MessageCreate events', async () => {
    vi.mocked(eventExists).mockResolvedValue(false);
    vi.mocked(insertDmEvent).mockResolvedValue(true);
    vi.mocked(sendDm).mockResolvedValue('mocked-event-id');

    const result = await processEvent(mockEvent, 'webhook');

    expect(result).toBe(true);
    expect(sendDm).toHaveBeenCalledWith({
      conversationId: 'conv-001',
      text: expect.stringContaining('Got it!'),
    });
  });

  it('should NOT trigger echo reply for bot echoes', async () => {
    const result = await processEvent(botEcho, 'webhook');

    expect(result).toBe(false);
    expect(sendDm).not.toHaveBeenCalled();
  });

  it('should NOT trigger echo reply for duplicate events', async () => {
    vi.mocked(eventExists).mockResolvedValue(true);

    const result = await processEvent(mockEvent, 'webhook');

    expect(result).toBe(false);
    expect(sendDm).not.toHaveBeenCalled();
  });

  it('should NOT trigger echo reply for ParticipantsJoin events', async () => {
    vi.mocked(eventExists).mockResolvedValue(false);
    vi.mocked(insertDmEvent).mockResolvedValue(true);

    const joinEvent: DmEvent = {
      event_id: 'evt-join',
      dm_conversation_id: 'conv-001',
      sender_id: 'user-999',
      event_type: 'ParticipantsJoin',
      text: null,
      media_keys: null,
      raw: {},
      created_at: '2026-07-06T12:00:00Z',
    };

    const result = await processEvent(joinEvent, 'webhook');
    expect(result).toBe(true);
    expect(sendDm).not.toHaveBeenCalled();
  });

  it('should skip bot echoes (sender_id === X_BOT_USER_ID)', async () => {
    const result = await processEvent(botEcho, 'webhook');

    expect(result).toBe(false);
    // Should NOT have checked DB or inserted
    expect(eventExists).not.toHaveBeenCalled();
    expect(insertDmEvent).not.toHaveBeenCalled();
  });

  it('should skip duplicate events (already in dm_events_log)', async () => {
    vi.mocked(eventExists).mockResolvedValue(true);

    const result = await processEvent(mockEvent, 'poll');

    expect(result).toBe(false);
    expect(eventExists).toHaveBeenCalledWith('evt-process-001');
    expect(insertDmEvent).not.toHaveBeenCalled();
  });

  it('should record received_via=poll for poller events', async () => {
    vi.mocked(eventExists).mockResolvedValue(false);
    vi.mocked(insertDmEvent).mockResolvedValue(true);

    await processEvent(mockEvent, 'poll');

    expect(insertDmEvent).toHaveBeenCalledWith(
      expect.objectContaining({ received_via: 'poll' }),
    );
    // Should NOT update last_webhook_event_at for poll events
    // (it only updates for received_via='webhook')
    expect(kvSet).toHaveBeenCalledWith('last_seen_event_id', 'evt-process-001');
  });

  it('should handle participants join events', async () => {
    vi.mocked(eventExists).mockResolvedValue(false);
    vi.mocked(insertDmEvent).mockResolvedValue(true);

    const joinEvent: DmEvent = {
      event_id: 'evt-join-001',
      dm_conversation_id: 'conv-001',
      sender_id: 'user-999',
      event_type: 'ParticipantsJoin',
      text: null,
      media_keys: null,
      raw: {},
      created_at: '2026-07-06T12:00:00Z',
    };

    const result = await processEvent(joinEvent, 'webhook');
    expect(result).toBe(true);
    expect(insertDmEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: 'ParticipantsJoin',
        text: null,
      }),
    );
  });
});