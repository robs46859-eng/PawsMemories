import type { NextFunction, Request, Response } from "express";

export function canonicalAssetsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.CANONICAL_ASSETS_ENABLED?.trim().toLowerCase() === "true";
}

export function requireCanonicalAssetsEnabled(req: Request, res: Response, next: NextFunction) {
  if (!canonicalAssetsEnabled()) {
    return res.status(404).json({ error: "Not found" });
  }
  next();
}
