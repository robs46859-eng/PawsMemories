import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import express from "express";
import request from "supertest";
import { signToken } from "../auth.ts";
import { hashBimContract } from "../server/bim/contracts.ts";
import { DurableBimRepositoryError } from "../server/bim/durableRepository.ts";
import { createDurableBimRouter } from "../server/bim/durableRoutes.ts";
import {
  DURABLE_BIM_CREDIT_POLICY,
  DurableBimService,
  DurableBimServiceError,
} from "../server/bim/durableService.ts";

const H = {
  model: "a".repeat(64),
  calibration: "b".repeat(64),
  output: "c".repeat(64),
};

function enqueueInput(overrides = {}) {
  const { overallPass, ...requestOverrides } = overrides;
  const mode = overrides.mode || "shell";
  const modelHash = overrides.modelHash || H.model;
  const calibrationHash = overrides.calibrationHash || H.calibration;
  const reportJson = {
    stage: "pre-build",
    mode,
    passed: true,
    modelHash,
    calibrationHash,
  };
  return {
    mode,
    idempotencyKey: overrides.idempotencyKey || "durable-enqueue-key-0001",
    modelHash,
    calibrationHash,
    proposalHash: overrides.proposalHash || modelHash,
    acceptedProposalHash: overrides.acceptedProposalHash || modelHash,
    preBuild: {
      reportHash: hashBimContract(reportJson),
      overallPass: overallPass ?? true,
      modelHash,
      calibrationHash,
      reportJson,
    },
    ...requestOverrides,
  };
}

class MemoryRepository {
  jobs = new Map();
  idempotency = new Map();

  async getByUuid(ownerId, jobUuid) {
    const job = this.jobs.get(jobUuid);
    return job?.ownerId === ownerId ? job : null;
  }

  async getByIdempotency(ownerId, key) {
    const uuid = this.idempotency.get(`${ownerId}:${key}`);
    return uuid ? this.jobs.get(uuid) : null;
  }

  async createJob(input) {
    const existing = await this.getByIdempotency(input.command.ownerKey, input.command.idempotencyKey);
    if (existing) return existing;
    const job = {
      id: this.jobs.size + 1,
      jobUuid: input.command.jobUuid,
      ownerId: input.command.ownerKey,
      mode: input.command.mode,
      state: "queued",
      idempotencyKey: input.command.idempotencyKey,
      modelHash: input.command.modelHash,
      calibrationHash: input.command.calibrationHash,
      proposalHash: input.command.proposalHash,
      acceptedProposalHash: input.command.acceptedProposalHash,
      preBuildReportHash: input.command.preBuildReportHash,
      quotedCredits: input.quotedCredits,
      retryCount: 0,
      failureCode: null,
      currentAttempt: {
        id: 1,
        attemptUuid: input.command.attemptUuid,
        attemptNumber: 1,
        state: "queued",
        command: input.command,
        commandHash: hashBimContract(input.command),
        providerTaskId: null,
        leaseOwner: null,
        leaseExpiresAt: null,
      },
      preBuildReport: input.preBuild,
      postBuildReport: null,
      artifacts: [],
      creditEvents: [
        { eventUuid: crypto.randomUUID(), eventType: "quote", amountCredits: input.quotedCredits, idempotencyKey: `bim:v2:${input.command.jobUuid}:quote`, state: "committed", evidenceHash: input.quoteEvidenceHash },
        { eventUuid: crypto.randomUUID(), eventType: "debit", amountCredits: -input.quotedCredits, idempotencyKey: `bim:v2:${input.command.jobUuid}:debit`, state: "pending", evidenceHash: "d".repeat(64) },
      ],
      acceptance: null,
    };
    this.jobs.set(job.jobUuid, job);
    this.idempotency.set(`${job.ownerId}:${job.idempotencyKey}`, job.jobUuid);
    return job;
  }

  async transitionCreditEvent(key, outcome) {
    for (const job of this.jobs.values()) {
      const event = job.creditEvents.find((candidate) => candidate.idempotencyKey === key);
      if (event && event.state !== "committed") Object.assign(event, outcome);
    }
  }

  async markDebitFailure(ownerId, jobUuid) {
    const job = await this.getByUuid(ownerId, jobUuid);
    if (job) {
      job.state = "failed_terminal";
      job.currentAttempt.state = "failed_terminal";
      job.failureCode = "CREDIT_DEBIT_FAILED";
    }
  }

  async claimNext(workerId, leaseSeconds) {
    const job = [...this.jobs.values()].find((candidate) => candidate.state === "queued"
      && candidate.creditEvents.some((event) => event.eventType === "debit" && event.state === "committed"));
    if (!job) return null;
    job.state = "claimed";
    job.currentAttempt.state = "claimed";
    job.currentAttempt.leaseOwner = workerId;
    job.currentAttempt.leaseExpiresAt = new Date(Date.now() + leaseSeconds * 1000).toISOString();
    return { jobId: job.id, attemptId: job.currentAttempt.id, ownerId: job.ownerId, command: job.currentAttempt.command, leaseOwner: workerId };
  }

  async markProcessing(claim, providerTaskId) {
    const job = this.jobs.get(claim.command.jobUuid);
    if (!job || job.state === "cancelled") return false;
    job.state = "processing";
    job.currentAttempt.state = "processing";
    job.currentAttempt.providerTaskId = providerTaskId;
    return true;
  }

  async setProviderTask(claim, providerTaskId) {
    const job = this.jobs.get(claim.command.jobUuid);
    if (job && job.state !== "cancelled") job.currentAttempt.providerTaskId = providerTaskId;
  }

  async markValidating(claim) {
    const job = this.jobs.get(claim.command.jobUuid);
    if (!job || job.state === "cancelled") return false;
    job.state = "validating";
    job.currentAttempt.state = "validating";
    return true;
  }

  async finalizeSuccess(claim, postBuild, artifacts) {
    const job = this.jobs.get(claim.command.jobUuid);
    if (!job || job.state === "cancelled") return false;
    job.postBuildReport = postBuild;
    job.artifacts = artifacts;
    job.state = "ready";
    job.currentAttempt.state = "ready";
    job.currentAttempt.leaseOwner = null;
    job.currentAttempt.leaseExpiresAt = null;
    return true;
  }

  async markAttemptFailed(claim, code, _detail, retryable, maxAttempts) {
    const job = this.jobs.get(claim.command.jobUuid);
    if (job.state === "cancelled") return "cancelled";
    const state = retryable && job.currentAttempt.attemptNumber < maxAttempts ? "failed_retryable" : "failed_terminal";
    job.state = state;
    job.currentAttempt.state = state;
    job.failureCode = code;
    return state;
  }

  async retry(ownerId, jobUuid, idempotencyKey, maxAttempts) {
    const job = await this.getByUuid(ownerId, jobUuid);
    if (!job) throw new DurableBimRepositoryError("BIM job not found", "NOT_FOUND");
    if (job.currentAttempt.attemptNumber > 1 && job.currentAttempt.command.idempotencyKey === idempotencyKey) return job;
    if (job.state !== "failed_retryable") throw new DurableBimRepositoryError("Job is not retryable", "INVALID_STATE");
    const attemptNumber = job.currentAttempt.attemptNumber + 1;
    if (attemptNumber > maxAttempts) throw new DurableBimRepositoryError("Maximum BIM attempts reached", "MAX_ATTEMPTS");
    const command = { ...job.currentAttempt.command, attemptUuid: crypto.randomUUID(), idempotencyKey, requestedAt: new Date().toISOString() };
    job.retryCount += 1;
    job.failureCode = null;
    job.state = "queued";
    job.currentAttempt = {
      id: attemptNumber,
      attemptUuid: command.attemptUuid,
      attemptNumber,
      state: "queued",
      command,
      commandHash: hashBimContract(command),
      providerTaskId: null,
      leaseOwner: null,
      leaseExpiresAt: null,
    };
    return job;
  }

  async cancel(ownerId, jobUuid) {
    const job = await this.getByUuid(ownerId, jobUuid);
    if (!job) throw new DurableBimRepositoryError("BIM job not found", "NOT_FOUND");
    const changed = job.state !== "cancelled";
    if (!["queued", "claimed", "processing", "validating", "failed_retryable", "cancelled"].includes(job.state)) {
      throw new DurableBimRepositoryError("BIM job can no longer be cancelled", "INVALID_STATE");
    }
    const providerTaskId = job.currentAttempt.providerTaskId;
    job.state = "cancelled";
    job.currentAttempt.state = "cancelled";
    return { job, providerTaskId, changed };
  }

  async accept(ownerId, jobUuid, outputManifestHash) {
    const job = await this.getByUuid(ownerId, jobUuid);
    if (!job) throw new DurableBimRepositoryError("BIM job not found", "NOT_FOUND");
    job.state = "accepted";
    job.acceptance = { outputManifestHash, acceptedAt: "2026-07-22T12:00:00.000Z" };
    return job;
  }

  async reserveRefund(ownerId, jobUuid) {
    const job = await this.getByUuid(ownerId, jobUuid);
    if (!job) throw new DurableBimRepositoryError("BIM job not found", "NOT_FOUND");
    const debit = job.creditEvents.find((event) => event.eventType === "debit" && event.state === "committed");
    if (!debit) return null;
    let refund = job.creditEvents.find((event) => event.eventType === "refund");
    if (!refund) {
      refund = { eventUuid: crypto.randomUUID(), eventType: "refund", amountCredits: job.quotedCredits, idempotencyKey: `bim:v2:${jobUuid}:refund`, state: "pending", evidenceHash: "e".repeat(64) };
      job.creditEvents.push(refund);
    }
    return refund;
  }

  async unsettledCreditEvents(ownerId, jobUuid) {
    const job = await this.getByUuid(ownerId, jobUuid);
    if (!job) throw new DurableBimRepositoryError("BIM job not found", "NOT_FOUND");
    return job.creditEvents.filter((event) => ["debit", "refund"].includes(event.eventType) && event.state !== "committed")
      .map((event) => ({ ...event, amountCredits: Math.abs(event.amountCredits) }));
  }

  async recordReconciliation(ownerId, jobUuid, event, outcome) {
    const job = await this.getByUuid(ownerId, jobUuid);
    job.creditEvents.push({ eventUuid: crypto.randomUUID(), eventType: "reconciliation", amountCredits: 0, idempotencyKey: `${event.idempotencyKey}:reconcile`, state: "committed", evidenceHash: outcome.evidenceHash });
  }
}

function serviceHarness(options = {}) {
  const repository = options.repository || new MemoryRepository();
  const calls = { quote: [], debit: [], refund: [], reconcile: [] };
  const refundOutcomes = [...(options.refundOutcomes || ["committed"])];
  const credits = {
    async quote(input) {
      calls.quote.push(input);
      return { amountCredits: input.expectedCredits, evidenceHash: "1".repeat(64) };
    },
    async debit(input) {
      calls.debit.push(input);
      return { state: options.debitState || "committed", evidenceHash: "2".repeat(64) };
    },
    async refund(input) {
      calls.refund.push(input);
      return { state: refundOutcomes.shift() || "committed", evidenceHash: "3".repeat(64) };
    },
    async reconcile(input) {
      calls.reconcile.push(input);
      return { state: options.reconcileState || "committed", evidenceHash: "4".repeat(64) };
    },
  };
  const worker = options.worker || {
    async build(command) {
      return {
        providerTaskId: "provider-task-1",
        result: {
          contractVersion: "phase9-v2.0.0",
          jobUuid: command.jobUuid,
          attemptUuid: command.attemptUuid,
          mode: command.mode,
          preBuildReportHash: command.preBuildReportHash,
          modelHash: command.modelHash,
          calibrationHash: command.calibrationHash,
          outputSha256: H.output,
          evidence: { verified: true },
        },
      };
    },
  };
  const postBuildVerifier = {
    async verify({ command }) {
      const reportJson = { stage: "post-build", passed: true, mode: command.mode, modelHash: command.modelHash, calibrationHash: command.calibrationHash };
      return { reportHash: hashBimContract(reportJson), modelHash: command.modelHash, calibrationHash: command.calibrationHash, overallPass: true, reportJson };
    },
  };
  const artifactRegistrar = {
    async register({ command }) {
      if (command.mode === "shell") return [artifact("shell_glb", H.output, 1)];
      return [artifact("ifc", H.output, 1), artifact("semantic_glb", "d".repeat(64), 2), artifact("semantic_sidecar", "e".repeat(64), 3)];
    },
  };
  const service = new DurableBimService({ repository, worker, postBuildVerifier, artifactRegistrar, credits, now: () => new Date("2026-07-22T12:00:00.000Z") });
  return { service, repository, calls, worker };
}

function artifact(role, sha256, versionNumber) {
  return {
    role,
    assetId: versionNumber,
    assetVersionId: versionNumber,
    assetUuid: `00000000-0000-4000-8000-00000000000${versionNumber}`,
    versionNumber,
    sha256,
    sizeBytes: 100 + versionNumber,
    mimeType: role === "ifc" ? "application/x-step" : role === "semantic_sidecar" ? "application/json" : "model/gltf-binary",
  };
}

test("durable BIM enqueue is owner-scoped and idempotent", async () => {
  const { service, calls } = serviceHarness();
  const input = enqueueInput();
  const first = await service.enqueue("owner-a", input);
  const second = await service.enqueue("owner-a", input);
  assert.equal(second.jobUuid, first.jobUuid);
  assert.equal(calls.debit.length, 1);
  assert.equal(first.billing.debitState, "committed");
  await assert.rejects(() => service.get("owner-b", first.jobUuid), (error) => error.code === "NOT_FOUND");
  const conflicting = enqueueInput({ idempotencyKey: input.idempotencyKey, modelHash: "f".repeat(64), proposalHash: "f".repeat(64), acceptedProposalHash: "f".repeat(64) });
  await assert.rejects(() => service.enqueue("owner-a", conflicting), (error) => error.code === "IDEMPOTENCY_CONFLICT");
});

test("durable BIM rejects unbound or failing pre-build reports before billing", async () => {
  const { service, calls } = serviceHarness();
  const failing = enqueueInput({ overallPass: false });
  await assert.rejects(() => service.enqueue("owner-a", failing), (error) => error.code === "PREBUILD_FAILED");
  const tampered = enqueueInput();
  tampered.preBuild.reportJson.passed = false;
  await assert.rejects(() => service.enqueue("owner-a", tampered), (error) => error.code === "HASH_MISMATCH");
  assert.equal(calls.quote.length, 0);
});

test("IFC jobs use the higher price and require the complete canonical artifact set", async () => {
  const { service, calls } = serviceHarness();
  const queued = await service.enqueue("owner-a", enqueueInput({ mode: "ifc", idempotencyKey: "durable-ifc-key-000001" })); // gitleaks:allow -- deterministic test label
  assert.equal(queued.billing.quotedCredits, DURABLE_BIM_CREDIT_POLICY.ifc);
  assert.equal(calls.quote[0].expectedCredits, DURABLE_BIM_CREDIT_POLICY.ifc);
  assert.ok(DURABLE_BIM_CREDIT_POLICY.ifc >= DURABLE_BIM_CREDIT_POLICY.shell * 4);
  const ready = await service.runNext("worker-a");
  assert.equal(ready.state, "ready");
  assert.deepEqual(ready.artifacts.map((item) => item.role), ["ifc", "semantic_glb", "semantic_sidecar"]);
});

test("worker identity mismatch fails terminally and commits a refund before claiming refunded", async () => {
  const worker = {
    async build(command) {
      return { result: {
        contractVersion: "phase9-v2.0.0",
        jobUuid: command.jobUuid,
        attemptUuid: command.attemptUuid,
        mode: command.mode,
        preBuildReportHash: command.preBuildReportHash,
        modelHash: "f".repeat(64),
        calibrationHash: command.calibrationHash,
        outputSha256: H.output,
        evidence: {},
      } };
    },
  };
  const { service } = serviceHarness({ worker });
  await service.enqueue("owner-a", enqueueInput());
  const failed = await service.runNext("worker-a");
  assert.equal(failed.state, "failed_terminal");
  assert.equal(failed.failureCode, "WORKER_HASH_MISMATCH");
  assert.equal(failed.billing.refundState, "committed");
  assert.equal(failed.billing.refunded, true);
});

test("retry creates a separate bounded attempt and is idempotent", async () => {
  const worker = { async build() { throw new Error("temporary provider outage"); } };
  const { service } = serviceHarness({ worker });
  const queued = await service.enqueue("owner-a", enqueueInput());
  const failed = await service.runNext("worker-a");
  assert.equal(failed.state, "failed_retryable");
  const retried = await service.retry("owner-a", queued.jobUuid, "durable-retry-key-0001");
  assert.equal(retried.attempt.attemptNumber, 2);
  assert.notEqual(retried.attempt.attemptUuid, failed.attempt.attemptUuid);
  const repeated = await service.retry("owner-a", queued.jobUuid, "durable-retry-key-0001");
  assert.equal(repeated.attempt.attemptUuid, retried.attempt.attemptUuid);
  assert.equal((await service.runNext("worker-a")).state, "failed_retryable");
  const finalAttempt = await service.retry("owner-a", queued.jobUuid, "durable-retry-key-0002");
  assert.equal(finalAttempt.attempt.attemptNumber, 3);
  const terminal = await service.runNext("worker-a");
  assert.equal(terminal.state, "failed_terminal");
  await assert.rejects(
    () => service.retry("owner-a", queued.jobUuid, "durable-retry-key-0003"),
    (error) => error.code === "INVALID_STATE" || error.code === "MAX_ATTEMPTS",
  );
});

test("ready output requires explicit hash-bound acceptance and exposes no SQL IDs", async () => {
  const { service } = serviceHarness();
  const queued = await service.enqueue("owner-a", enqueueInput());
  const ready = await service.runNext("worker-a");
  assert.equal(ready.state, "ready");
  assert.ok(ready.hashes.outputManifest);
  await assert.rejects(() => service.accept("owner-a", queued.jobUuid, "f".repeat(64)), (error) => error.code === "HASH_MISMATCH");
  const accepted = await service.accept("owner-a", queued.jobUuid, ready.hashes.outputManifest);
  assert.equal(accepted.state, "accepted");
  assert.equal(JSON.stringify(accepted).includes("assetId"), false);
  assert.equal(JSON.stringify(accepted).includes("attemptId"), false);
});

test("cancellation wins a completion race and refund truth waits for reconciliation", async () => {
  let resolveBuild;
  let buildStarted;
  const started = new Promise((resolve) => { buildStarted = resolve; });
  const worker = {
    async build(command) {
      buildStarted();
      return new Promise((resolve) => {
        resolveBuild = () => resolve({ result: {
          contractVersion: "phase9-v2.0.0",
          jobUuid: command.jobUuid,
          attemptUuid: command.attemptUuid,
          mode: command.mode,
          preBuildReportHash: command.preBuildReportHash,
          modelHash: command.modelHash,
          calibrationHash: command.calibrationHash,
          outputSha256: H.output,
          evidence: {},
        } });
      });
    },
  };
  const { service } = serviceHarness({ worker, refundOutcomes: ["unknown"], reconcileState: "committed" });
  const queued = await service.enqueue("owner-a", enqueueInput());
  const running = service.runNext("worker-a");
  await started;
  const cancelled = await service.cancel("owner-a", queued.jobUuid);
  assert.equal(cancelled.state, "cancelled");
  assert.equal(cancelled.billing.refundState, "unknown");
  assert.equal(cancelled.billing.refunded, false);
  resolveBuild();
  const raced = await running;
  assert.equal(raced.state, "cancelled");
  const reconciled = await service.reconcileCredits("owner-a", queued.jobUuid);
  assert.equal(reconciled.billing.refundState, "committed");
  assert.equal(reconciled.billing.refunded, true);
});

test("durable BIM router authenticates first, defaults disabled, and rejects unknown fields", async () => {
  process.env.JWT_SECRET = "durable-bim-test-secret";
  delete process.env.BIM_V2_ENABLED;
  const stub = {
    enqueue: async () => ({ ok: true }),
    get: async () => ({ ok: true }),
    retry: async () => ({ ok: true }),
    cancel: async () => ({ ok: true }),
    accept: async () => ({ ok: true }),
    reconcileCredits: async () => ({ ok: true }),
  };
  const disabled = express().use(express.json()).use("/api/bim-v2", createDurableBimRouter({ service: stub }));
  await request(disabled).get("/api/bim-v2/jobs/00000000-0000-4000-8000-000000000001").expect(401);
  const token = signToken({ phone: "owner-a", uid: 1 });
  await request(disabled).get("/api/bim-v2/jobs/00000000-0000-4000-8000-000000000001").set("Authorization", `Bearer ${token}`).expect(503);

  const enabled = express().use(express.json()).use("/api/bim-v2", createDurableBimRouter({ service: stub, enabled: true }));
  await request(enabled)
    .post("/api/bim-v2/jobs/00000000-0000-4000-8000-000000000001/cancel")
    .set("Authorization", `Bearer ${token}`)
    .send({ unexpected: true })
    .expect(400);
});
