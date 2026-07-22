import { Router, type Request, type Response } from "express";
import { isUserAdmin } from "../../db";
import {
  RegisterAssetSchema,
  AddVersionSchema,
  SetCurrentVersionSchema,
  AddLineageSchema,
  SignedAccessSchema,
  AssetListQuerySchema,
  ReconciliationQuerySchema,
} from "./schemas";
import {
  registerAsset,
  addAssetVersion,
  setCurrentVersion,
  addLineage,
  formatPublicAssetMetadata,
  AssetServiceError,
} from "./service";
import {
  findAssetByUuid,
  findAssetsByOwner,
  findVersionById,
  findVersionByAssetAndNumber,
  findVersionsByAssetId,
  findRelationsByVersionId,
} from "./repository";
import { generateSignedUrlForVersion } from "./access";
import { calculateOwnerStorageUsage } from "./accounting";
import { runAssetReconciliation } from "./reconciliation";

export const assetsRouter = Router();

// Middleware to extract authenticated user phone from request
function getRequestUserPhone(req: Request): string | null {
  const user = (req as any).user;
  if (user && user.phone) return String(user.phone);
  if (req.headers["x-user-phone"]) return String(req.headers["x-user-phone"]);
  return null;
}

/**
 * POST /api/assets/register
 * Register a new canonical asset and version 1
 */
assetsRouter.post("/register", async (req: Request, res: Response) => {
  try {
    const userPhone = getRequestUserPhone(req);
    if (!userPhone) return res.status(401).json({ success: false, error: "Authentication required" });

    const payload = { ...req.body, ownerId: userPhone };
    const validated = RegisterAssetSchema.parse(payload);
    const pool = req.app.get("pool") || undefined;

    const { asset, version } = await registerAsset(validated, { isNewObjectUpload: false, pool });
    const formatted = formatPublicAssetMetadata(asset, version);

    return res.status(201).json({ success: true, asset: formatted });
  } catch (error: any) {
    if (error.name === "ZodError") {
      return res.status(400).json({ success: false, error: "Invalid input schema", details: error.errors });
    }
    const statusCode = error instanceof AssetServiceError ? 422 : 500;
    return res.status(statusCode).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/assets/versions
 * Add an immutable version to an existing asset
 */
assetsRouter.post("/versions", async (req: Request, res: Response) => {
  try {
    const userPhone = getRequestUserPhone(req);
    if (!userPhone) return res.status(401).json({ success: false, error: "Authentication required" });

    const validated = AddVersionSchema.parse(req.body);
    const asset = await findAssetByUuid(req.app.get("pool") || undefined, validated.assetUuid);
    if (!asset) return res.status(404).json({ success: false, error: "Asset not found" });

    const pool = req.app.get("pool") || undefined;
    if (asset.owner_id !== userPhone && !await isUserAdmin(userPhone)) {
      return res.status(403).json({ success: false, error: "Access denied to target asset" });
    }

    const { asset: updatedAsset, version } = await addAssetVersion(validated, pool);
    const formatted = formatPublicAssetMetadata(updatedAsset, version);

    return res.status(201).json({ success: true, asset: formatted });
  } catch (error: any) {
    if (error.name === "ZodError") {
      return res.status(400).json({ success: false, error: "Invalid input schema", details: error.errors });
    }
    return res.status(422).json({ success: false, error: error.message });
  }
});

/**
 * PUT /api/assets/current-version
 * Explicitly update the current version pointer
 */
assetsRouter.put("/current-version", async (req: Request, res: Response) => {
  try {
    const userPhone = getRequestUserPhone(req);
    if (!userPhone) return res.status(401).json({ success: false, error: "Authentication required" });

    const validated = SetCurrentVersionSchema.parse(req.body);
    const pool = req.app.get("pool") || undefined;
    const asset = await findAssetByUuid(pool, validated.assetUuid);
    if (!asset) return res.status(404).json({ success: false, error: "Asset not found" });

    if (asset.owner_id !== userPhone && !await isUserAdmin(userPhone)) {
      return res.status(403).json({ success: false, error: "Access denied to target asset" });
    }

    const { asset: updatedAsset, version } = await setCurrentVersion(validated.assetUuid, validated.versionNumber, pool);
    const formatted = formatPublicAssetMetadata(updatedAsset, version);

    return res.json({ success: true, asset: formatted });
  } catch (error: any) {
    if (error.name === "ZodError") {
      return res.status(400).json({ success: false, error: "Invalid input schema", details: error.errors });
    }
    return res.status(422).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/assets/lineage
 * Record parent/child lineage graph relationship
 */
assetsRouter.post("/lineage", async (req: Request, res: Response) => {
  try {
    const userPhone = getRequestUserPhone(req);
    if (!userPhone) return res.status(401).json({ success: false, error: "Authentication required" });

    const validated = AddLineageSchema.parse(req.body);
    const pool = req.app.get("pool") || undefined;
    await addLineage(validated, pool);

    return res.status(201).json({ success: true });
  } catch (error: any) {
    if (error.name === "ZodError") {
      return res.status(400).json({ success: false, error: "Invalid input schema", details: error.errors });
    }
    return res.status(422).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/assets/list
 * List owner's canonical assets
 */
assetsRouter.get("/list", async (req: Request, res: Response) => {
  try {
    const userPhone = getRequestUserPhone(req);
    if (!userPhone) return res.status(401).json({ success: false, error: "Authentication required" });

    const query = AssetListQuerySchema.parse(req.query);
    const ownerId = query.ownerId && await isUserAdmin(userPhone) ? query.ownerId : userPhone;

    const assets = await findAssetsByOwner(req.app.get("pool") || undefined, ownerId, {
      assetType: query.assetType,
      visibility: query.visibility,
      status: query.status,
      limit: query.limit,
      offset: query.offset,
    });

    const result = await Promise.all(
      assets.map(async (a) => {
        const currentVersion = a.current_version_id
          ? await findVersionById(req.app.get("pool") || undefined, a.current_version_id)
          : null;
        return formatPublicAssetMetadata(a, currentVersion);
      }),
    );

    return res.json({ success: true, count: result.length, assets: result });
  } catch (error: any) {
    return res.status(400).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/assets/detail/:uuid
 * Get detailed asset metadata and version history
 */
assetsRouter.get("/detail/:uuid", async (req: Request, res: Response) => {
  try {
    const userPhone = getRequestUserPhone(req);
    const assetUuid = String(req.params.uuid);
    const pool = req.app.get("pool") || undefined;

    const asset = await findAssetByUuid(pool, assetUuid);
    if (!asset) return res.status(404).json({ success: false, error: "Asset not found" });

    const isOwner = Boolean(userPhone && asset.owner_id === userPhone);
    const userIsAdmin = (!isOwner && userPhone)
      ? await isUserAdmin(userPhone).catch(() => false)
      : false;

    if (asset.visibility === "private" && !isOwner && !userIsAdmin) {
      return res.status(403).json({ success: false, error: "Access denied to private asset" });
    }

    const versions = await findVersionsByAssetId(pool, asset.id);
    const currentVersion = asset.current_version_id
      ? await findVersionById(pool, asset.current_version_id)
      : null;

    const formattedAsset = formatPublicAssetMetadata(asset, currentVersion);
    const versionHistory = versions.map((v) => ({
      versionNumber: v.version_number,
      sha256: v.sha256,
      mimeType: v.mime_type,
      sizeBytes: v.size_bytes,
      bucket: v.bucket,
      sourceProvider: v.source_provider,
      license: v.license,
      commercialUseEligible: v.commercial_use_eligible,
      createdAt: v.created_at.toISOString(),
    }));

    let lineage: any = null;
    if (currentVersion) {
      const rels = await findRelationsByVersionId(pool, currentVersion.id);
      lineage = {
        parents: rels.parents.map((p) => ({ parentVersionId: p.parent_version_id, relationType: p.relation_type })),
        children: rels.children.map((c) => ({ childVersionId: c.child_version_id, relationType: c.relation_type })),
      };
    }

    return res.json({
      success: true,
      asset: formattedAsset,
      versions: versionHistory,
      lineage,
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/assets/signed-url/:uuid
 * Generate short-lived signed access URL for asset version
 */
assetsRouter.get("/signed-url/:uuid", async (req: Request, res: Response) => {
  try {
    const userPhone = getRequestUserPhone(req);
    const assetUuid = String(req.params.uuid);
    const ttlSeconds = req.query.ttl ? parseInt(String(req.query.ttl), 10) : 900;
    const versionNumber = req.query.version ? parseInt(String(req.query.version), 10) : undefined;
    const pool = req.app.get("pool") || undefined;

    const asset = await findAssetByUuid(pool, assetUuid);
    if (!asset) return res.status(404).json({ success: false, error: "Asset not found" });

    const userIsAdmin = userPhone ? await isUserAdmin(userPhone) : false;

    let targetVersion = null;
    if (versionNumber) {
      targetVersion = await findVersionByAssetAndNumber(pool, asset.id, versionNumber);
    } else if (asset.current_version_id) {
      targetVersion = await findVersionById(pool, asset.current_version_id);
    }

    if (!targetVersion) {
      return res.status(404).json({ success: false, error: "Target version not found" });
    }

    const signedUrl = await generateSignedUrlForVersion(asset, targetVersion, userPhone || undefined, userIsAdmin, ttlSeconds);
    return res.json({ success: true, assetUuid: asset.asset_uuid, versionNumber: targetVersion.version_number, signedUrl, expiresSeconds: ttlSeconds });
  } catch (error: any) {
    const statusCode = error instanceof AssetServiceError && error.code === "UNAUTHORIZED" ? 403 : 422;
    return res.status(statusCode).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/assets/storage-usage
 * Get distinct physical storage totals for authenticated user
 */
assetsRouter.get("/storage-usage", async (req: Request, res: Response) => {
  try {
    const userPhone = getRequestUserPhone(req);
    if (!userPhone) return res.status(401).json({ success: false, error: "Authentication required" });

    const usage = await calculateOwnerStorageUsage(userPhone, req.app.get("pool") || undefined);
    return res.json({ success: true, usage });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/assets/reconciliation
 * Administrative reconciliation report (admin only)
 */
assetsRouter.get("/reconciliation", async (req: Request, res: Response) => {
  try {
    const userPhone = getRequestUserPhone(req);
    if (!userPhone || !await isUserAdmin(userPhone)) {
      return res.status(403).json({ success: false, error: "Admin authority required" });
    }

    const query = ReconciliationQuerySchema.parse(req.query);
    const report = await runAssetReconciliation({ fixMode: Boolean(query.fix), pool: req.app.get("pool") || undefined });

    return res.json({ success: true, report });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/assets/reconciliation/fix
 * Administrative reconciliation fix execution (admin only)
 */
assetsRouter.post("/reconciliation/fix", async (req: Request, res: Response) => {
  try {
    const userPhone = getRequestUserPhone(req);
    if (!userPhone || !await isUserAdmin(userPhone)) {
      return res.status(403).json({ success: false, error: "Admin authority required" });
    }

    const report = await runAssetReconciliation({ fixMode: true, pool: req.app.get("pool") || undefined });
    return res.json({ success: true, report });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});
