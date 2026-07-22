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
const TEST_DB = "paws_phase4_service_test_db";

test("Phase 4 RigPipelineService Integration Test Suite", async (t) => {
  let pool;
  try {
    const admin = await mysql.createConnection(MYSQL_CONFIG);
    await admin.query(`DROP DATABASE IF EXISTS \`${TEST_DB}\``);
    await admin.query(`CREATE DATABASE \`${TEST_DB}\``);
    await admin.end();
    pool = mysql.createPool({ ...MYSQL_CONFIG, database: TEST_DB });
    await initializeLegacyUsersTable(pool);
  } catch (err) {
    t.skip("MySQL server not available, skipping service integration tests.");
    return;
  }
  t.after(async () => {
    await pool.end();
    const admin = await mysql.createConnection(MYSQL_CONFIG);
    await admin.query(`DROP DATABASE IF EXISTS \`${TEST_DB}\``);
    await admin.end();
  });

  await runMigrations(pool);

  // Enable feature flag for tests
  process.env.RIG_PIPELINE_V4_ENABLED = "true";

  await t.test("should classify the accepted model and fail closed without a measured rig worker", async () => {
    const ownerPhone = `+1555${Math.floor(1000000 + Math.random() * 9000000)}`;
    const setup = await createAcceptedModelBuildFixture(pool, ownerPhone);
    const service = new RigPipelineService(() => pool);

    const startRes = await service.startRigJob(ownerPhone, {
      modelBuildJobUuid: setup.jobUuid,
      idempotencyKey: `idemp_rig_${Date.now()}`,
      requestFacial: true,
    });

    assert.equal(startRes.classification, "quadruped");
    assert.equal(startRes.selectedProfile, "quadruped.dog.medium");

    await new Promise((r) => setTimeout(r, 100));

    const updatedJob = await service.getJobPublic(ownerPhone, startRes.jobUuid);
    assert.equal(updatedJob.state, "failed_rig");
    assert.equal(updatedJob.failureCode, "RIG_WORKER_NOT_INTEGRATED");
    assert.equal(updatedJob.rigValidation, null);
    assert.equal(updatedJob.facialCapability, null);
  });

  await t.test("should reject cross-owner rig access", async () => {
    const owner1 = `+1555${Math.floor(1000000 + Math.random() * 9000000)}`;
    const owner2 = `+1555${Math.floor(1000000 + Math.random() * 9000000)}`;
    const setup = await createAcceptedModelBuildFixture(pool, owner1);
    const service = new RigPipelineService(() => pool);

    await assert.rejects(
      async () => {
        await service.startRigJob(owner2, {
          modelBuildJobUuid: setup.jobUuid,
          idempotencyKey: `idemp_cross_${Date.now()}`,
        });
      },
      (err) => err.code === "FORBIDDEN",
    );
  });

});
