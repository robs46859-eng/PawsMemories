import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import mysql from "mysql2/promise";
import { Document, NodeIO } from "@gltf-transform/core";
import { runMigrations } from "../server/migrations/runner.ts";
import { RigPipelineService } from "../server/rig-pipeline/service.ts";
import { RigWorkerResultSchema } from "../server/rig-pipeline/worker.ts";
import { createValidPngBuffer } from "../server/model-builds/validation.ts";
import { createAcceptedModelBuildFixture } from "./helpers/phase4Fixture.mjs";
import { initializeLegacyUsersTable } from "./helpers/mysqlTestDatabase.mjs";

const MYSQL_CONFIG = {
  host: process.env.MYSQL_TEST_HOST || "127.0.0.1",
  port: Number(process.env.MYSQL_TEST_PORT || 3306),
  user: process.env.MYSQL_TEST_USER || "root",
  password: process.env.MYSQL_TEST_PASSWORD || "",
};
const TEST_DB = "paws_phase4_service_test_db";
process.env.NODE_ENV = "test";

async function buildGlb(targetNames) {
  const document = new Document();
  const buffer = document.createBuffer();
  const positions = document.createAccessor("positions")
    .setType("VEC3")
    .setArray(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]))
    .setBuffer(buffer);
  const joints = document.createAccessor("joints")
    .setType("VEC4")
    .setArray(new Uint16Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]))
    .setBuffer(buffer);
  const weights = document.createAccessor("weights")
    .setType("VEC4")
    .setArray(new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]))
    .setBuffer(buffer);
  const primitive = document.createPrimitive()
    .setAttribute("POSITION", positions)
    .setAttribute("JOINTS_0", joints)
    .setAttribute("WEIGHTS_0", weights);
  for (let index = 0; index < targetNames.length; index++) {
    const delta = document.createAccessor(targetNames[index])
      .setType("VEC3")
      .setArray(new Float32Array([0, 0, 0.01, 0, 0, 0.01, 0, 0, 0.01]))
      .setBuffer(buffer);
    primitive.addTarget(document.createPrimitiveTarget().setAttribute("POSITION", delta));
  }
  const mesh = document.createMesh("fixture-mesh").addPrimitive(primitive).setExtras({ targetNames });
  const meshNode = document.createNode("fixture-model").setMesh(mesh);
  const skin = document.createSkin("fixture-skin");
  const rootJoint = document.createNode("root");
  const skeletonJoints = [rootJoint];
  let parent = rootJoint;
  for (const name of ["spine", "neck", "head"]) {
    const joint = document.createNode(name).setTranslation([0, 0.1, 0]);
    parent.addChild(joint);
    skeletonJoints.push(joint);
    parent = joint;
  }
  for (const joint of skeletonJoints) skin.addJoint(joint);
  meshNode.setSkin(skin);
  document.createScene("fixture-scene").addChild(rootJoint).addChild(meshNode);
  return Buffer.from(await new NodeIO().writeBinary(document));
}

function measuredWorker() {
  return {
    async process(request) {
      const targets = ["A", "B", "C", "D", "E", "F", "G", "H", "X", "jawOpen", "eyeBlinkLeft", "eyeBlinkRight"]
        .map((canonicalName) => ({
          name: canonicalName,
          canonicalName,
          displacedVertexCount: 40,
          maxDisplacement: 0.02,
          localityPass: true,
          deformationPass: true,
        }));
      const glb = await buildGlb(targets.map((target) => target.name));
      const png = createValidPngBuffer(256, 256);
      return RigWorkerResultSchema.parse({
        contractVersion: 1,
        jobUuid: request.jobUuid,
        attemptUuid: request.attemptUuid,
        sourceSha256: request.source.sha256,
        output: {
          glbBase64: glb.toString("base64"),
          sha256: crypto.createHash("sha256").update(glb).digest("hex"),
          sizeBytes: glb.length,
        },
        rig: {
          validatorVersion: "blender-rig-v1",
          metrics: {
            boneCount: 4,
            skinnedVertexCount: 1200,
            maxInfluences: 4,
            unweightedIslands: 0,
            bindMatrixValid: true,
            animationSweepPass: true,
            silhouetteDeviation: 0.002,
            triangleCount: 5000,
            textureMaxDimension: 1024,
            jointCount: 4,
            boneNames: ["root", "spine", "neck", "head"],
          },
          rules: [{ rule: "worker_deformation_sweep", pass: true, detail: "Measured sweep passed" }],
          overallPass: true,
        },
        facial: {
          capability: "full",
          targets,
          canonicalMap: Object.fromEntries(targets.map((target) => [target.name, target.canonicalName])),
          hasBlink: true,
          hasJaw: true,
          hasEyeControls: true,
          rules: [{ rule: "facial_locality", pass: true, detail: "Measured localized deformation passed" }],
        },
        renders: ["facial_render_front", "facial_render_three_quarter"].map((role) => ({
          role,
          pngBase64: png.toString("base64"),
          sha256: crypto.createHash("sha256").update(png).digest("hex"),
          sizeBytes: png.length,
        })),
        accessories: [],
        warnings: [],
      });
    },
  };
}

async function waitForState(service, ownerId, jobUuid, expectedStates) {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    const job = await service.getJobPublic(ownerId, jobUuid);
    if (expectedStates.includes(job.state)) return job;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for rig job ${jobUuid}`);
}

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

  await t.test("should classify the accepted model and fail closed when the worker is unavailable", async () => {
    const ownerPhone = `+1555${Math.floor(1000000 + Math.random() * 9000000)}`;
    const setup = await createAcceptedModelBuildFixture(pool, ownerPhone);
    const service = new RigPipelineService(() => pool, {
      worker: { process: async () => { throw new Error("WORKER_SHARED_SECRET is required for the rig worker"); } },
      signVersion: async () => "https://assets.example.test/source.glb?signature=test",
    });

    const startRes = await service.startRigJob(ownerPhone, {
      modelBuildJobUuid: setup.jobUuid,
      idempotencyKey: `idemp_rig_${Date.now()}`,
      requestFacial: true,
    });

    assert.equal(startRes.classification, "quadruped");
    assert.equal(startRes.selectedProfile, "quadruped.dog.medium");

    const updatedJob = await waitForState(service, ownerPhone, startRes.jobUuid, ["failed_rig"]);
    assert.equal(updatedJob.state, "failed_rig");
    assert.equal(updatedJob.failureCode, "RIG_WORKER_UNAVAILABLE");
    assert.equal(updatedJob.rigValidation, null);
    assert.equal(updatedJob.facialCapability, null);

    const retryKey = `retry_rig_${Date.now()}`;
    const retry1 = await service.retryRigJob(ownerPhone, startRes.jobUuid, { idempotencyKey: retryKey });
    const retry2 = await service.retryRigJob(ownerPhone, startRes.jobUuid, { idempotencyKey: retryKey });
    assert.equal(retry2.jobUuid, retry1.jobUuid);
    const [attemptRows] = await pool.query(
      "SELECT COUNT(*) AS count FROM rig_attempts ra JOIN rig_jobs rj ON rj.id = ra.job_id WHERE rj.job_uuid = ?",
      [startRes.jobUuid],
    );
    assert.equal(Number(attemptRows[0].count), 2);
  });

  await t.test("persists and accepts a measured body and facial rig", async () => {
    const ownerPhone = `+1555${Math.floor(1000000 + Math.random() * 9000000)}`;
    const setup = await createAcceptedModelBuildFixture(pool, ownerPhone);
    const service = new RigPipelineService(() => pool, {
      worker: measuredWorker(),
      signVersion: async () => "https://assets.example.test/source.glb?signature=test",
    });

    const started = await service.startRigJob(ownerPhone, {
      modelBuildJobUuid: setup.jobUuid,
      idempotencyKey: `measured_rig_${Date.now()}`,
      requestFacial: true,
    });
    const ready = await waitForState(service, ownerPhone, started.jobUuid, ["ready", "failed_rig", "failed_validation"]);
    const [attemptRows] = await pool.query(
      "SELECT ra.failure_detail FROM rig_attempts ra JOIN rig_jobs rj ON rj.id = ra.job_id WHERE rj.job_uuid = ? ORDER BY ra.attempt_number DESC LIMIT 1",
      [started.jobUuid],
    );

    assert.equal(ready.state, "ready", attemptRows[0]?.failure_detail || ready.failureCode || "rig should be ready");
    assert.equal(ready.facialCapability, "full");
    assert.equal(ready.facialInventory.visemeCoverage, 1);
    assert.equal(ready.rigValidation.overallPass, true);
    assert.equal(ready.outputArtifact.sha256.length, 64);
    assert.equal(ready.manifestHash.length, 64);

    const accepted = await service.acceptRigJob(ownerPhone, ready.jobUuid, { manifestHash: ready.manifestHash });
    assert.equal(accepted.state, "accepted");
    assert.equal(accepted.outputArtifact.assetUuid, ready.outputArtifact.assetUuid);
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
