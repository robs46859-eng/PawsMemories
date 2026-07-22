import { Router, json, raw, type NextFunction, type Request, type RequestHandler, type Response } from "express";
import { z } from "zod";
import { requireAuth, type AuthedRequest } from "../../auth";
import {
  CreateCheckoutRequestSchema,
  DeliverAnnualIncentiveRequestSchema,
  DeliverPeriodRequestSchema,
  ListPublishedPacksQuerySchema,
  PackIdentityParamsSchema,
  PeriodDeliveryParamsSchema,
  PublicUuidSchema,
  ReconcileSubscriptionRequestSchema,
  SubscriptionIdentityParamsSchema,
} from "./apiContracts.ts";
import { assertWagsV2Enabled } from "./featureFlag.ts";
import { WagsApiError, WagsApiService } from "./service.ts";

export interface CreateWagsV2RouterOptions {
  service: WagsApiService;
  /** Resolves the legacy authenticated subject to a durable public owner UUID. */
  resolveOwnerUuid: (authSubject: string) => Promise<string>;
  authMiddleware?: RequestHandler;
  env?: NodeJS.ProcessEnv;
}

export function createWagsV2Router(options: CreateWagsV2RouterOptions): Router {
  const router = Router();
  const authenticated = options.authMiddleware || requireAuth;

  router.use((_req: Request, res: Response, next: NextFunction) => {
    try {
      assertWagsV2Enabled(options.env);
      next();
    } catch (error) {
      res.status(503).json({ error: error instanceof Error ? error.message : "Wags v2 is disabled.", code: "FEATURE_DISABLED" });
    }
  });

  // Stripe authenticates this route with its signature. It must be mounted with
  // express.raw({ type: "application/json" }) before a JSON body parser.
  router.post("/stripe/webhooks", raw({ type: "application/json", limit: "1mb" }), async (req: Request, res: Response) => {
    try {
      if (!Buffer.isBuffer(req.body)) throw new WagsApiError("Stripe webhook requires the unmodified request bytes.", "RAW_BODY_REQUIRED");
      const signature = req.get("stripe-signature") || "";
      const result = await options.service.handleStripeWebhook(req.body, signature);
      res.status(200).json(result);
    } catch (error) {
      handleWagsError(res, error);
    }
  });

  router.use(json({ limit: "256kb" }));

  router.get("/packs", authenticated, withOwner(options, async (_ownerUuid, req, res) => {
    const query = ListPublishedPacksQuerySchema.parse({
      periodKey: singleQuery(req.query.periodKey),
      tier: singleQuery(req.query.tier),
      cursor: singleQuery(req.query.cursor),
      limit: singleQuery(req.query.limit) || 20,
    });
    res.json(await options.service.listPublishedPacks(query));
  }));

  router.get("/packs/:packUuid/versions/:versionNumber", authenticated, withOwner(options, async (_ownerUuid, req, res) => {
    const params = PackIdentityParamsSchema.parse(req.params);
    res.json(await options.service.getPublishedPack(params.packUuid, params.versionNumber));
  }));

  router.get("/subscriptions/:subscriptionUuid", authenticated, withOwner(options, async (ownerUuid, req, res) => {
    const params = SubscriptionIdentityParamsSchema.parse(req.params);
    res.json(await options.service.getSubscription(ownerUuid, params.subscriptionUuid));
  }));

  router.post("/checkout/sessions", authenticated, withOwner(options, async (ownerUuid, req, res) => {
    const body = CreateCheckoutRequestSchema.parse(req.body);
    res.status(201).json(await options.service.createCheckout(ownerUuid, body));
  }));

  router.post("/subscriptions/:subscriptionUuid/periods/:periodKey/deliver", authenticated, withOwner(options, async (ownerUuid, req, res) => {
    const params = PeriodDeliveryParamsSchema.parse(req.params);
    const body = DeliverPeriodRequestSchema.parse(req.body);
    res.json(await options.service.deliverSubscriptionPeriod(ownerUuid, params.subscriptionUuid, params.periodKey, body));
  }));

  router.post("/subscriptions/:subscriptionUuid/annual-incentive", authenticated, withOwner(options, async (ownerUuid, req, res) => {
    const params = SubscriptionIdentityParamsSchema.parse(req.params);
    const body = DeliverAnnualIncentiveRequestSchema.parse(req.body);
    res.json(await options.service.deliverAnnualIncentive(ownerUuid, params.subscriptionUuid, body));
  }));

  router.post("/subscriptions/:subscriptionUuid/reconcile", authenticated, withOwner(options, async (ownerUuid, req, res) => {
    const params = SubscriptionIdentityParamsSchema.parse(req.params);
    const body = ReconcileSubscriptionRequestSchema.parse(req.body || {});
    res.json(await options.service.reconcileSubscription(ownerUuid, params.subscriptionUuid, body));
  }));

  return router;
}

function withOwner(
  options: CreateWagsV2RouterOptions,
  handler: (ownerUuid: string, req: Request, res: Response) => Promise<void>,
): RequestHandler {
  return async (req: Request, res: Response) => {
    try {
      const authSubject = (req as AuthedRequest).user?.phone;
      if (!authSubject) {
        res.status(401).json({ error: "Authentication required.", code: "UNAUTHORIZED" });
        return;
      }
      const ownerUuid = PublicUuidSchema.parse(await options.resolveOwnerUuid(authSubject));
      await handler(ownerUuid, req, res);
    } catch (error) {
      handleWagsError(res, error);
    }
  };
}

function singleQuery(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function handleWagsError(res: Response, error: unknown): void {
  if (error instanceof WagsApiError) {
    const statuses: Record<WagsApiError["code"], number> = {
      NOT_FOUND: 404,
      FORBIDDEN: 403,
      INVALID_STATE: 409,
      PAYMENT_REQUIRED: 402,
      PACK_INELIGIBLE: 422,
      HASH_MISMATCH: 409,
      IDEMPOTENCY_CONFLICT: 409,
      CHECKOUT_IN_PROGRESS: 409,
      PROVIDER_UNAVAILABLE: 503,
      WEBHOOK_UNAUTHORIZED: 401,
      RAW_BODY_REQUIRED: 415,
    };
    res.status(statuses[error.code]).json({ error: error.message, code: error.code });
    return;
  }
  if (error instanceof z.ZodError) {
    res.status(400).json({ error: "Invalid request.", code: "VALIDATION_ERROR", details: error.issues });
    return;
  }
  console.error("[wags-v2] Router error:", error);
  res.status(500).json({ error: "Internal server error.", code: "INTERNAL_ERROR" });
}
