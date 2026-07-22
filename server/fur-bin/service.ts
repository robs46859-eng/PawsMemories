// ─── Phase 5: Fur Bin Service ────────────────────────────────────────────────
import crypto from "node:crypto";
import type mysql from "mysql2/promise";
import { assertFurBinV5Enabled } from "./featureFlag";
import type {
  FurBinItemPublic,
  ShowcaseRecordPublic,
  ModerationState,
} from "./types";
import {
  insertFurBinItem,
  findFurBinItemByUuid,
  findFurBinItemById,
  findFurBinItemByUuidForUpdate,
  findFurBinItemByOwnerAndAsset,
  sumAssetVersionStorageBytes,
  searchFurBinItems,
  updateItemVersionPointer,
  insertCollection,
  findCollectionByUuid,
  addItemToCollection,
  insertShowcaseRecord,
  findShowcaseByUuid,
  findShowcaseByUuidForUpdate,
  findPublishedShowcaseByUuid,
  updateShowcaseModeration,
  markShowcaseUnpublished,
} from "./repository";
import {
  findVersionById,
  findAssetById,
  findAssetByUuid,
  findVersionByAssetAndNumber,
} from "../assets/repository";
import { generateSignedUrlForVersion } from "../assets/access";

export class FurBinError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = "FurBinError";
  }
}

export class FurBinService {
  constructor(
    private readonly getPoolFn: () => mysql.Pool,
    private readonly signUrl: typeof generateSignedUrlForVersion = generateSignedUrlForVersion,
  ) {}

  // ── 1. Create or Register Fur Bin Item ────────────────────────────────────

  async registerItem(
    ownerId: string,
    params: {
      assetUuid: string;
      versionNumber: number;
      title: string;
      description?: string;
      tags?: string[];
    },
  ): Promise<FurBinItemPublic> {
    assertFurBinV5Enabled();
    const pool = this.getPoolFn();
    const conn = await pool.getConnection();

    try {
      await conn.beginTransaction();
      const asset = await findAssetByUuid(conn, params.assetUuid);
      if (!asset) throw new FurBinError("Asset not found", "NOT_FOUND");
      if (asset.owner_id !== ownerId) throw new FurBinError("Not authorized", "FORBIDDEN");
      if (asset.status !== "active") throw new FurBinError("Asset is not active", "INVALID_ASSET");

      const version = await findVersionByAssetAndNumber(conn, asset.id, params.versionNumber);
      if (!version) throw new FurBinError("Asset version not found", "INVALID_VERSION");

      const existing = await findFurBinItemByOwnerAndAsset(conn, ownerId, asset.id);
      if (existing) {
        await conn.commit();
        return this.getItemPublic(ownerId, existing.item_uuid);
      }

      const storageBytes = await sumAssetVersionStorageBytes(conn, asset.id);
      const itemUuid = crypto.randomUUID();
      await insertFurBinItem(conn, {
        itemUuid,
        ownerId,
        assetId: asset.id,
        currentVersionId: version.id,
        title: params.title,
        description: params.description,
        tagsJson: normalizeTags(params.tags || []),
        // Capability badges require measured Phase 4 manifests. Client claims
        // are deliberately ignored until that lineage is implemented.
        hasRig: false,
        hasFacial: false,
        hasAnimations: false,
        storageBytes,
      });

      await conn.commit();
      return this.getItemPublic(ownerId, itemUuid);
    } catch (err: any) {
      await conn.rollback();
      if (err instanceof FurBinError) throw err;
      throw new FurBinError(`Failed to register Fur Bin item: ${err.message}`, "REGISTER_FAILED");
    } finally {
      conn.release();
    }
  }

  // ── 2. Search & View Private Library ──────────────────────────────────────

  async searchLibrary(
    ownerId: string,
    params: {
      query?: string;
      tag?: string;
      collectionUuid?: string;
      hasRig?: boolean;
      hasFacial?: boolean;
      hasAnimations?: boolean;
      page?: number;
      limit?: number;
    },
  ): Promise<{ items: FurBinItemPublic[]; total: number }> {
    assertFurBinV5Enabled();
    const pool = this.getPoolFn();
    const result = await searchFurBinItems(pool, {
      ownerId,
      query: params.query,
      tag: params.tag,
      collectionUuid: params.collectionUuid,
      hasRig: params.hasRig,
      hasFacial: params.hasFacial,
      hasAnimations: params.hasAnimations,
      page: params.page || 1,
      limit: params.limit || 20,
    });

    const publicItems = await Promise.all(
      result.items.map((item) => this.formatItemPublic(pool, ownerId, item)),
    );

    return { items: publicItems, total: result.total };
  }

  // ── 3. Short-lived Signed Viewing URL Generation ──────────────────────────

  async getItemPublic(ownerId: string, itemUuid: string): Promise<FurBinItemPublic> {
    assertFurBinV5Enabled();
    const pool = this.getPoolFn();
    const item = await findFurBinItemByUuid(pool, itemUuid);
    if (!item) throw new FurBinError("Fur Bin item not found", "NOT_FOUND");
    if (item.owner_id !== ownerId) throw new FurBinError("Not authorized", "FORBIDDEN");

    return this.formatItemPublic(pool, ownerId, item);
  }

  // ── 4. Version Rollback ───────────────────────────────────────────────────

  async rollbackVersion(ownerId: string, itemUuid: string, targetVersionId: number): Promise<FurBinItemPublic> {
    assertFurBinV5Enabled();
    const pool = this.getPoolFn();
    const conn = await pool.getConnection();

    try {
      await conn.beginTransaction();
      const item = await findFurBinItemByUuidForUpdate(conn, itemUuid);
      if (!item) throw new FurBinError("Item not found", "NOT_FOUND");
      if (item.owner_id !== ownerId) throw new FurBinError("Not authorized", "FORBIDDEN");

      const version = await findVersionById(conn, targetVersionId);
      if (!version || version.asset_id !== item.asset_id) {
        throw new FurBinError("Invalid target version for asset", "INVALID_VERSION");
      }

      await updateItemVersionPointer(conn, item.id, targetVersionId);
      await conn.commit();

      return this.getItemPublic(ownerId, itemUuid);
    } catch (err: any) {
      await conn.rollback();
      if (err instanceof FurBinError) throw err;
      throw new FurBinError(`Rollback failed: ${err.message}`, "ROLLBACK_FAILED");
    } finally {
      conn.release();
    }
  }

  async createCollection(
    ownerId: string,
    params: { name: string; description?: string },
  ): Promise<{ collectionUuid: string; name: string; description: string | null }> {
    assertFurBinV5Enabled();
    const pool = this.getPoolFn();
    const conn = await pool.getConnection();
    const collectionUuid = crypto.randomUUID();
    try {
      await conn.beginTransaction();
      await insertCollection(conn, { collectionUuid, ownerId, ...params });
      await conn.commit();
      return { collectionUuid, name: params.name, description: params.description || null };
    } catch (err: any) {
      await conn.rollback();
      throw new FurBinError(`Create collection failed: ${err.message}`, "COLLECTION_FAILED");
    } finally {
      conn.release();
    }
  }

  async addItemToCollection(ownerId: string, collectionUuid: string, itemUuid: string): Promise<void> {
    assertFurBinV5Enabled();
    const pool = this.getPoolFn();
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const collection = await findCollectionByUuid(conn, collectionUuid);
      const item = await findFurBinItemByUuidForUpdate(conn, itemUuid);
      if (!collection || !item) throw new FurBinError("Collection or item not found", "NOT_FOUND");
      if (collection.owner_id !== ownerId || item.owner_id !== ownerId) {
        throw new FurBinError("Not authorized", "FORBIDDEN");
      }
      await addItemToCollection(conn, collection.id, item.id);
      await conn.commit();
    } catch (err: any) {
      await conn.rollback();
      if (err instanceof FurBinError) throw err;
      throw new FurBinError(`Add collection item failed: ${err.message}`, "COLLECTION_FAILED");
    } finally {
      conn.release();
    }
  }

  // ── 5. Showcase Publishing & Rights Enforcement ────────────────────────────

  async publishShowcase(
    ownerId: string,
    params: {
      itemUuid: string;
      title: string;
      description?: string;
      tags?: string[];
      category?: string;
      attribution?: string;
      rightsDeclaration: string;
      commercialEligible?: boolean;
    },
  ): Promise<ShowcaseRecordPublic> {
    assertFurBinV5Enabled();
    const pool = this.getPoolFn();
    const conn = await pool.getConnection();

    try {
      await conn.beginTransaction();
      const item = await findFurBinItemByUuidForUpdate(conn, params.itemUuid);
      if (!item) throw new FurBinError("Item not found", "NOT_FOUND");
      if (item.owner_id !== ownerId) throw new FurBinError("Not authorized", "FORBIDDEN");
      if (!item.current_version_id) throw new FurBinError("Item has no active content version", "NO_VERSION");

      // Verify rights eligibility
      const version = await findVersionById(conn, item.current_version_id);
      if (!version) throw new FurBinError("Content version not found", "VERSION_NOT_FOUND");
      const asset = await findAssetById(conn, item.asset_id);
      if (!asset || asset.owner_id !== ownerId || version.asset_id !== asset.id) {
        throw new FurBinError("Published asset lineage is invalid", "INVALID_ASSET");
      }
      if (asset.visibility !== "public" && asset.visibility !== "published") {
        throw new FurBinError("Showcase publishing requires a separate public derivative asset", "PRIVATE_ASSET");
      }

      if (params.commercialEligible && !version.commercial_use_eligible) {
        throw new FurBinError("Asset version is not declared eligible for commercial marketplace listing", "COMMERCIAL_INELIGIBLE");
      }

      const showcaseUuid = crypto.randomUUID();
      const showcaseId = await insertShowcaseRecord(conn, {
        showcaseUuid,
        ownerId,
        furBinItemId: item.id,
        publishedVersionId: item.current_version_id,
        title: params.title,
        description: params.description,
        tagsJson: params.tags || [],
        category: params.category || "general",
        attribution: params.attribution,
        rightsDeclaration: params.rightsDeclaration,
        commercialEligible: params.commercialEligible ?? false,
      });

      await conn.commit();
      return this.getShowcaseForOwner(ownerId, showcaseUuid);
    } catch (err: any) {
      await conn.rollback();
      if (err instanceof FurBinError) throw err;
      throw new FurBinError(`Publish showcase failed: ${err.message}`, "PUBLISH_FAILED");
    } finally {
      conn.release();
    }
  }

  // ── 6. Unpublish Showcase (Never Deletes Private Source) ───────────────────

  async unpublishShowcase(ownerId: string, showcaseUuid: string): Promise<void> {
    assertFurBinV5Enabled();
    const pool = this.getPoolFn();
    const conn = await pool.getConnection();

    try {
      await conn.beginTransaction();
      const showcase = await findShowcaseByUuidForUpdate(conn, showcaseUuid);
      if (!showcase) throw new FurBinError("Showcase not found", "NOT_FOUND");
      if (showcase.owner_id !== ownerId) throw new FurBinError("Not authorized", "FORBIDDEN");

      await markShowcaseUnpublished(conn, showcase.id);
      await conn.commit();
    } catch (err: any) {
      await conn.rollback();
      if (err instanceof FurBinError) throw err;
      throw new FurBinError(`Unpublish failed: ${err.message}`, "UNPUBLISH_FAILED");
    } finally {
      conn.release();
    }
  }

  // ── 7. Fail-Closed Moderation Decision (Admin) ────────────────────────────

  async moderateShowcase(
    moderatorId: string,
    showcaseUuid: string,
    newState: ModerationState,
    reason: string,
    moderatorIsAdmin: boolean,
  ): Promise<ShowcaseRecordPublic> {
    assertFurBinV5Enabled();
    if (!moderatorIsAdmin) throw new FurBinError("Administrator access required", "ADMIN_REQUIRED");
    const pool = this.getPoolFn();
    const conn = await pool.getConnection();

    try {
      await conn.beginTransaction();
      const showcase = await findShowcaseByUuidForUpdate(conn, showcaseUuid);
      if (!showcase) throw new FurBinError("Showcase not found", "NOT_FOUND");
      if (!isModerationTransitionAllowed(showcase.moderation_state, newState)) {
        throw new FurBinError(
          `Invalid moderation transition: ${showcase.moderation_state} -> ${newState}`,
          "INVALID_STATE",
        );
      }

      await updateShowcaseModeration(conn, showcase.id, newState, moderatorId, reason);
      await conn.commit();

      return this.getShowcaseForOwner(showcase.owner_id, showcaseUuid);
    } catch (err: any) {
      await conn.rollback();
      if (err instanceof FurBinError) throw err;
      throw new FurBinError(`Moderation failed: ${err.message}`, "MODERATION_FAILED");
    } finally {
      conn.release();
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  async getShowcasePublic(showcaseUuid: string): Promise<ShowcaseRecordPublic> {
    assertFurBinV5Enabled();
    const pool = this.getPoolFn();
    const showcase = await findPublishedShowcaseByUuid(pool, showcaseUuid);
    if (!showcase) throw new FurBinError("Showcase record not found", "NOT_FOUND");

    return this.formatShowcasePublic(pool, showcase, true);
  }

  async getShowcaseForOwner(ownerId: string, showcaseUuid: string): Promise<ShowcaseRecordPublic> {
    assertFurBinV5Enabled();
    const pool = this.getPoolFn();
    const showcase = await findShowcaseByUuid(pool, showcaseUuid);
    if (!showcase) throw new FurBinError("Showcase record not found", "NOT_FOUND");
    if (showcase.owner_id !== ownerId) throw new FurBinError("Not authorized", "FORBIDDEN");

    return this.formatShowcasePublic(pool, showcase, false);
  }

  private async formatShowcasePublic(
    pool: mysql.Pool,
    showcase: any,
    includePublicViewUrl: boolean,
  ): Promise<ShowcaseRecordPublic> {
    let publicViewUrl: string | undefined;
    if (includePublicViewUrl) {
      const version = await findVersionById(pool, showcase.published_version_id);
      const item = await findFurBinItemById(pool, showcase.fur_bin_item_id);
      const asset = item ? await findAssetById(pool, item.asset_id) : null;
      if (!version || !asset || version.asset_id !== asset.id) {
        throw new FurBinError("Showcase asset lineage is invalid", "INVALID_ASSET");
      }
      publicViewUrl = await this.signUrl(asset, version, undefined, false);
    }

    return {
      showcaseUuid: showcase.showcase_uuid,
      title: showcase.title,
      description: showcase.description,
      tags: showcase.tags_json,
      category: showcase.category,
      attribution: showcase.attribution,
      rightsDeclaration: showcase.rights_declaration,
      commercialEligible: showcase.commercial_eligible,
      moderationState: showcase.moderation_state,
      viewCount: showcase.view_count,
      publishedAt: showcase.published_at ? new Date(showcase.published_at).toISOString() : null,
      publicViewUrl,
      createdAt: new Date(showcase.created_at).toISOString(),
    };
  }

  private async formatItemPublic(pool: mysql.Pool, ownerId: string, item: any): Promise<FurBinItemPublic> {
    let signedViewUrl: string | undefined;

    if (item.current_version_id) {
      const version = await findVersionById(pool, item.current_version_id);
      if (version) {
        const asset = await findAssetById(pool, version.asset_id);
        if (asset) {
          if (asset.owner_id !== ownerId || version.asset_id !== asset.id) {
            throw new FurBinError("Item asset lineage is invalid", "INVALID_ASSET");
          }
          signedViewUrl = (await this.signUrl(asset, version, ownerId, false)) || undefined;
        }
      }
    }

    return {
      itemUuid: item.item_uuid,
      title: item.title,
      description: item.description,
      tags: item.tags_json,
      dimensions: item.dimensions_json,
      hasRig: Boolean(item.has_rig),
      hasFacial: Boolean(item.has_facial),
      hasAnimations: Boolean(item.has_animations),
      accessoryCount: item.accessory_count,
      derivativeCount: item.derivative_count,
      storageBytes: await sumAssetVersionStorageBytes(pool, item.asset_id),
      status: item.status,
      signedViewUrl,
      createdAt: new Date(item.created_at).toISOString(),
      updatedAt: new Date(item.updated_at).toISOString(),
    };
  }
}

function normalizeTags(tags: string[]): string[] {
  return [...new Set(tags.map((tag) => tag.trim().toLowerCase()).filter(Boolean))];
}

function isModerationTransitionAllowed(current: ModerationState, next: ModerationState): boolean {
  if (current === "pending") return next === "approved" || next === "rejected";
  if (current === "approved") return next === "suspended";
  return false;
}
