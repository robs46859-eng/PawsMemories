// ─── Phase 4: Rig Pipeline HTTP Router ──────────────────────────────────────
import { Router, type Request, type Response } from "express";
import crypto from "node:crypto";
import type mysql from "mysql2/promise";
import type { AuthedRequest } from "../../auth";
import { findAssetByUuid, findVersionByAssetAndNumber } from "../assets/repository";
import { assertRigPipelineV4Enabled } from "./featureFlag";
import { RigPipelineService, RigPipelineError } from "./service";
import {
  StartRigJobRequestSchema,
  AcceptRigJobRequestSchema,
  RetryRigJobRequestSchema,
  RegisterAccessoryRequestSchema,
} from "./schemas";
import { insertAccessoryCatalog, findAccessoriesByOwner } from "./repository";

export function createRigPipelineRouter(getPool: () => mysql.Pool): Router {
  const router = Router();
  const service = new RigPipelineService(getPool);

  // Authenticated user extraction middleware
  function requireAuth(req: Request, res: Response, next: () => void) {
    const ownerId = (req as AuthedRequest).user?.phone;
    if (!ownerId) {
      res.status(401).json({ error: "Authentication required", code: "UNAUTHORIZED" });
      return;
    }
    (req as any).ownerId = String(ownerId);
    next();
  }

  // Gate middleware for feature flag
  router.use((req: Request, res: Response, next: () => void) => {
    try {
      assertRigPipelineV4Enabled();
      next();
    } catch (err: any) {
      res.status(503).json({ error: err.message || "Rig pipeline disabled", code: "FEATURE_DISABLED" });
    }
  });

  // POST /api/rig-pipeline/jobs — Start a rig job
  router.post("/jobs", requireAuth, async (req: Request, res: Response) => {
    try {
      const body = StartRigJobRequestSchema.parse(req.body);
      const job = await service.startRigJob((req as any).ownerId, {
        modelBuildJobUuid: body.modelBuildJobUuid,
        idempotencyKey: body.idempotencyKey,
        profileId: body.profileId,
        requestFacial: body.requestFacial,
        accessoryUuids: body.accessoryIds,
      });
      res.status(201).json(job);
    } catch (err: any) {
      handleError(res, err);
    }
  });

  // GET /api/rig-pipeline/jobs/:uuid — Get rig job status
  router.get("/jobs/:uuid", requireAuth, async (req: Request, res: Response) => {
    try {
      const job = await service.getJobPublic((req as any).ownerId, req.params.uuid);
      res.json(job);
    } catch (err: any) {
      handleError(res, err);
    }
  });

  // POST /api/rig-pipeline/jobs/:uuid/accept — Explicit user acceptance
  router.post("/jobs/:uuid/accept", requireAuth, async (req: Request, res: Response) => {
    try {
      const body = AcceptRigJobRequestSchema.parse(req.body);
      const accepted = await service.acceptRigJob((req as any).ownerId, req.params.uuid, {
        manifestHash: body.manifestHash,
      });
      res.json(accepted);
    } catch (err: any) {
      handleError(res, err);
    }
  });

  router.post("/jobs/:uuid/retry", requireAuth, async (req: Request, res: Response) => {
    try {
      const body = RetryRigJobRequestSchema.parse(req.body);
      res.status(202).json(await service.retryRigJob((req as any).ownerId, req.params.uuid, {
        idempotencyKey: body.idempotencyKey,
        accessoryUuids: body.accessoryIds,
      }));
    } catch (err: any) {
      handleError(res, err);
    }
  });

  // POST /api/rig-pipeline/accessories — Register accessory GLB
  router.post("/accessories", requireAuth, async (req: Request, res: Response) => {
    try {
      const body = RegisterAccessoryRequestSchema.parse(req.body);
      const pool = getPool();
      const conn = await pool.getConnection();

      const accessoryUuid = crypto.randomUUID();
      try {
        await conn.beginTransaction();
        const asset = await findAssetByUuid(conn, body.assetUuid);
        if (!asset) throw new RigPipelineError("Accessory asset not found", "NOT_FOUND");
        if (asset.owner_id !== (req as any).ownerId) throw new RigPipelineError("Not authorized", "FORBIDDEN");
        if (asset.status !== "active") throw new RigPipelineError("Accessory asset is not active", "INVALID_ASSET");

        const version = await findVersionByAssetAndNumber(conn, asset.id, body.versionNumber);
        if (!version || version.mime_type !== "model/gltf-binary") {
          throw new RigPipelineError("Accessory must reference an owned GLB version", "INVALID_ASSET");
        }

        await insertAccessoryCatalog(conn, {
          accessoryUuid,
          ownerId: (req as any).ownerId,
          name: body.name,
          assetId: asset.id,
          assetVersionId: version.id,
          compatibleProfiles: body.compatibleProfiles,
          attachmentBone: body.attachmentBone,
          fitBoundsJson: body.fitBounds,
          collisionBoundsJson: body.collisionBounds,
          license: version.license,
          commercialUseEligible: version.commercial_use_eligible,
          exportPolicy: body.exportPolicy,
        });
        await conn.commit();
        res.status(201).json({ accessoryUuid, name: body.name, attachmentBone: body.attachmentBone });
      } catch (error) {
        await conn.rollback();
        throw error;
      } finally {
        conn.release();
      }
    } catch (err: any) {
      handleError(res, err);
    }
  });

  // GET /api/rig-pipeline/accessories — List owner accessories
  router.get("/accessories", requireAuth, async (req: Request, res: Response) => {
    try {
      const pool = getPool();
      const rows = await findAccessoriesByOwner(pool, (req as any).ownerId);
      const items = rows.map((r: any) => ({
        accessoryUuid: r.accessory_uuid,
        name: r.name,
        attachmentBone: r.attachment_bone,
        compatibleProfiles: typeof r.compatible_profiles === "string" ? JSON.parse(r.compatible_profiles) : r.compatible_profiles,
        exportPolicy: r.export_policy,
      }));
      res.json({ accessories: items });
    } catch (err: any) {
      handleError(res, err);
    }
  });

  return router;
}

function handleError(res: Response, err: any): void {
  if (err instanceof RigPipelineError) {
    const statusMap: Record<string, number> = {
      NOT_FOUND: 404,
      FORBIDDEN: 403,
      UNACCEPTED_MODEL: 422,
      UNSUPPORTED_GEOMETRY: 422,
      HASH_MISMATCH: 400,
      INVALID_STATE: 409,
      VALIDATION_FAILED: 422,
      PROFILE_MISMATCH: 422,
      INVALID_ASSET: 422,
      MAX_ATTEMPTS: 409,
      IDEMPOTENCY_CONFLICT: 409,
    };
    res.status(statusMap[err.code] || 400).json({ error: err.message, code: err.code });
    return;
  }
  if (err.name === "ZodError") {
    res.status(400).json({ error: "Validation error", details: err.errors });
    return;
  }
  console.error("[rig-pipeline] Router error:", err);
  res.status(500).json({ error: "Internal server error", code: "INTERNAL_ERROR" });
}
