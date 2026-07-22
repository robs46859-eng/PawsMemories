import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import mysql from "mysql2/promise";
import { runMigrations } from "../server/migrations/runner.ts";
import { assetsRouter } from "../server/assets/routes.ts";

const mysqlHost = process.env.MYSQL_TEST_HOST || "127.0.0.1";
const mysqlPort = Number(process.env.MYSQL_TEST_PORT || 3306);
const mysqlUser = process.env.MYSQL_TEST_USER || "root";
const mysqlPassword = process.env.MYSQL_TEST_PASSWORD || "";

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
    app.use("/api/assets", assetsRouter);

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
      headers: { "Content-Type": "application/json", "x-user-phone": "+15554443333" },
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
    assert.equal(body.asset.ownerId, "+15554443333");
  });

  await t.test("POST /api/assets/register rejects unknown fields (strict Zod schema)", async () => {
    const res = await fetch(`${baseUrl()}/api/assets/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-user-phone": "+15554443333" },
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
      headers: { "Content-Type": "application/json", "x-user-phone": "+15554443333" },
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
      headers: { "x-user-phone": "+15554443333" },
    });
    assert.equal(ownerRes.status, 200);

    // 3. Request as Non-Owner B -> 403 Forbidden
    const strangerRes = await fetch(`${baseUrl()}/api/assets/detail/${assetUuid}`, {
      headers: { "x-user-phone": "+15559990000" },
    });
    assert.equal(strangerRes.status, 403);
  });

  await t.test("GET /api/assets/storage-usage calculates owner distinct usage", async () => {
    const res = await fetch(`${baseUrl()}/api/assets/storage-usage`, {
      headers: { "x-user-phone": "+15554443333" },
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.success, true);
    assert.ok(body.usage.totalSizeBytes >= 0);
  });
});
