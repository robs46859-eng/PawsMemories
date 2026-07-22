import crypto from "node:crypto";
import {
  BIM_BUILD_CONTRACT_VERSION,
  BimWorkerResultEnvelopeSchema,
  createBimBuildCommand,
  hashBimContract,
} from "./contracts";
import type {
  ClaimedDurableBimAttempt,
  DurableBimRepositoryPort,
  ReservedCreditEvent,
} from "./durableRepository";
import { DurableBimRepositoryError } from "./durableRepository";
import {
  EnqueueDurableBimRequestSchema,
  type EnqueueDurableBimRequest,
} from "./durableSchemas";
import type {
  DurableBimArtifactRegistrarPort,
  DurableBimArtifactRegistration,
  DurableBimCreditPort,
  DurableBimJobPublic,
  DurableBimJobRecord,
  DurableBimPostBuildVerifierPort,
  DurableBimVerificationRecord,
  DurableBimWorkerPort,
} from "./durableTypes";

export const DURABLE_BIM_MAX_ATTEMPTS = 3;
export const DURABLE_BIM_LEASE_SECONDS = 10 * 60;
export const DURABLE_BIM_CREDIT_POLICY = Object.freeze({ shell: 80, ifc: 400 });

export interface DurableBimServiceDependencies {
  repository: DurableBimRepositoryPort;
  worker: DurableBimWorkerPort;
  artifactRegistrar: DurableBimArtifactRegistrarPort;
  postBuildVerifier: DurableBimPostBuildVerifierPort;
  credits: DurableBimCreditPort;
  now?: () => Date;
  maxAttempts?: number;
  leaseSeconds?: number;
  pricing?: Readonly<{ shell: number; ifc: number }>;
}

export class DurableBimService {
  private readonly now: () => Date;
  private readonly maxAttempts: number;
  private readonly leaseSeconds: number;
  private readonly pricing: Readonly<{ shell: number; ifc: number }>;

  constructor(private readonly deps: DurableBimServiceDependencies) {
    this.now = deps.now || (() => new Date());
    this.maxAttempts = deps.maxAttempts || DURABLE_BIM_MAX_ATTEMPTS;
    this.leaseSeconds = deps.leaseSeconds || DURABLE_BIM_LEASE_SECONDS;
    this.pricing = deps.pricing || DURABLE_BIM_CREDIT_POLICY;
    if (this.pricing.ifc < this.pricing.shell * 4) {
      throw new DurableBimServiceError("IFC pricing must be at least four times Shell pricing", "INVALID_PRICING");
    }
  }

  async enqueue(ownerId: string, rawInput: unknown): Promise<DurableBimJobPublic> {
    const input = EnqueueDurableBimRequestSchema.parse(rawInput);
    this.assertPreBuildBinding(input);

    const existing = await this.deps.repository.getByIdempotency(ownerId, input.idempotencyKey);
    if (existing) {
      this.assertIdempotentMatch(existing, input);
      return this.toPublic(await this.settlePendingDebit(existing));
    }

    const expectedCredits = this.pricing[input.mode];
    const quote = await this.deps.credits.quote({ ownerId, mode: input.mode, expectedCredits });
    if (!Number.isSafeInteger(quote.amountCredits) || quote.amountCredits !== expectedCredits) {
      throw new DurableBimServiceError("Credit quote does not match the versioned BIM price", "QUOTE_MISMATCH");
    }
    if (!/^[a-f0-9]{64}$/i.test(quote.evidenceHash)) {
      throw new DurableBimServiceError("Credit quote evidence is invalid", "BILLING_INTEGRITY");
    }

    const command = createBimBuildCommand({
      jobUuid: crypto.randomUUID(),
      attemptUuid: crypto.randomUUID(),
      ownerKey: ownerId,
      mode: input.mode,
      idempotencyKey: input.idempotencyKey,
      modelHash: input.modelHash,
      calibrationHash: input.calibrationHash,
      proposalHash: input.proposalHash,
      acceptedProposalHash: input.acceptedProposalHash,
      preBuildReportHash: input.preBuild.reportHash,
      requestedAt: this.now().toISOString(),
    });
    const created = await this.deps.repository.createJob({
      command,
      preBuild: {
        reportHash: input.preBuild.reportHash,
        modelHash: input.preBuild.modelHash,
        calibrationHash: input.preBuild.calibrationHash,
        overallPass: input.preBuild.overallPass,
        reportJson: input.preBuild.reportJson,
      },
      quotedCredits: quote.amountCredits,
      quoteEvidenceHash: quote.evidenceHash,
    });
    this.assertIdempotentMatch(created, input);
    return this.toPublic(await this.settlePendingDebit(created));
  }

  async get(ownerId: string, jobUuid: string): Promise<DurableBimJobPublic> {
    const job = await this.requireOwned(ownerId, jobUuid);
    return this.toPublic(job);
  }

  async retry(ownerId: string, jobUuid: string, idempotencyKey: string): Promise<DurableBimJobPublic> {
    const job = await this.deps.repository.retry(ownerId, jobUuid, idempotencyKey, this.maxAttempts);
    return this.toPublic(job);
  }

  async cancel(ownerId: string, jobUuid: string): Promise<DurableBimJobPublic> {
    const cancellation = await this.deps.repository.cancel(ownerId, jobUuid);
    if (cancellation.changed && cancellation.providerTaskId && this.deps.worker.cancel) {
      await this.deps.worker.cancel(cancellation.providerTaskId).catch(() => undefined);
    }
    await this.executeRefund(ownerId, jobUuid);
    return this.toPublic(await this.requireOwned(ownerId, jobUuid));
  }

  async accept(ownerId: string, jobUuid: string, outputManifestHash: string): Promise<DurableBimJobPublic> {
    const current = await this.requireOwned(ownerId, jobUuid);
    if (current.state !== "ready" && current.state !== "accepted") {
      throw new DurableBimServiceError("BIM job is not ready for acceptance", "INVALID_STATE");
    }
    const expected = this.outputManifestHash(current);
    if (!expected || expected !== outputManifestHash) {
      throw new DurableBimServiceError("Output manifest hash does not match the verified artifacts", "HASH_MISMATCH");
    }
    return this.toPublic(await this.deps.repository.accept(ownerId, jobUuid, outputManifestHash));
  }

  async reconcileCredits(ownerId: string, jobUuid: string): Promise<DurableBimJobPublic> {
    const job = await this.requireOwned(ownerId, jobUuid);
    const events = await this.deps.repository.unsettledCreditEvents(ownerId, jobUuid);
    for (const event of events) {
      const outcome = this.assertCreditOutcome(await this.deps.credits.reconcile({
        ownerId,
        amountCredits: event.amountCredits,
        idempotencyKey: event.idempotencyKey,
        jobUuid,
        eventType: event.eventType,
      }));
      await this.deps.repository.transitionCreditEvent(event.idempotencyKey, outcome);
      await this.deps.repository.recordReconciliation(ownerId, jobUuid, event, outcome);
      if (event.eventType === "debit" && outcome.state === "committed"
        && ["failed_terminal", "cancelled"].includes(job.state)) {
        await this.executeRefund(ownerId, jobUuid);
      }
    }
    return this.toPublic(await this.requireOwned(ownerId, jobUuid));
  }

  async runNext(workerId: string): Promise<DurableBimJobPublic | null> {
    const claim = await this.deps.repository.claimNext(workerId, this.leaseSeconds);
    if (!claim) return null;
    let ownerId = claim.ownerId;
    let heartbeat: NodeJS.Timeout | null = null;
    try {
      if (!await this.deps.repository.markProcessing(claim, null)) {
        return this.toPublic(await this.requireOwned(ownerId, claim.command.jobUuid));
      }

      heartbeat = setInterval(() => {
        void this.deps.repository.renewLease(claim, this.leaseSeconds).catch(() => false);
      }, Math.max(1_000, Math.floor(this.leaseSeconds * 1_000 / 3)));
      heartbeat.unref?.();
      const execution = await this.deps.worker.build(claim.command, {
        onProviderTaskId: async (providerTaskId) => this.deps.repository.setProviderTask(claim, providerTaskId),
      });
      if (execution.providerTaskId) await this.deps.repository.setProviderTask(claim, execution.providerTaskId);
      const result = BimWorkerResultEnvelopeSchema.parse(execution.result);
      this.assertWorkerBinding(claim, result);
      if (!await this.deps.repository.markValidating(claim)) {
        return this.toPublic(await this.requireOwned(ownerId, claim.command.jobUuid));
      }

      // Worker, verifier, and storage calls are deliberately outside repository transactions.
      const postBuild = await this.deps.postBuildVerifier.verify({ command: claim.command, result });
      this.assertPostBuildBinding(claim, postBuild);
      if (!postBuild.overallPass) {
        throw new DurableBimServiceError("Post-build verification failed", "POSTBUILD_FAILED", false);
      }
      const artifacts = await this.deps.artifactRegistrar.register({ command: claim.command, result });
      this.assertArtifacts(claim, result.outputSha256, artifacts);
      const outputManifestHash = this.calculateManifestHash(
        claim.command.jobUuid,
        claim.command.attemptUuid,
        postBuild.reportHash,
        artifacts,
      );
      const finalized = await this.deps.repository.finalizeSuccess(
        claim,
        { ...postBuild, outputManifestHash },
        artifacts,
        hashBimContract(result),
      );
      if (!finalized) {
        const raced = await this.requireOwned(ownerId, claim.command.jobUuid);
        if (raced.state === "cancelled") await this.executeRefund(ownerId, raced.jobUuid);
        return this.toPublic(await this.requireOwned(ownerId, raced.jobUuid));
      }
      return this.toPublic(await this.requireOwned(ownerId, claim.command.jobUuid));
    } catch (error) {
      const normalized = this.normalizeWorkerError(error);
      const state = await this.deps.repository.markAttemptFailed(
        claim,
        normalized.code,
        normalized.message,
        normalized.retryable,
        this.maxAttempts,
      );
      if (state === "failed_terminal") await this.executeRefund(ownerId, claim.command.jobUuid);
      return this.toPublic(await this.requireOwned(ownerId, claim.command.jobUuid));
    } finally {
      if (heartbeat) clearInterval(heartbeat);
    }
  }

  private async settlePendingDebit(job: DurableBimJobRecord): Promise<DurableBimJobRecord> {
    const debit = job.creditEvents.find((event) => event.eventType === "debit");
    if (!debit) throw new DurableBimServiceError("Debit reservation is missing", "BILLING_INTEGRITY");
    if (debit.state === "committed") return job;
    if (debit.state !== "pending") return job;
    const outcome = this.assertCreditOutcome(await this.deps.credits.debit({
      ownerId: job.ownerId,
      amountCredits: job.quotedCredits,
      idempotencyKey: debit.idempotencyKey,
      jobUuid: job.jobUuid,
    }));
    await this.deps.repository.transitionCreditEvent(debit.idempotencyKey, outcome);
    if (outcome.state !== "committed") await this.deps.repository.markDebitFailure(job.ownerId, job.jobUuid);
    return this.requireOwned(job.ownerId, job.jobUuid);
  }

  private async executeRefund(ownerId: string, jobUuid: string): Promise<void> {
    const event = await this.deps.repository.reserveRefund(ownerId, jobUuid);
    if (!event || event.state === "committed") return;
    if (event.state !== "pending") return;
    const outcome = this.assertCreditOutcome(await this.deps.credits.refund({
      ownerId,
      amountCredits: event.amountCredits,
      idempotencyKey: event.idempotencyKey,
      jobUuid,
    }));
    await this.deps.repository.transitionCreditEvent(event.idempotencyKey, outcome);
  }

  private assertPreBuildBinding(input: EnqueueDurableBimRequest): void {
    if (!input.preBuild.overallPass) {
      throw new DurableBimServiceError("Pre-build verification must pass before enqueue", "PREBUILD_FAILED");
    }
    if (input.preBuild.modelHash !== input.modelHash || input.preBuild.calibrationHash !== input.calibrationHash) {
      throw new DurableBimServiceError("Pre-build hashes do not match the accepted proposal inputs", "HASH_MISMATCH");
    }
    if (input.proposalHash !== input.acceptedProposalHash || input.proposalHash !== input.modelHash) {
      throw new DurableBimServiceError("The accepted proposal must be the exact model being built", "HASH_MISMATCH");
    }
    if (hashBimContract(input.preBuild.reportJson) !== input.preBuild.reportHash) {
      throw new DurableBimServiceError("Pre-build report content does not match its hash", "HASH_MISMATCH");
    }
    const report = input.preBuild.reportJson;
    if (report.passed !== true || report.modelHash !== input.modelHash || report.calibrationHash !== input.calibrationHash
      || report.mode !== input.mode || report.stage !== "pre-build") {
      throw new DurableBimServiceError("Pre-build report claims do not bind to this build", "PREBUILD_FAILED");
    }
    if ((Array.isArray(report.errors) && report.errors.length > 0)
      || (Array.isArray(report.dimensionComparisons) && report.dimensionComparisons.some((item) => {
        return typeof item !== "object" || item === null || (item as Record<string, unknown>).passed !== true;
      }))) {
      throw new DurableBimServiceError("Pre-build report contains a failed verification rule", "PREBUILD_FAILED");
    }
  }

  private assertIdempotentMatch(job: DurableBimJobRecord, input: EnqueueDurableBimRequest): void {
    const matches = job.mode === input.mode
      && job.modelHash === input.modelHash
      && job.calibrationHash === input.calibrationHash
      && job.proposalHash === input.proposalHash
      && job.acceptedProposalHash === input.acceptedProposalHash
      && job.preBuildReportHash === input.preBuild.reportHash;
    if (!matches) throw new DurableBimServiceError("Idempotency key was already used for different BIM inputs", "IDEMPOTENCY_CONFLICT");
  }

  private assertWorkerBinding(claim: ClaimedDurableBimAttempt, result: ReturnType<typeof BimWorkerResultEnvelopeSchema.parse>): void {
    const command = claim.command;
    if (result.jobUuid !== command.jobUuid || result.attemptUuid !== command.attemptUuid
      || result.mode !== command.mode || result.preBuildReportHash !== command.preBuildReportHash
      || result.modelHash !== command.modelHash || result.calibrationHash !== command.calibrationHash) {
      throw new DurableBimServiceError("Worker result identity or input hashes do not match the claimed attempt", "WORKER_HASH_MISMATCH", false);
    }
  }

  private assertPostBuildBinding(claim: ClaimedDurableBimAttempt, report: DurableBimVerificationRecord): void {
    if (report.modelHash !== claim.command.modelHash || report.calibrationHash !== claim.command.calibrationHash) {
      throw new DurableBimServiceError("Post-build report hashes do not match the claimed attempt", "POSTBUILD_HASH_MISMATCH", false);
    }
    if (hashBimContract(report.reportJson) !== report.reportHash) {
      throw new DurableBimServiceError("Post-build report content does not match its hash", "POSTBUILD_HASH_MISMATCH", false);
    }
    if (report.reportJson.passed !== true
      || (Array.isArray(report.reportJson.errors) && report.reportJson.errors.length > 0)) {
      throw new DurableBimServiceError("Post-build report contains a failed verification rule", "POSTBUILD_FAILED", false);
    }
  }

  private assertArtifacts(
    claim: ClaimedDurableBimAttempt,
    outputSha256: string,
    artifacts: DurableBimArtifactRegistration[],
  ): void {
    const roles = artifacts.map((artifact) => artifact.role);
    if (!artifacts.length || new Set(roles).size !== roles.length) {
      throw new DurableBimServiceError("Canonical BIM artifact roles must be present and unique", "ARTIFACT_INTEGRITY", false);
    }
    const required = claim.command.mode === "shell"
      ? ["shell_glb"]
      : ["ifc", "semantic_glb", "semantic_sidecar"];
    if (!required.every((role) => roles.includes(role as DurableBimArtifactRegistration["role"]))) {
      throw new DurableBimServiceError("Canonical BIM output set is incomplete", "ARTIFACT_INTEGRITY", false);
    }
    const primaryRole = claim.command.mode === "shell" ? "shell_glb" : "ifc";
    const primary = artifacts.find((artifact) => artifact.role === primaryRole);
    if (!primary || primary.sha256 !== outputSha256) {
      throw new DurableBimServiceError("Registered primary artifact does not match the worker output hash", "ARTIFACT_HASH_MISMATCH", false);
    }
    for (const artifact of artifacts) {
      if (!Number.isSafeInteger(artifact.sizeBytes) || artifact.sizeBytes <= 0 || artifact.versionNumber <= 0
        || !/^[a-f0-9]{64}$/i.test(artifact.sha256)) {
        throw new DurableBimServiceError("Registered BIM artifact metadata is invalid", "ARTIFACT_INTEGRITY", false);
      }
    }
  }

  private calculateManifestHash(
    jobUuid: string,
    attemptUuid: string,
    postBuildReportHash: string,
    artifacts: DurableBimArtifactRegistration[],
  ): string {
    return hashBimContract({
      contractVersion: BIM_BUILD_CONTRACT_VERSION,
      jobUuid,
      attemptUuid,
      postBuildReportHash,
      artifacts: artifacts.map((artifact) => ({
        role: artifact.role,
        assetUuid: artifact.assetUuid,
        versionNumber: artifact.versionNumber,
        sha256: artifact.sha256,
        sizeBytes: artifact.sizeBytes,
        mimeType: artifact.mimeType,
      })).sort((a, b) => a.role.localeCompare(b.role)),
    });
  }

  private outputManifestHash(job: DurableBimJobRecord): string | null {
    if (!job.postBuildReport || !job.artifacts.length) return null;
    return this.calculateManifestHash(
      job.jobUuid,
      job.currentAttempt.attemptUuid,
      job.postBuildReport.reportHash,
      job.artifacts,
    );
  }

  private toPublic(job: DurableBimJobRecord): DurableBimJobPublic {
    const debit = [...job.creditEvents].reverse().find((event) => event.eventType === "debit");
    const refund = [...job.creditEvents].reverse().find((event) => event.eventType === "refund");
    return {
      jobUuid: job.jobUuid,
      mode: job.mode,
      state: job.state,
      attempt: {
        attemptUuid: job.currentAttempt.attemptUuid,
        attemptNumber: job.currentAttempt.attemptNumber,
        state: job.currentAttempt.state,
        leaseExpiresAt: job.currentAttempt.leaseExpiresAt,
      },
      hashes: {
        model: job.modelHash,
        calibration: job.calibrationHash,
        proposal: job.proposalHash,
        preBuildReport: job.preBuildReportHash,
        postBuildReport: job.postBuildReport?.reportHash || null,
        outputManifest: this.outputManifestHash(job),
      },
      verification: {
        preBuildPassed: job.preBuildReport.overallPass,
        postBuildPassed: job.postBuildReport?.overallPass ?? null,
      },
      artifacts: job.artifacts.map((artifact) => ({
        role: artifact.role,
        assetUuid: artifact.assetUuid,
        versionNumber: artifact.versionNumber,
        sha256: artifact.sha256,
        sizeBytes: artifact.sizeBytes,
        mimeType: artifact.mimeType,
      })),
      billing: {
        quotedCredits: job.quotedCredits,
        debitState: debit?.state || "not_requested",
        refundState: refund?.state || "not_requested",
        refunded: refund?.state === "committed",
      },
      retryCount: job.retryCount,
      failureCode: job.failureCode,
      acceptedAt: job.acceptance?.acceptedAt || null,
    };
  }

  private async requireOwned(ownerId: string, jobUuid: string): Promise<DurableBimJobRecord> {
    const job = await this.deps.repository.getByUuid(ownerId, jobUuid);
    if (!job) throw new DurableBimServiceError("BIM job not found", "NOT_FOUND");
    return job;
  }

  private assertCreditOutcome<T extends { state: string; evidenceHash: string }>(outcome: T): T {
    if (!new Set(["committed", "failed", "unknown"]).has(outcome.state)
      || !/^[a-f0-9]{64}$/i.test(outcome.evidenceHash)) {
      throw new DurableBimServiceError("Credit provider returned an invalid evidence envelope", "BILLING_INTEGRITY");
    }
    return outcome;
  }

  private normalizeWorkerError(error: unknown): DurableBimServiceError {
    if (error instanceof DurableBimServiceError) return error;
    if (error instanceof Error) return new DurableBimServiceError(error.message, "WORKER_FAILED", true);
    return new DurableBimServiceError("Unknown BIM worker failure", "WORKER_FAILED", true);
  }
}

export class DurableBimServiceError extends Error {
  constructor(message: string, public readonly code: string, public readonly retryable = false) {
    super(message);
    this.name = "DurableBimServiceError";
  }
}

export function normalizeDurableBimError(error: unknown): DurableBimServiceError {
  if (error instanceof DurableBimServiceError) return error;
  if (error instanceof DurableBimRepositoryError) return new DurableBimServiceError(error.message, error.code);
  return new DurableBimServiceError("Internal BIM service error", "INTERNAL_ERROR");
}
