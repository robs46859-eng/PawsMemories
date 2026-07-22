// ─── Phase 4: Rig Pipeline Types ───────────────────────────────────────────

// ── Classification ──────────────────────────────────────────────────────────
export type ClassificationType = "biped" | "quadruped" | "unsupported";

export interface ClassificationRecord {
  id: number;
  model_build_job_id: number;
  accepted_artifact_id: number;
  classification: ClassificationType;
  classifier_version: string;
  confidence: number;
  evidence_json: Record<string, unknown>;
  override_by: string | null;
  override_reason: string | null;
  override_at: Date | null;
  selected_profile_id: string;
  created_at: Date;
  updated_at: Date;
}

// ── Rig Job States ──────────────────────────────────────────────────────────
export type RigJobState =
  | "draft"
  | "classifying"
  | "classified"
  | "queued"
  | "submitted"
  | "rigging"
  | "validating_rig"
  | "inventorying_facial"
  | "fitting_accessories"
  | "ready"
  | "accepted"
  | "failed_classification"
  | "failed_rig"
  | "failed_validation"
  | "cancelled";

export const TERMINAL_RIG_JOB_STATES: readonly RigJobState[] = [
  "accepted",
  "failed_classification",
  "failed_rig",
  "failed_validation",
  "cancelled",
] as const;

// ── Rig Attempt States ──────────────────────────────────────────────────────
export type RigAttemptState =
  | "queued"
  | "submitted"
  | "rigging"
  | "validating"
  | "ready"
  | "failed"
  | "cancelled";

// ── Facial Capability ───────────────────────────────────────────────────────
export type FacialCapability = "full" | "partial" | "body_only" | "unsupported";

export interface FacialInventoryRecord {
  id: number;
  rig_job_id: number;
  rig_attempt_id: number;
  capability: FacialCapability;
  morph_count: number;
  viseme_coverage: number; // 0.0-1.0, fraction of canonical visemes mapped
  has_blink: boolean;
  has_jaw: boolean;
  has_eye_controls: boolean;
  morph_names_json: string[];
  canonical_map_json: Record<string, string>; // provider name -> canonical name
  deformation_pass: boolean;
  notes: string;
  created_at: Date;
}

// ── Rig Validation Manifest ─────────────────────────────────────────────────
export interface RigValidationRule {
  rule: string;
  pass: boolean;
  detail: string;
  measured?: number | string;
}

export interface RigValidationManifestRecord {
  id: number;
  rig_attempt_id: number;
  validator_version: string;
  bone_count: number;
  skinned_vertex_count: number;
  max_influences: number;
  unweighted_islands: number;
  bind_matrix_valid: boolean;
  animation_sweep_pass: boolean;
  silhouette_deviation: number;
  mobile_budget_pass: boolean;
  triangle_count: number;
  texture_max_dimension: number;
  joint_count: number;
  rules_json: RigValidationRule[];
  metrics_hash: string;
  created_at: Date;
}

// ── Accessory Catalog ───────────────────────────────────────────────────────
export interface AccessoryCatalogRecord {
  id: number;
  accessory_uuid: string;
  owner_id: string;
  name: string;
  asset_id: number;
  asset_version_id: number;
  compatible_profiles: string[]; // e.g. ["quadruped.dog.medium", "quadruped.cat.medium"]
  attachment_bone: string;
  fit_bounds_json: { min: [number, number, number]; max: [number, number, number] };
  collision_bounds_json: { min: [number, number, number]; max: [number, number, number] };
  license: string;
  commercial_use_eligible: boolean;
  export_policy: "allowed" | "preview_only" | "derivative_only";
  preview_asset_id: number | null;
  status: "active" | "archived" | "deleted";
  created_at: Date;
  updated_at: Date;
}

// ── Accessory Fit ───────────────────────────────────────────────────────────
export interface AccessoryFitRecord {
  id: number;
  fit_uuid: string;
  rig_job_id: number;
  accessory_id: number;
  derivative_asset_id: number | null;
  derivative_version_id: number | null;
  attachment_bone: string;
  transform_json: { position: [number, number, number]; rotation: [number, number, number, number]; scale: [number, number, number] };
  floating_distance: number;
  penetration_depth: number;
  animation_sweep_pass: boolean;
  polygon_budget_pass: boolean;
  print_clearance_mm: number;
  status: "pending" | "fitted" | "failed" | "accepted";
  created_at: Date;
  updated_at: Date;
}

// ── Public DTOs ─────────────────────────────────────────────────────────────
export interface RigJobPublic {
  jobUuid: string;
  state: RigJobState;
  classification: ClassificationType | null;
  selectedProfile: string | null;
  facialCapability: FacialCapability | null;
  rigValidation: {
    boneCount: number;
    maxInfluences: number;
    mobileBudgetPass: boolean;
    animationSweepPass: boolean;
    overallPass: boolean;
    rules: RigValidationRule[];
  } | null;
  facialInventory: {
    capability: FacialCapability;
    morphCount: number;
    visemeCoverage: number;
    hasBlink: boolean;
    hasJaw: boolean;
    hasEyeControls: boolean;
    deformationPass: boolean;
  } | null;
  accessories: AccessoryFitPublic[];
  /** Hash of the measured validation manifest required for explicit acceptance. */
  manifestHash: string | null;
  failureCode: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AccessoryFitPublic {
  fitUuid: string;
  accessoryName: string;
  attachmentBone: string;
  floatingDistance: number;
  penetrationDepth: number;
  animationSweepPass: boolean;
  polygonBudgetPass: boolean;
  printClearanceMm: number;
  status: string;
}

// ── Constants ───────────────────────────────────────────────────────────────
export const DEFAULT_RIG_LEASE_DURATION_MS = 5 * 60 * 1000; // 5 minutes
export const MAX_RIG_ATTEMPTS = 3;
export const MOBILE_JOINT_BUDGET = 128;
export const MOBILE_TRIANGLE_BUDGET = 100_000;
export const MOBILE_TEXTURE_MAX = 2048;
export const MAX_BONE_INFLUENCES = 4;
