// ─── Phase 4: Rig Pipeline Service ─────────────────────────────────────────
import crypto from "node:crypto";
import type mysql from "mysql2/promise";
import { assertRigPipelineV4Enabled } from "./featureFlag";
import type {
  RigJobPublic,
  RigJobState,
  ClassificationType,
  FacialCapability,
} from "./types";
import {
  DEFAULT_RIG_LEASE_DURATION_MS,
  TERMINAL_RIG_JOB_STATES,
} from "./types";
import {
  insertClassification,
  findClassificationByJobId,
  updateClassificationOverride,
  insertRigJob,
  findRigJobByUuid,
  findRigJobByUuidForUpdate,
  findRigJobByIdempotencyKey,
  updateRigJobState,
  insertRigAttempt,
  updateRigAttemptState,
  claimRigLease,
  findManifestByAttemptId,
  findFacialInventoryByAttemptId,
  findFitsByRigJobId,
  insertRigAcceptance,
} from "./repository";
import { classifyModel } from "./validation";
import { findJobByUuid, findJobByUuidForUpdate as findModelBuildJobByUuidForUpdate } from "../model-builds/repository";

export class RigPipelineError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = "RigPipelineError";
  }
}

export class RigPipelineService {
  constructor(private readonly getPoolFn: () => mysql.Pool) {}

  // ── 1. Start Rig Job ──────────────────────────────────────────────────────

  async startRigJob(
    ownerId: string,
    params: {
      modelBuildJobUuid: string;
      idempotencyKey: string;
      profileId?: string;
      requestFacial?: boolean;
      accessoryUuids?: string[];
      overrideClassification?: ClassificationType;
      overrideReason?: string;
    },
  ): Promise<RigJobPublic> {
    assertRigPipelineV4Enabled();
    const pool = this.getPoolFn();

    // Idempotency check
    const existingJob = await findRigJobByIdempotencyKey(pool, params.idempotencyKey);
    if (existingJob) {
      if (existingJob.owner_id !== ownerId) {
        throw new RigPipelineError("Not authorized", "FORBIDDEN");
      }
      return this.getJobPublic(ownerId, existingJob.job_uuid);
    }

    // Load Phase 3 build job
    let modelBuildJob = await findJobByUuid(pool, params.modelBuildJobUuid);
    if (!modelBuildJob) {
      throw new RigPipelineError("Phase 3 model build job not found", "NOT_FOUND");
    }
    if (modelBuildJob.owner_id !== ownerId) {
      throw new RigPipelineError("Not authorized to access model build", "FORBIDDEN");
    }
    if (modelBuildJob.state !== "accepted" || !modelBuildJob.accepted_artifact_id) {
      throw new RigPipelineError("Model build must be in accepted state before rigging", "UNACCEPTED_MODEL");
    }

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      modelBuildJob = await findModelBuildJobByUuidForUpdate(conn, params.modelBuildJobUuid);
      if (!modelBuildJob) throw new RigPipelineError("Phase 3 model build job not found", "NOT_FOUND");
      if (modelBuildJob.owner_id !== ownerId) throw new RigPipelineError("Not authorized to access model build", "FORBIDDEN");

      const existingLocked = await findRigJobByIdempotencyKey(conn, params.idempotencyKey);
      if (existingLocked) {
        await conn.commit();
        return this.getJobPublic(ownerId, existingLocked.job_uuid);
      }

      const [artifactRows]: any = await conn.query(
        `SELECT mba.*
         FROM model_build_artifacts mba
         WHERE mba.id = ? AND mba.attempt_id = ? AND mba.role = 'validated_glb'`,
        [modelBuildJob.accepted_artifact_id, modelBuildJob.current_attempt_id],
      );
      const artifact = artifactRows[0];
      if (!artifact) throw new RigPipelineError("Accepted artifact not found", "ARTIFACT_NOT_FOUND");

      // 1. Get or create classification
      let classRec = await findClassificationByJobId(conn, modelBuildJob.id);
      if (!classRec) {
        // Run classification on accepted artifact metadata and its report.
        const [contextRows]: any = await conn.query(
          `SELECT rs.subject_class, reports.metrics_json
           FROM reference_sessions rs
           LEFT JOIN model_post_build_reports reports ON reports.id = ?
           WHERE rs.id = ?`,
          [modelBuildJob.accepted_report_id, modelBuildJob.reference_session_id],
        );
        const context = contextRows[0] || {};
        const metrics = parseJsonRecord(context.metrics_json);
        const dimensions = parseDimensions(metrics.dimensions);
        const classRes = classifyModel({
          triangleCount: finiteNonNegative(metrics.triangleCount),
          boundingVolume: dimensions,
          subjectClass: typeof context.subject_class === "string" ? context.subject_class : undefined,
        });

        const requestedClassification = params.overrideClassification || classRes.classification;
        const selectedProfileId = params.profileId || profileForClassification(requestedClassification);
        if (!profileMatchesClassification(selectedProfileId, requestedClassification)) {
          throw new RigPipelineError("Selected rig profile does not match the measured classification", "PROFILE_MISMATCH");
        }

        const classId = await insertClassification(conn, {
          modelBuildJobId: modelBuildJob.id,
          acceptedArtifactId: artifact.id,
          classification: requestedClassification,
          classifierVersion: classRes.classifierVersion,
          confidence: classRes.confidence,
          evidenceJson: classRes.evidence,
          selectedProfileId,
        });

        classRec = (await findClassificationByJobId(conn, modelBuildJob.id))!;
      } else if (params.overrideClassification) {
        await updateClassificationOverride(
          conn,
          classRec.id,
          ownerId,
          params.overrideReason || "User override",
          params.overrideClassification,
          params.profileId || profileForClassification(params.overrideClassification),
        );
        classRec = (await findClassificationByJobId(conn, modelBuildJob.id))!;
      }

      // Check classification validity
      if (classRec.classification === "unsupported") {
        throw new RigPipelineError("Model geometry is classified as unsupported for auto-rigging", "UNSUPPORTED_GEOMETRY");
      }

      // 2. Create rig job record
      const jobUuid = crypto.randomUUID();
      const jobId = await insertRigJob(conn, {
        jobUuid,
        ownerId,
        modelBuildJobId: modelBuildJob.id,
        classificationId: classRec.id,
        sourceArtifactId: modelBuildJob.accepted_artifact_id,
        sourceVersionId: Number(artifact.asset_version_id),
        requestFacial: params.requestFacial ?? true,
        idempotencyKey: params.idempotencyKey,
      });

      // 3. Create attempt 1
      const attemptId = await insertRigAttempt(conn, {
        jobId,
        attemptNumber: 1,
        idempotencyKey: `${params.idempotencyKey}_att1`,
      });

      await updateRigJobState(conn, jobId, "queued", { currentAttemptId: attemptId });

      await conn.commit();

      // Trigger durable processing. The worker boundary currently fails closed
      // until it can return measured artifacts and validation evidence.
      this.processAttempt(ownerId, jobUuid, attemptId, params.accessoryUuids).catch((err) => {
        console.error(`[rig-pipeline] Unhandled error in processAttempt for ${jobUuid}:`, err);
      });

      return this.getJobPublic(ownerId, jobUuid);
    } catch (err: any) {
      await conn.rollback();
      if (err instanceof RigPipelineError) throw err;
      throw new RigPipelineError(`Start rig job failed: ${err.message}`, "START_FAILED");
    } finally {
      conn.release();
    }
  }

  // ── 2. Background Attempt Processing ──────────────────────────────────────

  async processAttempt(
    _ownerId: string,
    jobUuid: string,
    attemptId: number,
    _accessoryUuids: string[] = [],
  ): Promise<void> {
    const pool = this.getPoolFn();
    const leaseOwner = `worker-${process.pid}-${Date.now()}`;

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      const claimed = await claimRigLease(conn, attemptId, leaseOwner, new Date(Date.now() + DEFAULT_RIG_LEASE_DURATION_MS));
      if (!claimed) {
        await conn.commit();
        return;
      }

      const job = await findRigJobByUuidForUpdate(conn, jobUuid);
      if (!job || TERMINAL_RIG_JOB_STATES.includes(job.state as any)) {
        await conn.commit();
        return;
      }

      await updateRigAttemptState(conn, attemptId, "submitted", {
        provider: "unavailable",
        startedAt: new Date(),
      });
      await updateRigJobState(conn, job.id, "submitted");
      await conn.commit();
      await this.handleAttemptFailure(
        job.id,
        attemptId,
        "RIG_WORKER_NOT_INTEGRATED",
        "No measured Phase 4 rig worker adapter is configured; fabricated rig evidence is forbidden.",
      );
    } catch (err: any) {
      await conn.rollback();
      console.error(`[rig-pipeline] Error processing attempt ${attemptId}:`, err);
    } finally {
      conn.release();
    }
  }

  private async handleAttemptFailure(jobId: number, attemptId: number, code: string, detail: string): Promise<void> {
    const pool = this.getPoolFn();
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await updateRigAttemptState(conn, attemptId, "failed", { failureCode: code, failureDetail: detail, completedAt: new Date() });
      await updateRigJobState(conn, jobId, "failed_rig", { failureCode: code });
      await conn.commit();
    } finally {
      conn.release();
    }
  }

  // ── 3. Accept Rig Job ─────────────────────────────────────────────────────

  async acceptRigJob(
    ownerId: string,
    jobUuid: string,
    params: { manifestHash: string },
  ): Promise<RigJobPublic> {
    assertRigPipelineV4Enabled();
    const pool = this.getPoolFn();
    const conn = await pool.getConnection();

    try {
      await conn.beginTransaction();
      const job = await findRigJobByUuidForUpdate(conn, jobUuid);
      if (!job) throw new RigPipelineError("Job not found", "NOT_FOUND");
      if (job.owner_id !== ownerId) throw new RigPipelineError("Not authorized", "FORBIDDEN");
      if (job.state !== "ready" || !job.current_attempt_id) {
        throw new RigPipelineError("Rig job is not in ready state for acceptance", "INVALID_STATE");
      }

      const manifest = await findManifestByAttemptId(conn, job.current_attempt_id);
      if (!manifest) throw new RigPipelineError("Validation manifest not found", "MANIFEST_NOT_FOUND");

      const rules = parseRules(manifest.rules_json);
      if (!job.accepted_artifact_id || rules.length === 0 || rules.some((rule) => !rule.pass)) {
        throw new RigPipelineError("Rig output or validation evidence is incomplete", "VALIDATION_FAILED");
      }

      if (manifest.metrics_hash !== params.manifestHash) {
        throw new RigPipelineError("Manifest hash mismatch", "HASH_MISMATCH");
      }

      await insertRigAcceptance(conn, {
        rigJobId: job.id,
        rigAttemptId: job.current_attempt_id,
        manifestId: manifest.id,
        acceptedByUser: ownerId,
        manifestHash: params.manifestHash,
      });

      await updateRigJobState(conn, job.id, "accepted");

      await conn.commit();
      return this.getJobPublic(ownerId, jobUuid);
    } catch (err: any) {
      await conn.rollback();
      if (err instanceof RigPipelineError) throw err;
      throw new RigPipelineError(`Accept rig failed: ${err.message}`, "ACCEPT_FAILED");
    } finally {
      conn.release();
    }
  }

  // ── 4. Public DTO Hydration ───────────────────────────────────────────────

  async getJobPublic(ownerId: string, jobUuid: string): Promise<RigJobPublic> {
    assertRigPipelineV4Enabled();
    const pool = this.getPoolFn();
    const job = await findRigJobByUuid(pool, jobUuid);
    if (!job) throw new RigPipelineError("Job not found", "NOT_FOUND");
    if (job.owner_id !== ownerId) throw new RigPipelineError("Not authorized", "FORBIDDEN");

    const classRec = await findClassificationByJobId(pool, job.model_build_job_id);
    let manifestData = null;
    let facialData = null;

    if (job.current_attempt_id) {
      const manifest = await findManifestByAttemptId(pool, job.current_attempt_id);
      if (manifest) {
        const rules = typeof manifest.rules_json === "string" ? JSON.parse(manifest.rules_json) : manifest.rules_json;
        manifestData = {
          boneCount: manifest.bone_count,
          maxInfluences: manifest.max_influences,
          mobileBudgetPass: Boolean(manifest.mobile_budget_pass),
          animationSweepPass: Boolean(manifest.animation_sweep_pass),
          overallPass: rules.length > 0 && rules.every((rule: any) => Boolean(rule.pass)),
          rules,
        };
      }

      const facial = await findFacialInventoryByAttemptId(pool, job.current_attempt_id);
      if (facial) {
        facialData = {
          capability: facial.capability as FacialCapability,
          morphCount: facial.morph_count,
          visemeCoverage: Number(facial.viseme_coverage),
          hasBlink: Boolean(facial.has_blink),
          hasJaw: Boolean(facial.has_jaw),
          hasEyeControls: Boolean(facial.has_eye_controls),
          deformationPass: Boolean(facial.deformation_pass),
        };
      }
    }

    const fitRows = await findFitsByRigJobId(pool, job.id);
    const accessories = fitRows.map((f: any) => ({
      fitUuid: f.fit_uuid,
      accessoryName: f.accessory_name || "Accessory",
      attachmentBone: f.attachment_bone,
      floatingDistance: Number(f.floating_distance),
      penetrationDepth: Number(f.penetration_depth),
      animationSweepPass: Boolean(f.animation_sweep_pass),
      polygonBudgetPass: Boolean(f.polygon_budget_pass),
      printClearanceMm: Number(f.print_clearance_mm),
      status: f.status,
    }));

    return {
      jobUuid: job.job_uuid,
      state: job.state as RigJobState,
      classification: classRec ? (classRec.classification as ClassificationType) : null,
      selectedProfile: classRec ? classRec.selected_profile_id : null,
      facialCapability: facialData ? facialData.capability : null,
      rigValidation: manifestData,
      facialInventory: facialData,
      accessories,
      manifestHash: manifestData && job.current_attempt_id
        ? (await findManifestByAttemptId(pool, job.current_attempt_id))?.metrics_hash || null
        : null,
      failureCode: job.failure_code || null,
      createdAt: new Date(job.created_at).toISOString(),
      updatedAt: new Date(job.updated_at).toISOString(),
    };
  }
}

function parseJsonRecord(value: unknown): Record<string, any> {
  if (!value) return {};
  if (typeof value === "string") {
    try { return JSON.parse(value); } catch { return {}; }
  }
  return typeof value === "object" ? value as Record<string, any> : {};
}

function finiteNonNegative(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function parseDimensions(value: unknown): { x: number; y: number; z: number } {
  const dimensions = parseJsonRecord(value);
  return {
    x: finiteNonNegative(dimensions.width),
    y: finiteNonNegative(dimensions.height),
    z: finiteNonNegative(dimensions.depth),
  };
}

function profileForClassification(classification: ClassificationType): string {
  if (classification === "biped") return "biped.human.canonical";
  if (classification === "quadruped") return "quadruped.dog.medium";
  return "unsupported.static";
}

function profileMatchesClassification(profileId: string, classification: ClassificationType): boolean {
  return profileId === "unsupported.static"
    ? classification === "unsupported"
    : profileId.startsWith(`${classification}.`);
}

function parseRules(value: unknown): Array<{ pass: boolean }> {
  const parsed = typeof value === "string" ? (() => { try { return JSON.parse(value); } catch { return []; } })() : value;
  return Array.isArray(parsed) ? parsed.filter((rule) => rule && typeof rule === "object") as Array<{ pass: boolean }> : [];
}
