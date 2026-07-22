import crypto from "node:crypto";
import { v4 as uuidv4 } from "uuid";
import type mysql from "mysql2/promise";
import { getPool } from "../../db";
import { registerAsset } from "../assets/service";
import { generateSignedUrlForVersion } from "../assets/access";
import { findAssetById, findVersionById } from "../assets/repository";
import { assertMultiviewApprovalEnabled } from "./featureFlag";
import {
  CreateSessionSchema,
  StartAttemptSchema,
  RetryAttemptSchema,
  ApproveManifestSchema,
  type CreateSessionInput,
} from "./schemas";
import {
  insertSession,
  findSessionByUuid,
  findSessionsByOwner,
  updateSessionState,
  insertAttempt,
  findAttemptById,
  findAttemptsBySessionId,
  findAttemptByIdempotencyKey,
  updateAttemptState,
  insertView,
  findViewsByAttemptId,
  insertReport,
  findReportByAttemptId,
  insertApproval,
  findApprovalBySessionId,
} from "./repository";
import { storeReferenceImage, cleanupReferenceImage } from "./storage";
import { evaluateReferenceConsistency } from "./consistency";
import { FakeReferenceImageProvider, type ReferenceImageProvider } from "./provider";
import type {
  ReferenceSessionRecord,
  ReferenceAttemptRecord,
  ReferenceViewRecord,
  SessionPublic,
  ViewItemPublic,
  ReportPublic,
  ViewKind,
  ORDERED_VIEW_KINDS,
} from "./types";

export class ReferenceSessionError extends Error {
  constructor(message: string, public code: string = "REFERENCE_SESSION_ERROR") {
    super(message);
    this.name = "ReferenceSessionError";
  }
}

export function computeOrderedManifestHash(
  views: { viewKind: ViewKind; assetUuid: string; sha256: string }[],
): string {
  const ordered = ["front", "left", "right", "rear", "front_three_quarter"] as const;
  const parts: string[] = [];

  for (const kind of ordered) {
    const found = views.find((v) => v.viewKind === kind);
    if (!found) {
      throw new ReferenceSessionError(`Missing required view kind: ${kind}`, "INCOMPLETE_MANIFEST");
    }
    parts.push(`${kind}:${found.assetUuid}:${found.sha256}`);
  }

  return crypto.createHash("sha256").update(parts.join("|")).digest("hex");
}

export class ReferenceSessionService {
  constructor(
    private provider: ReferenceImageProvider = new FakeReferenceImageProvider(),
    private getPoolFn: () => mysql.Pool = getPool,
  ) {}

  async createSession(
    ownerId: string,
    input: CreateSessionInput,
  ): Promise<ReferenceSessionRecord> {
    assertMultiviewApprovalEnabled();
    const validated = CreateSessionSchema.parse(input);
    const pool = this.getPoolFn();
    const sessionUuid = uuidv4();

    return insertSession(pool, {
      sessionUuid,
      ownerId,
      inputMode: validated.inputMode,
      subjectClass: validated.subjectClass,
      prompt: validated.prompt,
    });
  }

  async startOrRetryAttempt(
    ownerId: string,
    sessionUuid: string,
    idempotencyKey: string,
    retryNotes?: string | null,
  ): Promise<{ session: ReferenceSessionRecord; attempt: ReferenceAttemptRecord }> {
    assertMultiviewApprovalEnabled();
    const pool = this.getPoolFn();
    const connection = await pool.getConnection();

    const createdObjectKeys: string[] = [];

    try {
      await connection.beginTransaction();

      const session = await findSessionByUuid(connection, sessionUuid);
      if (!session) throw new ReferenceSessionError("Reference session not found", "NOT_FOUND");

      if (session.owner_id !== ownerId) {
        throw new ReferenceSessionError("Unauthorized access to session", "UNAUTHORIZED");
      }

      if (session.state === "approved") {
        throw new ReferenceSessionError("Session is already approved and immutable.", "SESSION_APPROVED");
      }

      // Check idempotency
      const existingAttempt = await findAttemptByIdempotencyKey(connection, session.id, idempotencyKey);
      if (existingAttempt) {
        await connection.rollback();
        return { session, attempt: existingAttempt };
      }

      const nextAttemptNumber = session.retry_count + 1;
      const promptConfigHash = crypto
        .createHash("sha256")
        .update(`${session.prompt || ""}:${retryNotes || ""}:${nextAttemptNumber}`)
        .digest("hex");

      const attempt = await insertAttempt(connection, {
        sessionId: session.id,
        attemptNumber: nextAttemptNumber,
        idempotencyKey,
        provider: this.provider.name,
        model: this.provider.model,
        promptConfigHash,
        retryNotes: retryNotes || null,
      });

      await updateSessionState(connection, session.id, "generating", {
        currentAttemptId: attempt.id,
        incrementRetry: true,
      });

      await connection.commit();

      // Generate reference views via provider
      const genResult = await this.provider.generateMultiview(
        { prompt: session.prompt },
        session.input_mode,
      );

      // Store generated views and register canonical assets
      for (const viewPayload of genResult.views) {
        const stored = await storeReferenceImage(
          session.session_uuid,
          nextAttemptNumber,
          viewPayload.viewKind,
          viewPayload.imageBuffer,
          viewPayload.mimeType,
        );
        createdObjectKeys.push(stored.objectKey);

        const { asset, version } = await registerAsset(
          {
            ownerId,
            assetType: `reference_${viewPayload.viewKind}`,
            visibility: "private",
            mimeType: viewPayload.mimeType,
            sizeBytes: stored.sizeBytes,
            sha256: stored.sha256,
            bucket: "private",
            objectKey: stored.objectKey,
            metadata: {
              sessionUuid: session.session_uuid,
              attemptNumber: nextAttemptNumber,
              viewKind: viewPayload.viewKind,
            },
            sourceProvider: this.provider.name,
            license: "proprietary",
            commercialUseEligible: false,
          },
          { authorization: { internal: true }, isNewObjectUpload: false, pool },
        );

        await insertView(pool, {
          attemptId: attempt.id,
          viewKind: viewPayload.viewKind,
          assetId: asset.id,
          assetVersionId: version.id,
          widthPx: viewPayload.widthPx,
          heightPx: viewPayload.heightPx,
          isSynthesized: viewPayload.isSynthesized,
        });
      }

      // Evaluate AI consistency report
      const { payload: reportPayload, hash: reportHash } = evaluateReferenceConsistency(
        genResult.views,
        session.input_mode,
      );

      await insertReport(pool, {
        attemptId: attempt.id,
        status: reportPayload.status,
        scaleConfidence: reportPayload.scaleConfidence,
        reportHash,
        metricsJson: reportPayload,
      });

      await updateAttemptState(pool, attempt.id, "ready");
      await updateSessionState(pool, session.id, "ready");

      const updatedSession = (await findSessionByUuid(pool, sessionUuid))!;
      const updatedAttempt = (await findAttemptById(pool, attempt.id))!;

      return { session: updatedSession, attempt: updatedAttempt };
    } catch (error: any) {
      await connection.rollback().catch(() => {});

      // Compensating storage cleanup for failed attempts
      for (const key of createdObjectKeys) {
        await cleanupReferenceImage(key);
      }

      const session = await findSessionByUuid(pool, sessionUuid);
      if (session && session.current_attempt_id) {
        await updateAttemptState(pool, session.current_attempt_id, "failed", "GENERATION_FAILED", error.message).catch(() => {});
        await updateSessionState(pool, session.id, "failed").catch(() => {});
      }

      throw error instanceof ReferenceSessionError
        ? error
        : new ReferenceSessionError(`Attempt generation failed: ${error.message}`, "GENERATION_FAILED");
    } finally {
      connection.release();
    }
  }

  async cancelSession(ownerId: string, sessionUuid: string): Promise<void> {
    assertMultiviewApprovalEnabled();
    const pool = this.getPoolFn();
    const session = await findSessionByUuid(pool, sessionUuid);
    if (!session) throw new ReferenceSessionError("Session not found", "NOT_FOUND");
    if (session.owner_id !== ownerId) throw new ReferenceSessionError("Unauthorized", "UNAUTHORIZED");
    if (session.state === "approved") {
      throw new ReferenceSessionError("Cannot cancel an approved session.", "SESSION_APPROVED");
    }

    await updateSessionState(pool, session.id, "cancelled");
  }

  async approveManifest(
    ownerId: string,
    sessionUuid: string,
    manifestHash: string,
  ): Promise<SessionPublic> {
    assertMultiviewApprovalEnabled();
    const pool = this.getPoolFn();
    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();

      const session = await findSessionByUuid(connection, sessionUuid);
      if (!session) throw new ReferenceSessionError("Session not found", "NOT_FOUND");
      if (session.owner_id !== ownerId) throw new ReferenceSessionError("Unauthorized", "UNAUTHORIZED");

      const existingApproval = await findApprovalBySessionId(connection, session.id);
      if (existingApproval || session.state === "approved") {
        throw new ReferenceSessionError("Session is already approved.", "ALREADY_APPROVED");
      }

      if (session.state !== "ready" || !session.current_attempt_id) {
        throw new ReferenceSessionError("Session is not in ready state for approval.", "NOT_READY");
      }

      const attempt = await findAttemptById(connection, session.current_attempt_id);
      if (!attempt || attempt.state !== "ready") {
        throw new ReferenceSessionError("Attempt is not ready for approval.", "ATTEMPT_NOT_READY");
      }

      const views = await findViewsByAttemptId(connection, attempt.id);
      if (views.length !== 5) {
        throw new ReferenceSessionError("Approval requires exactly 5 reference views.", "INCOMPLETE_VIEWS");
      }

      // Compute server-side ordered manifest hash and verify match
      const viewManifestItems: { viewKind: ViewKind; assetUuid: string; sha256: string }[] = [];
      for (const v of views) {
        const asset = await findAssetById(connection, v.asset_id);
        const version = await findVersionById(connection, v.asset_version_id);
        if (!asset || !version) {
          throw new ReferenceSessionError("Corrupt view asset reference", "CORRUPT_VIEW");
        }
        viewManifestItems.push({
          viewKind: v.view_kind,
          assetUuid: asset.asset_uuid,
          sha256: version.sha256,
        });
      }

      const computedHash = computeOrderedManifestHash(viewManifestItems);
      if (computedHash !== manifestHash) {
        throw new ReferenceSessionError(
          "Manifest hash mismatch. Reviewed views have changed or hash is invalid.",
          "MANIFEST_HASH_MISMATCH",
        );
      }

      const report = await findReportByAttemptId(connection, attempt.id);
      if (!report) {
        throw new ReferenceSessionError("Consistency report is required for approval.", "MISSING_REPORT");
      }

      await insertApproval(connection, {
        sessionId: session.id,
        attemptId: attempt.id,
        manifestHash: computedHash,
        approvedByUser: ownerId,
      });

      await updateSessionState(connection, session.id, "approved", {
        approvedAttemptId: attempt.id,
      });

      await connection.commit();

      return this.getSessionPublic(sessionUuid, ownerId, false);
    } catch (error: any) {
      await connection.rollback().catch(() => {});
      throw error;
    } finally {
      connection.release();
    }
  }

  async getSessionPublic(
    sessionUuid: string,
    requestingUserPhone?: string,
    isAdmin: boolean = false,
  ): Promise<SessionPublic> {
    const pool = this.getPoolFn();
    const session = await findSessionByUuid(pool, sessionUuid);
    if (!session) throw new ReferenceSessionError("Session not found", "NOT_FOUND");

    if (session.owner_id !== requestingUserPhone && !isAdmin) {
      throw new ReferenceSessionError("Access denied to reference session", "UNAUTHORIZED");
    }

    let viewsPublic: ViewItemPublic[] = [];
    let reportPublic: ReportPublic | null = null;
    let manifestHash: string | null = null;
    let approvedAt: string | null = null;

    const targetAttemptId = session.approved_attempt_id || session.current_attempt_id;

    if (targetAttemptId) {
      const views = await findViewsByAttemptId(pool, targetAttemptId);
      const manifestItems: { viewKind: ViewKind; assetUuid: string; sha256: string }[] = [];

      for (const v of views) {
        const asset = await findAssetById(pool, v.asset_id);
        const version = await findVersionById(pool, v.asset_version_id);
        if (asset && version) {
          const signedUrl = await generateSignedUrlForVersion(asset, version, requestingUserPhone, isAdmin, 900);
          viewsPublic.push({
            viewKind: v.view_kind,
            assetUuid: asset.asset_uuid,
            versionNumber: version.version_number,
            widthPx: v.width_px,
            heightPx: v.height_px,
            isSynthesized: v.is_synthesized,
            signedUrl,
          });
          manifestItems.push({
            viewKind: v.view_kind,
            assetUuid: asset.asset_uuid,
            sha256: version.sha256,
          });
        }
      }

      if (viewsPublic.length === 5) {
        manifestHash = computeOrderedManifestHash(manifestItems);
      }

      const reportRecord = await findReportByAttemptId(pool, targetAttemptId);
      if (reportRecord) {
        reportPublic = {
          status: reportRecord.status,
          scaleConfidence: reportRecord.scale_confidence,
          reportHash: reportRecord.report_hash,
          metrics: reportRecord.metrics_json,
        };
      }
    }

    const approvalRecord = await findApprovalBySessionId(pool, session.id);
    if (approvalRecord) {
      approvedAt = approvalRecord.created_at.toISOString();
      manifestHash = approvalRecord.manifest_hash;
    }

    const attempts = await findAttemptsBySessionId(pool, session.id);
    const currentAttempt = session.current_attempt_id ? attempts.find((a) => a.id === session.current_attempt_id) : null;
    const approvedAttempt = session.approved_attempt_id ? attempts.find((a) => a.id === session.approved_attempt_id) : null;

    return {
      sessionUuid: session.session_uuid,
      ownerId: session.owner_id,
      inputMode: session.input_mode,
      subjectClass: session.subject_class,
      prompt: session.prompt,
      state: session.state,
      currentAttemptNumber: currentAttempt ? currentAttempt.attempt_number : null,
      approvedAttemptNumber: approvedAttempt ? approvedAttempt.attempt_number : null,
      retryCount: session.retry_count,
      createdAt: session.created_at.toISOString(),
      updatedAt: session.updated_at.toISOString(),
      views: viewsPublic,
      report: reportPublic,
      manifestHash,
      approvedAt,
    };
  }
}
