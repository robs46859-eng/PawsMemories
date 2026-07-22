import crypto from "node:crypto";
import type mysql from "mysql2/promise";
import { BimBuildCommandSchema, hashBimContract, type BimBuildCommand } from "./contracts";
import type {
  DurableBimArtifactRegistration,
  DurableBimCreditOutcome,
  DurableBimCreditState,
  DurableBimJobRecord,
  DurableBimPostBuildRecord,
  DurableBimVerificationRecord,
} from "./durableTypes";

export interface CreateDurableBimJobInput {
  command: BimBuildCommand;
  preBuild: DurableBimVerificationRecord;
  quotedCredits: number;
  quoteEvidenceHash: string;
}

export interface ClaimedDurableBimAttempt {
  jobId: number;
  attemptId: number;
  ownerId: string;
  command: BimBuildCommand;
  leaseOwner: string;
}

export interface ReservedCreditEvent {
  eventUuid: string;
  eventType: "debit" | "refund";
  amountCredits: number;
  idempotencyKey: string;
  state: DurableBimCreditState;
}

export interface DurableBimRepositoryPort {
  getByUuid(ownerId: string, jobUuid: string): Promise<DurableBimJobRecord | null>;
  getByIdempotency(ownerId: string, idempotencyKey: string): Promise<DurableBimJobRecord | null>;
  createJob(input: CreateDurableBimJobInput): Promise<DurableBimJobRecord>;
  transitionCreditEvent(idempotencyKey: string, outcome: DurableBimCreditOutcome): Promise<void>;
  markDebitFailure(ownerId: string, jobUuid: string): Promise<void>;
  claimNext(workerId: string, leaseSeconds: number): Promise<ClaimedDurableBimAttempt | null>;
  markProcessing(claim: ClaimedDurableBimAttempt, providerTaskId: string | null): Promise<boolean>;
  setProviderTask(claim: ClaimedDurableBimAttempt, providerTaskId: string): Promise<void>;
  renewLease(claim: ClaimedDurableBimAttempt, leaseSeconds: number): Promise<boolean>;
  markValidating(claim: ClaimedDurableBimAttempt): Promise<boolean>;
  finalizeSuccess(claim: ClaimedDurableBimAttempt, postBuild: DurableBimPostBuildRecord, artifacts: DurableBimArtifactRegistration[], workerPayloadHash: string): Promise<boolean>;
  markAttemptFailed(claim: ClaimedDurableBimAttempt, failureCode: string, failureDetail: string, retryable: boolean, maxAttempts: number): Promise<"failed_retryable" | "failed_terminal" | "cancelled" | "lease_lost">;
  retry(ownerId: string, jobUuid: string, idempotencyKey: string, maxAttempts: number): Promise<DurableBimJobRecord>;
  cancel(ownerId: string, jobUuid: string): Promise<{ job: DurableBimJobRecord; providerTaskId: string | null; changed: boolean }>;
  accept(ownerId: string, jobUuid: string, outputManifestHash: string): Promise<DurableBimJobRecord>;
  reserveRefund(ownerId: string, jobUuid: string): Promise<ReservedCreditEvent | null>;
  unsettledCreditEvents(ownerId: string, jobUuid: string): Promise<ReservedCreditEvent[]>;
  recordReconciliation(ownerId: string, jobUuid: string, event: ReservedCreditEvent, outcome: DurableBimCreditOutcome): Promise<void>;
}

function parseJson<T>(value: unknown): T {
  return (typeof value === "string" ? JSON.parse(value) : value) as T;
}

function iso(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return new Date(value as string | number | Date).toISOString();
}

function isDuplicate(error: unknown): boolean {
  const candidate = error as { code?: string; errno?: number };
  return candidate?.code === "ER_DUP_ENTRY" || candidate?.errno === 1062;
}

export class DurableBimRepository implements DurableBimRepositoryPort {
  constructor(private readonly pool: mysql.Pool) {}

  async getByUuid(ownerId: string, jobUuid: string): Promise<DurableBimJobRecord | null> {
    return this.loadJob("j.owner_id = ? AND j.job_uuid = ?", [ownerId, jobUuid]);
  }

  async getByIdempotency(ownerId: string, idempotencyKey: string): Promise<DurableBimJobRecord | null> {
    return this.loadJob("j.owner_id = ? AND j.idempotency_key = ?", [ownerId, idempotencyKey]);
  }

  async createJob(input: CreateDurableBimJobInput): Promise<DurableBimJobRecord> {
    const commandHash = hashBimContract(input.command);
    const quoteKey = `bim:v2:${input.command.jobUuid}:quote`;
    const debitKey = `bim:v2:${input.command.jobUuid}:debit`;
    const conn = await this.pool.getConnection();
    let duplicate = false;
    try {
      await conn.beginTransaction();
      const [jobResult]: any = await conn.query(
        `INSERT INTO bim_build_jobs_v2
          (job_uuid, owner_id, mode, state, idempotency_key, model_hash, calibration_hash,
           proposal_hash, accepted_proposal_hash, prebuild_report_hash, quoted_credits)
         VALUES (?, ?, ?, 'queued', ?, ?, ?, ?, ?, ?, ?)`,
        [
          input.command.jobUuid,
          input.command.ownerKey,
          input.command.mode,
          input.command.idempotencyKey,
          input.command.modelHash,
          input.command.calibrationHash,
          input.command.proposalHash,
          input.command.acceptedProposalHash,
          input.command.preBuildReportHash,
          input.quotedCredits,
        ],
      );
      const jobId = Number(jobResult.insertId);
      const [attemptResult]: any = await conn.query(
        `INSERT INTO bim_build_attempts_v2
          (attempt_uuid, job_id, attempt_number, state, command_json, command_hash)
         VALUES (?, ?, 1, 'queued', ?, ?)`,
        [input.command.attemptUuid, jobId, JSON.stringify(input.command), commandHash],
      );
      const attemptId = Number(attemptResult.insertId);
      await conn.query("UPDATE bim_build_jobs_v2 SET current_attempt_id = ? WHERE id = ?", [attemptId, jobId]);
      await conn.query(
        `INSERT INTO bim_verification_reports_v2
          (attempt_id, stage, mode, report_hash, model_hash, calibration_hash, overall_pass, report_json)
         VALUES (?, 'prebuild', ?, ?, ?, ?, ?, ?)`,
        [
          attemptId,
          input.command.mode,
          input.preBuild.reportHash,
          input.preBuild.modelHash,
          input.preBuild.calibrationHash,
          input.preBuild.overallPass ? 1 : 0,
          JSON.stringify(input.preBuild.reportJson),
        ],
      );
      await conn.query(
        `INSERT INTO bim_credit_events_v2
          (event_uuid, job_id, attempt_id, owner_id, event_type, amount_credits, idempotency_key, state, evidence_hash)
         VALUES (?, ?, ?, ?, 'quote', ?, ?, 'committed', ?)`,
        [crypto.randomUUID(), jobId, attemptId, input.command.ownerKey, input.quotedCredits, quoteKey, input.quoteEvidenceHash],
      );
      await conn.query(
        `INSERT INTO bim_credit_events_v2
          (event_uuid, job_id, attempt_id, owner_id, event_type, amount_credits, idempotency_key, state, evidence_hash)
         VALUES (?, ?, ?, ?, 'debit', ?, ?, 'pending', ?)`,
        [
          crypto.randomUUID(),
          jobId,
          attemptId,
          input.command.ownerKey,
          -input.quotedCredits,
          debitKey,
          hashBimContract({ state: "pending", operation: "debit", jobUuid: input.command.jobUuid }),
        ],
      );
      await conn.commit();
    } catch (error) {
      await conn.rollback();
      if (isDuplicate(error)) duplicate = true;
      else throw error;
    } finally {
      conn.release();
    }
    if (duplicate) {
      const existing = await this.getByIdempotency(input.command.ownerKey, input.command.idempotencyKey);
      if (existing) return existing;
      throw new DurableBimRepositoryError("Concurrent BIM enqueue did not resolve to a committed job", "IDEMPOTENCY_RACE");
    }
    const created = await this.getByUuid(input.command.ownerKey, input.command.jobUuid);
    if (!created) throw new Error("Durable BIM job was not readable after creation");
    return created;
  }

  async transitionCreditEvent(idempotencyKey: string, outcome: DurableBimCreditOutcome): Promise<void> {
    await this.pool.query(
      `UPDATE bim_credit_events_v2
       SET state = ?, evidence_hash = ?
       WHERE idempotency_key = ? AND state <> 'committed'`,
      [outcome.state, outcome.evidenceHash, idempotencyKey],
    );
  }

  async markDebitFailure(ownerId: string, jobUuid: string): Promise<void> {
    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();
      const [rows]: any = await conn.query(
        "SELECT id, current_attempt_id, state FROM bim_build_jobs_v2 WHERE owner_id = ? AND job_uuid = ? FOR UPDATE",
        [ownerId, jobUuid],
      );
      const job = rows[0];
      if (job && !["accepted", "cancelled"].includes(String(job.state))) {
        await conn.query(
          "UPDATE bim_build_attempts_v2 SET state = 'failed_terminal', failure_code = 'CREDIT_DEBIT_FAILED', completed_at = NOW(3) WHERE id = ?",
          [job.current_attempt_id],
        );
        await conn.query(
          "UPDATE bim_build_jobs_v2 SET state = 'failed_terminal', failure_code = 'CREDIT_DEBIT_FAILED' WHERE id = ?",
          [job.id],
        );
      }
      await conn.commit();
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      conn.release();
    }
  }

  async claimNext(workerId: string, leaseSeconds: number): Promise<ClaimedDurableBimAttempt | null> {
    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();
      const [rows]: any = await conn.query(
        `SELECT j.id AS job_id, j.owner_id, a.id AS attempt_id, a.command_json
         FROM bim_build_jobs_v2 j
         JOIN bim_build_attempts_v2 a ON a.id = j.current_attempt_id AND a.job_id = j.id
         WHERE (
           (j.state = 'queued' AND a.state = 'queued') OR
           (j.state IN ('claimed','processing','validating') AND a.worker_lease_expiry < NOW(3))
         )
         AND EXISTS (
           SELECT 1 FROM bim_credit_events_v2 ce
           WHERE ce.job_id = j.id AND ce.event_type = 'debit' AND ce.state = 'committed'
         )
         ORDER BY j.id ASC
         LIMIT 1 FOR UPDATE SKIP LOCKED`,
      );
      if (!rows.length) {
        await conn.commit();
        return null;
      }
      const row = rows[0];
      const leaseExpiry = new Date(Date.now() + leaseSeconds * 1000);
      await conn.query(
        `UPDATE bim_build_attempts_v2
         SET state = 'claimed', worker_lease_owner = ?, worker_lease_expiry = ?, started_at = COALESCE(started_at, NOW(3))
         WHERE id = ?`,
        [workerId, leaseExpiry, row.attempt_id],
      );
      await conn.query("UPDATE bim_build_jobs_v2 SET state = 'claimed' WHERE id = ?", [row.job_id]);
      await conn.commit();
      return {
        jobId: Number(row.job_id),
        attemptId: Number(row.attempt_id),
        ownerId: String(row.owner_id),
        command: BimBuildCommandSchema.parse(parseJson(row.command_json)),
        leaseOwner: workerId,
      };
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      conn.release();
    }
  }

  async markProcessing(claim: ClaimedDurableBimAttempt, providerTaskId: string | null): Promise<boolean> {
    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();
      const [result]: any = await conn.query(
        `UPDATE bim_build_attempts_v2 a
         JOIN bim_build_jobs_v2 j ON j.id = a.job_id AND j.current_attempt_id = a.id
         SET a.state = 'processing', a.provider_task_id = ?, j.state = 'processing'
         WHERE a.id = ? AND a.worker_lease_owner = ? AND a.state = 'claimed' AND j.state <> 'cancelled'`,
        [providerTaskId, claim.attemptId, claim.leaseOwner],
      );
      await conn.commit();
      return Number(result.affectedRows) > 0;
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      conn.release();
    }
  }

  async setProviderTask(claim: ClaimedDurableBimAttempt, providerTaskId: string): Promise<void> {
    await this.pool.query(
      `UPDATE bim_build_attempts_v2 a
       JOIN bim_build_jobs_v2 j ON j.id = a.job_id AND j.current_attempt_id = a.id
       SET a.provider_task_id = ?
       WHERE a.id = ? AND a.worker_lease_owner = ? AND j.state <> 'cancelled'`,
      [providerTaskId, claim.attemptId, claim.leaseOwner],
    );
  }

  async renewLease(claim: ClaimedDurableBimAttempt, leaseSeconds: number): Promise<boolean> {
    const leaseExpiry = new Date(Date.now() + leaseSeconds * 1000);
    const [result]: any = await this.pool.query(
      `UPDATE bim_build_attempts_v2 a
       JOIN bim_build_jobs_v2 j ON j.id = a.job_id AND j.current_attempt_id = a.id
       SET a.worker_lease_expiry = ?
       WHERE a.id = ? AND a.worker_lease_owner = ?
         AND a.state IN ('claimed','processing','validating') AND j.state <> 'cancelled'`,
      [leaseExpiry, claim.attemptId, claim.leaseOwner],
    );
    return Number(result.affectedRows) > 0;
  }

  async markValidating(claim: ClaimedDurableBimAttempt): Promise<boolean> {
    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();
      const [result]: any = await conn.query(
        `UPDATE bim_build_attempts_v2 a
         JOIN bim_build_jobs_v2 j ON j.id = a.job_id AND j.current_attempt_id = a.id
         SET a.state = 'validating', j.state = 'validating'
         WHERE a.id = ? AND a.worker_lease_owner = ? AND a.state = 'processing' AND j.state <> 'cancelled'`,
        [claim.attemptId, claim.leaseOwner],
      );
      await conn.commit();
      return Number(result.affectedRows) > 0;
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      conn.release();
    }
  }

  async finalizeSuccess(
    claim: ClaimedDurableBimAttempt,
    postBuild: DurableBimPostBuildRecord,
    artifacts: DurableBimArtifactRegistration[],
    workerPayloadHash: string,
  ): Promise<boolean> {
    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();
      const [rows]: any = await conn.query(
        `SELECT j.state, j.current_attempt_id, a.worker_lease_owner, a.state AS attempt_state
         FROM bim_build_jobs_v2 j JOIN bim_build_attempts_v2 a ON a.id = j.current_attempt_id
         WHERE j.id = ? FOR UPDATE`,
        [claim.jobId],
      );
      const locked = rows[0];
      if (!locked || locked.state === "cancelled" || Number(locked.current_attempt_id) !== claim.attemptId
        || locked.worker_lease_owner !== claim.leaseOwner || locked.attempt_state !== "validating") {
        await conn.commit();
        return false;
      }
      const [reportResult]: any = await conn.query(
        `INSERT INTO bim_verification_reports_v2
          (attempt_id, stage, mode, report_hash, model_hash, calibration_hash, overall_pass, report_json)
         VALUES (?, 'postbuild', ?, ?, ?, ?, ?, ?)`,
        [
          claim.attemptId,
          claim.command.mode,
          postBuild.reportHash,
          postBuild.modelHash,
          postBuild.calibrationHash,
          postBuild.overallPass ? 1 : 0,
          JSON.stringify(postBuild.reportJson),
        ],
      );
      if (!postBuild.overallPass || !reportResult.insertId) throw new Error("A passing post-build report is required");
      for (const artifact of artifacts) {
        await conn.query(
          `INSERT INTO bim_build_artifacts_v2
            (attempt_id, role, asset_id, asset_version_id, sha256, size_bytes, mime_type)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [claim.attemptId, artifact.role, artifact.assetId, artifact.assetVersionId, artifact.sha256, artifact.sizeBytes, artifact.mimeType],
        );
      }
      await conn.query(
        `INSERT INTO bim_worker_events_v2 (event_uuid, attempt_id, event_type, payload_hash)
         VALUES (?, ?, 'result_verified', ?)`,
        [crypto.randomUUID(), claim.attemptId, workerPayloadHash],
      );
      await conn.query(
        `UPDATE bim_build_attempts_v2
         SET state = 'ready', worker_lease_owner = NULL, worker_lease_expiry = NULL, completed_at = NOW(3)
         WHERE id = ?`,
        [claim.attemptId],
      );
      await conn.query("UPDATE bim_build_jobs_v2 SET state = 'ready', failure_code = NULL WHERE id = ?", [claim.jobId]);
      await conn.commit();
      return true;
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      conn.release();
    }
  }

  async markAttemptFailed(
    claim: ClaimedDurableBimAttempt,
    failureCode: string,
    failureDetail: string,
    retryable: boolean,
    maxAttempts: number,
  ): Promise<"failed_retryable" | "failed_terminal" | "cancelled" | "lease_lost"> {
    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();
      const [rows]: any = await conn.query(
        `SELECT j.state, j.current_attempt_id, a.attempt_number, a.worker_lease_owner
         FROM bim_build_jobs_v2 j JOIN bim_build_attempts_v2 a ON a.id = j.current_attempt_id
         WHERE j.id = ? FOR UPDATE`,
        [claim.jobId],
      );
      const row = rows[0];
      if (!row || row.state === "cancelled") {
        await conn.commit();
        return "cancelled";
      }
      if (Number(row.current_attempt_id) !== claim.attemptId) throw new Error("Attempt is no longer current");
      if (row.worker_lease_owner !== claim.leaseOwner) {
        await conn.commit();
        return "lease_lost";
      }
      const state = retryable && Number(row.attempt_number) < maxAttempts ? "failed_retryable" : "failed_terminal";
      await conn.query(
        `UPDATE bim_build_attempts_v2
         SET state = ?, failure_code = ?, failure_detail = ?, worker_lease_owner = NULL,
             worker_lease_expiry = NULL, completed_at = NOW(3)
         WHERE id = ? AND worker_lease_owner = ?`,
        [state, failureCode, failureDetail.slice(0, 8000), claim.attemptId, claim.leaseOwner],
      );
      await conn.query("UPDATE bim_build_jobs_v2 SET state = ?, failure_code = ? WHERE id = ?", [state, failureCode, claim.jobId]);
      await conn.commit();
      return state;
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      conn.release();
    }
  }

  async retry(ownerId: string, jobUuid: string, idempotencyKey: string, maxAttempts: number): Promise<DurableBimJobRecord> {
    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();
      const [rows]: any = await conn.query(
        `SELECT j.*, a.command_json, a.attempt_number
         FROM bim_build_jobs_v2 j JOIN bim_build_attempts_v2 a ON a.id = j.current_attempt_id
         WHERE j.owner_id = ? AND j.job_uuid = ? FOR UPDATE`,
        [ownerId, jobUuid],
      );
      const row = rows[0];
      if (!row) throw new DurableBimRepositoryError("BIM job not found", "NOT_FOUND");
      const current = BimBuildCommandSchema.parse(parseJson(row.command_json));
      if (current.idempotencyKey === idempotencyKey && Number(row.attempt_number) > 1) {
        await conn.commit();
      } else {
        if (row.state !== "failed_retryable") throw new DurableBimRepositoryError("Job is not retryable", "INVALID_STATE");
        const nextNumber = Number(row.attempt_number) + 1;
        if (nextNumber > maxAttempts) throw new DurableBimRepositoryError("Maximum BIM attempts reached", "MAX_ATTEMPTS");
        const command = BimBuildCommandSchema.parse({
          ...current,
          attemptUuid: crypto.randomUUID(),
          idempotencyKey,
          requestedAt: new Date().toISOString(),
        });
        const [attemptResult]: any = await conn.query(
          `INSERT INTO bim_build_attempts_v2
            (attempt_uuid, job_id, attempt_number, state, command_json, command_hash)
           VALUES (?, ?, ?, 'queued', ?, ?)`,
          [command.attemptUuid, row.id, nextNumber, JSON.stringify(command), hashBimContract(command)],
        );
        await conn.query(
          `UPDATE bim_build_jobs_v2
           SET current_attempt_id = ?, state = 'queued', retry_count = retry_count + 1, failure_code = NULL
           WHERE id = ?`,
          [attemptResult.insertId, row.id],
        );
        await conn.commit();
      }
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      conn.release();
    }
    const retried = await this.getByUuid(ownerId, jobUuid);
    if (!retried) throw new Error("Retried BIM job disappeared");
    return retried;
  }

  async cancel(ownerId: string, jobUuid: string): Promise<{ job: DurableBimJobRecord; providerTaskId: string | null; changed: boolean }> {
    const conn = await this.pool.getConnection();
    let providerTaskId: string | null = null;
    let changed = false;
    try {
      await conn.beginTransaction();
      const [rows]: any = await conn.query(
        `SELECT j.id, j.state, j.current_attempt_id, a.provider_task_id
         FROM bim_build_jobs_v2 j JOIN bim_build_attempts_v2 a ON a.id = j.current_attempt_id
         WHERE j.owner_id = ? AND j.job_uuid = ? FOR UPDATE`,
        [ownerId, jobUuid],
      );
      const row = rows[0];
      if (!row) throw new DurableBimRepositoryError("BIM job not found", "NOT_FOUND");
      providerTaskId = row.provider_task_id ? String(row.provider_task_id) : null;
      if (row.state === "cancelled") {
        await conn.commit();
      } else {
        if (!["queued", "claimed", "processing", "validating", "failed_retryable"].includes(String(row.state))) {
          throw new DurableBimRepositoryError("BIM job can no longer be cancelled", "INVALID_STATE");
        }
        await conn.query(
          `UPDATE bim_build_attempts_v2
           SET state = 'cancelled', worker_lease_owner = NULL, worker_lease_expiry = NULL, completed_at = NOW(3)
           WHERE id = ?`,
          [row.current_attempt_id],
        );
        await conn.query("UPDATE bim_build_jobs_v2 SET state = 'cancelled', failure_code = NULL WHERE id = ?", [row.id]);
        changed = true;
        await conn.commit();
      }
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      conn.release();
    }
    const job = await this.getByUuid(ownerId, jobUuid);
    if (!job) throw new Error("Cancelled BIM job disappeared");
    return { job, providerTaskId, changed };
  }

  async accept(ownerId: string, jobUuid: string, outputManifestHash: string): Promise<DurableBimJobRecord> {
    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();
      const [rows]: any = await conn.query(
        `SELECT j.id, j.state, j.current_attempt_id, r.id AS report_id, r.overall_pass
         FROM bim_build_jobs_v2 j
         JOIN bim_verification_reports_v2 r ON r.attempt_id = j.current_attempt_id AND r.stage = 'postbuild'
         WHERE j.owner_id = ? AND j.job_uuid = ? FOR UPDATE`,
        [ownerId, jobUuid],
      );
      const row = rows[0];
      if (!row) throw new DurableBimRepositoryError("Ready BIM job not found", "NOT_FOUND");
      if (row.state === "accepted") {
        const [existingRows]: any = await conn.query("SELECT output_manifest_hash FROM bim_build_acceptances_v2 WHERE job_id = ?", [row.id]);
        if (existingRows[0]?.output_manifest_hash !== outputManifestHash) {
          throw new DurableBimRepositoryError("Accepted manifest hash cannot be changed", "HASH_MISMATCH");
        }
        await conn.commit();
      } else {
        if (row.state !== "ready" || !Boolean(row.overall_pass)) {
          throw new DurableBimRepositoryError("Only a verified ready BIM job can be accepted", "INVALID_STATE");
        }
        const [artifactRows]: any = await conn.query("SELECT COUNT(*) AS count FROM bim_build_artifacts_v2 WHERE attempt_id = ?", [row.current_attempt_id]);
        if (Number(artifactRows[0]?.count || 0) === 0) throw new DurableBimRepositoryError("No canonical BIM artifact is registered", "INVALID_STATE");
        await conn.query(
          `INSERT INTO bim_build_acceptances_v2
            (job_id, attempt_id, postbuild_report_id, accepted_by_user, output_manifest_hash)
           VALUES (?, ?, ?, ?, ?)`,
          [row.id, row.current_attempt_id, row.report_id, ownerId, outputManifestHash],
        );
        await conn.query("UPDATE bim_build_jobs_v2 SET state = 'accepted' WHERE id = ?", [row.id]);
        await conn.commit();
      }
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      conn.release();
    }
    const accepted = await this.getByUuid(ownerId, jobUuid);
    if (!accepted) throw new Error("Accepted BIM job disappeared");
    return accepted;
  }

  async reserveRefund(ownerId: string, jobUuid: string): Promise<ReservedCreditEvent | null> {
    const conn = await this.pool.getConnection();
    let reserved: ReservedCreditEvent | null = null;
    try {
      await conn.beginTransaction();
      const [rows]: any = await conn.query(
        `SELECT id, current_attempt_id, quoted_credits, state
         FROM bim_build_jobs_v2 WHERE owner_id = ? AND job_uuid = ? FOR UPDATE`,
        [ownerId, jobUuid],
      );
      const job = rows[0];
      if (!job) throw new DurableBimRepositoryError("BIM job not found", "NOT_FOUND");
      if (!["cancelled", "failed_terminal"].includes(String(job.state))) {
        throw new DurableBimRepositoryError("Refund is not available for this job state", "INVALID_STATE");
      }
      const [debits]: any = await conn.query(
        "SELECT id FROM bim_credit_events_v2 WHERE job_id = ? AND event_type = 'debit' AND state = 'committed' LIMIT 1",
        [job.id],
      );
      if (!debits.length) {
        await conn.commit();
        return null;
      }
      const [existingRows]: any = await conn.query(
        "SELECT event_uuid, amount_credits, idempotency_key, state FROM bim_credit_events_v2 WHERE job_id = ? AND event_type = 'refund' LIMIT 1",
        [job.id],
      );
      if (existingRows.length) {
        const existing = existingRows[0];
        reserved = {
          eventUuid: String(existing.event_uuid),
          eventType: "refund",
          amountCredits: Number(existing.amount_credits),
          idempotencyKey: String(existing.idempotency_key),
          state: existing.state as DurableBimCreditState,
        };
      } else {
        const eventUuid = crypto.randomUUID();
        const key = `bim:v2:${jobUuid}:refund`;
        await conn.query(
          `INSERT INTO bim_credit_events_v2
            (event_uuid, job_id, attempt_id, owner_id, event_type, amount_credits, idempotency_key, state, evidence_hash)
           VALUES (?, ?, ?, ?, 'refund', ?, ?, 'pending', ?)`,
          [
            eventUuid,
            job.id,
            job.current_attempt_id,
            ownerId,
            Number(job.quoted_credits),
            key,
            hashBimContract({ state: "pending", operation: "refund", jobUuid }),
          ],
        );
        reserved = { eventUuid, eventType: "refund", amountCredits: Number(job.quoted_credits), idempotencyKey: key, state: "pending" };
      }
      await conn.commit();
      return reserved;
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      conn.release();
    }
  }

  async unsettledCreditEvents(ownerId: string, jobUuid: string): Promise<ReservedCreditEvent[]> {
    const [rows]: any = await this.pool.query(
      `SELECT ce.event_uuid, ce.event_type, ce.amount_credits, ce.idempotency_key, ce.state
       FROM bim_credit_events_v2 ce JOIN bim_build_jobs_v2 j ON j.id = ce.job_id
       WHERE j.owner_id = ? AND j.job_uuid = ? AND ce.event_type IN ('debit','refund') AND ce.state <> 'committed'`,
      [ownerId, jobUuid],
    );
    return rows.map((row: any) => ({
      eventUuid: String(row.event_uuid),
      eventType: row.event_type,
      amountCredits: Math.abs(Number(row.amount_credits)),
      idempotencyKey: String(row.idempotency_key),
      state: row.state,
    }));
  }

  async recordReconciliation(
    ownerId: string,
    jobUuid: string,
    event: ReservedCreditEvent,
    outcome: DurableBimCreditOutcome,
  ): Promise<void> {
    const [jobs]: any = await this.pool.query(
      "SELECT id, current_attempt_id FROM bim_build_jobs_v2 WHERE owner_id = ? AND job_uuid = ? LIMIT 1",
      [ownerId, jobUuid],
    );
    if (!jobs.length) throw new DurableBimRepositoryError("BIM job not found", "NOT_FOUND");
    const idempotencyKey = `${event.idempotencyKey}:reconcile:${outcome.evidenceHash.slice(0, 16)}`;
    await this.pool.query(
      `INSERT INTO bim_credit_events_v2
        (event_uuid, job_id, attempt_id, owner_id, event_type, amount_credits, idempotency_key, state, evidence_hash)
       VALUES (?, ?, ?, ?, 'reconciliation', 0, ?, 'committed', ?)
       ON DUPLICATE KEY UPDATE id = id`,
      [crypto.randomUUID(), jobs[0].id, jobs[0].current_attempt_id, ownerId, idempotencyKey, outcome.evidenceHash],
    );
  }

  private async loadJob(where: string, params: unknown[]): Promise<DurableBimJobRecord | null> {
    const [rows]: any = await this.pool.query(
      `SELECT j.*, a.id AS attempt_id, a.attempt_uuid, a.attempt_number, a.state AS attempt_state,
              a.command_json, a.command_hash, a.provider_task_id, a.worker_lease_owner, a.worker_lease_expiry
       FROM bim_build_jobs_v2 j
       JOIN bim_build_attempts_v2 a ON a.id = j.current_attempt_id AND a.job_id = j.id
       WHERE ${where} LIMIT 1`,
      params,
    );
    if (!rows.length) return null;
    const row = rows[0];
    const [reports]: any = await this.pool.query(
      `SELECT r.stage, r.report_hash, r.model_hash, r.calibration_hash, r.overall_pass, r.report_json
       FROM bim_verification_reports_v2 r
       JOIN bim_build_attempts_v2 report_attempt ON report_attempt.id = r.attempt_id
       WHERE (r.stage = 'prebuild' AND report_attempt.job_id = ?)
          OR (r.stage = 'postbuild' AND r.attempt_id = ?)
       ORDER BY r.id`,
      [row.id, row.attempt_id],
    );
    const [artifacts]: any = await this.pool.query(
      `SELECT ba.role, ba.asset_id, ba.asset_version_id, ba.sha256, ba.size_bytes, ba.mime_type,
              a.asset_uuid, av.version_number
       FROM bim_build_artifacts_v2 ba
       JOIN assets a ON a.id = ba.asset_id
       JOIN asset_versions av ON av.id = ba.asset_version_id AND av.asset_id = ba.asset_id
       WHERE ba.attempt_id = ? ORDER BY ba.role`,
      [row.attempt_id],
    );
    const [credits]: any = await this.pool.query(
      `SELECT event_uuid, event_type, amount_credits, idempotency_key, state, evidence_hash
       FROM bim_credit_events_v2 WHERE job_id = ? ORDER BY id`,
      [row.id],
    );
    const [acceptances]: any = await this.pool.query(
      "SELECT output_manifest_hash, created_at FROM bim_build_acceptances_v2 WHERE job_id = ? LIMIT 1",
      [row.id],
    );
    const mapReport = (report: any): DurableBimVerificationRecord => ({
      reportHash: String(report.report_hash),
      modelHash: String(report.model_hash),
      calibrationHash: String(report.calibration_hash),
      overallPass: Boolean(report.overall_pass),
      reportJson: parseJson<Record<string, unknown>>(report.report_json),
    });
    const pre = reports.find((report: any) => report.stage === "prebuild");
    if (!pre) throw new Error(`Durable BIM job ${row.job_uuid} has no pre-build report`);
    const post = reports.find((report: any) => report.stage === "postbuild");
    return {
      id: Number(row.id),
      jobUuid: String(row.job_uuid),
      ownerId: String(row.owner_id),
      mode: row.mode,
      state: row.state,
      idempotencyKey: String(row.idempotency_key),
      modelHash: String(row.model_hash),
      calibrationHash: String(row.calibration_hash),
      proposalHash: String(row.proposal_hash),
      acceptedProposalHash: String(row.accepted_proposal_hash),
      preBuildReportHash: String(row.prebuild_report_hash),
      quotedCredits: Number(row.quoted_credits),
      retryCount: Number(row.retry_count),
      failureCode: row.failure_code ? String(row.failure_code) : null,
      currentAttempt: {
        id: Number(row.attempt_id),
        attemptUuid: String(row.attempt_uuid),
        attemptNumber: Number(row.attempt_number),
        state: row.attempt_state,
        command: BimBuildCommandSchema.parse(parseJson(row.command_json)),
        commandHash: String(row.command_hash),
        providerTaskId: row.provider_task_id ? String(row.provider_task_id) : null,
        leaseOwner: row.worker_lease_owner ? String(row.worker_lease_owner) : null,
        leaseExpiresAt: iso(row.worker_lease_expiry),
      },
      preBuildReport: mapReport(pre),
      postBuildReport: post ? mapReport(post) : null,
      artifacts: artifacts.map((artifact: any) => ({
        role: artifact.role,
        assetId: Number(artifact.asset_id),
        assetVersionId: Number(artifact.asset_version_id),
        assetUuid: String(artifact.asset_uuid),
        versionNumber: Number(artifact.version_number),
        sha256: String(artifact.sha256),
        sizeBytes: Number(artifact.size_bytes),
        mimeType: String(artifact.mime_type),
      })),
      creditEvents: credits.map((event: any) => ({
        eventUuid: String(event.event_uuid),
        eventType: event.event_type,
        amountCredits: Number(event.amount_credits),
        idempotencyKey: String(event.idempotency_key),
        state: event.state,
        evidenceHash: String(event.evidence_hash),
      })),
      acceptance: acceptances[0] ? {
        outputManifestHash: String(acceptances[0].output_manifest_hash),
        acceptedAt: iso(acceptances[0].created_at)!,
      } : null,
    };
  }
}

export class DurableBimRepositoryError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = "DurableBimRepositoryError";
  }
}
