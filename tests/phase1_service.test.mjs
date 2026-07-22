import assert from "node:assert/strict";
import test from "node:test";
import mysql from "mysql2/promise";
import { runMigrations } from "../server/migrations/runner.ts";
import {
  registerAsset,
  addAssetVersion,
  setCurrentVersion,
  addLineage,
  AssetServiceError,
} from "../server/assets/service.ts";
import {
  findAssetByUuid,
  findVersionsByAssetId,
  findRelationsByVersionId,
} from "../server/assets/repository.ts";
import {
  registerLegacyCreation,
  registerLegacyMarketplaceAsset,
  getFurBinCompositionForUser,
} from "../server/assets/legacyAdapters.ts";

const mysqlHost = process.env.MYSQL_TEST_HOST || "127.0.0.1";
const mysqlPort = Number(process.env.MYSQL_TEST_PORT || 3306);
const mysqlUser = process.env.MYSQL_TEST_USER || "root";
const mysqlPassword = process.env.MYSQL_TEST_PASSWORD || "";

test("Phase 1 Production Service Suite", async (t) => {
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
    t.skip("Local test MySQL instance not running on 127.0.0.1:3306. Provision MySQL to run production service tests.");
    return;
  }

  const testDbName = `paws_test_service_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  const adminConn = await mysql.createConnection({ host: mysqlHost, port: mysqlPort, user: mysqlUser, password: mysqlPassword });
  await adminConn.query(`CREATE DATABASE IF NOT EXISTS \`${testDbName}\``);
  await adminConn.end();

  const pool = mysql.createPool({ host: mysqlHost, port: mysqlPort, user: mysqlUser, password: mysqlPassword, database: testDbName, connectionLimit: 5 });
  await runMigrations(pool);

  t.after(async () => {
    await pool.end();
    const cleanupConn = await mysql.createConnection({ host: mysqlHost, port: mysqlPort, user: mysqlUser, password: mysqlPassword });
    await cleanupConn.query(`DROP DATABASE IF EXISTS \`${testDbName}\``);
    await cleanupConn.end();
  });

  await t.test("registerAsset creates logical asset and immutable version 1", async () => {
    const { asset, version } = await registerAsset(
      {
        ownerId: "+15551112222",
        assetType: "source_photo",
        visibility: "private",
        mimeType: "image/png",
        sizeBytes: 15000,
        sha256: "1".repeat(64),
        bucket: "private",
        objectKey: "private/photo1.png",
        metadata: { camera: "DSLR" },
      },
      { isNewObjectUpload: false, pool },
    );

    assert.ok(asset.asset_uuid);
    assert.equal(asset.owner_id, "+15551112222");
    assert.equal(asset.asset_type, "source_photo");
    assert.equal(version.version_number, 1);
    assert.equal(version.size_bytes, 15000);
    assert.equal(version.sha256, "1".repeat(64));
    assert.equal(asset.current_version_id, version.id);
  });

  await t.test("addAssetVersion increments version number and updates current version", async () => {
    const { asset } = await registerAsset(
      {
        ownerId: "+15551112222",
        assetType: "model_glb",
        visibility: "private",
        mimeType: "model/gltf-binary",
        sizeBytes: 20000,
        sha256: "2".repeat(64),
        bucket: "private",
        objectKey: "private/model_v1.glb",
      },
      { isNewObjectUpload: false, pool },
    );

    const { version: v2 } = await addAssetVersion(
      {
        assetUuid: asset.asset_uuid,
        mimeType: "model/gltf-binary",
        sizeBytes: 25000,
        sha256: "3".repeat(64),
        bucket: "private",
        objectKey: "private/model_v2.glb",
        setAsCurrent: true,
      },
      pool,
    );

    assert.equal(v2.version_number, 2);
    assert.equal(v2.size_bytes, 25000);

    const updated = await findAssetByUuid(pool, asset.asset_uuid);
    assert.equal(updated.current_version_id, v2.id);

    const versions = await findVersionsByAssetId(pool, asset.id);
    assert.equal(versions.length, 2);
    assert.equal(versions[0].version_number, 1);
    assert.equal(versions[1].version_number, 2);
  });

  await t.test("setCurrentVersion switches current version pointer", async () => {
    const { asset } = await registerAsset(
      {
        ownerId: "+15551112222",
        assetType: "model_glb",
        visibility: "private",
        mimeType: "model/gltf-binary",
        sizeBytes: 1000,
        sha256: "4".repeat(64),
        bucket: "private",
        objectKey: "private/m1.glb",
      },
      { isNewObjectUpload: false, pool },
    );

    const { version: v2 } = await addAssetVersion(
      {
        assetUuid: asset.asset_uuid,
        mimeType: "model/gltf-binary",
        sizeBytes: 2000,
        sha256: "5".repeat(64),
        bucket: "private",
        objectKey: "private/m2.glb",
        setAsCurrent: true,
      },
      pool,
    );

    // Roll pointer back to version 1
    const { asset: reverted } = await setCurrentVersion(asset.asset_uuid, 1, pool);
    assert.notEqual(reverted.current_version_id, v2.id);
  });

  await t.test("addLineage tracks parent/child relationships and rejects self-lineage", async () => {
    const { asset: parentAsset, version: parentVersion } = await registerAsset(
      {
        ownerId: "+15551112222",
        assetType: "source_photo",
        visibility: "private",
        mimeType: "image/png",
        sizeBytes: 1000,
        sha256: "a".repeat(64),
        bucket: "private",
        objectKey: "private/p.png",
      },
      { isNewObjectUpload: false, pool },
    );

    const { asset: childAsset, version: childVersion } = await registerAsset(
      {
        ownerId: "+15551112222",
        assetType: "model_glb",
        visibility: "private",
        mimeType: "model/gltf-binary",
        sizeBytes: 2000,
        sha256: "b".repeat(64),
        bucket: "private",
        objectKey: "private/c.glb",
      },
      { isNewObjectUpload: false, pool },
    );

    await addLineage(
      {
        parentAssetUuid: parentAsset.asset_uuid,
        parentVersionNumber: 1,
        childAssetUuid: childAsset.asset_uuid,
        childVersionNumber: 1,
        relationType: "mesh",
      },
      pool,
    );

    const rels = await findRelationsByVersionId(pool, parentVersion.id);
    assert.equal(rels.children.length, 1);
    assert.equal(rels.children[0].child_version_id, childVersion.id);

    // Self-lineage must fail
    await assert.rejects(
      async () => {
        await addLineage(
          {
            parentAssetUuid: parentAsset.asset_uuid,
            parentVersionNumber: 1,
            childAssetUuid: parentAsset.asset_uuid,
            childVersionNumber: 1,
            relationType: "mesh",
          },
          pool,
        );
      },
      (err) => err instanceof AssetServiceError && err.code === "INVALID_LINEAGE",
    );
  });

  await t.test("Legacy creation adapter idempotency and Fur Bin fallback", async () => {
    // Setup legacy creations table
    const dbConn = await pool.getConnection();
    await dbConn.query(`
      CREATE TABLE IF NOT EXISTS creations (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_phone VARCHAR(64) NOT NULL,
        image_url VARCHAR(512) NULL,
        model_url VARCHAR(512) NULL,
        video_url VARCHAR(512) NULL,
        prompt TEXT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    const [cRes] = await dbConn.query(
      `INSERT INTO creations (user_phone, model_url, prompt) VALUES ('+15559998888', 'https://storage.com/c1.glb', 'A cute puppy')`,
    );
    dbConn.release();

    const creationId = cRes.insertId;

    // First adapter call registers creation
    const res1 = await registerLegacyCreation(creationId, "+15559998888", pool);
    assert.ok(res1);
    assert.equal(res1.isNewLink, true);

    // Second adapter call returns existing registration idempotently
    const res2 = await registerLegacyCreation(creationId, "+15559998888", pool);
    assert.ok(res2);
    assert.equal(res2.isNewLink, false);
    assert.equal(res1.asset.id, res2.asset.id);

    // Test Fur Bin fallback composition
    const composition = await getFurBinCompositionForUser("+15559998888", pool);
    assert.ok(composition.canonical.length >= 1);
    assert.ok(composition.legacyCreations.length >= 1);
  });
});
