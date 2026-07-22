import assert from "node:assert/strict";
import test from "node:test";
import mysql from "mysql2/promise";
import { persistStlDerivativeOrResolveWinner } from "../server/marketplaceStl.ts";

const enabled = process.env.MYSQL_TEST_ENABLED === "1";
const mysqlHost = process.env.MYSQL_TEST_HOST;
const mysqlPort = Number(process.env.MYSQL_TEST_PORT || 3306);
const mysqlUser = process.env.MYSQL_TEST_USER;
const mysqlPassword = process.env.MYSQL_TEST_PASSWORD || "";

test("production STL persistence resolves a real MySQL race", { skip: !enabled }, async (t) => {
  assert.ok(mysqlHost && ["127.0.0.1", "localhost", "::1"].includes(mysqlHost), "MYSQL_TEST_HOST must be local");
  assert.ok(mysqlUser, "MYSQL_TEST_USER is required");

  const testDbName = `paws_test_stl_conc_${Date.now()}`;
  const adminConfig = { host: mysqlHost, port: mysqlPort, user: mysqlUser, password: mysqlPassword };
  const adminConn = await mysql.createConnection(adminConfig);
  await adminConn.query(`CREATE DATABASE \`${testDbName}\``);
  await adminConn.end();

  const pool = mysql.createPool({ ...adminConfig, database: testDbName, connectionLimit: 5 });
  t.after(async () => {
    await pool.end();
    const cleanupConn = await mysql.createConnection(adminConfig);
    await cleanupConn.query(`DROP DATABASE IF EXISTS \`${testDbName}\``);
    await cleanupConn.end();
  });

  await pool.query(`
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
      generated_active_height DECIMAL(8,2) GENERATED ALWAYS AS
        (CASE WHEN kind='stl_derivative' AND status='active' THEN ROUND(derivative_height_mm, 2) ELSE NULL END) STORED,
      UNIQUE KEY uniq_marketplace_asset_uuid (asset_uuid),
      UNIQUE KEY uniq_marketplace_object_key (object_key),
      UNIQUE KEY uniq_stl_active_derivative (listing_id, generated_active_height)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  const deleted = [];
  const persist = (assetUuid, objectKey, targetHeightMm) =>
    persistStlDerivativeOrResolveWinner({
      db: pool,
      deleteObject: async (key) => deleted.push(key),
      listingId: 55,
      assetUuid,
      stored: { objectKey, sizeBytes: 2000, sha256: assetUuid.padEnd(64, "0").slice(0, 64) },
      targetHeightMm,
    });

  const results = await Promise.all([
    persist("00000000-0000-0000-0000-000000000001", "marketplace/listing/a.stl", 75.004),
    persist("00000000-0000-0000-0000-000000000002", "marketplace/listing/b.stl", 75.001),
  ]);

  assert.equal(results.filter((result) => result.wonRace).length, 1);
  assert.equal(results.filter((result) => !result.wonRace).length, 1);
  assert.equal(results[0].objectKey, results[1].objectKey);
  assert.equal(deleted.length, 1);

  const [rows] = await pool.query(
    "SELECT object_key, derivative_height_mm FROM marketplace_assets WHERE listing_id = 55 AND status = 'active'",
  );
  assert.equal(rows.length, 1);
  assert.equal(Number(rows[0].derivative_height_mm), 75);
});
