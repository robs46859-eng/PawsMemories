import test from "node:test";
import assert from "node:assert/strict";
import mysql from "mysql2/promise";
import { runMigrations, CURRENT_SCHEMA_VERSION } from "../server/migrations/runner.ts";
import { initializeLegacyUsersTable } from "./helpers/mysqlTestDatabase.mjs";

const MYSQL_CONFIG = {
  host: process.env.MYSQL_TEST_HOST || "127.0.0.1",
  port: Number(process.env.MYSQL_TEST_PORT || 3306),
  user: process.env.MYSQL_TEST_USER || "root",
  password: process.env.MYSQL_TEST_PASSWORD || "",
};
const TEST_DB = "paws_phase45_migration_test_db";

test("Phase 4 Migrations 23 and 24 MySQL Integration", async (t) => {
  let pool;
  try {
    const admin = await mysql.createConnection(MYSQL_CONFIG);
    await admin.query(`DROP DATABASE IF EXISTS \`${TEST_DB}\``);
    await admin.query(`CREATE DATABASE \`${TEST_DB}\``);
    await admin.end();
    pool = mysql.createPool({ ...MYSQL_CONFIG, database: TEST_DB });
    await initializeLegacyUsersTable(pool);
  } catch (err) {
    t.skip("MySQL server not available, skipping migration integration tests.");
    return;
  }
  t.after(async () => {
    await pool.end();
    const admin = await mysql.createConnection(MYSQL_CONFIG);
    await admin.query(`DROP DATABASE IF EXISTS \`${TEST_DB}\``);
    await admin.end();
  });

  await t.test("should execute all managed migrations 16..24 cleanly", async () => {
    const result = await runMigrations(pool);
    assert.ok(result.durationMs >= 0);

    const [rows] = await pool.query("SELECT MAX(version) as max_v FROM schema_migrations");
    assert.equal(rows[0].max_v, CURRENT_SCHEMA_VERSION);
    assert.equal(CURRENT_SCHEMA_VERSION, 24);
  });

  await t.test("should verify Phase 4 and 5 tables exist in schema", async () => {
    const tables = [
      "rig_classifications",
      "rig_jobs",
      "rig_attempts",
      "rig_validation_manifests",
      "facial_inventories",
      "accessory_catalog",
      "accessory_fits",
      "rig_acceptances",
      "fur_bin_items",
      "fur_bin_collections",
      "fur_bin_collection_items",
      "fur_bin_tags",
      "showcase_records",
      "moderation_history",
    ];

    for (const table of tables) {
      const [r] = await pool.query(
        "SELECT COUNT(*) AS c FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?",
        [table],
      );
      assert.equal(r[0].c, 1, `Table ${table} should exist in DB`);
    }
  });

});
