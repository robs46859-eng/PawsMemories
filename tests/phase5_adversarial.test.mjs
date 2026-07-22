import test from "node:test";
import assert from "node:assert/strict";
import mysql from "mysql2/promise";
import crypto from "node:crypto";
import { runMigrations } from "../server/migrations/runner.ts";
import { FurBinService, FurBinError } from "../server/fur-bin/service.ts";
import { initializeLegacyUsersTable } from "./helpers/mysqlTestDatabase.mjs";

const MYSQL_CONFIG = {
  host: process.env.MYSQL_TEST_HOST || "127.0.0.1",
  port: Number(process.env.MYSQL_TEST_PORT || 3306),
  user: process.env.MYSQL_TEST_USER || "root",
  password: process.env.MYSQL_TEST_PASSWORD || "",
};
const TEST_DB = "paws_phase5_adversarial_test_db";

test("Phase 5 Adversarial Test Suite", async (t) => {
  let pool;
  try {
    const admin = await mysql.createConnection(MYSQL_CONFIG);
    await admin.query(`DROP DATABASE IF EXISTS \`${TEST_DB}\``);
    await admin.query(`CREATE DATABASE \`${TEST_DB}\``);
    await admin.end();
    pool = mysql.createPool({ ...MYSQL_CONFIG, database: TEST_DB });
    await initializeLegacyUsersTable(pool);
  } catch (err) {
    t.skip("MySQL server not available, skipping adversarial tests.");
    return;
  }
  t.after(async () => {
    await pool.end();
    const admin = await mysql.createConnection(MYSQL_CONFIG);
    await admin.query(`DROP DATABASE IF EXISTS \`${TEST_DB}\``);
    await admin.end();
  });

  await runMigrations(pool);
  process.env.FUR_BIN_V5_ENABLED = "true";

  async function createAssetAndVersion(ownerPhone, commercialEligible = true) {
    const conn = await pool.getConnection();
    try {
      await conn.query(
        `INSERT INTO users (phone, email, password_hash, full_name, credits)
         VALUES (?, 'adv_fb@test.com', 'hash', 'Adv FurBin User', 100)
         ON DUPLICATE KEY UPDATE credits = 100`,
        [ownerPhone],
      );

      const [aRes] = await conn.query(
        "INSERT INTO assets (asset_uuid, owner_id, asset_type, visibility, status) VALUES (UUID(), ?, 'model_glb', 'private', 'active')",
        [ownerPhone],
      );

      const [vRes] = await conn.query(
        `INSERT INTO asset_versions (asset_id, version_number, sha256, mime_type, size_bytes, bucket, object_key, commercial_use_eligible)
         VALUES (?, 1, REPEAT('c', 64), 'model/gltf-binary', 2048, 'private', 'model_adv.glb', ?)`,
        [aRes.insertId, commercialEligible ? 1 : 0],
      );

      const [publicAssetResult] = await conn.query(
        "INSERT INTO assets (asset_uuid, owner_id, asset_type, visibility, status) VALUES (UUID(), ?, 'model_glb', 'published', 'active')",
        [ownerPhone],
      );
      const [publicVersionResult] = await conn.query(
        `INSERT INTO asset_versions (asset_id, version_number, sha256, mime_type, size_bytes, bucket, object_key, commercial_use_eligible)
         VALUES (?, 1, REPEAT('d', 64), 'model/gltf-binary', 2048, 'private', 'model_adv_public.glb', ?)`,
        [publicAssetResult.insertId, commercialEligible ? 1 : 0],
      );
      await conn.query("UPDATE assets SET current_version_id = ? WHERE id = ?", [publicVersionResult.insertId, publicAssetResult.insertId]);
      await conn.query(
        "INSERT INTO asset_relations (parent_version_id, child_version_id, relation_type) VALUES (?, ?, 'derivative')",
        [vRes.insertId, publicVersionResult.insertId],
      );

      const [assetRows] = await conn.query("SELECT asset_uuid FROM assets WHERE id = ?", [aRes.insertId]);
      const [publicRows] = await conn.query("SELECT asset_uuid FROM assets WHERE id = ?", [publicAssetResult.insertId]);
      return {
        assetId: aRes.insertId,
        assetUuid: assetRows[0].asset_uuid,
        publicDerivativeUuid: publicRows[0].asset_uuid,
        versionId: vRes.insertId,
        ownerPhone,
      };
    } finally {
      conn.release();
    }
  }

  await t.test("1. Enforces owner isolation for private library search and item access", async () => {
    const owner1 = `+1555${Math.floor(1000000 + Math.random() * 9000000)}`;
    const owner2 = `+1555${Math.floor(1000000 + Math.random() * 9000000)}`;
    const setup = await createAssetAndVersion(owner1);
    const service = new FurBinService(() => pool, async () => "https://signed.fixture/model.glb");

    const item = await service.registerItem(owner1, {
      assetUuid: setup.assetUuid,
      versionNumber: 1,
      title: "Private Dog Model",
    });

    // Owner 2 searching library should find 0 items
    const owner2Search = await service.searchLibrary(owner2, {});
    assert.equal(owner2Search.total, 0);

    // Owner 2 accessing item directly should throw FORBIDDEN
    await assert.rejects(
      async () => {
        await service.getItemPublic(owner2, item.itemUuid);
      },
      (err) => err.code === "FORBIDDEN",
    );
  });

  await t.test("2. Rejects commercial marketplace listing for non-eligible version", async () => {
    const ownerPhone = `+1555${Math.floor(1000000 + Math.random() * 9000000)}`;
    const setup = await createAssetAndVersion(ownerPhone, false); // commercial_use_eligible = false
    const service = new FurBinService(() => pool, async () => "https://signed.fixture/model.glb");

    const item = await service.registerItem(ownerPhone, {
      assetUuid: setup.assetUuid,
      versionNumber: 1,
      title: "Non-commercial Model",
    });

    await assert.rejects(
      async () => {
        await service.publishShowcase(ownerPhone, {
          itemUuid: item.itemUuid,
          publicDerivativeUuid: setup.publicDerivativeUuid,
          publicDerivativeVersionNumber: 1,
          title: "Commercial Attempt",
          rightsDeclaration: "all_rights_reserved",
          commercialEligible: true,
        });
      },
      (err) => err.code === "COMMERCIAL_INELIGIBLE",
    );
  });

  await t.test("3. Records fail-closed moderation audit history", async () => {
    const ownerPhone = `+1555${Math.floor(1000000 + Math.random() * 9000000)}`;
    const setup = await createAssetAndVersion(ownerPhone, true);
    const service = new FurBinService(() => pool, async () => "https://signed.fixture/model.glb");

    const item = await service.registerItem(ownerPhone, {
      assetUuid: setup.assetUuid,
      versionNumber: 1,
      title: "Mod Model",
    });

    const showcase = await service.publishShowcase(ownerPhone, {
      itemUuid: item.itemUuid,
      publicDerivativeUuid: setup.publicDerivativeUuid,
      publicDerivativeVersionNumber: 1,
      title: "Mod Showcase",
      rightsDeclaration: "cc0",
    });

    assert.equal(showcase.moderationState, "pending");

    await assert.rejects(
      () => service.moderateShowcase(ownerPhone, showcase.showcaseUuid, "approved", "Self approval", false),
      (err) => err.code === "ADMIN_REQUIRED",
    );

    // Moderate decision: approve
    const approved = await service.moderateShowcase("admin_user", showcase.showcaseUuid, "approved", "Passes safety check", true);
    assert.equal(approved.moderationState, "approved");
    const publicRecord = await service.getShowcasePublic(showcase.showcaseUuid);
    assert.equal(publicRecord.publicViewUrl, "https://signed.fixture/model.glb");

    // Check audit history in DB
    const [history] = await pool.query("SELECT * FROM moderation_history WHERE showcase_id = (SELECT id FROM showcase_records WHERE showcase_uuid = ?)", [showcase.showcaseUuid]);
    assert.equal(history.length, 1);
    assert.equal(history[0].previous_state, "pending");
    assert.equal(history[0].new_state, "approved");
    assert.equal(history[0].moderator_id, "admin_user");
  });

});
