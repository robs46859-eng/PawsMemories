import { v4 as uuidv4 } from "uuid";
import type mysql from "mysql2/promise";
import { getPool } from "../../db";
import { deletePrivateObject } from "../../storage.private";
import {
  RegisterAssetSchema,
  AddVersionSchema,
  SetCurrentVersionSchema,
  AddLineageSchema,
  type RegisterAssetInput,
  type AddVersionInput,
} from "./schemas";
import {
  insertAsset,
  findAssetByUuid,
  findAssetById,
  insertAssetVersion,
  findVersionByAssetAndNumber,
  findVersionById,
  findVersionsByAssetId,
  updateAssetCurrentVersion,
  insertAssetRelation,
  findRelationsByVersionId,
  insertLegacyLink,
  findLegacyLink,
} from "./repository";
import type {
  AssetRecord,
  AssetVersionRecord,
  PublicAssetMetadata,
  PublicAssetVersionMetadata,
  RelationType,
} from "./types";

export class AssetServiceError extends Error {
  constructor(message: string, public code: string = "ASSET_SERVICE_ERROR") {
    super(message);
    this.name = "AssetServiceError";
  }
}

export async function registerAsset(
  input: RegisterAssetInput,
  options: { isNewObjectUpload?: boolean; pool?: mysql.Pool } = {},
): Promise<{ asset: AssetRecord; version: AssetVersionRecord }> {
  const validated = RegisterAssetSchema.parse(input);
  const pool = options.pool || getPool();
  const assetUuid = uuidv4();
  const isNewUpload = options.isNewObjectUpload ?? true;

  // Check if legacy mapping already exists for idempotency
  if (validated.legacyTable && validated.legacyId) {
    const existingLink = await findLegacyLink(pool, validated.legacyTable, validated.legacyId);
    if (existingLink) {
      const asset = await findAssetById(pool, existingLink.asset_id);
      const version = await findVersionById(pool, existingLink.asset_version_id);
      if (asset && version) {
        return { asset, version };
      }
    }
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const asset = await insertAsset(connection, {
      assetUuid,
      ownerId: validated.ownerId,
      assetType: validated.assetType,
      visibility: validated.visibility,
    });

    const version = await insertAssetVersion(connection, {
      assetId: asset.id,
      versionNumber: 1,
      sha256: validated.sha256,
      mimeType: validated.mimeType,
      sizeBytes: validated.sizeBytes,
      bucket: validated.bucket,
      objectKey: validated.objectKey,
      metadata: validated.metadata,
      sourceProvider: validated.sourceProvider,
      license: validated.license,
      commercialUseEligible: validated.commercialUseEligible,
    });

    await updateAssetCurrentVersion(connection, asset.id, version.id);
    asset.current_version_id = version.id;

    if (validated.legacyTable && validated.legacyId) {
      await insertLegacyLink(connection, {
        legacyTable: validated.legacyTable,
        legacyId: validated.legacyId,
        assetId: asset.id,
        assetVersionId: version.id,
      });
    }

    await connection.commit();
    return { asset, version };
  } catch (error: any) {
    await connection.rollback();

    // Compensating storage cleanup ONLY for newly uploaded private objects
    if (isNewUpload && validated.bucket === "private" && validated.objectKey) {
      await deletePrivateObject(validated.objectKey).catch((cleanupErr) => {
        console.error("⚠️ Compensating private object cleanup failed during asset registration:", {
          objectKey: validated.objectKey,
          cleanupErr,
        });
      });
    }

    throw new AssetServiceError(
      `Failed to register asset: ${error.message}`,
      error.code || "REGISTRATION_FAILED",
    );
  } finally {
    connection.release();
  }
}

export async function addAssetVersion(
  input: AddVersionInput,
  pool: mysql.Pool = getPool(),
): Promise<{ asset: AssetRecord; version: AssetVersionRecord }> {
  const validated = AddVersionSchema.parse(input);

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const asset = await findAssetByUuid(connection, validated.assetUuid);
    if (!asset) {
      throw new AssetServiceError(`Asset with UUID ${validated.assetUuid} not found`, "ASSET_NOT_FOUND");
    }

    const existingVersions = await findVersionsByAssetId(connection, asset.id);
    const maxVersion = existingVersions.reduce((max, v) => (v.version_number > max ? v.version_number : max), 0);
    const nextVersionNumber = maxVersion + 1;

    const version = await insertAssetVersion(connection, {
      assetId: asset.id,
      versionNumber: nextVersionNumber,
      sha256: validated.sha256,
      mimeType: validated.mimeType,
      sizeBytes: validated.sizeBytes,
      bucket: validated.bucket,
      objectKey: validated.objectKey,
      metadata: validated.metadata,
      sourceProvider: validated.sourceProvider,
      license: validated.license,
      commercialUseEligible: validated.commercialUseEligible,
    });

    if (validated.setAsCurrent) {
      await updateAssetCurrentVersion(connection, asset.id, version.id);
      asset.current_version_id = version.id;
    }

    await connection.commit();
    return { asset, version };
  } catch (error: any) {
    await connection.rollback();
    throw error instanceof AssetServiceError
      ? error
      : new AssetServiceError(`Failed to add asset version: ${error.message}`);
  } finally {
    connection.release();
  }
}

export async function setCurrentVersion(
  assetUuid: string,
  versionNumber: number,
  pool: mysql.Pool = getPool(),
): Promise<{ asset: AssetRecord; version: AssetVersionRecord }> {
  SetCurrentVersionSchema.parse({ assetUuid, versionNumber });

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const asset = await findAssetByUuid(connection, assetUuid);
    if (!asset) throw new AssetServiceError(`Asset ${assetUuid} not found`, "ASSET_NOT_FOUND");

    const version = await findVersionByAssetAndNumber(connection, asset.id, versionNumber);
    if (!version) {
      throw new AssetServiceError(
        `Version ${versionNumber} does not exist for asset ${assetUuid}`,
        "VERSION_NOT_FOUND",
      );
    }

    await updateAssetCurrentVersion(connection, asset.id, version.id);
    asset.current_version_id = version.id;

    await connection.commit();
    return { asset, version };
  } catch (error: any) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function addLineage(
  input: {
    parentAssetUuid: string;
    parentVersionNumber: number;
    childAssetUuid: string;
    childVersionNumber: number;
    relationType: RelationType;
  },
  pool: mysql.Pool = getPool(),
): Promise<void> {
  const validated = AddLineageSchema.parse(input);

  const parentAsset = await findAssetByUuid(pool, validated.parentAssetUuid);
  if (!parentAsset) throw new AssetServiceError(`Parent asset ${validated.parentAssetUuid} not found`, "NOT_FOUND");

  const parentVersion = await findVersionByAssetAndNumber(pool, parentAsset.id, validated.parentVersionNumber);
  if (!parentVersion) throw new AssetServiceError(`Parent version ${validated.parentVersionNumber} not found`, "NOT_FOUND");

  const childAsset = await findAssetByUuid(pool, validated.childAssetUuid);
  if (!childAsset) throw new AssetServiceError(`Child asset ${validated.childAssetUuid} not found`, "NOT_FOUND");

  const childVersion = await findVersionByAssetAndNumber(pool, childAsset.id, validated.childVersionNumber);
  if (!childVersion) throw new AssetServiceError(`Child version ${validated.childVersionNumber} not found`, "NOT_FOUND");

  if (parentVersion.id === childVersion.id) {
    throw new AssetServiceError("Self-lineage relationship is not allowed.", "INVALID_LINEAGE");
  }

  await insertAssetRelation(pool, {
    parentVersionId: parentVersion.id,
    childVersionId: childVersion.id,
    relationType: validated.relationType,
  });
}

export function formatPublicVersionMetadata(version: AssetVersionRecord): PublicAssetVersionMetadata {
  return {
    versionNumber: version.version_number,
    sha256: version.sha256,
    mimeType: version.mime_type,
    sizeBytes: version.size_bytes,
    bucket: version.bucket,
    metadata: version.metadata,
    sourceProvider: version.source_provider,
    license: version.license,
    commercialUseEligible: version.commercial_use_eligible,
    createdAt: version.created_at.toISOString(),
  };
}

export function formatPublicAssetMetadata(
  asset: AssetRecord,
  currentVersion: AssetVersionRecord | null,
): PublicAssetMetadata {
  return {
    assetUuid: asset.asset_uuid,
    ownerId: asset.owner_id,
    assetType: asset.asset_type,
    visibility: asset.visibility,
    status: asset.status,
    currentVersion: currentVersion ? formatPublicVersionMetadata(currentVersion) : null,
    createdAt: asset.created_at.toISOString(),
    updatedAt: asset.updated_at.toISOString(),
  };
}
