export type AssetVisibility = "private" | "public" | "published";
export type AssetStatus = "active" | "archived" | "deleted";
export type StorageBucket = "public" | "private";

export type AssetType =
  | "source_photo"
  | "source_prompt"
  | "reference_front"
  | "reference_left"
  | "reference_right"
  | "reference_back"
  | "reference_three_quarter"
  | "reference_top"
  | "model_glb"
  | "model_lod"
  | "model_rigged_glb"
  | "model_facial_glb"
  | "model_ifc"
  | "model_stl"
  | "model_3mf"
  | "accessory_glb"
  | "texture_set"
  | "material"
  | "turntable_video"
  | "thumbnail"
  | "stationery_background"
  | "stationery_template"
  | "stationery_composite"
  | "stationery_print_file"
  | "voice"
  | "animation_clip"
  | "validation_report"
  | "provider_manifest"
  | string;

export type RelationType =
  | "turnaround"
  | "mesh"
  | "rig"
  | "stl"
  | "render"
  | "print_file"
  | "derivative";

export interface AssetRecord {
  id: number;
  asset_uuid: string;
  owner_id: string;
  asset_type: AssetType;
  visibility: AssetVisibility;
  status: AssetStatus;
  current_version_id: number | null;
  created_at: Date;
  updated_at: Date;
}

export interface AssetVersionRecord {
  id: number;
  asset_id: number;
  version_number: number;
  sha256: string;
  mime_type: string;
  size_bytes: number;
  bucket: StorageBucket;
  object_key: string;
  metadata: Record<string, any> | null;
  source_provider: string;
  license: string;
  commercial_use_eligible: boolean;
  created_at: Date;
}

export interface AssetRelationRecord {
  id: number;
  parent_version_id: number;
  child_version_id: number;
  relation_type: RelationType;
  created_at: Date;
}

export interface AssetLegacyLinkRecord {
  id: number;
  legacy_table: string;
  legacy_id: string;
  asset_id: number;
  asset_version_id: number;
  created_at: Date;
}

export interface PublicAssetMetadata {
  assetUuid: string;
  ownerId: string;
  assetType: AssetType;
  visibility: AssetVisibility;
  status: AssetStatus;
  currentVersion: PublicAssetVersionMetadata | null;
  createdAt: string;
  updatedAt: string;
}

export interface PublicAssetVersionMetadata {
  versionNumber: number;
  sha256: string;
  mimeType: string;
  sizeBytes: number;
  bucket: StorageBucket;
  metadata: Record<string, any> | null;
  sourceProvider: string;
  license: string;
  commercialUseEligible: boolean;
  createdAt: string;
  signedUrl?: string;
}

export interface StorageUsageSummary {
  ownerId: string;
  totalSizeBytes: number;
  distinctObjectsCount: number;
  publicSizeBytes: number;
  privateSizeBytes: number;
}

export interface ReconciliationFinding {
  type:
    | "DB_VERSION_MISSING_OBJECT"
    | "OBJECT_WITHOUT_DB_REGISTRATION"
    | "SIZE_MISMATCH"
    | "INVALID_CURRENT_VERSION_POINTER"
    | "CROSS_OWNER_PRIVATE_CONFLICT"
    | "DUPLICATE_LEGACY_LINK";
  severity: "error" | "warning";
  details: Record<string, any>;
  fixed?: boolean;
}

export interface ReconciliationReport {
  timestamp: string;
  fixMode: boolean;
  totalFindings: number;
  findings: ReconciliationFinding[];
}
