import assert from "node:assert/strict";
import test from "node:test";
import { runMigrations, sha256 } from "../server/migrations/runner.ts";

test("sha256 produces deterministic checksums", () => {
  const hash1 = sha256("SELECT 1;");
  const hash2 = sha256("  SELECT 1;  ");
  assert.equal(hash1, hash2);
  assert.equal(hash1.length, 64);
});

test("runMigrations acquires dedicated connection, performs migration, and releases lock & connection in finally", async () => {
  const connectionQueries = [];
  const storedRows = [];
  let lockAcquired = false;
  let connectionReleased = false;

  const mockConnection = {
    async query(sql, params) {
      const sqlStr = String(sql).trim();
      connectionQueries.push(sqlStr);

      if (sqlStr.startsWith("CREATE TABLE IF NOT EXISTS schema_migrations")) {
        return [[]];
      }
      if (sqlStr.includes("GET_LOCK")) {
        lockAcquired = true;
        return [[{ lock_acquired: 1 }]];
      }
      if (sqlStr.includes("RELEASE_LOCK")) {
        lockAcquired = false;
        return [[{ lock_released: 1 }]];
      }
      if (sqlStr.startsWith("SELECT version, name, checksum")) {
        return [storedRows];
      }
      if (sqlStr.startsWith("INSERT INTO schema_migrations")) {
        storedRows.push({
          version: params[0],
          name: params[1],
          checksum: params[2],
          applied_at: new Date(),
          duration_ms: params[3],
        });
        return [{ affectedRows: 1 }];
      }
      return [[]];
    },
    release() {
      connectionReleased = true;
    },
  };

  let poolGetConnectionCalled = false;
  const mockPool = {
    async getConnection() {
      poolGetConnectionCalled = true;
      return mockConnection;
    },
    async query() {
      throw new Error("Pool.query should not be called directly during migrations; use dedicated connection.");
    },
  };

  const testMigrations = [
    {
      version: 16,
      name: "test_migration_16",
      statements: ["CREATE TABLE test16 (id INT PRIMARY KEY);"],
    },
    {
      version: 17,
      name: "test_migration_17",
      statements: ["CREATE TABLE test17 (id INT PRIMARY KEY);"],
    },
  ];

  const result = await runMigrations(mockPool, testMigrations);

  assert.ok(poolGetConnectionCalled, "Must acquire connection via pool.getConnection()");
  assert.equal(result.applied, 2);
  assert.equal(storedRows.length, 2);
  assert.equal(storedRows[0].version, 16);
  assert.equal(storedRows[1].version, 17);
  assert.equal(lockAcquired, false, "Lock must be released after completion");
  assert.equal(connectionReleased, true, "Connection must be released after completion");

  // Second run: 0 migrations applied
  connectionReleased = false;
  const result2 = await runMigrations(mockPool, testMigrations);
  assert.equal(result2.applied, 0);
  assert.equal(connectionReleased, true, "Connection must be released on second run");
});

test("runMigrations releases lock and connection in finally when migration statement fails", async () => {
  let lockAcquired = false;
  let connectionReleased = false;

  const mockConnection = {
    async query(sql) {
      const sqlStr = String(sql).trim();
      if (sqlStr.includes("GET_LOCK")) {
        lockAcquired = true;
        return [[{ lock_acquired: 1 }]];
      }
      if (sqlStr.includes("RELEASE_LOCK")) {
        lockAcquired = false;
        return [[{ lock_released: 1 }]];
      }
      if (sqlStr.startsWith("CREATE TABLE IF NOT EXISTS schema_migrations")) return [[]];
      if (sqlStr.startsWith("SELECT version, name, checksum")) return [[]];
      if (sqlStr.startsWith("FAIL_STATEMENT")) {
        throw new Error("Syntax error in DDL statement");
      }
      return [[]];
    },
    release() {
      connectionReleased = true;
    },
  };

  const mockPool = {
    async getConnection() {
      return mockConnection;
    },
  };

  const failingMigrations = [
    {
      version: 16,
      name: "failing_mig",
      statements: ["FAIL_STATEMENT"],
    },
  ];

  await assert.rejects(
    async () => {
      await runMigrations(mockPool, failingMigrations);
    },
    /Syntax error in DDL statement/,
  );

  assert.equal(lockAcquired, false, "Lock must be released in finally block on error");
  assert.equal(connectionReleased, true, "Connection must be released in finally block on error");
});

test("runMigrations rejects duplicate versions and duplicate names before connection/DDL", async () => {
  const mockPool = {
    async getConnection() {
      assert.fail("Should not acquire connection if migrations array is invalid");
    },
  };

  const duplicateVersions = [
    { version: 16, name: "mig_a", statements: ["SELECT 1"] },
    { version: 16, name: "mig_b", statements: ["SELECT 2"] },
  ];

  await assert.rejects(
    async () => {
      await runMigrations(mockPool, duplicateVersions);
    },
    /Duplicate migration version detected: 16/,
  );

  const duplicateNames = [
    { version: 16, name: "same_name", statements: ["SELECT 1"] },
    { version: 17, name: "same_name", statements: ["SELECT 2"] },
  ];

  await assert.rejects(
    async () => {
      await runMigrations(mockPool, duplicateNames);
    },
    /Duplicate migration name detected: same_name/,
  );
});

test("runMigrations detects checksum mismatch for modified applied migration", async () => {
  const storedRows = [
    {
      version: 16,
      name: "test_migration_16",
      checksum: sha256("ORIGINAL STATEMENT"),
      applied_at: new Date(),
      duration_ms: 10,
    },
  ];

  let lockAcquired = false;
  let connectionReleased = false;

  const mockConnection = {
    async query(sql) {
      const sqlStr = String(sql).trim();
      if (sqlStr.startsWith("CREATE TABLE IF NOT EXISTS schema_migrations")) return [[]];
      if (sqlStr.includes("GET_LOCK")) {
        lockAcquired = true;
        return [[{ lock_acquired: 1 }]];
      }
      if (sqlStr.includes("RELEASE_LOCK")) {
        lockAcquired = false;
        return [[{ lock_released: 1 }]];
      }
      if (sqlStr.startsWith("SELECT version, name, checksum")) return [storedRows];
      return [[]];
    },
    release() {
      connectionReleased = true;
    },
  };

  const mockPool = {
    async getConnection() {
      return mockConnection;
    },
  };

  const tamperedMigrations = [
    {
      version: 16,
      name: "test_migration_16",
      statements: ["MODIFIED STATEMENT"],
    },
  ];

  await assert.rejects(
    async () => {
      await runMigrations(mockPool, tamperedMigrations);
    },
    /Migration checksum mismatch for version 16/,
  );

  assert.equal(lockAcquired, false, "Lock must be released on checksum mismatch");
  assert.equal(connectionReleased, true, "Connection must be released on checksum mismatch");
});
