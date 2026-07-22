import assert from "node:assert/strict";
import test from "node:test";

import {
  checkDatabaseHealth,
  closePool,
  databasePoolOptions,
  setPool,
} from "../db.ts";

test("databasePoolOptions bounds deployment-provided pool settings", () => {
  const options = databasePoolOptions({
    DB_HOST: "db.example",
    DB_PORT: "99999",
    DB_USER: "app",
    DB_PASSWORD: "secret",
    DB_NAME: "paws",
    DB_CONNECTION_LIMIT: "500",
    DB_MAX_IDLE: "100",
    DB_IDLE_TIMEOUT_MS: "1",
    DB_CONNECT_TIMEOUT_MS: "999999",
    DB_KEEPALIVE_DELAY_MS: "2500",
  });

  assert.equal(options.host, "db.example");
  assert.equal(options.port, 65535);
  assert.equal(options.connectionLimit, 50);
  assert.equal(options.maxIdle, 50);
  assert.equal(options.idleTimeout, 10_000);
  assert.equal(options.connectTimeout, 60_000);
  assert.equal(options.enableKeepAlive, true);
  assert.equal(options.keepAliveInitialDelay, 2500);
});

test("checkDatabaseHealth reports a successful pooled query", async () => {
  const previous = {
    NODE_ENV: process.env.NODE_ENV,
    DB_DISABLED: process.env.DB_DISABLED,
    DB_HOST: process.env.DB_HOST,
    DB_NAME: process.env.DB_NAME,
    DB_USER: process.env.DB_USER,
  };
  Object.assign(process.env, {
    NODE_ENV: "test",
    DB_DISABLED: "0",
    DB_HOST: "configured",
    DB_NAME: "configured",
    DB_USER: "configured",
  });
  let ended = false;
  setPool({
    query: async () => [[{ ok: 1 }], []],
    end: async () => { ended = true; },
  });

  try {
    const health = await checkDatabaseHealth();
    assert.equal(health.configured, true);
    assert.equal(health.healthy, true);
    await closePool();
    assert.equal(ended, true);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("checkDatabaseHealth normalizes query failures", async () => {
  const previous = {
    NODE_ENV: process.env.NODE_ENV,
    DB_DISABLED: process.env.DB_DISABLED,
    DB_HOST: process.env.DB_HOST,
    DB_NAME: process.env.DB_NAME,
    DB_USER: process.env.DB_USER,
  };
  Object.assign(process.env, {
    NODE_ENV: "test",
    DB_DISABLED: "0",
    DB_HOST: "configured",
    DB_NAME: "configured",
    DB_USER: "configured",
  });
  setPool({
    query: async () => { throw new Error("connection lost"); },
    end: async () => {},
  });

  try {
    const health = await checkDatabaseHealth();
    assert.equal(health.configured, true);
    assert.equal(health.healthy, false);
    assert.match(health.error, /connection lost/);
  } finally {
    await closePool();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
