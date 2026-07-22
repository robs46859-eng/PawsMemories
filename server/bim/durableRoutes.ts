import { Router, type NextFunction, type Response } from "express";
import type mysql from "mysql2/promise";
import { z } from "zod";
import { requireAuth, type AuthedRequest } from "../../auth";
import { DurableBimRepository } from "./durableRepository";
import { isDurableBimV2Enabled } from "./durableFeatureFlag";
import {
  AcceptDurableBimRequestSchema,
  EmptyDurableBimRequestSchema,
  EnqueueDurableBimRequestSchema,
  RetryDurableBimRequestSchema,
} from "./durableSchemas";
import { DurableBimService, normalizeDurableBimError } from "./durableService";
import type {
  DurableBimArtifactRegistrarPort,
  DurableBimCreditPort,
  DurableBimPostBuildVerifierPort,
  DurableBimWorkerPort,
} from "./durableTypes";

const JobUuidSchema = z.string().uuid();

export interface DurableBimRouterDependencies {
  service: DurableBimService;
  enabled?: boolean;
}
export interface SqlDurableBimRouterDependencies {
  pool: mysql.Pool;
  worker: DurableBimWorkerPort;
  artifactRegistrar: DurableBimArtifactRegistrarPort;
  postBuildVerifier: DurableBimPostBuildVerifierPort;
  credits: DurableBimCreditPort;
  enabled?: boolean;
}

export function createSqlDurableBimRouter(deps: SqlDurableBimRouterDependencies): Router {
  return createDurableBimRouter({
    enabled: deps.enabled,
    service: new DurableBimService({
      repository: new DurableBimRepository(deps.pool),
      worker: deps.worker,
      artifactRegistrar: deps.artifactRegistrar,
      postBuildVerifier: deps.postBuildVerifier,
      credits: deps.credits,
    }),
  });
}

export function createDurableBimRouter(deps: DurableBimRouterDependencies): Router {
  const router = Router();
  router.use(requireAuth);
  router.use((_req: AuthedRequest, res: Response, next: NextFunction) => {
    if (deps.enabled ?? isDurableBimV2Enabled()) return next();
    return res.status(503).json({ error: "Durable BIM v2 is disabled", code: "FEATURE_DISABLED" });
  });

  router.post("/jobs", async (req: AuthedRequest, res: Response) => {
    try {
      const input = EnqueueDurableBimRequestSchema.parse(req.body);
      const result = await deps.service.enqueue(requireOwner(req), input);
      return res.status(201).json(result);
    } catch (error) {
      return sendError(res, error);
    }
  });

  router.get("/jobs/:uuid", async (req: AuthedRequest, res: Response) => {
    try {
      const jobUuid = JobUuidSchema.parse(req.params.uuid);
      return res.json(await deps.service.get(requireOwner(req), jobUuid));
    } catch (error) {
      return sendError(res, error);
    }
  });

  router.post("/jobs/:uuid/retry", async (req: AuthedRequest, res: Response) => {
    try {
      const jobUuid = JobUuidSchema.parse(req.params.uuid);
      const input = RetryDurableBimRequestSchema.parse(req.body);
      return res.status(202).json(await deps.service.retry(requireOwner(req), jobUuid, input.idempotencyKey));
    } catch (error) {
      return sendError(res, error);
    }
  });

  router.post("/jobs/:uuid/cancel", async (req: AuthedRequest, res: Response) => {
    try {
      const jobUuid = JobUuidSchema.parse(req.params.uuid);
      EmptyDurableBimRequestSchema.parse(req.body || {});
      return res.json(await deps.service.cancel(requireOwner(req), jobUuid));
    } catch (error) {
      return sendError(res, error);
    }
  });

  router.post("/jobs/:uuid/accept", async (req: AuthedRequest, res: Response) => {
    try {
      const jobUuid = JobUuidSchema.parse(req.params.uuid);
      const input = AcceptDurableBimRequestSchema.parse(req.body);
      return res.json(await deps.service.accept(requireOwner(req), jobUuid, input.outputManifestHash));
    } catch (error) {
      return sendError(res, error);
    }
  });

  router.post("/jobs/:uuid/reconcile-credits", async (req: AuthedRequest, res: Response) => {
    try {
      const jobUuid = JobUuidSchema.parse(req.params.uuid);
      EmptyDurableBimRequestSchema.parse(req.body || {});
      return res.json(await deps.service.reconcileCredits(requireOwner(req), jobUuid));
    } catch (error) {
      return sendError(res, error);
    }
  });

  return router;
}

function requireOwner(req: AuthedRequest): string {
  if (!req.user?.phone) throw new Error("Authentication middleware did not supply an owner");
  return String(req.user.phone);
}

function sendError(res: Response, error: unknown): Response {
  if (error instanceof z.ZodError) {
    return res.status(400).json({ error: "Invalid BIM request", code: "VALIDATION_ERROR", details: error.issues });
  }
  const normalized = normalizeDurableBimError(error);
  const statuses: Record<string, number> = {
    NOT_FOUND: 404,
    HASH_MISMATCH: 409,
    WORKER_HASH_MISMATCH: 422,
    POSTBUILD_HASH_MISMATCH: 422,
    IDEMPOTENCY_CONFLICT: 409,
    INVALID_STATE: 409,
    MAX_ATTEMPTS: 409,
    PREBUILD_FAILED: 422,
    POSTBUILD_FAILED: 422,
    QUOTE_MISMATCH: 409,
    CREDIT_DEBIT_FAILED: 402,
  };
  const status = statuses[normalized.code] || 500;
  if (status >= 500) console.error("[bim-durable-v2]", normalized);
  return res.status(status).json({ error: normalized.message, code: normalized.code });
}
