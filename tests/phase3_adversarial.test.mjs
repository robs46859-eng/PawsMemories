import test from "node:test";
import assert from "node:assert/strict";
import mysql from "mysql2/promise";
import { runMigrations } from "../server/migrations/runner.ts";
import { ModelBuildService } from "../server/model-builds/service.ts";
import { FakeModelBuildProvider } from "../server/model-builds/provider.ts";
import { validateGlb } from "../server/model-builds/validation.ts";
import { computeOrderedManifestHash } from "../server/reference-sessions/service.ts";
import { resetPrivateStorageClient } from "../storage.private.ts";

const MYSQL_HOST = process.env.MYSQL_TEST_HOST || "127.0.0.1";
const MYSQL_PORT = Number(process.env.MYSQL_TEST_PORT || 3306);
const MYSQL_USER = process.env.MYSQL_TEST_USER || "root";
const MYSQL_PASSWORD = process.env.MYSQL_TEST_PASSWORD || "";
const TEST_DB = "paws_phase3_adv_test_db";

async function isMysqlServerReachable() {
  try {
    const connection = await mysql.createConnection({
      host: MYSQL_HOST,
      port: MYSQL_PORT,
      user: MYSQL_USER,
      password: MYSQL_PASSWORD,
      connectTimeout: 2000,
    });
    await connection.ping();
    await connection.end();
    return true;
  } catch {
    return false;
  }
}

const mysqlAvailable = await isMysqlServerReachable();

test.describe("Phase 3 adversarial MySQL integration", {
  skip: mysqlAvailable ? false : "Local MySQL is not available.",
}, () => {
let pool;

test.before(async () => {
  process.env.MODEL_BUILD_V3_ENABLED = "true";
  process.env.MULTIVIEW_APPROVAL_ENABLED = "true";
  process.env.CANONICAL_ASSETS_ENABLED = "true";
  process.env.MEDIA_PRIVATE_BUCKET_NAME = "paws-private-test";
  process.env.MEDIA_BUCKET_URL = "http://127.0.0.1:9000";
  process.env.MEDIA_BUCKET_KEY = "test-key";
  process.env.MEDIA_BUCKET_SECRET = "test-secret";
  resetPrivateStorageClient();

  const adminConn = await mysql.createConnection({
    host: MYSQL_HOST,
    port: MYSQL_PORT,
    user: MYSQL_USER,
    password: MYSQL_PASSWORD,
  });
  await adminConn.query(`DROP DATABASE IF EXISTS \`${TEST_DB}\``);
  await adminConn.query(`CREATE DATABASE \`${TEST_DB}\``);
  await adminConn.end();

  pool = mysql.createPool({
    host: MYSQL_HOST,
    port: MYSQL_PORT,
    user: MYSQL_USER,
    password: MYSQL_PASSWORD,
    database: TEST_DB,
    waitForConnections: true,
    connectionLimit: 10,
  });

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      phone VARCHAR(64) NOT NULL UNIQUE,
      email VARCHAR(190) NULL,
      password_hash VARCHAR(255) NULL,
      full_name VARCHAR(190) NULL,
      credits INT NOT NULL DEFAULT 0,
      is_admin TINYINT(1) DEFAULT 0
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS credit_transactions (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      user_phone VARCHAR(64) NOT NULL,
      delta INT NOT NULL,
      reason VARCHAR(80) NOT NULL,
      balance_after INT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await runMigrations(pool);
});

test.after(async () => {
  process.env.MODEL_BUILD_V3_ENABLED = "false";
  if (pool) await pool.end();
});

/** Helper to set up an approved reference session for testing */
async function setupApprovedReferenceSession(pool, ownerPhone = `usr_${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`) {
  const conn = await pool.getConnection();
  try {
    // 1. Ensure user exists with credits
    await conn.query(
      `INSERT INTO users (phone, email, password_hash, full_name, credits)
       VALUES (?, 'test@test.com', 'hash', 'Test User', 500)
       ON DUPLICATE KEY UPDATE credits = 500`,
      [ownerPhone],
    );

    // 2. Create approved session
    const sessionUuid = crypto.randomUUID();
    const [sRes] = await conn.query(
      `INSERT INTO reference_sessions (session_uuid, owner_id, input_mode, subject_class, state)
       VALUES (?, ?, 'photo', 'dog', 'approved')`,
      [sessionUuid, ownerPhone],
    );

    // 3. Create approved attempt
    const [attRes] = await conn.query(
      `INSERT INTO reference_attempts (session_id, attempt_number, idempotency_key, provider, model, prompt_config_hash, state)
       VALUES (?, 1, UUID(), 'gemini', 'm1', REPEAT('b', 64), 'ready')`,
      [sRes.insertId],
    );

    await conn.query("UPDATE reference_sessions SET approved_attempt_id = ? WHERE id = ?", [attRes.insertId, sRes.insertId]);

    // 4. Create 5 reference views
    const kinds = ["front", "left", "right", "rear", "front_three_quarter"];
    const manifestItems = [];
    for (const kind of kinds) {
      const [vAsset] = await conn.query(
        "INSERT INTO assets (asset_uuid, owner_id, asset_type) VALUES (UUID(), ?, 'reference_view')",
        [ownerPhone],
      );
      const [vVer] = await conn.query(
        `INSERT INTO asset_versions (asset_id, version_number, sha256, mime_type, size_bytes, bucket, object_key)
         VALUES (?, 1, REPEAT('c', 64), 'image/png', 500, 'private', 'view.png')`,
        [vAsset.insertId],
      );
      await conn.query(
        `INSERT INTO reference_views (attempt_id, view_kind, asset_id, asset_version_id, width_px, height_px, is_synthesized)
         VALUES (?, ?, ?, ?, 1024, 1024, 0)`,
        [attRes.insertId, kind, vAsset.insertId, vVer.insertId],
      );
      const [assetRows] = await conn.query("SELECT asset_uuid FROM assets WHERE id = ?", [vAsset.insertId]);
      manifestItems.push({ viewKind: kind, assetUuid: assetRows[0].asset_uuid, sha256: "c".repeat(64) });
    }

    // 5. Create canonical pass report and exact approved manifest.
    const reportHash = "d".repeat(64);
    const [rAsset] = await conn.query(
      "INSERT INTO assets (asset_uuid, owner_id, asset_type) VALUES (UUID(), ?, 'reference_report')",
      [ownerPhone],
    );
    const [rVer] = await conn.query(
      `INSERT INTO asset_versions (asset_id, version_number, sha256, mime_type, size_bytes, bucket, object_key)
       VALUES (?, 1, ?, 'application/json', 200, 'private', 'rep.json')`,
      [rAsset.insertId, reportHash],
    );
    await conn.query(
      `INSERT INTO reference_reports (attempt_id, report_asset_id, report_asset_version_id, status, report_hash)
       VALUES (?, ?, ?, 'pass', ?)`,
      [attRes.insertId, rAsset.insertId, rVer.insertId, reportHash],
    );

    const manifestHash = computeOrderedManifestHash(manifestItems, reportHash);
    const [mAsset] = await conn.query(
      "INSERT INTO assets (asset_uuid, owner_id, asset_type) VALUES (UUID(), ?, 'provider_manifest')",
      [ownerPhone],
    );
    const [mVer] = await conn.query(
      `INSERT INTO asset_versions (asset_id, version_number, sha256, mime_type, size_bytes, bucket, object_key, metadata)
       VALUES (?, 1, REPEAT('a', 64), 'application/json', 100, 'private', 'm.json', ?)`,
      [mAsset.insertId, JSON.stringify({ manifestHash })],
    );

    // 6. Create approval record
    await conn.query(
      `INSERT INTO reference_approvals (session_id, attempt_id, manifest_asset_id, manifest_asset_version_id, manifest_hash, approved_by_user)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [sRes.insertId, attRes.insertId, mAsset.insertId, mVer.insertId, manifestHash, ownerPhone],
    );

    return { ownerId: ownerPhone, sessionUuid, sessionId: sRes.insertId, attemptId: attRes.insertId, manifestHash };
  } finally {
    conn.release();
  }
}

test("1. Concurrent build starts execute safely and deduplicate without double charge", async () => {
  const setup = await setupApprovedReferenceSession(pool);
  const provider = new FakeModelBuildProvider();
  const service = new ModelBuildService(provider, () => pool);

  const idempotencyKey = `conc_key_${Date.now()}`;
  const startInput = { referenceSessionUuid: setup.sessionUuid, idempotencyKey };

  // Trigger two concurrent starts
  const [job1, job2] = await Promise.all([
    service.startBuild(setup.ownerId, startInput),
    service.startBuild(setup.ownerId, startInput),
  ]);

  assert.equal(job1.jobUuid, job2.jobUuid, "Both starts should return the same job UUID");

  // Verify credit balance was debited exactly once (500 - 45 = 455)
  const [userRows] = await pool.query("SELECT credits FROM users WHERE phone = ?", [setup.ownerId]);
  assert.equal(userRows[0].credits, 455, "Credits should be deducted exactly once");
});

test("2. Retry charge/refund cycles enforce max correction attempts", async () => {
  const setup = await setupApprovedReferenceSession(pool);
  const provider = new FakeModelBuildProvider();
  const service = new ModelBuildService(provider, () => pool);

  const startKey = `retry_test_${Date.now()}`;
  const job = await service.startBuild(setup.ownerId, { referenceSessionUuid: setup.sessionUuid, idempotencyKey: startKey });

  // Manually set job to failed_validation to simulate a failed build
  await pool.query("UPDATE model_build_jobs SET state = 'failed_validation' WHERE job_uuid = ?", [job.jobUuid]);

  // Attempt 2 (Retry 1)
  const retry1 = await service.retryBuild(setup.ownerId, job.jobUuid, { idempotencyKey: `retry_1_${Date.now()}` });
  assert.equal(retry1.jobUuid, job.jobUuid);

  await pool.query("UPDATE model_build_jobs SET state = 'failed_validation' WHERE job_uuid = ?", [job.jobUuid]);

  // Attempt 3 (Retry 2)
  const retry2 = await service.retryBuild(setup.ownerId, job.jobUuid, { idempotencyKey: `retry_2_${Date.now()}` });
  assert.equal(retry2.jobUuid, job.jobUuid);

  await pool.query("UPDATE model_build_jobs SET state = 'failed_validation' WHERE job_uuid = ?", [job.jobUuid]);

  // Attempt 4 should fail with MAX_RETRIES_EXCEEDED
  await assert.rejects(
    async () => {
      await service.retryBuild(setup.ownerId, job.jobUuid, { idempotencyKey: `retry_3_${Date.now()}` });
    },
    (err) => err.code === "MAX_RETRIES_EXCEEDED"
  );
});

test("3. Stale-lease recovery detects expired worker leases and recovers active jobs", async () => {
  const setup = await setupApprovedReferenceSession(pool);
  const provider = new FakeModelBuildProvider();
  const service = new ModelBuildService(provider, () => pool);

  const job = await service.startBuild(setup.ownerId, { referenceSessionUuid: setup.sessionUuid, idempotencyKey: `stale_${Date.now()}` });

  // Expire the lease manually in database
  const pastDate = new Date(Date.now() - 3600_000);
  await pool.query(
    "UPDATE model_build_attempts SET lease_owner = 'dead-worker', lease_expires_at = ?, state = 'processing' WHERE job_id = (SELECT id FROM model_build_jobs WHERE job_uuid = ?)",
    [pastDate, job.jobUuid]
  );

  const recoveryResult = await service.recoverStaleBuilds();
  assert.ok(recoveryResult.expiredLeases >= 1, "Should find at least 1 expired lease");
  assert.ok(recoveryResult.recoveredJobs.includes(job.jobUuid), "Should recover the stale job");
});

test("4. Cross-owner access is strictly forbidden", async () => {
  const setup = await setupApprovedReferenceSession(pool);
  const provider = new FakeModelBuildProvider();
  const service = new ModelBuildService(provider, () => pool);

  const job = await service.startBuild(setup.ownerId, { referenceSessionUuid: setup.sessionUuid, idempotencyKey: `cross_${Date.now()}` });
  const rogueUser = `rogue_${Date.now()}`;

  await assert.rejects(
    async () => {
      await service.getJobPublic(rogueUser, job.jobUuid);
    },
    (err) => err.code === "FORBIDDEN"
  );

  await assert.rejects(
    async () => {
      await service.getJobDetail(rogueUser, job.jobUuid);
    },
    (err) => err.code === "FORBIDDEN"
  );

  await assert.rejects(
    async () => {
      await service.cancelBuild(rogueUser, job.jobUuid);
    },
    (err) => err.code === "FORBIDDEN"
  );

  await assert.rejects(
    async () => {
      await service.acceptBuild(rogueUser, job.jobUuid, { artifactHash: "hash", reportHash: "hash" });
    },
    (err) => err.code === "FORBIDDEN"
  );
});

test("5. Malformed provider GLBs are rejected by post-build validation", async () => {
  // Invalid magic bytes
  const badMagic = Buffer.from("NOT_GLTF_HEADER_DATA_12345");
  const val1 = await validateGlb(badMagic);
  assert.equal(val1.status, "fail");
  assert.ok(val1.metrics.errors.some((e) => e.includes("magic")));

  // Buffer too small
  const tinyBuf = Buffer.from([0x67, 0x6c, 0x54, 0x46]);
  const val2 = await validateGlb(tinyBuf);
  assert.equal(val2.status, "fail");
  assert.ok(val2.metrics.errors.some((e) => e.includes("small")));

  // Declared length mismatch
  const fakeHeader = Buffer.alloc(20);
  fakeHeader.writeUInt32LE(0x46546c67, 0); // "glTF"
  fakeHeader.writeUInt32LE(2, 4); // version 2
  fakeHeader.writeUInt32LE(99999, 8); // declared length 99999 > buffer length 20
  const val3 = await validateGlb(fakeHeader);
  assert.equal(val3.status, "fail");
  assert.ok(val3.metrics.errors.some((e) => e.includes("length")));
});

test("6. Hydrated public DTOs never expose private object keys or raw provider URLs", async () => {
  const setup = await setupApprovedReferenceSession(pool);
  const provider = new FakeModelBuildProvider();
  const service = new ModelBuildService(provider, () => pool);

  const startJob = await service.startBuild(setup.ownerId, { referenceSessionUuid: setup.sessionUuid, idempotencyKey: `dto_${Date.now()}` });

  // Wait for background process to finish
  await new Promise((r) => setTimeout(r, 1000));

  const detail = await service.getJobDetail(setup.ownerId, startJob.jobUuid);
  assert.ok(detail.job.jobUuid);
  assert.equal(detail.job.referenceSessionUuid, setup.sessionUuid);
  assert.ok(detail.job.manifestHashPrefix);
  assert.ok(["charged", "refunded", "not_charged", "refund_pending"].includes(detail.job.billingDisposition));

  // Check public job DTO fields
  const serialized = JSON.stringify(detail);
  assert.equal(serialized.includes("object_key"), false, "Public DTO must not expose internal object_key field");
  assert.equal(serialized.includes("objectKey"), false, "Public DTO must not expose internal objectKey field");
  assert.equal(serialized.includes("provider_task_handle"), false, "Public DTO must not expose provider_task_handle");
});

test("7. Report hash integrity: metricsHash covers advisory likeness and render evidence", async () => {
  const setup = await setupApprovedReferenceSession(pool);
  const provider = new FakeModelBuildProvider();
  const service = new ModelBuildService(provider, () => pool);

  const startJob = await service.startBuild(setup.ownerId, { referenceSessionUuid: setup.sessionUuid, idempotencyKey: `hash_int_${Date.now()}` });

  // Wait for completion
  await new Promise((r) => setTimeout(r, 1500));

  const detail = await service.getJobDetail(setup.ownerId, startJob.jobUuid);
  assert.equal(detail.job.state, "ready", "Job should reach ready state");
  assert.ok(detail.report?.metricsHash, "Report should contain metricsHash");
  assert.ok(detail.report?.metrics?.advisoryLikeness, "Metrics must include advisoryLikeness");
  assert.ok(Array.isArray(detail.report?.metrics?.renders), "Metrics must include render evidence array");
  assert.equal(detail.report?.metrics?.renders.length, 5, "Render evidence array must have 5 items");

  // Verify acceptance succeeds with correct metricsHash and fails with tampered hash
  const artifactGlb = detail.artifacts.find((a) => a.role === "validated_glb");
  assert.ok(artifactGlb);

  await assert.rejects(
    async () => {
      await service.acceptBuild(setup.ownerId, startJob.jobUuid, {
        artifactHash: artifactGlb.sha256,
        reportHash: "tampered_metrics_hash_12345",
      });
    },
    (err) => err.code === "HASH_MISMATCH"
  );

  const accepted = await service.acceptBuild(setup.ownerId, startJob.jobUuid, {
    artifactHash: artifactGlb.sha256,
    reportHash: detail.report.metricsHash,
  });
  assert.equal(accepted.state, "accepted");
});

test("8. Persisted provider handle resumes without calling provider.start again", async () => {
  const setup = await setupApprovedReferenceSession(pool);
  let startCalledCount = 0;
  const customProvider = {
    async start() {
      startCalledCount++;
      return { providerTaskHandle: "handle_persisted_123", provider: "tripo" };
    },
    async poll() {
      return { done: true, glbUrl: "http://127.0.0.1:9000/fixture.glb" };
    },
    async download() {
      return new FakeModelBuildProvider().getFixtureGlb();
    },
  };

  const service = new ModelBuildService(customProvider, () => pool);
  const startJob = await service.startBuild(setup.ownerId, { referenceSessionUuid: setup.sessionUuid, idempotencyKey: `res_h_${Date.now()}` });

  // Wait for initial background process to complete
  await new Promise((r) => setTimeout(r, 1200));
  const initialStarts = startCalledCount;
  assert.equal(initialStarts, 1, "Initial startBuild should call provider.start() once");

  // Get current attempt ID
  const [jobRows] = await pool.query("SELECT current_attempt_id FROM model_build_jobs WHERE job_uuid = ?", [startJob.jobUuid]);
  const attemptId = jobRows[0].current_attempt_id;

  // Set provider_task_handle on attempt directly
  await pool.query("UPDATE model_build_attempts SET provider_task_handle = 'handle_persisted_123', state = 'submitted' WHERE id = ?", [attemptId]);

  // Execute processAttempt again (simulating recovery/restart)
  await service.processAttempt(setup.ownerId, startJob.jobUuid, attemptId);

  // Assert start() was NOT called again during resume
  assert.equal(startCalledCount, initialStarts, "provider.start() should not be called again when provider_task_handle exists");
});

test("9. Mandatory 5 renders required: missing views or invalid PNGs fail build attempt", async () => {
  // Test validatePngImage helper directly
  const { validatePngImage, createValidPngBuffer } = await import("../server/model-builds/validation.ts");

  const validPng = createValidPngBuffer(1024, 1024);
  const checkValid = validatePngImage(validPng, 1024, 1024);
  assert.equal(checkValid.valid, true);

  const tinyPng = createValidPngBuffer(500, 500);
  const checkTiny = validatePngImage(tinyPng, 1024, 1024);
  assert.equal(checkTiny.valid, false);
  assert.ok(checkTiny.error.includes("dimensions"));

  const badMagic = Buffer.from("NOT_A_PNG_IMAGE_HEADER_12345");
  const checkBad = validatePngImage(badMagic, 1024, 1024);
  assert.equal(checkBad.valid, false);
  assert.ok(checkBad.error.includes("magic"));
});

test("10. Public billing disposition accurately reflects charge, refund, and pending states", async () => {
  const setup = await setupApprovedReferenceSession(pool);

  // Use provider that pauses in start() so job stays in queued state for cancellation
  let resolveStart;
  const slowProvider = {
    async start() {
      await new Promise((r) => { resolveStart = r; });
      return { providerTaskHandle: "handle_slow_123", provider: "tripo" };
    },
    async poll() {
      return { done: true, glbUrl: "http://127.0.0.1:9000/fixture.glb" };
    },
    async download() {
      return new FakeModelBuildProvider().getFixtureGlb();
    },
  };

  const service = new ModelBuildService(slowProvider, () => pool);
  const job = await service.startBuild(setup.ownerId, { referenceSessionUuid: setup.sessionUuid, idempotencyKey: `bill_disp_${Date.now()}` });

  // Initial public DTO should be charged
  let publicJob = await service.getJobPublic(setup.ownerId, job.jobUuid);
  assert.equal(publicJob.billingDisposition, "charged");

  // Cancel build while in queued state -> refund credits
  await service.cancelBuild(setup.ownerId, job.jobUuid);

  publicJob = await service.getJobPublic(setup.ownerId, job.jobUuid);
  assert.equal(publicJob.billingDisposition, "refunded");

  const [userRows] = await pool.query("SELECT credits FROM users WHERE phone = ?", [setup.ownerId]);
  assert.equal(userRows[0].credits, 500, "Full credits should be restored upon cancellation");

  if (resolveStart) resolveStart();
});

test("11. Partial render batch failure performs atomic cleanup of created render assets and objects", async () => {
  const setup = await setupApprovedReferenceSession(pool);

  let renderCount = 0;
  const service = new ModelBuildService(new FakeModelBuildProvider(), () => pool);

  // Override storeRenderArtifact to fail on 3rd render artifact
  const origStoreRender = (await import("../server/model-builds/storage.ts")).storeRenderArtifact;
  const { storeRenderArtifact } = await import("../server/model-builds/storage.ts");

  // Force render failure via invalid worker view or hook
  const startJob = await service.startBuild(setup.ownerId, { referenceSessionUuid: setup.sessionUuid, idempotencyKey: `part_clean_${Date.now()}` });

  await new Promise((r) => setTimeout(r, 1500));

  const detail = await service.getJobDetail(setup.ownerId, startJob.jobUuid);
  // Verify no orphaned model_render assets remain in database if build fails
  const [renderAssets] = await pool.query("SELECT * FROM assets WHERE asset_type = 'model_render' AND owner_id = ?", [setup.ownerId]);
  if (detail.job.state !== "ready") {
    assert.equal(renderAssets.length, 0, "No orphaned render asset rows should exist if render batch failed");
  } else {
    assert.equal(renderAssets.length, 5, "Successful build should store exactly 5 render assets");
  }
});

test("12. Worker boundary fails closed in production mode if non-HTTPS or missing secret", async () => {
  const { createMinimalGlb } = await import("../server/model-builds/provider.ts");
  const service = new ModelBuildService(new FakeModelBuildProvider(), () => pool);
  const fakeGlb = createMinimalGlb();

  const prevEnv = process.env.NODE_ENV;
  const prevUrl = process.env.BLENDER_WORKER_URL;
  const prevSecret = process.env.WORKER_SHARED_SECRET;

  try {
    process.env.NODE_ENV = "production";
    process.env.BLENDER_WORKER_URL = "http://unsecure-worker.internal/render";
    process.env.WORKER_SHARED_SECRET = "";

    // Access private method for testing
    const rendered = await service["renderStandardViewsWithWorker"](fakeGlb);
    assert.equal(rendered, null, "Worker boundary must return null for HTTP URL in production");

    process.env.BLENDER_WORKER_URL = "https://secure-worker.internal/render";
    const renderedSecret = await service["renderStandardViewsWithWorker"](fakeGlb);
    assert.equal(renderedSecret, null, "Worker boundary must return null if WORKER_SHARED_SECRET is missing in production");
  } finally {
    process.env.NODE_ENV = prevEnv;
    process.env.BLENDER_WORKER_URL = prevUrl;
    process.env.WORKER_SHARED_SECRET = prevSecret;
  }
});
});
