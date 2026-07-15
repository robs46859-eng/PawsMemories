import express, { type ErrorRequestHandler, type Express } from "express";
import { dbConfigured, findUserByPhone, getPool } from "../../db";
import { EdgeHermesClient } from "./client";
import { loadHermesConfig } from "./config";
import { createHermesRouter, type HermesRouterDeps } from "./router";
import { MySqlHermesDailyUsage, MySqlHermesMinuteLimits } from "./limits";
import { MySqlHermesStore } from "./store";

const HERMES_JSON_LIMIT = "256kb";

const hermesJsonErrorHandler: ErrorRequestHandler = (error, _req, res, next) => {
  if (error?.type === "entity.too.large" || error?.status === 413) {
    res.status(413).json({ error: "Hermes request exceeds the size limit." });
    return;
  }
  if (error instanceof SyntaxError || error?.status === 400) {
    res.status(400).json({ error: "Invalid JSON request." });
    return;
  }
  next(error);
};

/** The exact app mounted by production and exercised by contract tests. */
export function createHermesApp(deps: HermesRouterDeps): Express {
  const app = express();
  app.set("trust proxy", 1);
  app.use("/api/hermes", express.json({ limit: HERMES_JSON_LIMIT, strict: true }));
  app.use("/api/hermes", hermesJsonErrorHandler);
  app.use(createHermesRouter(deps));
  app.use("/api/hermes", (_req, res) => res.status(404).json({ error: "Hermes endpoint not found." }));
  return app;
}

export async function createProductionHermesApp(): Promise<Express> {
  const config = loadHermesConfig();
  const databaseReady = dbConfigured();
  if (config.enabled && !databaseReady) {
    throw new Error("Hermes requires database configuration.");
  }

  const pool = getPool();
  const store = new MySqlHermesStore(pool);
  const minuteLimits = new MySqlHermesMinuteLimits(pool);
  if (databaseReady) {
    try {
      await store.ensureSchema();
      await minuteLimits.ensureSchema();
    } catch {
      if (config.enabled) throw new Error("Hermes database initialization failed.");
      console.warn("[Hermes] Table initialization skipped while Hermes is disabled.");
    }
  }

  return createHermesApp({
    enabled: config.enabled,
    client: config.enabled ? new EdgeHermesClient(config) : null,
    store,
    dailyUsage: new MySqlHermesDailyUsage(pool),
    minuteLimits,
    authorizeOwner: async (owner, uid) => {
      const user = await findUserByPhone(owner);
      return user != null && user.id === uid;
    },
  });
}
