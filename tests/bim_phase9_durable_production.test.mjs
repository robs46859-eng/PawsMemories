import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import {
  CanonicalDurableBimArtifactRegistrar,
  DurableBimPostBuildVerifier,
  DurableBimProductionError,
  MysqlDurableBimCreditAdapter,
  RenderDurableBimWorker,
} from "../server/bim/durableProduction.ts";
import {
  BIM_BUILD_CONTRACT_VERSION,
  hashBimModel,
} from "../server/bim/contracts.ts";
import { DurableBimServiceError } from "../server/bim/durableService.ts";
import { buildBimPreBuildVerification } from "../server/bim/verification.ts";

const model = {
  name: "Durable fixture",
  siteName: "Site",
  buildingName: "Building",
  levels: [{ id: "ground", name: "Ground", elevation: 0 }],
  elements: [{
    id: "slab-1",
    type: "slab",
    name: "Floor",
    levelId: "ground",
    position: [0, 0, 0],
    width: 10,
    depth: 8,
    height: 0.2,
    properties: { Provenance: "user_confirmed" },
  }],
};

const calibration = {
  sourceKind: "text",
  sourceDescription: "Authoritative dimensions supplied by the owner.",
  imageViews: [],
  synthesizedImageViews: [],
  measurements: [
    { id: "width", axis: "width", value: 10, unit: "m", source: "user_measurement" },
    { id: "depth", axis: "depth", value: 8, unit: "m", source: "user_measurement" },
    { id: "height", axis: "height", value: 0.2, unit: "m", source: "user_measurement" },
  ],
  userConfirmedAssumptions: ["The supplied slab dimensions are authoritative."],
};

const preBuild = buildBimPreBuildVerification(model, "ifc", calibration);

function command(overrides = {}) {
  return {
    contractVersion: BIM_BUILD_CONTRACT_VERSION,
    jobUuid: "11111111-1111-4111-8111-111111111111",
    attemptUuid: "22222222-2222-4222-8222-222222222222",
    ownerKey: "+15555550100",
    mode: "ifc",
    idempotencyKey: "durable-production-test-key",
    modelHash: hashBimModel(model),
    calibrationHash: preBuild.calibrationHash,
    proposalHash: hashBimModel(model),
    acceptedProposalHash: hashBimModel(model),
    preBuildReportHash: preBuild.reportHash,
    requestedAt: "2026-07-22T12:00:00.000Z",
    ...overrides,
  };
}

function glbBytes() {
  const json = Buffer.from('{"asset":{"version":"2.0"}}');
  const padded = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 0x20)]);
  const output = Buffer.alloc(20 + padded.length);
  output.write("glTF", 0, "ascii");
  output.writeUInt32LE(2, 4);
  output.writeUInt32LE(output.length, 8);
  output.writeUInt32LE(padded.length, 12);
  output.writeUInt32LE(0x4e4f534a, 16);
  padded.copy(output, 20);
  return output;
}

function ifcBytes() {
  return Buffer.from("ISO-10303-21;\nHEADER;\nFILE_SCHEMA(('IFC4'));\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;\n");
}

function sidecar(overrides = {}) {
  return {
    success: true,
    schema: "IFC4",
    sourceUnit: "m",
    metersPerUnit: 1,
    axisConvention: "z-up-model",
    glbBounds: { min: [0, 0, 0], max: [10, 8, 0.2], dimensions: [10, 8, 0.2] },
    elementCount: 1,
    globalIdCount: 1,
    uniqueGlobalIdCount: 1,
    relationshipCount: 1,
    voidRelationshipCount: 0,
    fillingRelationshipCount: 0,
    propertySetElementCount: 1,
    storeyCount: 1,
    placementsFinite: true,
    proxyCount: 0,
    elements: [{
      globalId: "0000000000000000000001",
      class: "IfcSlab",
      parentGlobalId: "1000000000000000000001",
      placementMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
      properties: { Pset_Pawsome3D: { Pawsome3DId: "slab-1" } },
    }],
    openingRelationships: [],
    fillingRelationships: [],
    ...overrides,
  };
}

function workerPayload(overrides = {}) {
  return {
    success: true,
    ifc_base64: ifcBytes().toString("base64"),
    glb_base64: glbBytes().toString("base64"),
    sidecar: sidecar(),
    exportReport: { schema: "IFC4", roundTripPassed: true },
    ...overrides,
  };
}

function artifact(bytes, mimeType) {
  return {
    base64: bytes.toString("base64"),
    sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
    sizeBytes: bytes.length,
    mimeType,
  };
}

function resultEnvelope(overrides = {}) {
  const ifc = artifact(ifcBytes(), "application/x-step");
  const semanticGlb = artifact(glbBytes(), "model/gltf-binary");
  const semantic = sidecar();
  const semanticSidecar = artifact(Buffer.from(JSON.stringify(semantic)), "application/json");
  const validationReport = artifact(Buffer.from(JSON.stringify({ passed: true })), "application/json");
  return {
    contractVersion: BIM_BUILD_CONTRACT_VERSION,
    jobUuid: command().jobUuid,
    attemptUuid: command().attemptUuid,
    mode: "ifc",
    preBuildReportHash: preBuild.reportHash,
    modelHash: hashBimModel(model),
    calibrationHash: preBuild.calibrationHash,
    outputSha256: ifc.sha256,
    evidence: {
      provider: "render-ifc-export",
      ifc,
      semanticGlb,
      semanticSidecar,
      validationReport,
      sidecar: semantic,
      exportReport: { schema: "IFC4", roundTripPassed: true },
    },
    ...overrides,
  };
}

test("Render worker uses the authenticated HTTPS IFC endpoint and binds the accepted model", async () => {
  let captured;
  const worker = new RenderDurableBimWorker({
    baseUrl: "https://worker.example/render",
    sharedSecret: "worker-secret",
    modelResolver: { async resolve() { return model; } },
    fetchImpl: async (url, init) => {
      captured = { url: String(url), init };
      return new Response(JSON.stringify(workerPayload()), { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  const execution = await worker.build(command());
  assert.equal(captured.url, "https://worker.example/ifc/export");
  assert.equal(captured.init.headers["x-worker-secret"], "worker-secret");
  assert.equal(captured.init.redirect, "error");
  const body = JSON.parse(captured.init.body);
  assert.deepEqual(body.model, model);
  assert.equal(body.contract.modelHash, hashBimModel(model));
  assert.equal(execution.result.outputSha256, crypto.createHash("sha256").update(ifcBytes()).digest("hex"));
});

test("Render worker refuses non-HTTPS configuration", () => {
  assert.throws(() => new RenderDurableBimWorker({
    baseUrl: "http://worker.example",
    sharedSecret: "secret",
    modelResolver: { async resolve() { return model; } },
  }), (error) => error instanceof DurableBimProductionError && error.code === "BIM_WORKER_CONFIG");
});

test("Render worker refuses to start without the shared authentication secret", () => {
  assert.throws(() => new RenderDurableBimWorker({
    baseUrl: "https://worker.example",
    sharedSecret: "",
    modelResolver: { async resolve() { return model; } },
  }), (error) => error instanceof DurableBimProductionError && error.code === "BIM_WORKER_CONFIG");
});

test("Shell mode fails closed without calling the IFC worker", async () => {
  let calls = 0;
  const worker = new RenderDurableBimWorker({
    baseUrl: "https://worker.example",
    sharedSecret: "secret",
    modelResolver: { async resolve() { return model; } },
    fetchImpl: async () => { calls += 1; throw new Error("must not be called"); },
  });
  await assert.rejects(worker.build(command({ mode: "shell" })), (error) => (
    error instanceof DurableBimServiceError && error.code === "SHELL_WORKER_UNSUPPORTED" && error.retryable === false
  ));
  assert.equal(calls, 0);
});

test("Worker rejects a resolved model that does not match the accepted hash", async () => {
  const worker = new RenderDurableBimWorker({
    baseUrl: "https://worker.example",
    sharedSecret: "secret",
    modelResolver: { async resolve() { return { ...model, name: "forged" }; } },
    fetchImpl: async () => { throw new Error("must not be called"); },
  });
  await assert.rejects(worker.build(command()), (error) => error.code === "MODEL_HASH_MISMATCH");
});

test("Worker rejects a response declared above the configured bound", async () => {
  const worker = new RenderDurableBimWorker({
    baseUrl: "https://worker.example",
    sharedSecret: "secret",
    modelResolver: { async resolve() { return model; } },
    maxResponseBytes: 32,
    fetchImpl: async () => new Response("{}", { status: 200, headers: { "content-length": "33" } }),
  });
  await assert.rejects(worker.build(command()), (error) => error.code === "BIM_WORKER_RESPONSE_BOUNDS");
});

test("Canonical registrar independently rejects forged bytes and hashes before storage", async () => {
  let puts = 0;
  const persistence = {
    async put() { puts += 1; throw new Error("must not store forged data"); },
    async removeObject() {},
    async register() { throw new Error("must not register forged data"); },
    async removeAsset() {},
    async addDerivative() {},
  };
  const registrar = new CanonicalDurableBimArtifactRegistrar(persistence);
  const forged = resultEnvelope();
  forged.evidence.ifc.sha256 = "f".repeat(64);
  await assert.rejects(registrar.register({ command: command(), result: forged }), (error) => error.code === "BIM_ARTIFACT_HASH");
  assert.equal(puts, 0);
});

test("Canonical registrar persists four immutable private artifacts with lineage", async () => {
  const objects = [];
  const assets = [];
  const lineage = [];
  const persistence = {
    async put(objectKey, bytes, mimeType) {
      objects.push({ objectKey, bytes, mimeType });
      return { objectKey, sizeBytes: bytes.length, sha256: crypto.createHash("sha256").update(bytes).digest("hex") };
    },
    async removeObject() {},
    async register(input) {
      const id = assets.length + 1;
      assets.push(input);
      return { assetId: id, assetUuid: `00000000-0000-4000-8000-${String(id).padStart(12, "0")}`, assetVersionId: id + 10, versionNumber: 1 };
    },
    async removeAsset() {},
    async addDerivative(parent, child) { lineage.push({ parent, child }); },
  };
  const registrar = new CanonicalDurableBimArtifactRegistrar(persistence);
  const registrations = await registrar.register({ command: command(), result: resultEnvelope() });
  assert.deepEqual(registrations.map((item) => item.role), ["ifc", "semantic_glb", "semantic_sidecar", "validation_report"]);
  assert.equal(objects.length, 4);
  assert.equal(assets.every((item) => item.ownerId === command().ownerKey), true);
  assert.equal(lineage.length, 3);
});

test("Canonical registrar compensates an uploaded object when registration fails", async () => {
  const removed = [];
  const persistence = {
    async put(objectKey, bytes) { return { objectKey, sizeBytes: bytes.length, sha256: crypto.createHash("sha256").update(bytes).digest("hex") }; },
    async removeObject(key) { removed.push(key); },
    async register() { throw new Error("database unavailable"); },
    async removeAsset() {},
    async addDerivative() {},
  };
  const registrar = new CanonicalDurableBimArtifactRegistrar(persistence);
  await assert.rejects(registrar.register({ command: command(), result: resultEnvelope() }), /database unavailable/);
  assert.equal(removed.length, 1);
  assert.match(removed[0], /^models\/.+\/bim-.+\/ifc-.+\.ifc$/);
});

test("Post-build verifier derives a passing IFC report from semantic worker evidence", async () => {
  const verifier = new DurableBimPostBuildVerifier({ async resolve() { return preBuild; } });
  const report = await verifier.verify({ command: command(), result: resultEnvelope() });
  assert.equal(report.overallPass, true);
  assert.equal(report.reportJson.semanticsVerified, true);
  assert.equal(report.reportJson.claim, "verified_ifc4_semantic_model");
});

test("Post-build verifier rejects sidecar bytes that differ from claimed semantics", async () => {
  const verifier = new DurableBimPostBuildVerifier({ async resolve() { return preBuild; } });
  const result = resultEnvelope();
  result.evidence.sidecar.elementCount = 999;
  await assert.rejects(verifier.verify({ command: command(), result }), (error) => error.code === "BIM_WORKER_EVIDENCE");
});

class MemoryCreditPool {
  constructor(balance = 1000) {
    this.users = new Map([[command().ownerKey, balance]]);
    this.ledger = new Map();
    this.failReads = false;
    this.updateCount = 0;
  }

  async query(sql, params) {
    if (this.failReads) throw new Error("ledger unavailable");
    if (sql.includes("FROM credit_transactions")) {
      const row = this.ledger.get(params[0]);
      return [row ? [row] : [], []];
    }
    throw new Error(`Unexpected pool query: ${sql}`);
  }

  async getConnection() {
    const pool = this;
    return {
      async beginTransaction() {},
      async commit() {},
      async rollback() {},
      release() {},
      async query(sql, params) {
        if (sql.includes("FROM credit_transactions")) {
          const row = pool.ledger.get(params[0]);
          return [row ? [row] : [], []];
        }
        if (sql.includes("SELECT credits FROM users")) {
          const balance = pool.users.get(params[0]);
          return [balance === undefined ? [] : [{ credits: balance }], []];
        }
        if (sql.startsWith("UPDATE users SET credits")) {
          pool.users.set(params[1], params[0]);
          pool.updateCount += 1;
          return [{ affectedRows: 1 }, []];
        }
        if (sql.includes("INSERT INTO credit_transactions")) {
          const [owner, delta, reason, balanceAfter, key] = params;
          if (pool.ledger.has(key)) {
            const error = new Error("duplicate");
            error.code = "ER_DUP_ENTRY";
            throw error;
          }
          pool.ledger.set(key, { user_phone: owner, delta, reason, balance_after: balanceAfter });
          return [{ insertId: pool.ledger.size }, []];
        }
        throw new Error(`Unexpected connection query: ${sql}`);
      },
    };
  }
}

test("Credit debit is atomic and duplicate idempotency does not charge twice", async () => {
  const pool = new MemoryCreditPool();
  const credits = new MysqlDurableBimCreditAdapter(pool);
  const input = { ownerId: command().ownerKey, amountCredits: 400, idempotencyKey: `bim:v2:${command().jobUuid}:debit`, jobUuid: command().jobUuid };
  assert.equal((await credits.debit(input)).state, "committed");
  assert.equal((await credits.debit(input)).state, "committed");
  assert.equal(pool.users.get(command().ownerKey), 600);
  assert.equal(pool.updateCount, 1);
});

test("Credit adapter treats a duplicate key with a different billing identity as unknown", async () => {
  const pool = new MemoryCreditPool();
  const key = `bim:v2:${command().jobUuid}:debit`;
  pool.ledger.set(key, { user_phone: "+15555550999", delta: -400, reason: `bim_v2_debit:${command().jobUuid}`, balance_after: 600 });
  const outcome = await new MysqlDurableBimCreditAdapter(pool).debit({
    ownerId: command().ownerKey,
    amountCredits: 400,
    idempotencyKey: key,
    jobUuid: command().jobUuid,
  });
  assert.equal(outcome.state, "unknown");
  assert.equal(pool.updateCount, 0);
});

test("Refund stays unknown without a confirmed debit", async () => {
  const pool = new MemoryCreditPool();
  const outcome = await new MysqlDurableBimCreditAdapter(pool).refund({
    ownerId: command().ownerKey,
    amountCredits: 400,
    idempotencyKey: `bim:v2:${command().jobUuid}:refund`,
    jobUuid: command().jobUuid,
  });
  assert.equal(outcome.state, "unknown");
  assert.equal(pool.users.get(command().ownerKey), 1000);
});

test("Refund is committed only after its ledger row is readable and reconciliation can confirm it", async () => {
  const pool = new MemoryCreditPool();
  const credits = new MysqlDurableBimCreditAdapter(pool);
  const debitKey = `bim:v2:${command().jobUuid}:debit`;
  const refundKey = `bim:v2:${command().jobUuid}:refund`;
  assert.equal((await credits.debit({ ownerId: command().ownerKey, amountCredits: 400, idempotencyKey: debitKey, jobUuid: command().jobUuid })).state, "committed");

  const originalQuery = pool.query.bind(pool);
  let confirmationReads = 0;
  pool.query = async (sql, params) => {
    if (params[0] === refundKey) {
      confirmationReads += 1;
      if (confirmationReads >= 2) throw new Error("confirmation read unavailable");
    }
    return originalQuery(sql, params);
  };
  const first = await credits.refund({ ownerId: command().ownerKey, amountCredits: 400, idempotencyKey: refundKey, jobUuid: command().jobUuid });
  assert.equal(first.state, "unknown");
  assert.equal(pool.users.get(command().ownerKey), 1000);

  pool.query = originalQuery;
  const reconciled = await credits.reconcile({
    ownerId: command().ownerKey,
    amountCredits: 400,
    idempotencyKey: refundKey,
    jobUuid: command().jobUuid,
    eventType: "refund",
  });
  assert.equal(reconciled.state, "committed");
});
