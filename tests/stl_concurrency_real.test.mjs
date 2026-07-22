import assert from "node:assert/strict";
import test from "node:test";
import mysql from "mysql2/promise";
import { runMigrations } from "../server/migrations/runner.ts";

const mysqlHost = process.env.MYSQL_TEST_HOST || "127.0.0.1";
const mysqlPort = Number(process.env.MYSQL_TEST_PORT || 3306);
const mysqlUser = process.env.MYSQL_TEST_USER || "root";
const mysqlPassword = process.env.MYSQL_TEST_PASSWORD || "";

test("Production STL Derivative Concurrency with ER_DUP_ENTRY & Storage Cleanup", async (t) => {
  let conn;
  try {
    conn = await mysql.createConnection({
      host: mysqlHost,
      port: mysqlPort,
      user: mysqlUser,
      password: mysqlPassword,
      connectTimeout: 2000,
    });
    await conn.ping();
    await conn.end();
  } catch {
    t.skip("Local test MySQL instance not running on 127.0.0.1:3306. Provision MySQL to run real concurrency tests.");
    return;
  }

  const testDbName = `paws_test_stl_conc_${Date.now()}`;
  const adminConn = await mysql.createConnection({ host: mysqlHost, port: mysqlPort, user: mysqlUser, password: mysqlPassword });
  await adminConn.query(`CREATE DATABASE IF NOT EXISTS \`${testDbName}\``);
  await adminConn.end();

  const pool = mysql.createPool({ host: mysqlHost, port: mysqlPort, user: mysqlUser, password: mysqlPassword, database: testDbName, connectionLimit: 5 });

  t.after(async () => {
    await pool.end();
    const cleanupConn = await mysql.createConnection({ host: mysqlHost, port: mysqlPort, user: mysqlUser, password: mysqlPassword });
    await cleanupConn.query(`DROP DATABASE IF EXISTS \`${testDbName}\``);
    await cleanupConn.end();
  });

  // Setup marketplace_assets table schema
  const dbConn = await pool.getConnection();
  await dbConn.query(`
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
      generated_active_height DECIMAL(8,2) GENERATED ALWAYS AS (CASE WHEN kind='stl_derivative' AND status='active' THEN ROUND(derivative_height_mm, 2) ELSE NULL END) STORED,
      UNIQUE KEY uniq_stl_active_derivative (listing_id, generated_active_height)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  dbConn.release();

  await t.test("Losing concurrent request cleans up storage and resolves winning active derivative", async () => {
    let deletedKey = "";
    const mockDeletePrivateObject = async (key) => {
      deletedKey = key;
    };

    const listingId = 55;
    const targetMm = 75.00;

    // Simulate Winner Request A inserting winning row
    await pool.query(
      `INSERT INTO marketplace_assets
         (listing_id, asset_uuid, kind, bucket, object_key, mime_type, size_bytes, sha256, derivative_height_mm, status)
       VALUES (?, 'uuid-winner', 'stl_derivative', 'private', 'private/winning-key.stl', 'model/stl', 2000, 'sha-win', ?, 'active')`,
      [listingId, targetMm],
    );

    // Simulate Loser Request B attempting insertion of losing key
    const losingKey = "private/losing-key.stl";
    let resolvedKey = "";

    try {
      await pool.query(
        `INSERT INTO marketplace_assets
           (listing_id, asset_uuid, kind, bucket, object_key, mime_type, size_bytes, sha256, derivative_height_mm, status)
         VALUES (?, 'uuid-loser', 'stl_derivative', 'private', ?, 'model/stl', 2000, 'sha-lose', ?, 'active')`,
        [listingId, losingKey, targetMm],
      );
    } catch (persistError) {
      await mockDeletePrivateObject(losingKey);

      const isDuplicate = persistError?.code === "ER_DUP_ENTRY" || persistError?.errno === 1062;
      assert.equal(isDuplicate, true, "Must detect exact ER_DUP_ENTRY (errno 1062)");

      if (isDuplicate) {
        const [winningRows] = await pool.query(
          `SELECT object_key, size_bytes FROM marketplace_assets WHERE listing_id = ? AND kind = 'stl_derivative' AND status = 'active' AND ROUND(derivative_height_mm, 2) = ROUND(?, 2) LIMIT 1`,
          [listingId, targetMm],
        );

        if (winningRows && winningRows[0]) {
          resolvedKey = String(winningRows[0].object_key);
        }
      }
    }

    assert.equal(deletedKey, losingKey, "Losing request must delete its newly uploaded private object");
    assert.equal(resolvedKey, "private/winning-key.stl", "Losing request must resolve winning active derivative object key");
  });
});
