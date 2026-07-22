import Stripe from "stripe";
import type mysql from "mysql2/promise";
import { dbConfigured, getPool } from "../../db.ts";
import { MysqlWagsApiRepository } from "./mysqlAdapter.ts";
import {
  StripeWagsCheckoutProvider,
  StripeWagsReconciliationProvider,
  StripeWagsWebhookVerifier,
} from "./stripeAdapter.ts";
import { WagsApiService } from "./service.ts";

export interface WagsV2ProductionDependencies {
  env?: NodeJS.ProcessEnv;
  pool?: mysql.Pool;
  stripe?: Stripe;
}

function requiredSecret(env: NodeJS.ProcessEnv, name: string, prefix: string): string {
  const value = env[name]?.trim() || "";
  if (!value || !value.startsWith(prefix) || /replace|example|changeme/i.test(value)) {
    throw new Error(`${name} is missing or invalid; Wags v2 production adapters are disabled.`);
  }
  return value;
}

/**
 * Creates the router dependencies without enabling WAGS_V2_ENABLED. The caller
 * must still mount the webhook before a global JSON parser and explicitly turn
 * on the feature only after migration and Stripe gates pass.
 */
export function createWagsV2Production(dependencies: WagsV2ProductionDependencies = {}) {
  const env = dependencies.env || process.env;
  const stripeSecret = requiredSecret(env, "STRIPE_SECRET_KEY", "sk_");
  const webhookSecret = requiredSecret(env, "WAGS_STRIPE_WEBHOOK_SECRET", "whsec_");
  if (!dependencies.pool && !dbConfigured()) {
    throw new Error("Database configuration is required for Wags v2 production adapters.");
  }
  const pool = dependencies.pool || getPool();
  const stripe = dependencies.stripe || new Stripe(stripeSecret, {
    maxNetworkRetries: 2,
    timeout: 20_000,
  });
  const repository = new MysqlWagsApiRepository(pool);
  const service = new WagsApiService({
    repository,
    checkoutProvider: new StripeWagsCheckoutProvider(stripe, repository),
    stripeVerifier: new StripeWagsWebhookVerifier(stripe, webhookSecret, repository),
    reconciliationProvider: new StripeWagsReconciliationProvider(stripe, repository),
  });
  return {
    service,
    repository,
    resolveOwnerUuid: repository.resolveOwnerUuid.bind(repository),
  };
}
