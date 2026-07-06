/**
 * Database layer for x-dm-service.
 *
 * Provides a mysql2 connection pool and typed helpers for dm_events_log
 * INSERT + dedupe, and the key-value store (kvStore).
 *
 * Safety: nothing at module top level connects at import time — the pool
 * is lazily created on first use via getPool().
 */

import mysql from 'mysql2/promise';
import { getConfig } from './config.js';

// ---------------------------------------------------------------------------
// Typed error for DB failures
// ---------------------------------------------------------------------------

export class DbError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'DbError';
  }
}

// ---------------------------------------------------------------------------
// Pool
// ---------------------------------------------------------------------------

let pool: mysql.Pool | null = null;

export function getPool(): mysql.Pool {
  if (!pool) {
    const cfg = getConfig();
    pool = mysql.createPool({
      host: cfg.DB_HOST,
      port: cfg.DB_PORT,
      database: cfg.DB_NAME,
      user: cfg.DB_USER,
      password: cfg.DB_PASSWORD,
      waitForConnections: true,
      connectionLimit: 5,
      queueLimit: 0,
    });
  }
  return pool;
}

/** For testing: replace the pool with a mock/connection. */
export function _setPool(mock: mysql.Pool): void {
  pool = mock;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DmEventRow {
  event_id: string;
  dm_conversation_id: string;
  sender_id: string;
  event_type: string;
  text: string | null;
  media_keys: string | null; // JSON string
  raw: string | null;        // JSON string
  received_via: 'webhook' | 'poll';
  created_at: string;        // MySQL DATETIME string
}

// ---------------------------------------------------------------------------
// dm_events_log helpers
// ---------------------------------------------------------------------------

/**
 * Insert a DM event row, ignoring duplicates (idempotent dedupe by event_id).
 * Returns true if a new row was inserted, false if it already existed.
 * Throws DbError on connection failure.
 */
export async function insertDmEvent(row: {
  event_id: string;
  dm_conversation_id: string;
  sender_id: string;
  event_type: string;
  text: string | null;
  media_keys: unknown;
  raw: unknown;
  received_via: 'webhook' | 'poll';
  created_at: string;
}): Promise<boolean> {
  try {
    const conn = getPool();
    const [result] = await conn.execute(
      `INSERT IGNORE INTO dm_events_log
     (event_id, dm_conversation_id, sender_id, event_type, text, media_keys, raw, received_via, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.event_id,
        row.dm_conversation_id,
        row.sender_id,
        row.event_type,
        row.text,
        row.media_keys ? JSON.stringify(row.media_keys) : null,
        row.raw ? JSON.stringify(row.raw) : null,
        row.received_via,
        row.created_at,
      ],
    );
    // insertId is 0 when INSERT IGNORE skips a duplicate
    const info = result as mysql.ResultSetHeader;
    return info.affectedRows === 1;
  } catch (err) {
    throw new DbError(`insertDmEvent failed for ${row.event_id}`, err);
  }
}

/**
 * Check if an event_id already exists in dm_events_log (dedupe check).
 * Throws DbError on connection failure.
 */
export async function eventExists(eventId: string): Promise<boolean> {
  try {
    const conn = getPool();
    const [rows] = await conn.execute(
      'SELECT 1 FROM dm_events_log WHERE event_id = ? LIMIT 1',
      [eventId],
    );
    return (rows as unknown[]).length > 0;
  } catch (err) {
    throw new DbError(`eventExists failed for ${eventId}`, err);
  }
}

/**
 * Get the last-seen event timestamp from dm_events_log.
 * Returns ISO string or null if no events exist.
 */
export async function getLastEventCreatedAt(): Promise<string | null> {
  try {
    const conn = getPool();
    const [rows] = await conn.execute(
      'SELECT created_at FROM dm_events_log ORDER BY created_at DESC LIMIT 1',
    );
    const data = rows as { created_at: string }[];
    return data.length > 0 ? data[0].created_at : null;
  } catch (err) {
    throw new DbError('getLastEventCreatedAt failed', err);
  }
}

// ---------------------------------------------------------------------------
// Key-value store helpers
// ---------------------------------------------------------------------------

/**
 * Get a value from the kv store. Returns null if the key doesn't exist.
 * Throws DbError on connection failure.
 */
export async function kvGet(key: string): Promise<string | null> {
  try {
    const conn = getPool();
    const [rows] = await conn.execute(
      'SELECT `value` FROM x_kv_store WHERE `key` = ? LIMIT 1',
      [key],
    );
    const data = rows as { value: string }[];
    return data.length > 0 ? data[0].value : null;
  } catch (err) {
    throw new DbError(`kvGet failed for key "${key}"`, err);
  }
}

/**
 * Set a value in the kv store (upsert).
 * Throws DbError on connection failure.
 */
export async function kvSet(key: string, value: string): Promise<void> {
  try {
    const conn = getPool();
    await conn.execute(
      'INSERT INTO x_kv_store (`key`, `value`) VALUES (?, ?) ON DUPLICATE KEY UPDATE `value` = VALUES(`value`)',
      [key, value],
    );
  } catch (err) {
    throw new DbError(`kvSet failed for key "${key}"`, err);
  }
}

/**
 * Delete a key from the kv store.
 * Throws DbError on connection failure.
 */
export async function kvDelete(key: string): Promise<void> {
  try {
    const conn = getPool();
    await conn.execute('DELETE FROM x_kv_store WHERE `key` = ?', [key]);
  } catch (err) {
    throw new DbError(`kvDelete failed for key "${key}"`, err);
  }
}

// ---------------------------------------------------------------------------
// Well-known kv keys
// ---------------------------------------------------------------------------

export const KV_KEYS = {
  WEBHOOK_ID: 'webhook_id',
  WEBHOOK_VALID: 'webhook_valid',
  LAST_SEEN_EVENT_ID: 'last_seen_event_id',
  LAST_WEBHOOK_EVENT_AT: 'last_webhook_event_at',
  SUBSCRIPTION_DM_RECEIVED: 'subscription_dm_received_id',
  SUBSCRIPTION_DM_SENT: 'subscription_dm_sent_id',
  /** Daily DM send counter — value stores count for current UTC date */
  DM_DAILY_COUNT: 'dm_daily_count',
  /** Last UTC date the daily counter was recorded (YYYY-MM-DD) */
  DM_DAILY_DATE: 'dm_daily_date',
} as const;