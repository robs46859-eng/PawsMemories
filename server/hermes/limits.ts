import { createHash } from "node:crypto";
import type { HermesJobType } from "./schemas";

export type HermesLimitScope = "create" | "status";

export const HERMES_MINUTE_LIMITS = {
  create: { user: 5, ip: 30 },
  status: { user: 60, ip: 60 },
} as const;

export interface HermesLimitDecision {
  allowed: boolean;
  retryAfterSeconds?: number;
}

export interface HermesMinuteLimits {
  consume(scope: HermesLimitScope, owner: string, ip: string): Promise<HermesLimitDecision>;
}

export interface HermesDailyUsageDecision {
  allowed: boolean;
  count: number;
}

export interface HermesDailyUsage {
  reserve(owner: string, type: HermesJobType, cap: number): Promise<HermesDailyUsageDecision>;
}

interface WindowEntry {
  count: number;
  resetAt: number;
}

interface SqlConnection {
  beginTransaction(): Promise<void>;
  query(sql: string, values?: unknown[]): Promise<any>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
  release(): void;
}

interface SqlPool {
  query(sql: string, values?: unknown[]): Promise<any>;
  getConnection(): Promise<SqlConnection>;
}

function keyHash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export const HERMES_RATE_LIMITS_DDL = `
  CREATE TABLE IF NOT EXISTS hermes_rate_limits (
    scope         VARCHAR(16)  NOT NULL,
    dimension     ENUM('user','ip') NOT NULL,
    key_hash      CHAR(64)     NOT NULL,
    window_start  BIGINT       NOT NULL,
    count         INT UNSIGNED NOT NULL DEFAULT 0,
    updated_at    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (scope, dimension, key_hash, window_start),
    INDEX idx_hermes_rate_window (window_start)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
`;

/** Deterministic test fallback. Production always injects the MySQL implementation. */
export class InMemoryHermesMinuteLimits implements HermesMinuteLimits {
  private readonly entries = new Map<string, WindowEntry>();

  constructor(
    private readonly now: () => number = Date.now,
    private readonly windowMs = 60_000,
  ) {}

  async consume(scope: HermesLimitScope, owner: string, ip: string): Promise<HermesLimitDecision> {
    const now = this.now();
    const limits = HERMES_MINUTE_LIMITS[scope];
    const userKey = `${scope}:user:${keyHash(owner)}`;
    const ipKey = `${scope}:ip:${keyHash(ip)}`;
    const userEntry = this.current(userKey, now);
    const ipEntry = this.current(ipKey, now);

    const userLimited = userEntry != null && userEntry.count >= limits.user;
    const ipLimited = ipEntry != null && ipEntry.count >= limits.ip;
    if (userLimited || ipLimited) {
      const resetAt = Math.max(
        userLimited ? userEntry!.resetAt : now,
        ipLimited ? ipEntry!.resetAt : now,
      );
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((resetAt - now) / 1000)),
      };
    }

    this.increment(userKey, userEntry, now);
    this.increment(ipKey, ipEntry, now);
    return { allowed: true };
  }

  private current(key: string, now: number): WindowEntry | null {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (now >= entry.resetAt) {
      this.entries.delete(key);
      return null;
    }
    return entry;
  }

  private increment(key: string, current: WindowEntry | null, now: number): void {
    this.entries.set(key, current
      ? { ...current, count: current.count + 1 }
      : { count: 1, resetAt: now + this.windowMs });
  }
}

/** Atomic fixed-window limiter shared by every Hostinger process. */
export class MySqlHermesMinuteLimits implements HermesMinuteLimits {
  constructor(
    private readonly pool: SqlPool,
    private readonly now: () => number = Date.now,
  ) {}

  async ensureSchema(): Promise<void> {
    await this.pool.query(HERMES_RATE_LIMITS_DDL);
    const currentWindow = Math.floor(this.now() / 60_000);
    await this.pool.query(
      "DELETE FROM hermes_rate_limits WHERE window_start < ?",
      [currentWindow - 1_440],
    );
  }

  async consume(scope: HermesLimitScope, owner: string, ip: string): Promise<HermesLimitDecision> {
    const now = this.now();
    const windowStart = Math.floor(now / 60_000);
    const retryAfterSeconds = Math.max(1, Math.ceil(((windowStart + 1) * 60_000 - now) / 1_000));
    const configured = HERMES_MINUTE_LIMITS[scope];
    const entries = [
      { dimension: "user", key: keyHash(owner), limit: configured.user },
      { dimension: "ip", key: keyHash(ip), limit: configured.ip },
    ] as const;
    const connection = await this.pool.getConnection();

    try {
      await connection.beginTransaction();
      for (const entry of entries) {
        await connection.query(
          `INSERT INTO hermes_rate_limits
             (scope, dimension, key_hash, window_start, count)
           VALUES (?, ?, ?, ?, 0)
           ON DUPLICATE KEY UPDATE key_hash = VALUES(key_hash)`,
          [scope, entry.dimension, entry.key, windowStart],
        );
      }

      const counts: number[] = [];
      for (const entry of entries) {
        const [rows]: any = await connection.query(
          `SELECT count
             FROM hermes_rate_limits
            WHERE scope = ? AND dimension = ? AND key_hash = ? AND window_start = ?
            FOR UPDATE`,
          [scope, entry.dimension, entry.key, windowStart],
        );
        counts.push(Number(rows?.[0]?.count ?? 0));
      }

      if (counts.some((count, index) => count >= entries[index].limit)) {
        await connection.rollback();
        return { allowed: false, retryAfterSeconds };
      }

      for (const entry of entries) {
        await connection.query(
          `UPDATE hermes_rate_limits
              SET count = count + 1
            WHERE scope = ? AND dimension = ? AND key_hash = ? AND window_start = ?`,
          [scope, entry.dimension, entry.key, windowStart],
        );
      }
      await connection.commit();
      return { allowed: true };
    } catch (error) {
      await connection.rollback().catch(() => undefined);
      throw error;
    } finally {
      connection.release();
    }
  }
}

/** Atomic daily reservation. A denied request leaves the stored count unchanged. */
export class MySqlHermesDailyUsage implements HermesDailyUsage {
  constructor(private readonly pool: SqlPool) {}

  async reserve(owner: string, type: HermesJobType, cap: number): Promise<HermesDailyUsageDecision> {
    if (!Number.isInteger(cap) || cap < 1) throw new Error("Invalid Hermes daily cap.");
    const endpoint = `hermes_${type}`;
    const connection = await this.pool.getConnection();

    try {
      await connection.beginTransaction();
      await connection.query(
        `INSERT INTO api_usage_daily (user_phone, endpoint, day, count)
         VALUES (?, ?, UTC_DATE(), 0)
         ON DUPLICATE KEY UPDATE user_phone = VALUES(user_phone)`,
        [owner, endpoint],
      );
      const [rows]: any = await connection.query(
        `SELECT count
           FROM api_usage_daily
          WHERE user_phone = ? AND endpoint = ? AND day = UTC_DATE()
          FOR UPDATE`,
        [owner, endpoint],
      );
      const count = Number(rows?.[0]?.count ?? 0);
      if (!Number.isInteger(count) || count < 0) throw new Error("Invalid Hermes usage count.");
      if (count >= cap) {
        await connection.rollback();
        return { allowed: false, count };
      }
      await connection.query(
        `UPDATE api_usage_daily
            SET count = count + 1
          WHERE user_phone = ? AND endpoint = ? AND day = UTC_DATE()`,
        [owner, endpoint],
      );
      await connection.commit();
      return { allowed: true, count: count + 1 };
    } catch (error) {
      await connection.rollback().catch(() => undefined);
      throw error;
    } finally {
      connection.release();
    }
  }
}
