import crypto from "node:crypto";
import { v4 as uuidv4 } from "uuid";
import type mysql from "mysql2/promise";
import { getPool } from "../../db";
import { deductCredits, addCredits, getCreditBalance } from "../../db";
import { CREDIT_PRICES } from "../../src/pricing";
import { registerAsset, addLineage } from "../assets/service";
import { findAssetById, findVersionById } from "../assets/repository";
import { generateSignedUrlForVersion } from "../assets/access";
import {
  findSessionByUuid as findRefSession,
  findApprovalBySessionId as findRefApproval,
  findAttemptById as findRefAttempt,
  findViewsByAttemptId as findRefViews,
  findReportByAttemptId as findRefReport,
} from "../reference-sessions/repository";
import {
  insertJob,
  findJobByUuid,
  findJobByUuidForUpdate,
  findJobsByOwner,
  findJobBySessionAndOwner,
  updateJobState,
  insertAttempt,
  findAttemptById,
  findAttemptsByJobId,
  findAttemptByIdempotencyKey,
  updateAttemptState,
  claimLease,
  insertProviderEvent,
  computeEventHash,
  insertArtifact,
  findArtifactsByAttemptId,
  findArtifactByAttemptAndRole,
  insertReport,
  findReportByAttemptId,
  insertAcceptance,
  findAcceptanceByJobId,
} from "./repository";
import { storeProviderGlb, storeValidatedGlb, storeReport as storeReportJson, cleanupPrivateObject } from "./storage";
import { validateGlb, VALIDATOR_VERSION } from "./validation";
import type { ModelBuildProvider, ModelBuildProviderInput } from "./provider";
import { assertModelBuildV3Enabled } from "./featureFlag";
import {
  TERMINAL_JOB_STATES,
  MAX_BUILD_CORRECTION_ATTEMPTS,
  DEFAULT_LEASE_DURATION_MS,
  type BuildJobRecord,
  type BuildJobState,
  type BuildJobPublic,
  type BuildAttemptPublic,
  type BuildArtifactPublic,
  type PostBuildReportPublic,
  type BuildQuotePublic,
  type PreflightResult,
} from "./types";
import type { StartBuildInput, RetryBuildInput, AcceptBuildInput } from "./schemas";

export class ModelBuildServiceError extends Error {
  constructor(message: string, public code: string = "MODEL_BUILD_ERROR") {
    super(message);
    this.name = "ModelBuildServiceError";
  }
}

// ─── Service ────────────────────────────────────────────────────────────────

export class ModelBuildService {
  constructor(
    private provider: ModelBuildProvider,
    private getPoolFn: () => mysql.Pool = getPool,
  ) {}

  // ── Preflight & Quote ───────────────────────────────────────────────────

  async preflight(ownerId: string, sessionUuid: string): Promise<PreflightResult> {
    assertModelBuildV3Enabled();
    const pool = this.getPoolFn();
    const errors: string[] = [];

    // 1. Load reference session
    const session = await findRefSession(pool, sessionUuid);
    if (!session) {
      return { passed: false, errors: ["Reference session not found"], sessionId: 0, attemptId: 0, manifestAssetId: 0, manifestAssetVersionId: 0, manifestHash: "", quotedCredits: 0, pricingKey: "", currentBalance: 0 };
    }

    // 2. Verify ownership
    if (session.owner_id !== ownerId) {
      return { passed: false, errors: ["Not authorized for this reference session"], sessionId: 0, attemptId: 0, manifestAssetId: 0, manifestAssetVersionId: 0, manifestHash: "", quotedCredits: 0, pricingKey: "", currentBalance: 0 };
    }

    // 3. Check approval exists
    if (session.state !== "approved") {
      errors.push(`Reference session state is '${session.state}', not 'approved'`);
    }

    const approval = await findRefApproval(pool, session.id);
    if (!approval) {
      errors.push("No approval found for this reference session");
      return { passed: false, errors, sessionId: session.id, attemptId: 0, manifestAssetId: 0, manifestAssetVersionId: 0, manifestHash: "", quotedCredits: 0, pricingKey: "", currentBalance: 0 };
    }

    // 4. Verify approved attempt
    const attempt = await findRefAttempt(pool, approval.attempt_id);
    if (!attempt) {
      errors.push("Approved attempt not found");
      return { passed: false, errors, sessionId: session.id, attemptId: 0, manifestAssetId: 0, manifestAssetVersionId: 0, manifestHash: "", quotedCredits: 0, pricingKey: "", currentBalance: 0 };
    }

    // 5. Verify manifest asset exists with versions
    if (!approval.manifest_asset_id || !approval.manifest_asset_version_id) {
      errors.push("Manifest asset not registered in approval");
    } else {
      const manifestAsset = await findAssetById(pool, approval.manifest_asset_id);
      if (!manifestAsset) errors.push("Manifest asset not found in canonical registry");
      const manifestVersion = await findVersionById(pool, approval.manifest_asset_version_id);
      if (!manifestVersion) errors.push("Manifest asset version not found");
    }

    // 6. Verify five canonical views
    const views = await findRefViews(pool, attempt.id);
    const requiredKinds = ["front", "left", "right", "rear", "front_three_quarter"];
    for (const kind of requiredKinds) {
      const view = views.find(v => v.view_kind === kind);
      if (!view) {
        errors.push(`Missing required view: ${kind}`);
      } else {
        // Verify asset/version exists
        const asset = await findAssetById(pool, view.asset_id);
        if (!asset) errors.push(`View ${kind}: asset not found`);
        const version = await findVersionById(pool, view.asset_version_id);
        if (!version) errors.push(`View ${kind}: version not found`);
      }
    }

    // 7. Verify report
    const report = await findRefReport(pool, attempt.id);
    if (!report) {
      errors.push("Reference report not found for approved attempt");
    } else if (report.status === "fail") {
      errors.push("Reference report has status 'fail'");
    }

    // 8. Pricing
    const pricingKey = "STATIC_3D_PHOTO";
    const quotedCredits = CREDIT_PRICES.STATIC_3D_PHOTO;

    // 9. Balance check
    const [userRows]: any = await pool.query("SELECT credits FROM users WHERE phone = ?", [ownerId]);
    const currentBalance = userRows[0] ? Number(userRows[0].credits || 0) : 0;
    if (currentBalance < quotedCredits) {
      errors.push(`Insufficient credit balance: ${currentBalance} < ${quotedCredits}`);
    }

    return {
      passed: errors.length === 0,
      errors,
      sessionId: session.id,
      attemptId: attempt.id,
      manifestAssetId: approval.manifest_asset_id || 0,
      manifestAssetVersionId: approval.manifest_asset_version_id || 0,
      manifestHash: approval.manifest_hash,
      quotedCredits,
      pricingKey,
      currentBalance,
    };
  }

  async getQuote(ownerId: string, sessionUuid: string): Promise<BuildQuotePublic> {
    const pf = await this.preflight(ownerId, sessionUuid);
    return {
      referenceSessionUuid: sessionUuid,
      manifestHashPrefix: pf.manifestHash.slice(0, 12),
      pricingKey: pf.pricingKey,
      quotedCredits: pf.quotedCredits,
      currentBalance: pf.currentBalance,
      sufficientBalance: pf.currentBalance >= pf.quotedCredits,
      preflightPassed: pf.passed,
      preflightErrors: pf.errors,
    };
  }

  // ── Start Build ─────────────────────────────────────────────────────────

  async startBuild(ownerId: string, input: StartBuildInput): Promise<BuildJobPublic> {
    assertModelBuildV3Enabled();
    const pool = this.getPoolFn();

    // 1. Run preflight
    const pf = await this.preflight(ownerId, input.referenceSessionUuid);
    if (!pf.passed) {
      throw new ModelBuildServiceError(
        `Preflight failed: ${pf.errors.join("; ")}`,
        "PREFLIGHT_FAILED",
      );
    }

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      // 2. Check idempotency — duplicate start returns existing job
      const existingAttempt = await findAttemptByIdempotencyKey(connection, input.idempotencyKey);
      if (existingAttempt) {
        const existingJob = await findJobByUuid(connection, "");
        // Find the job by the attempt's job_id
        const [rows] = await connection.query(
          "SELECT job_uuid FROM model_build_jobs WHERE id = ?",
          [existingAttempt.job_id],
        ) as any;
        await connection.commit();
        if (rows[0]) {
          return this.getJobPublic(ownerId, rows[0].job_uuid);
        }
      }

      // 3. Check for existing active job on this session
      const existingJob = await findJobBySessionAndOwner(connection, pf.sessionId, ownerId);
      if (existingJob && !TERMINAL_JOB_STATES.includes(existingJob.state as any)) {
        await connection.commit();
        return this.formatJobPublic(existingJob);
      }

      // 4. Create job
      const jobUuid = uuidv4();
      const creditCorrelationId = `model_build:${jobUuid}`;

      const job = await insertJob(connection, {
        jobUuid,
        ownerId,
        referenceSessionId: pf.sessionId,
        referenceAttemptId: pf.attemptId,
        manifestAssetId: pf.manifestAssetId,
        manifestAssetVersionId: pf.manifestAssetVersionId,
        manifestHash: pf.manifestHash,
        requestedOutput: input.requestedOutput || "glb",
        pricingKey: pf.pricingKey,
        quotedCredits: pf.quotedCredits,
        state: "reserving",
      });

      // 5. Debit credits — idempotent via correlation ID check
      const alreadyCharged = await this.hasCorrelation(pool, ownerId, creditCorrelationId);
      if (!alreadyCharged) {
        const debited = await this.deductCredits(connection, pool, ownerId, pf.quotedCredits, creditCorrelationId);
        if (!debited) {
          await updateJobState(connection, job.id, "failed_preflight", {
            failureCode: "INSUFFICIENT_CREDITS",
          });
          await connection.commit();
          throw new ModelBuildServiceError("Insufficient credits", "INSUFFICIENT_CREDITS");
        }
      }

      await updateJobState(connection, job.id, "queued", {
        creditCorrelationId,
      });

      // 6. Create first attempt
      const inputConfigHash = crypto.createHash("sha256")
        .update(`${pf.manifestHash}:${input.requestedOutput || "glb"}`)
        .digest("hex");

      const attempt = await insertAttempt(connection, {
        jobId: job.id,
        attemptNumber: 1,
        idempotencyKey: input.idempotencyKey,
        provider: "tripo",
        model: process.env.TRIPO_MODEL_VERSION || "default",
        inputConfigHash,
      });

      await updateJobState(connection, job.id, "queued", {
        currentAttemptId: attempt.id,
      });

      await connection.commit();

      // 7. Launch background processing (fire and forget)
      this.processAttempt(ownerId, jobUuid, attempt.id).catch((err) => {
        console.error(`[model-build] Background processing error for job ${jobUuid}:`, err.message);
      });

      const updatedJob = await findJobByUuid(pool, jobUuid);
      return this.formatJobPublic(updatedJob!);
    } catch (err: any) {
      await connection.rollback();
      if (err instanceof ModelBuildServiceError) throw err;
      throw new ModelBuildServiceError(`Build start failed: ${err.message}`, "START_FAILED");
    } finally {
      connection.release();
    }
  }

  // ── Background Processing ─────────────────────────────────────────────

  async processAttempt(ownerId: string, jobUuid: string, attemptId: number): Promise<void> {
    const pool = this.getPoolFn();
    const leaseOwner = `worker-${process.pid}-${Date.now()}`;

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      // Claim lease
      const leaseExpiry = new Date(Date.now() + DEFAULT_LEASE_DURATION_MS);
      const claimed = await claimLease(connection, attemptId, leaseOwner, leaseExpiry);
      if (!claimed) {
        await connection.commit();
        return; // Another worker holds this
      }

      const job = await findJobByUuidForUpdate(connection, jobUuid);
      if (!job || TERMINAL_JOB_STATES.includes(job.state as any)) {
        await connection.commit();
        return;
      }

      const attempt = await findAttemptById(connection, attemptId);
      if (!attempt || attempt.state !== "queued") {
        await connection.commit();
        return;
      }

      // Submit to provider
      await updateJobState(connection, job.id, "submitted");
      await updateAttemptState(connection, attemptId, "submitted");
      await connection.commit();

      // Get signed URLs for the reference views
      const views = await findRefViews(pool, job.reference_attempt_id);
      const viewUrls: ModelBuildProviderInput = {
        frontUrl: "",
        leftUrl: "",
        rightUrl: "",
        rearUrl: "",
        threeQuarterUrl: "",
      };

      for (const view of views) {
        const asset = await findAssetById(pool, view.asset_id);
        const version = await findVersionById(pool, view.asset_version_id);
        if (!asset || !version) continue;
        const url = await generateSignedUrlForVersion(asset, version, ownerId, true);
        if (!url) continue;
        switch (view.view_kind) {
          case "front": viewUrls.frontUrl = url; break;
          case "left": viewUrls.leftUrl = url; break;
          case "right": viewUrls.rightUrl = url; break;
          case "rear": viewUrls.rearUrl = url; break;
          case "front_three_quarter": viewUrls.threeQuarterUrl = url; break;
        }
      }

      let providerResult;
      try {
        providerResult = await this.provider.start(viewUrls, attempt.input_config_hash);
      } catch (err: any) {
        await this.failJob(jobUuid, attemptId, "PROVIDER_START_FAILED", err.message);
        return;
      }

      // Persist provider handle before polling
      const conn2 = await pool.getConnection();
      try {
        await conn2.beginTransaction();
        await updateAttemptState(conn2, attemptId, "submitted", {
          providerTaskHandle: providerResult.providerTaskHandle,
        });
        await conn2.commit();
      } finally {
        conn2.release();
      }

      // Record task_created event
      const eventHash = computeEventHash(
        providerResult.provider, attemptId, "task_created",
        providerResult.providerTaskHandle,
      );
      const conn3 = await pool.getConnection();
      try {
        await conn3.beginTransaction();
        await insertProviderEvent(conn3, {
          provider: providerResult.provider,
          eventHash,
          attemptId,
          eventType: "task_created",
        });
        await updateJobState(conn3, job.id, "processing");
        await updateAttemptState(conn3, attemptId, "processing");
        await conn3.commit();
      } finally {
        conn3.release();
      }

      // Poll until done
      let pollResult;
      const maxPolls = 120;
      for (let i = 0; i < maxPolls; i++) {
        await new Promise(r => setTimeout(r, 500));
        try {
          pollResult = await this.provider.poll(providerResult.providerTaskHandle);
        } catch (err: any) {
          console.error(`[model-build] Poll error:`, err.message);
          continue;
        }
        if (pollResult.done) break;
      }

      if (!pollResult?.done) {
        await this.failJob(jobUuid, attemptId, "PROVIDER_TIMEOUT", "Provider timed out");
        return;
      }

      if (pollResult.error || !pollResult.glbUrl) {
        await this.failJob(jobUuid, attemptId, "PROVIDER_FAILED", pollResult.error || "No GLB URL");
        return;
      }

      // Download GLB
      const conn4 = await pool.getConnection();
      try {
        await conn4.beginTransaction();
        await updateJobState(conn4, job.id, "downloading");
        await updateAttemptState(conn4, attemptId, "downloading");
        await conn4.commit();
      } finally {
        conn4.release();
      }

      let glbBuffer: Buffer;
      try {
        glbBuffer = await this.provider.download(pollResult.glbUrl);
      } catch (err: any) {
        await this.failJob(jobUuid, attemptId, "DOWNLOAD_FAILED", err.message);
        return;
      }

      // Store provider GLB
      let providerGlbStored;
      try {
        providerGlbStored = await storeProviderGlb(ownerId, jobUuid, attempt.attempt_number, glbBuffer);
      } catch (err: any) {
        console.error(`[model-build] storeProviderGlb failed for ${jobUuid}:`, err);
        await this.failJob(jobUuid, attemptId, "STORAGE_FAILED", err?.message || String(err));
        return;
      }

      // Register provider GLB as canonical asset
      let providerGlbAsset;
      try {
        providerGlbAsset = await registerAsset({
          ownerId,
          assetType: "model_glb",
          visibility: "private",
          mimeType: "model/gltf-binary",
          sizeBytes: providerGlbStored.sizeBytes,
          sha256: providerGlbStored.sha256,
          bucket: "private",
          objectKey: providerGlbStored.objectKey,
          sourceProvider: "tripo",
          license: "proprietary",
          commercialUseEligible: false,
          metadata: { phase: 3, role: "provider_glb", jobUuid },
        }, { authorization: { internal: true }, pool });
      } catch (err: any) {
        await cleanupPrivateObject(providerGlbStored.objectKey);
        await this.failJob(jobUuid, attemptId, "ASSET_REGISTRATION_FAILED", err.message);
        return;
      }

      // Record provider GLB artifact
      const conn5 = await pool.getConnection();
      try {
        await conn5.beginTransaction();
        await insertArtifact(conn5, {
          attemptId,
          assetId: providerGlbAsset.asset.id,
          assetVersionId: providerGlbAsset.version.id,
          role: "provider_glb",
          computedHash: providerGlbStored.sha256,
          sizeBytes: providerGlbStored.sizeBytes,
          mimeType: "model/gltf-binary",
        });
        await conn5.commit();
      } finally {
        conn5.release();
      }

      // Validate GLB
      const conn6 = await pool.getConnection();
      try {
        await conn6.beginTransaction();
        await updateJobState(conn6, job.id, "validating");
        await updateAttemptState(conn6, attemptId, "validating");
        await conn6.commit();
      } finally {
        conn6.release();
      }

      const validationResult = await validateGlb(glbBuffer);

      // Store validated GLB (same bytes if pass/warn, still quarantined privately)
      let validatedGlbStored;
      try {
        validatedGlbStored = await storeValidatedGlb(ownerId, jobUuid, attempt.attempt_number, glbBuffer);
      } catch (err: any) {
        await this.failJob(jobUuid, attemptId, "STORAGE_FAILED", err.message);
        return;
      }

      // Register validated GLB
      let validatedGlbAsset;
      try {
        validatedGlbAsset = await registerAsset({
          ownerId,
          assetType: "model_glb",
          visibility: "private",
          mimeType: "model/gltf-binary",
          sizeBytes: validatedGlbStored.sizeBytes,
          sha256: validatedGlbStored.sha256,
          bucket: "private",
          objectKey: validatedGlbStored.objectKey,
          sourceProvider: "tripo",
          license: "proprietary",
          commercialUseEligible: false,
          metadata: {
            phase: 3,
            role: "validated_glb",
            jobUuid,
            validationStatus: validationResult.status,
            validatorVersion: VALIDATOR_VERSION,
          },
        }, { authorization: { internal: true }, pool });
      } catch (err: any) {
        await cleanupPrivateObject(validatedGlbStored.objectKey);
        await this.failJob(jobUuid, attemptId, "ASSET_REGISTRATION_FAILED", err.message);
        return;
      }

      // Add lineage: manifest → provider GLB → validated GLB
      try {
        await addLineage({
          parentAssetUuid: (await findAssetById(pool, job.manifest_asset_id))!.asset_uuid,
          parentVersionNumber: 1,
          childAssetUuid: providerGlbAsset.asset.asset_uuid,
          childVersionNumber: 1,
          relationType: "mesh",
        }, { internal: true }, pool);

        await addLineage({
          parentAssetUuid: providerGlbAsset.asset.asset_uuid,
          parentVersionNumber: 1,
          childAssetUuid: validatedGlbAsset.asset.asset_uuid,
          childVersionNumber: 1,
          relationType: "derivative",
        }, { internal: true }, pool);
      } catch (err: any) {
        console.warn("[model-build] Lineage recording failed (non-fatal):", err.message);
      }

      // Store report
      const reportJson = {
        validatorVersion: VALIDATOR_VERSION,
        status: validationResult.status,
        metrics: validationResult.metrics,
        metricsHash: validationResult.metricsHash,
        providerGlbHash: providerGlbStored.sha256,
        validatedGlbHash: validatedGlbStored.sha256,
        jobUuid,
        attemptNumber: attempt.attempt_number,
      };

      let reportStored;
      try {
        reportStored = await storeReportJson(ownerId, jobUuid, attempt.attempt_number, reportJson);
      } catch (err: any) {
        await this.failJob(jobUuid, attemptId, "STORAGE_FAILED", err.message);
        return;
      }

      // Register report asset
      let reportAsset;
      try {
        reportAsset = await registerAsset({
          ownerId,
          assetType: "validation_report",
          visibility: "private",
          mimeType: "application/json",
          sizeBytes: reportStored.sizeBytes,
          sha256: reportStored.sha256,
          bucket: "private",
          objectKey: reportStored.objectKey,
          sourceProvider: "pawsome3d",
          license: "proprietary",
          commercialUseEligible: false,
          metadata: { phase: 3, role: "post_build_report", jobUuid },
        }, { authorization: { internal: true }, pool });
      } catch (err: any) {
        await cleanupPrivateObject(reportStored.objectKey);
        await this.failJob(jobUuid, attemptId, "ASSET_REGISTRATION_FAILED", err.message);
        return;
      }

      // Record validated GLB artifact + report
      const conn7 = await pool.getConnection();
      try {
        await conn7.beginTransaction();

        await insertArtifact(conn7, {
          attemptId,
          assetId: validatedGlbAsset.asset.id,
          assetVersionId: validatedGlbAsset.version.id,
          role: "validated_glb",
          computedHash: validatedGlbStored.sha256,
          sizeBytes: validatedGlbStored.sizeBytes,
          mimeType: "model/gltf-binary",
        });

        await insertReport(conn7, {
          attemptId,
          reportAssetId: reportAsset.asset.id,
          reportAssetVersionId: reportAsset.version.id,
          status: validationResult.status,
          validatorVersions: VALIDATOR_VERSION,
          metricsHash: validationResult.metricsHash,
          metricsJson: validationResult.metrics as any,
        });

        if (validationResult.status === "fail") {
          console.error(`[model-build] Validation failed for ${jobUuid}:`, validationResult.metrics.errors);
          await updateAttemptState(conn7, attemptId, "failed", {
            failureCode: "VALIDATION_FAILED",
            errorMessage: (validationResult.metrics.errors || []).join("; ").slice(0, 500),
            completedAt: new Date(),
          });
          await updateJobState(conn7, job.id, "failed_validation", {
            failureCode: "VALIDATION_FAILED",
          });
          await conn7.commit();

          // Refund
          await this.refundJob(jobUuid);
          return;
        }

        await updateAttemptState(conn7, attemptId, "ready", {
          completedAt: new Date(),
        });
        await updateJobState(conn7, job.id, "ready");
        await conn7.commit();
      } finally {
        conn7.release();
      }
    } catch (err: any) {
      console.error(`[model-build] Unhandled error in processAttempt for ${jobUuid}:`, err.message);
      await this.failJob(jobUuid, attemptId, "INTERNAL_ERROR", err.message).catch(() => {});
    } finally {
      connection.release();
    }
  }

  // ── Fail Job ──────────────────────────────────────────────────────────

  private async failJob(
    jobUuid: string,
    attemptId: number,
    failureCode: string,
    message: string,
  ): Promise<void> {
    const pool = this.getPoolFn();
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const job = await findJobByUuidForUpdate(conn, jobUuid);
      if (!job || TERMINAL_JOB_STATES.includes(job.state as any)) {
        await conn.commit();
        return;
      }

      const isProvider = failureCode.startsWith("PROVIDER_") || failureCode === "DOWNLOAD_FAILED";
      const jobState: BuildJobState = isProvider ? "failed_provider" : "failed_validation";

      await updateAttemptState(conn, attemptId, "failed", {
        failureCode,
        errorMessage: message.slice(0, 500),
        completedAt: new Date(),
      });
      await updateJobState(conn, job.id, jobState, { failureCode });
      await conn.commit();

      // Refund if credits were charged
      if (job.credit_correlation_id && !job.refund_correlation_id) {
        await this.refundJob(jobUuid);
      }
    } catch (err: any) {
      await conn.rollback();
      console.error("[model-build] failJob error:", err.message);
    } finally {
      conn.release();
    }
  }

  // ── Refund ────────────────────────────────────────────────────────────

  private async refundJob(jobUuid: string): Promise<void> {
    const pool = this.getPoolFn();
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const job = await findJobByUuidForUpdate(conn, jobUuid);
      if (!job || job.refund_correlation_id) {
        await conn.commit();
        return; // Already refunded or no job
      }

      const refundCorrelationId = `model_build_refund:${jobUuid}`;
      const alreadyRefunded = await this.hasCorrelation(pool, job.owner_id, refundCorrelationId);
      if (alreadyRefunded) {
        await updateJobState(conn, job.id, job.state, { refundCorrelationId });
        await conn.commit();
        return;
      }

      await this.addCredits(pool, job.owner_id, job.quoted_credits, refundCorrelationId);
      await updateJobState(conn, job.id, job.state, { refundCorrelationId });
      await conn.commit();
    } catch (err: any) {
      await conn.rollback();
      console.error("[model-build] refundJob error:", err.message);
    } finally {
      conn.release();
    }
  }

  // ── Retry / Correction ────────────────────────────────────────────────

  async retryBuild(ownerId: string, jobUuid: string, input: RetryBuildInput): Promise<BuildJobPublic> {
    assertModelBuildV3Enabled();
    const pool = this.getPoolFn();
    const conn = await pool.getConnection();

    try {
      await conn.beginTransaction();
      const job = await findJobByUuidForUpdate(conn, jobUuid);
      if (!job) throw new ModelBuildServiceError("Job not found", "NOT_FOUND");
      if (job.owner_id !== ownerId) throw new ModelBuildServiceError("Not authorized", "FORBIDDEN");
      if (job.state !== "failed_validation" && job.state !== "failed_provider") {
        throw new ModelBuildServiceError(`Cannot retry job in state '${job.state}'`, "INVALID_STATE");
      }

      // Check idempotency
      const existing = await findAttemptByIdempotencyKey(conn, input.idempotencyKey);
      if (existing) {
        await conn.commit();
        return this.getJobPublic(ownerId, jobUuid);
      }

      // Check correction limit
      const attempts = await findAttemptsByJobId(conn, job.id);
      if (attempts.length >= MAX_BUILD_CORRECTION_ATTEMPTS) {
        throw new ModelBuildServiceError(
          `Maximum correction attempts (${MAX_BUILD_CORRECTION_ATTEMPTS}) reached`,
          "MAX_RETRIES_EXCEEDED",
        );
      }

      const nextNumber = attempts.length + 1;
      const inputConfigHash = crypto.createHash("sha256")
        .update(`${job.manifest_hash}:${job.requested_output}:${nextNumber}:${input.correctionNotes || ""}`)
        .digest("hex");

      const attempt = await insertAttempt(conn, {
        jobId: job.id,
        attemptNumber: nextNumber,
        idempotencyKey: input.idempotencyKey,
        provider: "tripo",
        model: process.env.TRIPO_MODEL_VERSION || "default",
        inputConfigHash,
      });

      // Re-charge credits for retry
      const creditCorrelationId = `model_build:${jobUuid}:retry:${nextNumber}`;
      const alreadyCharged = await this.hasCorrelation(pool, ownerId, creditCorrelationId);
      if (!alreadyCharged) {
        const debited = await this.deductCredits(conn, pool, ownerId, job.quoted_credits, creditCorrelationId);
        if (!debited) {
          throw new ModelBuildServiceError("Insufficient credits for retry", "INSUFFICIENT_CREDITS");
        }
      }

      await updateJobState(conn, job.id, "queued", {
        currentAttemptId: attempt.id,
        creditCorrelationId,
        failureCode: null as any,
      });

      await conn.commit();

      // Launch background processing
      this.processAttempt(ownerId, jobUuid, attempt.id).catch((err) => {
        console.error(`[model-build] Retry processing error for job ${jobUuid}:`, err.message);
      });

      const updatedJob = await findJobByUuid(pool, jobUuid);
      return this.formatJobPublic(updatedJob!);
    } catch (err: any) {
      await conn.rollback();
      if (err instanceof ModelBuildServiceError) throw err;
      throw new ModelBuildServiceError(`Retry failed: ${err.message}`, "RETRY_FAILED");
    } finally {
      conn.release();
    }
  }

  // ── Cancel ────────────────────────────────────────────────────────────

  async cancelBuild(ownerId: string, jobUuid: string): Promise<BuildJobPublic> {
    assertModelBuildV3Enabled();
    const pool = this.getPoolFn();
    const conn = await pool.getConnection();

    try {
      await conn.beginTransaction();
      const job = await findJobByUuidForUpdate(conn, jobUuid);
      if (!job) throw new ModelBuildServiceError("Job not found", "NOT_FOUND");
      if (job.owner_id !== ownerId) throw new ModelBuildServiceError("Not authorized", "FORBIDDEN");

      // Can only cancel before provider submission
      if (!["draft", "preflight", "reserving", "queued"].includes(job.state)) {
        throw new ModelBuildServiceError(
          `Cannot cancel job in state '${job.state}'`,
          "INVALID_STATE",
        );
      }

      await updateJobState(conn, job.id, "cancelled", { failureCode: "USER_CANCELLED" });

      // Cancel any pending attempts
      const attempts = await findAttemptsByJobId(conn, job.id);
      for (const attempt of attempts) {
        if (!["failed", "ready", "cancelled"].includes(attempt.state)) {
          await updateAttemptState(conn, attempt.id, "cancelled", {
            completedAt: new Date(),
          });
        }
      }

      await conn.commit();

      // Refund if charged
      if (job.credit_correlation_id && !job.refund_correlation_id) {
        await this.refundJob(jobUuid);
      }

      const updatedJob = await findJobByUuid(pool, jobUuid);
      return this.formatJobPublic(updatedJob!);
    } catch (err: any) {
      await conn.rollback();
      if (err instanceof ModelBuildServiceError) throw err;
      throw new ModelBuildServiceError(`Cancel failed: ${err.message}`, "CANCEL_FAILED");
    } finally {
      conn.release();
    }
  }

  // ── Accept ────────────────────────────────────────────────────────────

  async acceptBuild(ownerId: string, jobUuid: string, input: AcceptBuildInput): Promise<BuildJobPublic> {
    assertModelBuildV3Enabled();
    const pool = this.getPoolFn();
    const conn = await pool.getConnection();

    try {
      await conn.beginTransaction();
      const job = await findJobByUuidForUpdate(conn, jobUuid);
      if (!job) throw new ModelBuildServiceError("Job not found", "NOT_FOUND");
      if (job.owner_id !== ownerId) throw new ModelBuildServiceError("Not authorized", "FORBIDDEN");

      if (job.state === "accepted") {
        // Idempotent: already accepted
        await conn.commit();
        return this.formatJobPublic(job);
      }

      if (job.state !== "ready") {
        throw new ModelBuildServiceError(
          `Cannot accept job in state '${job.state}'`,
          "INVALID_STATE",
        );
      }

      // Find the validated GLB artifact and report for the current attempt
      if (!job.current_attempt_id) {
        throw new ModelBuildServiceError("No current attempt", "INVALID_STATE");
      }

      const artifact = await findArtifactByAttemptAndRole(conn, job.current_attempt_id, "validated_glb");
      if (!artifact) throw new ModelBuildServiceError("Validated GLB artifact not found", "ARTIFACT_NOT_FOUND");
      if (artifact.computed_hash !== input.artifactHash) {
        throw new ModelBuildServiceError("Artifact hash mismatch", "HASH_MISMATCH");
      }

      const report = await findReportByAttemptId(conn, job.current_attempt_id);
      if (!report) throw new ModelBuildServiceError("Post-build report not found", "REPORT_NOT_FOUND");
      if (report.metrics_hash !== input.reportHash) {
        throw new ModelBuildServiceError("Report hash mismatch", "HASH_MISMATCH");
      }

      // Insert acceptance
      const acceptance = await insertAcceptance(conn, {
        jobId: job.id,
        attemptId: job.current_attempt_id,
        artifactId: artifact.id,
        reportId: report.id,
        acceptedByUser: ownerId,
      });

      await updateJobState(conn, job.id, "accepted", {
        acceptedArtifactId: artifact.id,
        acceptedReportId: report.id,
      });

      await conn.commit();

      const updatedJob = await findJobByUuid(pool, jobUuid);
      return this.formatJobPublic(updatedJob!);
    } catch (err: any) {
      await conn.rollback();
      if (err instanceof ModelBuildServiceError) throw err;
      throw new ModelBuildServiceError(`Accept failed: ${err.message}`, "ACCEPT_FAILED");
    } finally {
      conn.release();
    }
  }

  // ── Read ──────────────────────────────────────────────────────────────

  async getJobPublic(ownerId: string, jobUuid: string): Promise<BuildJobPublic> {
    assertModelBuildV3Enabled();
    const pool = this.getPoolFn();
    const job = await findJobByUuid(pool, jobUuid);
    if (!job) throw new ModelBuildServiceError("Job not found", "NOT_FOUND");
    if (job.owner_id !== ownerId) throw new ModelBuildServiceError("Not authorized", "FORBIDDEN");
    return this.formatJobPublic(job);
  }

  async getJobDetail(ownerId: string, jobUuid: string): Promise<{
    job: BuildJobPublic;
    attempts: BuildAttemptPublic[];
    artifacts: BuildArtifactPublic[];
    report: PostBuildReportPublic | null;
  }> {
    assertModelBuildV3Enabled();
    const pool = this.getPoolFn();
    const job = await findJobByUuid(pool, jobUuid);
    if (!job) throw new ModelBuildServiceError("Job not found", "NOT_FOUND");
    if (job.owner_id !== ownerId) throw new ModelBuildServiceError("Not authorized", "FORBIDDEN");

    const attempts = await findAttemptsByJobId(pool, job.id);
    const attemptPublics = attempts.map(a => ({
      attemptNumber: a.attempt_number,
      provider: a.provider,
      model: a.model,
      state: a.state,
      failureCode: a.failure_code,
      startedAt: a.started_at.toISOString(),
      completedAt: a.completed_at?.toISOString() || null,
    }));

    // Get artifacts for the current/latest attempt
    let artifactPublics: BuildArtifactPublic[] = [];
    let reportPublic: PostBuildReportPublic | null = null;

    if (job.current_attempt_id) {
      const artifacts = await findArtifactsByAttemptId(pool, job.current_attempt_id);
      for (const art of artifacts) {
        const asset = await findAssetById(pool, art.asset_id);
        const version = await findVersionById(pool, art.asset_version_id);
        if (asset && version) {
          let signedUrl: string | undefined;
          try {
            signedUrl = await generateSignedUrlForVersion(asset, version, ownerId, true) || undefined;
          } catch { /* non-fatal */ }
          artifactPublics.push({
            role: art.role,
            assetUuid: asset.asset_uuid,
            versionNumber: version.version_number,
            sha256: art.computed_hash,
            sizeBytes: art.size_bytes,
            mimeType: art.mime_type,
            signedUrl,
          });
        }
      }

      const report = await findReportByAttemptId(pool, job.current_attempt_id);
      if (report) {
        reportPublic = {
          status: report.status,
          validatorVersions: report.validator_versions,
          metricsHash: report.metrics_hash,
          metrics: report.metrics_json,
        };
      }
    }

    return {
      job: this.formatJobPublic(job),
      attempts: attemptPublics,
      artifacts: artifactPublics,
      report: reportPublic,
    };
  }

  async listJobs(ownerId: string): Promise<BuildJobPublic[]> {
    assertModelBuildV3Enabled();
    const pool = this.getPoolFn();
    const jobs = await findJobsByOwner(pool, ownerId);
    return jobs.map(j => this.formatJobPublic(j));
  }

  // ── Helpers ───────────────────────────────────────────────────────────

  private formatJobPublic(job: BuildJobRecord): BuildJobPublic {
    return {
      jobUuid: job.job_uuid,
      ownerId: job.owner_id,
      referenceSessionUuid: "", // Filled by route layer via join
      manifestHashPrefix: job.manifest_hash.slice(0, 12),
      requestedOutput: job.requested_output,
      pricingKey: job.pricing_key,
      quotedCredits: job.quoted_credits,
      state: job.state,
      currentAttemptNumber: null, // Filled by route layer
      failureCode: job.failure_code,
      createdAt: job.created_at.toISOString(),
      updatedAt: job.updated_at.toISOString(),
    };
  }

  private async deductCredits(
    conn: mysql.PoolConnection,
    pool: mysql.Pool,
    phone: string,
    amount: number,
    reason: string,
  ): Promise<boolean> {
    const [result]: any = await conn.query(
      "UPDATE users SET credits = credits - ? WHERE phone = ? AND credits >= ?",
      [amount, phone, amount],
    );
    if (result.affectedRows === 1) {
      await this.recordCreditTxn(pool, phone, -Math.abs(amount), reason);
    }
    return result.affectedRows === 1;
  }

  private async addCredits(
    pool: mysql.Pool,
    phone: string,
    amount: number,
    reason: string,
  ): Promise<void> {
    await pool.query("UPDATE users SET credits = credits + ? WHERE phone = ?", [amount, phone]);
    await this.recordCreditTxn(pool, phone, Math.abs(amount), reason);
  }

  private async recordCreditTxn(
    pool: mysql.Pool,
    phone: string,
    delta: number,
    reason: string,
  ): Promise<void> {
    try {
      const [rows]: any = await pool.query("SELECT credits FROM users WHERE phone = ?", [phone]);
      const balance = rows[0] ? Number(rows[0].credits || 0) : 0;
      await pool.query(
        "INSERT INTO credit_transactions (user_phone, delta, reason, balance_after) VALUES (?, ?, ?, ?)",
        [phone, delta, reason.slice(0, 80), balance],
      );
    } catch (err: any) {
      console.warn("[credit ledger] failed to record transaction:", err.message);
    }
  }

  private async hasCorrelation(pool: mysql.Pool, phone: string, correlationId: string): Promise<boolean> {
    const [rows] = await pool.query(
      "SELECT 1 FROM credit_transactions WHERE user_phone = ? AND reason = ? LIMIT 1",
      [phone, correlationId.slice(0, 80)],
    ) as any;
    return rows.length > 0;
  }
}
