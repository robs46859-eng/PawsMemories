import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MySqlHermesDailyUsage,
  MySqlHermesMinuteLimits,
} from "../../server/hermes/limits.ts";

const normalized = (sql) => sql.replace(/\s+/g, " ").trim();

class FakeSqlPool {
  rateRows = new Map();
  dailyRows = new Map();
  schemaCalls = 0;

  async query(sql) {
    const statement = normalized(sql);
    if (statement.startsWith("CREATE TABLE IF NOT EXISTS hermes_rate_limits")) {
      this.schemaCalls += 1;
      return [[], []];
    }
    if (statement.startsWith("DELETE FROM hermes_rate_limits")) return [{ affectedRows: 0 }, []];
    throw new Error(`Unexpected pool query: ${statement}`);
  }

  async getConnection() {
    return new FakeSqlConnection(this);
  }
}

class FakeSqlConnection {
  rateSnapshot;
  dailySnapshot;

  constructor(pool) {
    this.pool = pool;
  }

  async beginTransaction() {
    this.rateSnapshot = new Map(this.pool.rateRows);
    this.dailySnapshot = new Map(this.pool.dailyRows);
  }

  async query(sql, values = []) {
    const statement = normalized(sql);
    if (statement.startsWith("INSERT INTO hermes_rate_limits")) {
      const key = values.join(":");
      if (!this.pool.rateRows.has(key)) this.pool.rateRows.set(key, 0);
      return [{ affectedRows: 1 }, []];
    }
    if (statement.startsWith("SELECT count FROM hermes_rate_limits")) {
      const key = values.join(":");
      return [[{ count: this.pool.rateRows.get(key) ?? 0 }], []];
    }
    if (statement.startsWith("UPDATE hermes_rate_limits")) {
      const key = values.join(":");
      this.pool.rateRows.set(key, (this.pool.rateRows.get(key) ?? 0) + 1);
      return [{ affectedRows: 1 }, []];
    }
    if (statement.startsWith("INSERT INTO api_usage_daily")) {
      const key = values.join(":");
      if (!this.pool.dailyRows.has(key)) this.pool.dailyRows.set(key, 0);
      return [{ affectedRows: 1 }, []];
    }
    if (statement.startsWith("SELECT count FROM api_usage_daily")) {
      const key = values.join(":");
      return [[{ count: this.pool.dailyRows.get(key) ?? 0 }], []];
    }
    if (statement.startsWith("UPDATE api_usage_daily")) {
      const key = values.join(":");
      this.pool.dailyRows.set(key, (this.pool.dailyRows.get(key) ?? 0) + 1);
      return [{ affectedRows: 1 }, []];
    }
    throw new Error(`Unexpected connection query: ${statement}`);
  }

  async commit() {
    this.rateSnapshot = undefined;
    this.dailySnapshot = undefined;
  }

  async rollback() {
    if (this.rateSnapshot) this.pool.rateRows = new Map(this.rateSnapshot);
    if (this.dailySnapshot) this.pool.dailyRows = new Map(this.dailySnapshot);
    this.rateSnapshot = undefined;
    this.dailySnapshot = undefined;
  }

  release() {}
}

test("MySQL minute limits are shared across limiter instances and reset by window", async () => {
  const pool = new FakeSqlPool();
  let now = Date.UTC(2026, 6, 15, 12, 0, 10);
  const firstProcess = new MySqlHermesMinuteLimits(pool, () => now);
  const secondProcess = new MySqlHermesMinuteLimits(pool, () => now);
  await firstProcess.ensureSchema();
  assert.equal(pool.schemaCalls, 1);

  for (let index = 0; index < 5; index += 1) {
    const limiter = index % 2 === 0 ? firstProcess : secondProcess;
    assert.deepEqual(
      await limiter.consume("create", "owner-shared", `198.51.100.${index + 1}`),
      { allowed: true },
    );
  }
  const blocked = await secondProcess.consume("create", "owner-shared", "198.51.100.99");
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.retryAfterSeconds, 50);
  assert.equal([...pool.rateRows.keys()].some((key) => key.includes("owner-shared")), false);

  now += 60_000;
  assert.deepEqual(
    await firstProcess.consume("create", "owner-shared", "198.51.100.99"),
    { allowed: true },
  );
});

test("MySQL daily reservations share state and denied calls do not increment", async () => {
  const pool = new FakeSqlPool();
  const firstProcess = new MySqlHermesDailyUsage(pool);
  const secondProcess = new MySqlHermesDailyUsage(pool);

  assert.deepEqual(
    await firstProcess.reserve("daily-owner", "knowledge", 2),
    { allowed: true, count: 1 },
  );
  assert.deepEqual(
    await secondProcess.reserve("daily-owner", "knowledge", 2),
    { allowed: true, count: 2 },
  );
  assert.deepEqual(
    await firstProcess.reserve("daily-owner", "knowledge", 2),
    { allowed: false, count: 2 },
  );
  assert.equal(pool.dailyRows.get("daily-owner:hermes_knowledge"), 2);
});
