import { randomUUID } from "node:crypto";
import { Router, type NextFunction, type Request, type Response } from "express";
import { requireAuth, type AuthedRequest } from "../../auth";
import { HermesClientError, type HermesClient } from "./client";
import type { GeminiAdapter } from "./gemini_adapter";
import {
  HermesBridgeCreateResponseSchema,
  HermesBridgeStatusResponseSchema,
  HermesCreateRequestSchemas,
  HermesLookSpecSchema,
  HermesJobParamsSchema,
  HermesLocalJobIdSchema,
  HermesOwnerKeySchema,
  type HermesJobType,
  type HermesJsonValue,
} from "./schemas";
import {
  InMemoryHermesMinuteLimits,
  type HermesLimitScope,
  type HermesMinuteLimits,
} from "./limits";
import type { HermesJobRecord, HermesStore } from "./store";

export const HERMES_DAILY_CAPS: Record<HermesJobType, number> = {
  translate: 20,
  knowledge: 10,
  looks: 10,
};

export const HERMES_SANITIZED_ERRORS = {
  submissionFailed: "Hermes submission failed.",
  jobFailed: "Hermes job failed.",
  statusUnavailable: "Hermes status is temporarily unavailable.",
} as const;

const APPROVED_STORED_ERRORS = new Set<string>(Object.values(HERMES_SANITIZED_ERRORS));
const TERMINAL_STATUSES = new Set([
  "completed",
  "succeeded",
  "done",
  "failed",
  "cancelled",
  "canceled",
]);
const FAILURE_STATUSES = new Set(["failed", "cancelled", "canceled"]);
const PRIVATE_RESULT_KEYS = new Set([
  "job_id",
  "bridge_id",
  "bridge_job_id",
  "producer_job_id",
  "idempotency_key",
]);

export interface HermesDailyUsage {
  increment(owner: string, type: HermesJobType): Promise<number>;
}

export interface HermesRouterDeps {
  enabled: boolean;
  client: HermesClient | null;
  store: HermesStore;
  dailyUsage: HermesDailyUsage;
  minuteLimits?: HermesMinuteLimits;
  idFactory?: () => string;
  /**
   * Gemini-backed adapter for all three job types.
   * Used automatically when `enabled` is false (Hermes bridge disabled).
   * If both `enabled` and `geminiAdapter` are absent, endpoints return 503.
   */
  geminiAdapter?: GeminiAdapter;
}

function requireStrictHermesAuth(req: AuthedRequest, res: Response, next: NextFunction): void {
  requireAuth(req, res, () => {
    if (!HermesOwnerKeySchema.safeParse(req.user?.phone).success) {
      res.status(401).json({ error: "Unauthorized. Please sign in to continue." });
      return;
    }
    next();
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
  if (!job.error) return null;
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

function rejectMinuteLimit(
  scope: HermesLimitScope,
  req: AuthedRequest,
  res: Response,
  limits: HermesMinuteLimits,
): boolean {
  const decision = limits.consume(scope, req.user!.phone, clientIp(req));
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

  router.use("/api/hermes", requireStrictHermesAuth);
  router.use("/api/hermes", (_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });

  const createHandler = (type: HermesJobType) => async (req: AuthedRequest, res: Response) => {
    const parsed = HermesCreateRequestSchemas[type].safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({
        error: "Invalid Hermes request.",
        validation: parsed.error.issues.map((issue) => issue.message),
      });
    }

    // -----------------------------------------------------------------------
    // Gemini adapter path — used when the Hermes bridge is disabled.
    // Runs the Gemini call synchronously and stores the completed result, so
    // the polling endpoint returns immediately on the first GET.
    // -----------------------------------------------------------------------
    if (!deps.enabled || !deps.client) {
      if (!deps.geminiAdapter) {
        return res.status(503).json({ error: "Hermes is unavailable." });
      }

      if (rejectMinuteLimit("create", req, res, limits)) return;

      let dailyCount: number;
      try {
        dailyCount = await deps.dailyUsage.increment(req.user!.phone, type);
      } catch {
        return res.status(503).json({ error: "Hermes usage tracking is unavailable." });
      }
      const dailyCap = HERMES_DAILY_CAPS[type];
      if (!Number.isInteger(dailyCount) || dailyCount < 1) {
        return res.status(503).json({ error: "Hermes usage tracking is unavailable." });
      }
      if (dailyCount > dailyCap) {
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
        });
      } catch {
        return res.status(500).json({ error: "Unable to create Hermes job." });
      }

      // Run Gemini synchronously.
      let geminiResult: HermesJsonValue;
      try {
        geminiResult = await deps.geminiAdapter.run(type, parsed.data.payload);
      } catch {
        await safeUpdateJob(deps.store, {
          id: localId.data,
          owner: req.user!.phone,
          status: "failed",
          result: null,
          error: HERMES_SANITIZED_ERRORS.submissionFailed,
        });
        return res.status(502).json({ error: "Hermes service is temporarily unavailable." });
      }

      // Validate looks result against the same schema the bridge path uses.
      if (type === "looks") {
        const constrained = HermesLookSpecSchema.safeParse(geminiResult);
        if (!constrained.success) {
          await safeUpdateJob(deps.store, {
            id: localId.data,
            owner: req.user!.phone,
            status: "failed",
            result: null,
            error: HERMES_SANITIZED_ERRORS.jobFailed,
          });
          return res.status(502).json({ error: "Hermes returned an invalid Looks plan." });
        }
        // Store the Zod-parsed (and therefore type-safe) value.
        geminiResult = constrained.data as unknown as HermesJsonValue;
      }

      try {
        await deps.store.updateJob({
          id: localId.data,
          owner: req.user!.phone,
          status: "completed",
          result: geminiResult,
          error: null,
        });
      } catch {
        return res.status(500).json({ error: "Unable to save Hermes job." });
      }

      res.location(`/api/hermes/jobs/${localId.data}`);
      // Return "completed" immediately — no polling required, but the client
      // can still call GET /api/hermes/jobs/:id and receive the cached result.
      return res.status(202).json({
        id: localId.data,
        type,
        status: "completed",
      });
    }

    // -----------------------------------------------------------------------
    // Hermes bridge path (HERMES_ENABLED=true)
    // -----------------------------------------------------------------------
    if (rejectMinuteLimit("create", req, res, limits)) return;

    let dailyCount: number;
    try {
      dailyCount = await deps.dailyUsage.increment(req.user!.phone, type);
    } catch {
      return res.status(503).json({ error: "Hermes usage tracking is unavailable." });
    }
    const dailyCap = HERMES_DAILY_CAPS[type];
    if (!Number.isInteger(dailyCount) || dailyCount < 1) {
      return res.status(503).json({ error: "Hermes usage tracking is unavailable." });
    }
    if (dailyCount > dailyCap) {
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
      });
    } catch {
      return res.status(500).json({ error: "Unable to create Hermes job." });
    }

    let bridgeResponse: unknown;
    try {
      bridgeResponse = await deps.client.createJob(type, parsed.data.payload, localId.data);
    } catch (error) {
      await safeUpdateJob(deps.store, {
        id: localId.data,
        owner: req.user!.phone,
        status: "failed",
        result: null,
        error: HERMES_SANITIZED_ERRORS.submissionFailed,
      });
      sendClientFailure(res, error);
      return;
    }

    const validatedBridge = HermesBridgeCreateResponseSchema.safeParse(bridgeResponse);
    if (!validatedBridge.success) {
      await safeUpdateJob(deps.store, {
        id: localId.data,
        owner: req.user!.phone,
        status: "failed",
        result: null,
        error: HERMES_SANITIZED_ERRORS.submissionFailed,
      });
      sendClientFailure(res, new HermesClientError("invalid_response"));
      return;
    }

    try {
      await deps.store.setBridgeJob({
        id: localId.data,
        owner: req.user!.phone,
        bridgeJobId: validatedBridge.data.job_id,
        status: validatedBridge.data.status,
      });
    } catch {
      return res.status(500).json({ error: "Unable to save Hermes job." });
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
  router.post("/api/hermes/looks", createHandler("looks"));

  router.get("/api/hermes/jobs/:id", async (req: AuthedRequest, res: Response) => {
    const parsedParams = HermesJobParamsSchema.safeParse(req.params);
    if (!parsedParams.success) {
      return res.status(400).json({ error: "Invalid Hermes job ID." });
    }
    // NOTE: The enabled-check is intentionally deferred until after we confirm
    // the job is not already in a terminal state. Gemini-path jobs are stored
    // as "completed" synchronously, so the first (and only) GET must succeed
    // even when HERMES_ENABLED=false.

    let job: HermesJobRecord | null;
    try {
      job = await deps.store.getJob(parsedParams.data.id, req.user!.phone);
    } catch {
      return res.status(500).json({ error: "Unable to read Hermes job." });
    }
    if (!job) return res.status(404).json({ error: "Hermes job not found." });
    if (rejectMinuteLimit("status", req, res, limits)) return;

    // If the job is already terminal and has a result (or is a failure), return
    // the cached record immediately — no bridge call required. This handles both
    // the Gemini adapter path (bridgeJobId is null, status=completed) and
    // previously resolved bridge jobs.
    const cachedTerminal = TERMINAL_STATUSES.has(job.status)
      && (FAILURE_STATUSES.has(job.status) || job.result != null);
    if (!job.bridgeJobId || cachedTerminal) {
      try {
        return res.json(publicJob(job));
      } catch {
        return res.status(500).json({ error: "Unable to read Hermes job." });
      }
    }

    // Beyond this point a bridge round-trip is needed — require the bridge.
    if (!deps.enabled || !deps.client) {
      return res.status(503).json({ error: "Hermes is unavailable." });
    }

    let bridgeResponse: unknown;
    try {
      bridgeResponse = await deps.client.getJob(job.bridgeJobId);
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

    const validatedBridge = HermesBridgeStatusResponseSchema.safeParse(bridgeResponse);
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
    let result = bridge.result == null
      ? null
      : sanitizeHermesResult(bridge.result, job.bridgeJobId);
    if (job.type === "looks" && result != null) {
      const constrained = HermesLookSpecSchema.safeParse(result);
      if (!constrained.success) {
        await safeUpdateJob(deps.store, {
          id: job.id,
          owner: job.owner,
          status: "failed",
          result: null,
          error: HERMES_SANITIZED_ERRORS.jobFailed,
        });
        return res.status(502).json({ error: "Hermes returned an invalid Looks plan." });
      }
      result = constrained.data;
    }
    const error = bridge.error || FAILURE_STATUSES.has(bridge.status)
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
