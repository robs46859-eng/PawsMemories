import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import mysql from "mysql2/promise";
import { Document, NodeIO } from "@gltf-transform/core";
import { runMigrations } from "../server/migrations/runner.ts";
import { FurBinService } from "../server/fur-bin/service.ts";
import {
  PublishShowcaseRequestSchema,
  RollbackVersionRequestSchema,
  ShowcaseBrowseRequestSchema,
} from "../server/fur-bin/schemas.ts";
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
const TEST_DB = "paws_phase5_server_completion_test_db";
process.env.NODE_ENV = "test";

async function buildRiggedGlb(targetNames) {
  const document = new Document();
  const buffer = document.createBuffer();
  const positions = document.createAccessor("positions").setType("VEC3")
    .setArray(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0])).setBuffer(buffer);
  const joints = document.createAccessor("joints").setType("VEC4")
    .setArray(new Uint16Array(12)).setBuffer(buffer);
  const weights = document.createAccessor("weights").setType("VEC4")
    .setArray(new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0])).setBuffer(buffer);
  const primitive = document.createPrimitive()
    .setAttribute("POSITION", positions).setAttribute("JOINTS_0", joints).setAttribute("WEIGHTS_0", weights);
  for (const name of targetNames) {
    const delta = document.createAccessor(name).setType("VEC3")
      .setArray(new Float32Array([0, 0, 0.01, 0, 0, 0.01, 0, 0, 0.01])).setBuffer(buffer);
    primitive.addTarget(document.createPrimitiveTarget().setAttribute("POSITION", delta));
  }
  const mesh = document.createMesh("fixture-mesh").addPrimitive(primitive).setExtras({ targetNames });
  const meshNode = document.createNode("fixture-model").setMesh(mesh);
  const skin = document.createSkin("fixture-skin");
  const root = document.createNode("root");
  const skeleton = [root];
  let parent = root;
  for (const name of ["spine", "neck", "head"]) {
    const joint = document.createNode(name).setTranslation([0, 0.1, 0]);
    parent.addChild(joint);
    skeleton.push(joint);
    parent = joint;
  }
  for (const joint of skeleton) skin.addJoint(joint);
  meshNode.setSkin(skin);
  document.createScene("fixture-scene").addChild(root).addChild(meshNode);
  return Buffer.from(await new NodeIO().writeBinary(document));
}

function measuredWorker(glb) {
  return {
    async process(request) {
      const targets = ["A", "B", "C", "D", "E", "F", "G", "H", "X", "jawOpen", "eyeBlinkLeft", "eyeBlinkRight"]
        .map((canonicalName) => ({
          name: canonicalName,
          canonicalName,
          displacedVertexCount: 24,
          maxDisplacement: 0.01,
          localityPass: true,
          deformationPass: true,
        }));
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
          validatorVersion: "phase5-fixture-v1",
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
          rules: [{ rule: "deformation_sweep", pass: true, detail: "Measured sweep passed" }],
          overallPass: true,
        },
        facial: {
          capability: "full",
          targets,
          canonicalMap: Object.fromEntries(targets.map((target) => [target.name, target.canonicalName])),
          hasBlink: true,
          hasJaw: true,
          hasEyeControls: true,
          rules: [{ rule: "locality", pass: true, detail: "Localized facial deformation passed" }],
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

async function waitForReady(service, ownerId, jobUuid) {
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline) {
    const job = await service.getJobPublic(ownerId, jobUuid);
    if (["ready", "failed_rig", "failed_validation"].includes(job.state)) return job;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Timed out waiting for measured rig fixture");
}

test("Phase 5 strict public contracts reject internal IDs and missing derivatives", () => {
  assert.equal(RollbackVersionRequestSchema.safeParse({ versionNumber: 2 }).success, true);
  assert.equal(RollbackVersionRequestSchema.safeParse({ targetVersionId: 19 }).success, false);
  assert.equal(PublishShowcaseRequestSchema.safeParse({
    itemUuid: crypto.randomUUID(),
    title: "Unsafe source",
  }).success, false);
  assert.equal(ShowcaseBrowseRequestSchema.safeParse({ page: 1, limit: 101 }).success, false);
  assert.equal(ShowcaseBrowseRequestSchema.safeParse({ page: 1, limit: 20, ownerId: "spoof" }).success, false);
});

test("Phase 5 server completion integration", async (t) => {
  let pool;
  try {
    const admin = await mysql.createConnection(MYSQL_CONFIG);
    await admin.query(`DROP DATABASE IF EXISTS \`${TEST_DB}\``);
    await admin.query(`CREATE DATABASE \`${TEST_DB}\``);
    await admin.end();
    pool = mysql.createPool({ ...MYSQL_CONFIG, database: TEST_DB });
    await initializeLegacyUsersTable(pool);
  } catch {
    t.skip("MySQL server not available, skipping Phase 5 server completion integration.");
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
  process.env.FUR_BIN_V5_ENABLED = "true";
  const owner = `+1555${Math.floor(1000000 + Math.random() * 9000000)}`;
  const source = await createAcceptedModelBuildFixture(pool, owner);
  const glb = await buildRiggedGlb(["A", "B", "C", "D", "E", "F", "G", "H", "X", "jawOpen", "eyeBlinkLeft", "eyeBlinkRight"]);
  const rigService = new RigPipelineService(() => pool, {
    worker: measuredWorker(glb),
    signVersion: async () => "https://private.fixture/source.glb",
  });
  const started = await rigService.startRigJob(owner, {
    modelBuildJobUuid: source.jobUuid,
    idempotencyKey: `phase5-rig-${crypto.randomUUID()}`,
    requestFacial: true,
  });
  const ready = await waitForReady(rigService, owner, started.jobUuid);
  assert.equal(ready.state, "ready", ready.failureCode || "fixture rig should be ready");
  const accepted = await rigService.acceptRigJob(owner, ready.jobUuid, { manifestHash: ready.manifestHash });

  const signedAssets = [];
  const service = new FurBinService(() => pool, async (asset) => {
    signedAssets.push(asset.asset_uuid);
    return `https://signed.fixture/${asset.asset_uuid}.glb`;
  });
  const item = await service.registerItem(owner, {
    assetUuid: accepted.outputArtifact.assetUuid,
    versionNumber: accepted.outputArtifact.versionNumber,
    title: "Measured private pet",
    tags: ["Pet", "pet"],
  });
  assert.equal(item.badges.find((badge) => badge.id === "rig").state, "verified");
  assert.equal(item.badges.find((badge) => badge.id === "facial").state, "verified");
  assert.equal(item.badges.find((badge) => badge.id === "animation").state, "not_verified");
  assert.equal(item.currentVersionNumber, accepted.outputArtifact.versionNumber);
  assert.equal(item.versions.length, 1);

  const collection = await service.createCollection(owner, { name: "Approved pets" });
  await service.addItemToCollection(owner, collection.collectionUuid, item.itemUuid);
  assert.deepEqual(await service.listCollections(owner), [{
    collectionUuid: collection.collectionUuid,
    name: "Approved pets",
    description: null,
    itemCount: 1,
  }]);

  const conn = await pool.getConnection();
  let derivativeUuid;
  try {
    await conn.beginTransaction();
    derivativeUuid = crypto.randomUUID();
    const [assetResult] = await conn.query(
      "INSERT INTO assets (asset_uuid, owner_id, asset_type, visibility, status) VALUES (?, ?, 'model_glb', 'published', 'active')",
      [derivativeUuid, owner],
    );
    const [versionResult] = await conn.query(
      `INSERT INTO asset_versions
        (asset_id, version_number, sha256, mime_type, size_bytes, bucket, object_key, source_provider, commercial_use_eligible)
       VALUES (?, 1, ?, 'model/gltf-binary', ?, 'private', ?, 'showcase-derivative', 1)`,
      [assetResult.insertId, "d".repeat(64), glb.length, `showcase/${derivativeUuid}.glb`],
    );
    await conn.query("UPDATE assets SET current_version_id = ? WHERE id = ?", [versionResult.insertId, assetResult.insertId]);
    const [sourceVersion] = await conn.query(
      "SELECT id FROM asset_versions WHERE asset_id = (SELECT id FROM assets WHERE asset_uuid = ?) AND version_number = ?",
      [accepted.outputArtifact.assetUuid, accepted.outputArtifact.versionNumber],
    );
    await conn.query(
      "INSERT INTO asset_relations (parent_version_id, child_version_id, relation_type) VALUES (?, ?, 'derivative')",
      [sourceVersion[0].id, versionResult.insertId],
    );
    await conn.commit();
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }

  await assert.rejects(() => service.publishShowcase(owner, {
    itemUuid: item.itemUuid,
    publicDerivativeUuid: accepted.outputArtifact.assetUuid,
    publicDerivativeVersionNumber: accepted.outputArtifact.versionNumber,
    title: "Unsafe private source",
    rightsDeclaration: "all_rights_reserved",
  }), (error) => error.code === "PRIVATE_ASSET");

  const showcase = await service.publishShowcase(owner, {
    itemUuid: item.itemUuid,
    publicDerivativeUuid: derivativeUuid,
    publicDerivativeVersionNumber: 1,
    title: "Measured pet showcase",
    tags: ["pet"],
    category: "pets",
    rightsDeclaration: "all_rights_reserved",
    commercialEligible: true,
  });
  assert.equal(showcase.moderationState, "pending");
  assert.equal((await service.listOwnerShowcases(owner, { page: 1, limit: 20 })).total, 1);
  await service.moderateShowcase("database-admin", showcase.showcaseUuid, "approved", "Evidence reviewed", true);
  const publicPage = await service.browsePublicShowcases({ query: "Measured", page: 1, limit: 20 });
  assert.equal(publicPage.total, 1);
  assert.equal(publicPage.items[0].showcaseUuid, showcase.showcaseUuid);
  assert.equal(signedAssets.at(-1), derivativeUuid, "public viewing must sign the derivative, never the private source");
  assert.equal(publicPage.items[0].publicViewUrl.includes(derivativeUuid), true);

  const archived = await service.archiveItem(owner, item.itemUuid);
  assert.equal(archived.status, "archived");
  assert.equal((await service.searchLibrary(owner, {})).total, 0);

  const [versionEvents] = await pool.query(
    `SELECT event_type, evidence_hash FROM fur_bin_version_events
      WHERE item_id = (SELECT id FROM fur_bin_items WHERE item_uuid = ?)
      ORDER BY id`,
    [item.itemUuid],
  );
  assert.deepEqual(versionEvents.map((event) => event.event_type), ["registered", "archived"]);
  assert.equal(versionEvents.every((event) => /^[a-f0-9]{64}$/.test(event.evidence_hash)), true);

  const [publicationEvents] = await pool.query(
    `SELECT event_type, evidence_hash FROM showcase_publication_events
      WHERE showcase_id = (SELECT id FROM showcase_records WHERE showcase_uuid = ?)
      ORDER BY id`,
    [showcase.showcaseUuid],
  );
  assert.deepEqual(publicationEvents.map((event) => event.event_type), ["submitted", "published"]);
  assert.equal(publicationEvents.every((event) => /^[a-f0-9]{64}$/.test(event.evidence_hash)), true);
});
