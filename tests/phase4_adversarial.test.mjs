import test from "node:test";
import assert from "node:assert/strict";
import mysql from "mysql2/promise";
import { runMigrations } from "../server/migrations/runner.ts";
import { RigPipelineService } from "../server/rig-pipeline/service.ts";
import { createAcceptedModelBuildFixture } from "./helpers/phase4Fixture.mjs";
import { initializeLegacyUsersTable } from "./helpers/mysqlTestDatabase.mjs";

const MYSQL_CONFIG = {
  host: process.env.MYSQL_TEST_HOST || "127.0.0.1",
  port: Number(process.env.MYSQL_TEST_PORT || 3306),
  user: process.env.MYSQL_TEST_USER || "root",
  password: process.env.MYSQL_TEST_PASSWORD || "",
};
const TEST_DB = "paws_phase4_adversarial_test_db";

test("Phase 4 Adversarial Test Suite", async (t) => {
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
  process.env.RIG_PIPELINE_V4_ENABLED = "true";

  await t.test("1. Deduplicates concurrent rig start calls with same idempotency key", async () => {
    const ownerPhone = `+1555${Math.floor(1000000 + Math.random() * 9000000)}`;
    const setup = await createAcceptedModelBuildFixture(pool, ownerPhone);
    const service = new RigPipelineService(() => pool);

    const key = `adv_idemp_${Date.now()}`;
    const [res1, res2] = await Promise.all([
      service.startRigJob(ownerPhone, { modelBuildJobUuid: setup.jobUuid, idempotencyKey: key }),
      service.startRigJob(ownerPhone, { modelBuildJobUuid: setup.jobUuid, idempotencyKey: key }),
    ]);

    assert.equal(res1.jobUuid, res2.jobUuid);
  });

  await t.test("2. Rejects unaccepted model build jobs", async () => {
    const ownerPhone = `+1555${Math.floor(1000000 + Math.random() * 9000000)}`;
    const setup = await createAcceptedModelBuildFixture(pool, ownerPhone);
    await pool.query("UPDATE model_build_jobs SET state = 'ready', accepted_artifact_id = NULL WHERE job_uuid = ?", [setup.jobUuid]);

    const service = new RigPipelineService(() => pool);
    await assert.rejects(
      async () => {
        await service.startRigJob(ownerPhone, {
          modelBuildJobUuid: setup.jobUuid,
          idempotencyKey: `unaccepted_${Date.now()}`,
        });
      },
      (err) => err.code === "UNACCEPTED_MODEL",
    );
  });

  await t.test("3. Rejects acceptance when no real worker output or manifest exists", async () => {
    const ownerPhone = `+1555${Math.floor(1000000 + Math.random() * 9000000)}`;
    const setup = await createAcceptedModelBuildFixture(pool, ownerPhone);
    const service = new RigPipelineService(() => pool);

    const job = await service.startRigJob(ownerPhone, {
      modelBuildJobUuid: setup.jobUuid,
      idempotencyKey: `tamper_${Date.now()}`,
    });

    await new Promise((r) => setTimeout(r, 100));

    await assert.rejects(
      async () => {
        await service.acceptRigJob(ownerPhone, job.jobUuid, {
          manifestHash: "tampered_hash_123456789012345678901234567890123456789012345678901234",
        });
      },
      (err) => err.code === "INVALID_STATE",
    );
  });

  await t.test("4. Hydrated DTO never exposes private keys or database IDs", async () => {
    const ownerPhone = `+1555${Math.floor(1000000 + Math.random() * 9000000)}`;
    const setup = await createAcceptedModelBuildFixture(pool, ownerPhone);
    const service = new RigPipelineService(() => pool);

    const job = await service.startRigJob(ownerPhone, {
      modelBuildJobUuid: setup.jobUuid,
      idempotencyKey: `dto_${Date.now()}`,
    });
    await new Promise((resolve) => setTimeout(resolve, 100));

    const str = JSON.stringify(job);
    assert.equal(str.includes("object_key"), false);
    assert.equal(str.includes("bucket"), false);
    assert.equal(str.includes("password"), false);
  });

});
