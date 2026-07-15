import { randomUUID } from "node:crypto";
import { Router, type NextFunction, type Request, type Response } from "express";
import { requireAuth, type AuthedRequest } from "../../auth";
import { HermesClientError, type HermesClient } from "./client";
import {
  HermesBridgeCreateResponseSchema,
  HermesBridgeStatusResponseSchemas,
  HermesCreateRequestSchemas,
  HermesJobParamsSchema,
  HermesLocalJobIdSchema,
  HermesOwnerKeySchema,
  type HermesJobType,
  type HermesJsonValue,
} from "./schemas";
import {
  InMemoryHermesMinuteLimits,
  type HermesDailyUsage,
  type HermesLimitScope,
  type HermesMinuteLimits,
} from "./limits";
import type { HermesJobRecord, HermesStore } from "./store";

export const HERMES_DAILY_CAPS: Record<HermesJobType, number> = {
  translate: 20,
  knowledge: 10,
};

export const HERMES_SANITIZED_ERRORS = {
  submissionFailed: "Hermes submission failed.",
  jobFailed: "Hermes job failed.",
  statusUnavailable: "Hermes status is temporarily unavailable.",
} as const;

const APPROVED_STORED_ERRORS = new Set<string>(Object.values(HERMES_SANITIZED_ERRORS));
const TERMINAL_STATUSES = new Set(["completed", "failed"]);
const FAILURE_STATUSES = new Set(["failed"]);
const PRIVATE_RESULT_KEYS = new Set([
  "job_id",
  "bridge_id",
  "bridge_job_id",
  "producer_job_id",
  "idempotency_key",
]);

export interface HermesRouterDeps {
  enabled: boolean;
  client: HermesClient | null;
  store: HermesStore;
  dailyUsage: HermesDailyUsage;
  minuteLimits?: HermesMinuteLimits;
  authorizeOwner?: (owner: string, uid: number) => Promise<boolean>;
  idFactory?: () => string;
}

function requireStrictHermesAuth(
  deps: HermesRouterDeps,
  req: AuthedRequest,
  res: Response,
  next: NextFunction,
): void {
  requireAuth(req, res, () => {
    const owner = HermesOwnerKeySchema.safeParse(req.user?.phone);
    const uid = req.user?.uid;
    if (!owner.success || !Number.isInteger(uid) || Number(uid) < 1) {
      res.status(401).json({ error: "Unauthorized. Please sign in to continue." });
      return;
    }
    if (!deps.enabled) {
      next();
      return;
    }
    if (!deps.authorizeOwner) {
      res.status(503).json({ error: "Hermes authentication is unavailable." });
      return;
    }
    deps.authorizeOwner(owner.data, Number(uid))
      .then((active) => {
        if (!active) {
          res.status(401).json({ error: "Unauthorized. Please sign in to continue." });
          return;
        }
        next();
      })
      .catch(() => {
        res.status(503).json({ error: "Hermes authentication is unavailable." });
      });
  });
}

function clientIp(req: Request): string {
  return req.ip || req.socket?.remoteAddress || "unknown";
}

function normalizedPrivateKey(key: string): string {
  return key
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/-/g, "_");
}

export function sanitizeHermesResult(
  value: HermesJsonValue,
  bridgeJobId: string | null,
): HermesJsonValue {
  if (typeof value === "string") {
    return bridgeJobId && value.includes(bridgeJobId)
      ? value.split(bridgeJobId).join("[redacted]")
      : value;
  }
  if (value == null || typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map((item) => sanitizeHermesResult(item, bridgeJobId));

  const clean: Record<string, HermesJsonValue> = {};
  for (const [key, item] of Object.entries(value)) {
    if (PRIVATE_RESULT_KEYS.has(normalizedPrivateKey(key))) continue;
    clean[key] = sanitizeHermesResult(item, bridgeJobId);
  }
  return clean;
}

function sanitizedStoredError(job: HermesJobRecord): string | null {
  if (!job.error) {
    return FAILURE_STATUSES.has(job.status) ? HERMES_SANITIZED_ERRORS.jobFailed : null;
  }
  if (APPROVED_STORED_ERRORS.has(job.error)) return job.error;
  return FAILURE_STATUSES.has(job.status)
    ? HERMES_SANITIZED_ERRORS.jobFailed
    : HERMES_SANITIZED_ERRORS.statusUnavailable;
}

function publicJob(job: HermesJobRecord) {
  return {
    id: job.id,
    type: job.type,
    status: job.status,
    result: job.result == null ? null : sanitizeHermesResult(job.result, job.bridgeJobId),
    error: sanitizedStoredError(job),
    created_at: job.createdAt,
    updated_at: job.updatedAt,
  };
}

async function rejectMinuteLimit(
  scope: HermesLimitScope,
  req: AuthedRequest,
  res: Response,
  limits: HermesMinuteLimits,
): Promise<boolean> {
  let decision;
  try {
    decision = await limits.consume(scope, req.user!.phone, clientIp(req));
  } catch {
    res.status(503).json({ error: "Hermes abuse controls are unavailable." });
    return true;
  }
  if (decision.allowed) return false;
  res.setHeader("Retry-After", String(decision.retryAfterSeconds ?? 60));
  res.status(429).json({ error: "Too many Hermes requests. Please try again shortly." });
  return true;
}

function sendClientFailure(res: Response, error: unknown): void {
  if (error instanceof HermesClientError && error.kind === "timeout") {
    res.status(504).json({ error: "Hermes service timed out." });
    return;
  }
  res.status(502).json({ error: "Hermes service is temporarily unavailable." });
}

async function safeUpdateJob(
  store: HermesStore,
  input: Parameters<HermesStore["updateJob"]>[0],
): Promise<void> {
  try {
    await store.updateJob(input);
  } catch {
    // The public response stays sanitized even if recording the failure fails.
  }
}

export function createHermesRouter(deps: HermesRouterDeps): Router {
  const router = Router();
  const limits = deps.minuteLimits ?? new InMemoryHermesMinuteLimits();
  const idFactory = deps.idFactory ?? randomUUID;

  router.use("/api/hermes", (req, res, next) => {
    requireStrictHermesAuth(deps, req, res, next);
  });
  router.use("/api/hermes", (_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });

  const createHandler = (type: HermesJobType) => async (req: AuthedRequest, res: Response) => {
    if (!deps.enabled || !deps.client) {
      return res.status(503).json({ error: "Hermes is unavailable." });
    }
    if (await rejectMinuteLimit("create", req, res, limits)) return;

    const parsed = HermesCreateRequestSchemas[type].safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({
        error: "Invalid Hermes request.",
        validation: parsed.error.issues.map((issue) => issue.message),
      });
    }
    let dailyReservation;
    try {
      dailyReservation = await deps.dailyUsage.reserve(
        req.user!.phone,
        type,
        HERMES_DAILY_CAPS[type],
      );
    } catch {
      return res.status(503).json({ error: "Hermes usage tracking is unavailable." });
    }
    const dailyCap = HERMES_DAILY_CAPS[type];
    if (!Number.isInteger(dailyReservation.count) || dailyReservation.count < 0) {
      return res.status(503).json({ error: "Hermes usage tracking is unavailable." });
    }
    if (!dailyReservation.allowed) {
      return res.status(429).json({
        error: `Daily Hermes ${type} limit reached.`,
        cap: dailyCap,
      });
    }

    const localId = HermesLocalJobIdSchema.safeParse(idFactory());
    if (!localId.success) {
      return res.status(500).json({ error: "Unable to create Hermes job." });
    }

    try {
      await deps.store.createJob({
        id: localId.data,
        owner: req.user!.phone,
        type,
        status: "submitting",
        requestPayload: parsed.data.payload,
      });
    } catch {
      return res.status(500).json({ error: "Unable to create Hermes job." });
    }

    const sendSubmissionPending = () => {
      res.setHeader("Retry-After", "2");
      res.location(`/api/hermes/jobs/${localId.data}`);
      return res.status(202).json({
        id: localId.data,
        type,
        status: "submitting",
      });
    };

    let bridgeResponse: unknown;
    try {
      bridgeResponse = await deps.client.createJob(type, parsed.data.payload, localId.data);
    } catch {
      return sendSubmissionPending();
    }

    const validatedBridge = HermesBridgeCreateResponseSchema.safeParse(bridgeResponse);
    if (!validatedBridge.success) {
      return sendSubmissionPending();
    }

    try {
      await deps.store.setBridgeJob({
        id: localId.data,
        owner: req.user!.phone,
        bridgeJobId: validatedBridge.data.job_id,
        status: validatedBridge.data.status,
      });
    } catch {
      return sendSubmissionPending();
    }

    res.location(`/api/hermes/jobs/${localId.data}`);
    return res.status(202).json({
      id: localId.data,
      type,
      status: validatedBridge.data.status,
    });
  };

  router.post("/api/hermes/translate", createHandler("translate"));
  router.post("/api/hermes/knowledge", createHandler("knowledge"));

  router.get("/api/hermes/jobs/:id", async (req: AuthedRequest, res: Response) => {
    if (!deps.enabled || !deps.client) {
      return res.status(503).json({ error: "Hermes is unavailable." });
    }
    if (await rejectMinuteLimit("status", req, res, limits)) return;

    const parsedParams = HermesJobParamsSchema.safeParse(req.params);
    if (!parsedParams.success) {
      return res.status(400).json({ error: "Invalid Hermes job ID." });
    }

    let job: HermesJobRecord | null;
    try {
      job = await deps.store.getJob(parsedParams.data.id, req.user!.phone);
    } catch {
      return res.status(500).json({ error: "Unable to read Hermes job." });
    }
    if (!job) return res.status(404).json({ error: "Hermes job not found." });

    if (!job.bridgeJobId && job.status === "submitting" && job.requestPayload) {
      let bridgeCreate: unknown;
      try {
        bridgeCreate = await deps.client.createJob(job.type, job.requestPayload, job.id);
      } catch (error) {
        sendClientFailure(res, error);
        return;
      }
      const validatedCreate = HermesBridgeCreateResponseSchema.safeParse(bridgeCreate);
      if (!validatedCreate.success) {
        sendClientFailure(res, new HermesClientError("invalid_response"));
        return;
      }
      try {
        await deps.store.setBridgeJob({
          id: job.id,
          owner: job.owner,
          bridgeJobId: validatedCreate.data.job_id,
          status: validatedCreate.data.status,
        });
        const reconciled = await deps.store.getJob(job.id, job.owner);
        if (!reconciled) return res.status(404).json({ error: "Hermes job not found." });
        job = reconciled;
      } catch {
        return res.status(500).json({ error: "Unable to reconcile Hermes job." });
      }
    }

    const cachedTerminal = TERMINAL_STATUSES.has(job.status)
      && (FAILURE_STATUSES.has(job.status) || job.result != null);
    if (!job.bridgeJobId || cachedTerminal) {
      try {
        return res.json(publicJob(job));
      } catch {
        return res.status(500).json({ error: "Unable to read Hermes job." });
      }
    }

    let bridgeResponse: unknown;
    try {
      bridgeResponse = await deps.client.getJob(job.bridgeJobId, job.type);
    } catch (error) {
      await safeUpdateJob(deps.store, {
        id: job.id,
        owner: job.owner,
        status: job.status,
        result: job.result,
        error: HERMES_SANITIZED_ERRORS.statusUnavailable,
      });
      sendClientFailure(res, error);
      return;
    }

    const validatedBridge = HermesBridgeStatusResponseSchemas[job.type].safeParse(bridgeResponse);
    if (!validatedBridge.success) {
      await safeUpdateJob(deps.store, {
        id: job.id,
        owner: job.owner,
        status: job.status,
        result: job.result,
        error: HERMES_SANITIZED_ERRORS.statusUnavailable,
      });
      sendClientFailure(res, new HermesClientError("invalid_response"));
      return;
    }

    const bridge = validatedBridge.data;
    const result = bridge.result == null
      ? null
      : sanitizeHermesResult(bridge.result as HermesJsonValue, job.bridgeJobId);
    const error = FAILURE_STATUSES.has(bridge.status)
      ? HERMES_SANITIZED_ERRORS.jobFailed
      : null;

    try {
      await deps.store.updateJob({
        id: job.id,
        owner: job.owner,
        status: bridge.status,
        result,
        error,
      });
      const refreshed = await deps.store.getJob(job.id, job.owner);
      if (!refreshed) return res.status(404).json({ error: "Hermes job not found." });
      return res.json(publicJob(refreshed));
    } catch {
      return res.status(500).json({ error: "Unable to save Hermes job status." });
    }
  });

  return router;
}
