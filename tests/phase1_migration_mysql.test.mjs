import assert from "node:assert/strict";
import test from "node:test";
import mysql from "mysql2/promise";
import { runMigrations, CURRENT_SCHEMA_VERSION } from "../server/migrations/runner.ts";

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

test("Phase 1 Real MySQL 8.4 Migration 19 Test Suite", async (t) => {
  const reachable = await isMysqlServerReachable();
  if (!reachable) {
    t.skip("Local test MySQL instance not running on 127.0.0.1:3306. Provision MySQL to run integration tests.");
    return;
  }

  const testDbName = `paws_test_mig19_${Date.now()}_${Math.floor(Math.random() * 10000)}`;

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

  await t.test("1. Migrations 18-19 upgrade the baseline and create canonical tables", async () => {
    const pool = getTestPool();
    try {
      const conn = await pool.getConnection();

      // Setup representative pre-18 baseline schema
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
      conn.release();

      // Execute migrations up to the current schema version.
      const res = await runMigrations(pool);
      assert.ok(res.applied >= 4, "Must apply migrations v16 through v19");

      // Verify canonical tables exist
      const [tables] = await pool.query(
        "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN ('assets', 'asset_versions', 'asset_relations', 'asset_legacy_links')",
        [testDbName],
      );
      assert.equal(tables.length, 4, "All 4 canonical tables must be created");
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

  await t.test("3. Unique constraints and version immutability", async () => {
    const pool = getTestPool();
    try {
      const conn = await pool.getConnection();

      // Insert asset
      const [aRes] = await conn.query(
        "INSERT INTO assets (asset_uuid, owner_id, asset_type, visibility) VALUES ('11111111-1111-4111-8111-111111111111', '+15550001', 'model_glb', 'private')",
      );
      const assetId = aRes.insertId;

      // Duplicate asset_uuid must fail
      await assert.rejects(
        async () => {
          await conn.query(
            "INSERT INTO assets (asset_uuid, owner_id, asset_type, visibility) VALUES ('11111111-1111-4111-8111-111111111111', '+15550002', 'model_glb', 'private')",
          );
        },
        (err) => err.code === "ER_DUP_ENTRY" || err.errno === 1062,
      );

      const shaA = "a".repeat(64);
      const shaB = "b".repeat(64);

      // Insert version 1
      await conn.query(
        `INSERT INTO asset_versions 
           (asset_id, version_number, sha256, mime_type, size_bytes, bucket, object_key)
         VALUES (?, 1, ?, 'model/gltf-binary', 5000, 'private', 'private/model1.glb')`,
        [assetId, shaA],
      );

      // Duplicate version_number (1) for same asset must fail
      await assert.rejects(
        async () => {
          await conn.query(
            `INSERT INTO asset_versions 
               (asset_id, version_number, sha256, mime_type, size_bytes, bucket, object_key)
             VALUES (?, 1, ?, 'model/gltf-binary', 6000, 'private', 'private/model1_v2.glb')`,
            [assetId, shaB],
          );
        },
        (err) => err.code === "ER_DUP_ENTRY" || err.errno === 1062,
      );

      conn.release();
    } finally {
      await pool.end();
    }
  });

  await t.test("4. Database rejects cross-asset current pointers and self-lineage", async () => {
    const pool = getTestPool();
    try {
      const [firstAssets] = await pool.query("SELECT id FROM assets ORDER BY id LIMIT 1");
      const firstAssetId = firstAssets[0].id;
      const [firstVersions] = await pool.query("SELECT id FROM asset_versions WHERE asset_id = ? ORDER BY id LIMIT 1", [firstAssetId]);
      const firstVersionId = firstVersions[0].id;
      const [secondAsset] = await pool.query(
        "INSERT INTO assets (asset_uuid, owner_id, asset_type, visibility) VALUES ('22222222-2222-4222-8222-222222222222', 'u_second', 'model_glb', 'private')",
      );
      const [secondVersion] = await pool.query(
        `INSERT INTO asset_versions
           (asset_id, version_number, sha256, mime_type, size_bytes, bucket, object_key)
         VALUES (?, 1, ?, 'model/gltf-binary', 1, 'private', 'private/second.glb')`,
        [secondAsset.insertId, "c".repeat(64)],
      );

      await assert.rejects(
        pool.query("UPDATE assets SET current_version_id = ? WHERE id = ?", [secondVersion.insertId, firstAssetId]),
        (err) => err.code === "ER_NO_REFERENCED_ROW_2" || err.errno === 1452,
      );
      await assert.rejects(
        pool.query(
          "INSERT INTO asset_relations (parent_version_id, child_version_id, relation_type) VALUES (?, ?, 'derivative')",
          [firstVersionId, firstVersionId],
        ),
        (err) => err.code === "ER_CHECK_CONSTRAINT_VIOLATED" || err.errno === 3819,
      );
    } finally {
      await pool.end();
    }
  });

  await t.test("5. Concurrent migration runners respect advisory lock", async () => {
    const pool = getTestPool();
    try {
      const [res1, res2] = await Promise.all([runMigrations(pool), runMigrations(pool)]);
      assert.equal(res1.applied, 0);
      assert.equal(res2.applied, 0);
    } finally {
      await pool.end();
    }
  });
});
