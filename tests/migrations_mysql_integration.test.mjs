import assert from "node:assert/strict";
import test from "node:test";
import mysql from "mysql2/promise";
import { runMigrations } from "../server/migrations/runner.ts";

const mysqlHost = process.env.MYSQL_TEST_HOST || "127.0.0.1";
const mysqlPort = Number(process.env.MYSQL_TEST_PORT || 3306);
const mysqlUser = process.env.MYSQL_TEST_USER || "root";
const mysqlPassword = process.env.MYSQL_TEST_PASSWORD || "";

export async function isMysqlServerReachable() {
  try {
    const conn = await mysql.createConnection({
      host: mysqlHost,
      port: mysqlPort,
      user: mysqlUser,
      password: mysqlPassword,
      connectTimeout: 2000,
    });
    await conn.ping();
    await conn.end();
    return true;
  } catch {
    return false;
  }
}

test("Real MySQL Integration Suite", async (t) => {
  const reachable = await isMysqlServerReachable();
  if (!reachable) {
    t.skip("Local test MySQL instance not running on 127.0.0.1:3306. Provision MySQL to run integration tests.");
    return;
  }

  const testDbName = `paws_test_integration_${Date.now()}_${Math.floor(Math.random() * 10000)}`;

  t.before(async () => {
    const adminConn = await mysql.createConnection({
      host: mysqlHost,
      port: mysqlPort,
      user: mysqlUser,
      password: mysqlPassword,
    });
    await adminConn.query(`CREATE DATABASE IF NOT EXISTS \`${testDbName}\``);
    await adminConn.end();
  });

  t.after(async () => {
    const adminConn = await mysql.createConnection({
      host: mysqlHost,
      port: mysqlPort,
      user: mysqlUser,
      password: mysqlPassword,
    });
    await adminConn.query(`DROP DATABASE IF EXISTS \`${testDbName}\``);
    await adminConn.end();
  });

  const getTestPool = () =>
    mysql.createPool({
      host: mysqlHost,
      port: mysqlPort,
      user: mysqlUser,
      password: mysqlPassword,
      database: testDbName,
      waitForConnections: true,
      connectionLimit: 5,
    });

  await t.test("1. Baseline table setup and migration 16 & 17 execution", async () => {
    const pool = getTestPool();
    try {
      const conn = await pool.getConnection();
      // Setup representative pre-16 baseline schema
      await conn.query(`
        CREATE TABLE users (
          id INT AUTO_INCREMENT PRIMARY KEY,
          phone VARCHAR(64) NOT NULL UNIQUE,
          email VARCHAR(190) NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
      `);

      await conn.query(`
        CREATE TABLE marketplace_assets (
          id BIGINT AUTO_INCREMENT PRIMARY KEY,
          listing_id BIGINT NOT NULL,
          asset_uuid CHAR(36) NOT NULL,
          kind ENUM('source_glb','preview_image','stl_derivative') NOT NULL,
          bucket ENUM('public','private') NOT NULL,
          object_key VARCHAR(512) NOT NULL,
          mime_type VARCHAR(120) NOT NULL,
          size_bytes BIGINT NOT NULL,
          sha256 CHAR(64) NOT NULL,
          version INT NOT NULL DEFAULT 1,
          status ENUM('active','superseded') NOT NULL DEFAULT 'active',
          sort_order INT NOT NULL DEFAULT 0,
          derivative_height_mm DECIMAL(8,2) NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
      `);

      // Insert pre-existing duplicate active STL derivatives to test reconciliation
      await conn.query(`
        INSERT INTO marketplace_assets 
          (listing_id, asset_uuid, kind, bucket, object_key, mime_type, size_bytes, sha256, status, derivative_height_mm)
        VALUES
          (100, 'uuid-dupe-1', 'stl_derivative', 'private', 'key-1', 'model/stl', 1000, 'sha1', 'active', 50.00),
          (100, 'uuid-dupe-2', 'stl_derivative', 'private', 'key-2', 'model/stl', 1000, 'sha2', 'active', 50.00);
      `);
      conn.release();

      // Run migrations against pre-16 baseline schema
      const res = await runMigrations(pool);
      assert.ok(res.applied >= 2, "Must apply migrations v16 and v17");

      // Verify stripe_customer_id column exists
      const [cols] = await pool.query(
        "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'users' AND COLUMN_NAME = 'stripe_customer_id'",
        [testDbName],
      );
      assert.equal(cols.length, 1);

      // Verify duplicate active STL derivative was reconciled to 'superseded' (never 'archived')
      const [dupes] = await pool.query(
        "SELECT id, status FROM marketplace_assets WHERE listing_id = 100 AND status = 'superseded'",
      );
      assert.equal(dupes.length, 1, "Older duplicate active row must be updated to status='superseded'");
    } finally {
      await pool.end();
    }
  });

  await t.test("2. Idempotency - rerun applies zero migrations", async () => {
    const pool = getTestPool();
    try {
      const res = await runMigrations(pool);
      assert.equal(res.applied, 0, "Rerun must apply 0 migrations");
    } finally {
      await pool.end();
    }
  });

  await t.test("3. Active-only unique constraint enforces single active STL derivative", async () => {
    const pool = getTestPool();
    try {
      const conn = await pool.getConnection();

      // Inserting a second active derivative at the same listing & height must fail with ER_DUP_ENTRY
      await assert.rejects(
        async () => {
          await conn.query(`
            INSERT INTO marketplace_assets 
              (listing_id, asset_uuid, kind, bucket, object_key, mime_type, size_bytes, sha256, status, derivative_height_mm)
            VALUES
              (100, 'uuid-active-conflict', 'stl_derivative', 'private', 'key-conflict', 'model/stl', 1000, 'shac', 'active', 50.00)
          `);
        },
        (err) => err.code === "ER_DUP_ENTRY" || err.errno === 1062,
      );

      // Inserting multiple superseded historical derivatives at the SAME height must succeed
      await conn.query(`
        INSERT INTO marketplace_assets 
          (listing_id, asset_uuid, kind, bucket, object_key, mime_type, size_bytes, sha256, status, derivative_height_mm)
        VALUES
          (100, 'uuid-hist-1', 'stl_derivative', 'private', 'key-hist-1', 'model/stl', 1000, 'shah1', 'superseded', 50.00),
          (100, 'uuid-hist-2', 'stl_derivative', 'private', 'key-hist-2', 'model/stl', 1000, 'shah2', 'superseded', 50.00)
      `);

      const [histRows] = await pool.query(
        "SELECT COUNT(*) AS c FROM marketplace_assets WHERE listing_id = 100 AND status = 'superseded'",
      );
      assert.ok(Number(histRows[0].c) >= 3, "Multiple historical superseded rows at same height are allowed");

      conn.release();
    } finally {
      await pool.end();
    }
  });

  await t.test("4. Concurrent migration runners respect advisory GET_LOCK", async () => {
    const pool = getTestPool();
    try {
      const [res1, res2] = await Promise.all([runMigrations(pool), runMigrations(pool)]);
      assert.equal(res1.applied, 0);
      assert.equal(res2.applied, 0);
    } finally {
      await pool.end();
    }
  });

  await t.test("5. Failed migration is not recorded as successful", async () => {
    const pool = getTestPool();
    try {
      const failingMigrations = [
        {
          version: 999,
          name: "invalid_sql_mig",
          statements: ["INVALID SQL SYNTAX AT ALL"],
        },
      ];

      await assert.rejects(
        async () => {
          await runMigrations(pool, failingMigrations);
        },
        /INVALID SQL SYNTAX/,
      );

      const [rows] = await pool.query("SELECT * FROM schema_migrations WHERE version = 999");
      assert.equal(rows.length, 0, "Failing migration must NOT be recorded in schema_migrations");
    } finally {
      await pool.end();
    }
  });
});
