import express, {
  type Application,
  type ErrorRequestHandler,
  type Express,
} from "express";
import { createPetSimRouter, type PetSimDeps } from "./petSimRouter";

// The data URL itself is capped at 5 MiB by image-input.ts. This small envelope
// accommodates JSON syntax and the other bounded request fields.
export const PETSIM_IMAGE_JSON_LIMIT = "6mb";
export const PETSIM_IMAGE_ROUTES: string[] = [
  "/api/pets/classify",
  "/api/ar/semantic-scan",
];

export function isPetSimImageRoute(pathname: string): boolean {
  const normalized = pathname.length > 1 && pathname.endsWith("/")
    ? pathname.slice(0, -1)
    : pathname;
  return PETSIM_IMAGE_ROUTES.includes(normalized);
}

const imageJsonParser = express.json({ limit: PETSIM_IMAGE_JSON_LIMIT });

const imageJsonErrorHandler: ErrorRequestHandler = (error, _req, res, next) => {
  if (error?.type === "entity.too.large" || error?.status === 413) {
    res.status(413).json({
      error: "Image request exceeds the size limit.",
      validation: ["REQUEST_TOO_LARGE"],
    });
    return;
  }
  next(error);
};

/** Install before the global 1 MiB parser in the full production server. */
export function installPetSimImageBodyParsing(app: Application): void {
  app.use(PETSIM_IMAGE_ROUTES, imageJsonParser);
  app.use(PETSIM_IMAGE_ROUTES, imageJsonErrorHandler);
}

/**
 * In-process production app for the paid pet-simulation routes. Tests import
 * this factory, while server.ts uses the same parser installer and router.
 */
export function createPetSimApp(deps: PetSimDeps): Express {
  const app = express();
  installPetSimImageBodyParsing(app);
  app.use(express.json({ limit: "1mb" }));
  app.use(createPetSimRouter(deps));
  return app;
}
