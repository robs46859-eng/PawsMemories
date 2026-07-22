import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import mysql from "mysql2/promise";
import { runMigrations } from "../server/migrations/runner.ts";
import { assetsRouter } from "../server/assets/routes.ts";
import { requireAuth, signToken } from "../auth.ts";
import { requireCanonicalAssetsEnabled } from "../server/assets/featureFlag.ts";

const mysqlHost = process.env.MYSQL_TEST_HOST || "127.0.0.1";
const mysqlPort = Number(process.env.MYSQL_TEST_PORT || 3306);
const mysqlUser = process.env.MYSQL_TEST_USER || "root";
const mysqlPassword = process.env.MYSQL_TEST_PASSWORD || "";
process.env.JWT_SECRET = "phase1-route-test-secret-at-least-32-chars"; // gitleaks:allow -- deterministic test-only value
process.env.CANONICAL_ASSETS_ENABLED = "true";

const adminToken = signToken({ phone: "u_admin", uid: 1 });
const ownerToken = signToken({ phone: "u_owner", uid: 2 });
const strangerToken = signToken({ phone: "u_stranger", uid: 3 });
const authHeaders = (token, json = false) => ({
  Authorization: `Bearer ${token}`,
  ...(json ? { "Content-Type": "application/json" } : {}),
});

test("Phase 1 API Router Suite (/api/assets)", async (t) => {
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
    t.skip("Local test MySQL instance not running on 127.0.0.1:3306. Provision MySQL to run API route tests.");
    return;
  }

  const testDbName = `paws_test_routes_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  let pool;
  let server;
  let serverPort;

  t.before(async () => {
    const adminConn = await mysql.createConnection({ host: mysqlHost, port: mysqlPort, user: mysqlUser, password: mysqlPassword });
    await adminConn.query(`CREATE DATABASE IF NOT EXISTS \`${testDbName}\``);
    await adminConn.end();

    pool = mysql.createPool({ host: mysqlHost, port: mysqlPort, user: mysqlUser, password: mysqlPassword, database: testDbName, connectionLimit: 5 });
    
    // Create users table baseline
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        phone VARCHAR(64) NOT NULL UNIQUE,
        is_admin TINYINT(1) DEFAULT 0
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    await runMigrations(pool);

    const app = express();
    app.use(express.json());
    app.set("pool", pool);
    app.set("assetsIsUserAdmin", (userId) => userId === "u_admin");
    app.use("/api/assets", requireCanonicalAssetsEnabled, requireAuth, assetsRouter);

    await new Promise((resolve) => {
      server = app.listen(0, () => {
        serverPort = server.address().port;
        resolve();
      });
    });
  });

  t.after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (pool) await pool.end();
    const cleanupConn = await mysql.createConnection({ host: mysqlHost, port: mysqlPort, user: mysqlUser, password: mysqlPassword });
    await cleanupConn.query(`DROP DATABASE IF EXISTS \`${testDbName}\``);
    await cleanupConn.end();
  });

  const baseUrl = () => `http://127.0.0.1:${serverPort}`;

  await t.test("POST /api/assets/register registers asset and version", async () => {
    const res = await fetch(`${baseUrl()}/api/assets/register`, {
      method: "POST",
      headers: authHeaders(adminToken, true),
      body: JSON.stringify({
        assetType: "source_photo",
        visibility: "private",
        mimeType: "image/jpeg",
        sizeBytes: 8000,
        sha256: "6".repeat(64),
        bucket: "public",
        objectKey: "public/photo_test.jpg",
      }),
    });

    const body = await res.json();
    assert.equal(res.status, 201);
    assert.equal(body.success, true);
    assert.ok(body.asset.assetUuid);
    assert.equal(body.asset.ownerId, "u_admin");
  });

  await t.test("POST /api/assets/register rejects unknown fields (strict Zod schema)", async () => {
    const res = await fetch(`${baseUrl()}/api/assets/register`, {
      method: "POST",
      headers: authHeaders(adminToken, true),
      body: JSON.stringify({
        assetType: "source_photo",
        visibility: "private",
        mimeType: "image/jpeg",
        sizeBytes: 8000,
        sha256: "6".repeat(64),
        bucket: "public",
        objectKey: "public/photo_test.jpg",
        unknownField: "should_be_rejected",
      }),
    });

    const body = await res.json();
    assert.equal(res.status, 400);
    assert.equal(body.success, false);
    assert.equal(body.error, "Invalid input schema");
  });

  await t.test("GET /api/assets/detail/:uuid enforces ownership for private assets", async () => {
    // 1. Register private asset as owner A
    const regRes = await fetch(`${baseUrl()}/api/assets/register`, {
      method: "POST",
      headers: authHeaders(adminToken, true),
      body: JSON.stringify({
        assetType: "model_glb",
        visibility: "private",
        mimeType: "model/gltf-binary",
        sizeBytes: 12000,
        sha256: "5".repeat(64),
        bucket: "private",
        objectKey: "private/secret.glb",
      }),
    });
    const regBody = await regRes.json();
    assert.equal(regRes.status, 201, `Expected 201 registration, got ${regRes.status}: ${JSON.stringify(regBody)}`);
    const assetUuid = regBody.asset.assetUuid;

    // 2. Request as Owner A -> 200 OK
    const ownerRes = await fetch(`${baseUrl()}/api/assets/detail/${assetUuid}`, {
      headers: authHeaders(adminToken),
    });
    assert.equal(ownerRes.status, 200);

    // 3. Request as Non-Owner B -> 403 Forbidden
    const strangerRes = await fetch(`${baseUrl()}/api/assets/detail/${assetUuid}`, {
      headers: authHeaders(strangerToken),
    });
    assert.equal(strangerRes.status, 403);
  });

  await t.test("GET /api/assets/storage-usage calculates owner distinct usage", async () => {
    const res = await fetch(`${baseUrl()}/api/assets/storage-usage`, {
      headers: authHeaders(adminToken),
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.success, true);
    assert.ok(body.usage.totalSizeBytes >= 0);
  });

  await t.test("JWT and server feature flag fail closed", async () => {
    const spoofed = await fetch(`${baseUrl()}/api/assets/storage-usage`, {
      headers: { "x-user-phone": "u_admin" },
    });
    assert.equal(spoofed.status, 401, "A caller-controlled identity header must never authenticate");

    process.env.CANONICAL_ASSETS_ENABLED = "false";
    try {
      const disabled = await fetch(`${baseUrl()}/api/assets/storage-usage`, {
        headers: authHeaders(adminToken),
      });
      assert.equal(disabled.status, 404);
    } finally {
      process.env.CANONICAL_ASSETS_ENABLED = "true";
    }
  });

  await t.test("raw registration is admin-only", async () => {
    const res = await fetch(`${baseUrl()}/api/assets/register`, {
      method: "POST",
      headers: authHeaders(ownerToken, true),
      body: JSON.stringify({
        assetType: "source_photo",
        visibility: "private",
        mimeType: "image/jpeg",
        sizeBytes: 10,
        sha256: "d".repeat(64),
        bucket: "private",
        objectKey: "untrusted/object.jpg",
      }),
    });
    assert.equal(res.status, 403);
  });

  await t.test("signed URL query validation rejects malformed values", async () => {
    const res = await fetch(`${baseUrl()}/api/assets/signed-url/not-a-uuid?ttl=NaN`, {
      headers: authHeaders(adminToken),
    });
    assert.equal(res.status, 400);
  });

  await t.test("service authorization blocks cross-owner pointer mutation", async () => {
    const [assets] = await pool.query("SELECT asset_uuid FROM assets WHERE owner_id = 'u_admin' ORDER BY id LIMIT 1");
    const res = await fetch(`${baseUrl()}/api/assets/current-version`, {
      method: "PUT",
      headers: authHeaders(strangerToken, true),
      body: JSON.stringify({ assetUuid: assets[0].asset_uuid, versionNumber: 1 }),
    });
    assert.equal(res.status, 403);
  });
});
