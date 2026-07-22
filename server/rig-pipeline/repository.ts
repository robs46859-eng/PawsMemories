// ─── Phase 4: Rig Pipeline Repository ───────────────────────────────────────
import crypto from "node:crypto";
import type mysql from "mysql2/promise";
import type {
  ClassificationRecord,
  RigValidationManifestRecord,
  FacialInventoryRecord,
  AccessoryCatalogRecord,
  AccessoryFitRecord,
  RigJobState,
  RigAttemptState,
  RigValidationRule,
} from "./types";

// ── Classification ──────────────────────────────────────────────────────────

export async function insertClassification(
  conn: mysql.PoolConnection,
  data: {
    modelBuildJobId: number;
    acceptedArtifactId: number;
    classification: string;
    classifierVersion: string;
    confidence: number;
    evidenceJson: Record<string, unknown>;
    selectedProfileId: string;
  },
): Promise<number> {
  const [res]: any = await conn.query(
    `INSERT INTO rig_classifications
      (model_build_job_id, accepted_artifact_id, classification, classifier_version, confidence, evidence_json, selected_profile_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [data.modelBuildJobId, data.acceptedArtifactId, data.classification, data.classifierVersion, data.confidence, JSON.stringify(data.evidenceJson), data.selectedProfileId],
  );
  return res.insertId;
}

export async function findClassificationByJobId(
  pool: mysql.Pool | mysql.PoolConnection,
  modelBuildJobId: number,
): Promise<ClassificationRecord | null> {
  const [rows]: any = await pool.query("SELECT * FROM rig_classifications WHERE model_build_job_id = ?", [modelBuildJobId]);
  return rows[0] || null;
}

export async function updateClassificationOverride(
  conn: mysql.PoolConnection,
  id: number,
  overrideBy: string,
  overrideReason: string,
  newClassification: string,
  newProfileId: string,
): Promise<void> {
  await conn.query(
    `UPDATE rig_classifications SET override_by = ?, override_reason = ?, override_at = NOW(), classification = ?, selected_profile_id = ? WHERE id = ?`,
    [overrideBy, overrideReason, newClassification, newProfileId, id],
  );
}

// ── Rig Jobs ────────────────────────────────────────────────────────────────

export async function insertRigJob(
  conn: mysql.PoolConnection,
  data: {
    jobUuid: string;
    ownerId: string;
    modelBuildJobId: number;
    classificationId: number;
    sourceArtifactId: number;
    sourceVersionId: number;
    requestFacial: boolean;
    idempotencyKey: string;
  },
): Promise<number> {
  const [res]: any = await conn.query(
    `INSERT INTO rig_jobs
      (job_uuid, owner_id, model_build_job_id, classification_id, source_artifact_id, source_version_id, request_facial, idempotency_key, state)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft')`,
    [data.jobUuid, data.ownerId, data.modelBuildJobId, data.classificationId, data.sourceArtifactId, data.sourceVersionId, data.requestFacial, data.idempotencyKey],
  );
  return res.insertId;
}

export async function findRigJobByUuid(pool: mysql.Pool | mysql.PoolConnection, jobUuid: string): Promise<any | null> {
  const [rows]: any = await pool.query("SELECT * FROM rig_jobs WHERE job_uuid = ?", [jobUuid]);
  return rows[0] || null;
}

export async function findRigJobByUuidForUpdate(conn: mysql.PoolConnection, jobUuid: string): Promise<any | null> {
  const [rows]: any = await conn.query("SELECT * FROM rig_jobs WHERE job_uuid = ? FOR UPDATE", [jobUuid]);
  return rows[0] || null;
}

export async function findRigJobByIdempotencyKey(pool: mysql.Pool | mysql.PoolConnection, key: string): Promise<any | null> {
  const [rows]: any = await pool.query("SELECT * FROM rig_jobs WHERE idempotency_key = ?", [key]);
  return rows[0] || null;
}

export async function updateRigJobState(
  conn: mysql.PoolConnection,
  jobId: number,
  newState: RigJobState,
  extra?: { currentAttemptId?: number; failureCode?: string; acceptedArtifactId?: number },
): Promise<void> {
  const sets: string[] = ["state = ?"];
  const vals: any[] = [newState];
  if (extra?.currentAttemptId !== undefined) { sets.push("current_attempt_id = ?"); vals.push(extra.currentAttemptId); }
  if (extra?.failureCode !== undefined) { sets.push("failure_code = ?"); vals.push(extra.failureCode); }
  if (extra?.acceptedArtifactId !== undefined) { sets.push("accepted_artifact_id = ?"); vals.push(extra.acceptedArtifactId); }
  vals.push(jobId);
  await conn.query(`UPDATE rig_jobs SET ${sets.join(", ")} WHERE id = ?`, vals);
}

// ── Rig Attempts ────────────────────────────────────────────────────────────

export async function insertRigAttempt(
  conn: mysql.PoolConnection,
  data: { jobId: number; attemptNumber: number; idempotencyKey: string },
): Promise<number> {
  const [res]: any = await conn.query(
    `INSERT INTO rig_attempts (job_id, attempt_number, idempotency_key, state) VALUES (?, ?, ?, 'queued')`,
    [data.jobId, data.attemptNumber, data.idempotencyKey],
  );
  return res.insertId;
}

export async function findRigAttemptById(pool: mysql.Pool | mysql.PoolConnection, attemptId: number): Promise<any | null> {
  const [rows]: any = await pool.query("SELECT * FROM rig_attempts WHERE id = ?", [attemptId]);
  return rows[0] || null;
}

export async function findRigAttemptsByJobId(conn: mysql.PoolConnection, jobId: number): Promise<any[]> {
  const [rows]: any = await conn.query("SELECT * FROM rig_attempts WHERE job_id = ? ORDER BY attempt_number ASC", [jobId]);
  return rows;
}

export async function updateRigAttemptState(
  conn: mysql.PoolConnection,
  attemptId: number,
  newState: RigAttemptState,
  extra?: { provider?: string; providerTaskHandle?: string; startedAt?: Date; completedAt?: Date; failureCode?: string; failureDetail?: string },
): Promise<void> {
  const sets: string[] = ["state = ?"];
  const vals: any[] = [newState];
  if (extra?.provider !== undefined) { sets.push("provider = ?"); vals.push(extra.provider); }
  if (extra?.providerTaskHandle !== undefined) { sets.push("provider_task_handle = ?"); vals.push(extra.providerTaskHandle); }
  if (extra?.startedAt !== undefined) { sets.push("started_at = ?"); vals.push(extra.startedAt); }
  if (extra?.completedAt !== undefined) { sets.push("completed_at = ?"); vals.push(extra.completedAt); }
  if (extra?.failureCode !== undefined) { sets.push("failure_code = ?"); vals.push(extra.failureCode); }
  if (extra?.failureDetail !== undefined) { sets.push("failure_detail = ?"); vals.push(extra.failureDetail); }
  vals.push(attemptId);
  await conn.query(`UPDATE rig_attempts SET ${sets.join(", ")} WHERE id = ?`, vals);
}

export async function claimRigLease(
  conn: mysql.PoolConnection,
  attemptId: number,
  leaseOwner: string,
  leaseExpiry: Date,
): Promise<boolean> {
  const [res]: any = await conn.query(
    `UPDATE rig_attempts SET worker_lease_owner = ?, worker_lease_expiry = ? WHERE id = ? AND (worker_lease_owner IS NULL OR worker_lease_expiry < NOW())`,
    [leaseOwner, leaseExpiry, attemptId],
  );
  return res.affectedRows > 0;
}

// ── Validation Manifests ────────────────────────────────────────────────────

export async function insertRigValidationManifest(
  conn: mysql.PoolConnection,
  data: {
    rigAttemptId: number;
    validatorVersion: string;
    boneCount: number;
    skinnedVertexCount: number;
    maxInfluences: number;
    unweightedIslands: number;
    bindMatrixValid: boolean;
    animationSweepPass: boolean;
    silhouetteDeviation: number;
    mobileBudgetPass: boolean;
    triangleCount: number;
    textureMaxDimension: number;
    jointCount: number;
    rulesJson: RigValidationRule[];
    metricsHash: string;
  },
): Promise<number> {
  const [res]: any = await conn.query(
    `INSERT INTO rig_validation_manifests
      (rig_attempt_id, validator_version, bone_count, skinned_vertex_count, max_influences,
       unweighted_islands, bind_matrix_valid, animation_sweep_pass, silhouette_deviation,
       mobile_budget_pass, triangle_count, texture_max_dimension, joint_count, rules_json, metrics_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [data.rigAttemptId, data.validatorVersion, data.boneCount, data.skinnedVertexCount, data.maxInfluences,
     data.unweightedIslands, data.bindMatrixValid, data.animationSweepPass, data.silhouetteDeviation,
     data.mobileBudgetPass, data.triangleCount, data.textureMaxDimension, data.jointCount, JSON.stringify(data.rulesJson), data.metricsHash],
  );
  return res.insertId;
}

export async function findManifestByAttemptId(pool: mysql.Pool | mysql.PoolConnection, attemptId: number): Promise<any | null> {
  const [rows]: any = await pool.query("SELECT * FROM rig_validation_manifests WHERE rig_attempt_id = ?", [attemptId]);
  return rows[0] || null;
}

// ── Facial Inventories ──────────────────────────────────────────────────────

export async function insertFacialInventory(
  conn: mysql.PoolConnection,
  data: {
    rigJobId: number;
    rigAttemptId: number;
    capability: string;
    morphCount: number;
    visemeCoverage: number;
    hasBlink: boolean;
    hasJaw: boolean;
    hasEyeControls: boolean;
    morphNamesJson: string[];
    canonicalMapJson: Record<string, string>;
    deformationPass: boolean;
    notes: string;
  },
): Promise<number> {
  const [res]: any = await conn.query(
    `INSERT INTO facial_inventories
      (rig_job_id, rig_attempt_id, capability, morph_count, viseme_coverage, has_blink, has_jaw, has_eye_controls, morph_names_json, canonical_map_json, deformation_pass, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [data.rigJobId, data.rigAttemptId, data.capability, data.morphCount, data.visemeCoverage, data.hasBlink, data.hasJaw, data.hasEyeControls,
     JSON.stringify(data.morphNamesJson), JSON.stringify(data.canonicalMapJson), data.deformationPass, data.notes],
  );
  return res.insertId;
}

export async function findFacialInventoryByAttemptId(pool: mysql.Pool | mysql.PoolConnection, attemptId: number): Promise<any | null> {
  const [rows]: any = await pool.query("SELECT * FROM facial_inventories WHERE rig_attempt_id = ?", [attemptId]);
  return rows[0] || null;
}

// ── Accessory Catalog ───────────────────────────────────────────────────────

export async function insertAccessoryCatalog(
  conn: mysql.PoolConnection,
  data: {
    accessoryUuid: string;
    ownerId: string;
    name: string;
    assetId: number;
    assetVersionId: number;
    compatibleProfiles: string[];
    attachmentBone: string;
    fitBoundsJson: any;
    collisionBoundsJson: any;
    license: string;
    commercialUseEligible: boolean;
    exportPolicy: string;
  },
): Promise<number> {
  const [res]: any = await conn.query(
    `INSERT INTO accessory_catalog
      (accessory_uuid, owner_id, name, asset_id, asset_version_id, compatible_profiles, attachment_bone, fit_bounds_json, collision_bounds_json, license, commercial_use_eligible, export_policy)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [data.accessoryUuid, data.ownerId, data.name, data.assetId, data.assetVersionId,
     JSON.stringify(data.compatibleProfiles), data.attachmentBone, JSON.stringify(data.fitBoundsJson),
     JSON.stringify(data.collisionBoundsJson), data.license, data.commercialUseEligible, data.exportPolicy],
  );
  return res.insertId;
}

export async function findAccessoryByUuid(pool: mysql.Pool, uuid: string): Promise<any | null> {
  const [rows]: any = await pool.query("SELECT * FROM accessory_catalog WHERE accessory_uuid = ? AND status = 'active'", [uuid]);
  return rows[0] || null;
}

export async function findAccessoriesByOwner(pool: mysql.Pool, ownerId: string): Promise<any[]> {
  const [rows]: any = await pool.query("SELECT * FROM accessory_catalog WHERE owner_id = ? AND status = 'active' ORDER BY created_at DESC", [ownerId]);
  return rows;
}

// ── Accessory Fits ──────────────────────────────────────────────────────────

export async function insertAccessoryFit(
  conn: mysql.PoolConnection,
  data: {
    fitUuid: string;
    rigJobId: number;
    accessoryId: number;
    attachmentBone: string;
    transformJson: any;
    floatingDistance: number;
    penetrationDepth: number;
    animationSweepPass: boolean;
    polygonBudgetPass: boolean;
    printClearanceMm: number;
  },
): Promise<number> {
  const [res]: any = await conn.query(
    `INSERT INTO accessory_fits
      (fit_uuid, rig_job_id, accessory_id, attachment_bone, transform_json, floating_distance, penetration_depth, animation_sweep_pass, polygon_budget_pass, print_clearance_mm)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [data.fitUuid, data.rigJobId, data.accessoryId, data.attachmentBone, JSON.stringify(data.transformJson),
     data.floatingDistance, data.penetrationDepth, data.animationSweepPass, data.polygonBudgetPass, data.printClearanceMm],
  );
  return res.insertId;
}

export async function findFitsByRigJobId(pool: mysql.Pool | mysql.PoolConnection, rigJobId: number): Promise<any[]> {
  const [rows]: any = await pool.query(
    `SELECT af.*, ac.name as accessory_name FROM accessory_fits af
     JOIN accessory_catalog ac ON af.accessory_id = ac.id
     WHERE af.rig_job_id = ? ORDER BY af.created_at ASC`,
    [rigJobId],
  );
  return rows;
}

export async function updateAccessoryFitStatus(
  conn: mysql.PoolConnection,
  fitId: number,
  status: string,
  derivativeAssetId?: number,
  derivativeVersionId?: number,
): Promise<void> {
  const sets = ["status = ?"];
  const vals: any[] = [status];
  if (derivativeAssetId !== undefined) { sets.push("derivative_asset_id = ?"); vals.push(derivativeAssetId); }
  if (derivativeVersionId !== undefined) { sets.push("derivative_version_id = ?"); vals.push(derivativeVersionId); }
  vals.push(fitId);
  await conn.query(`UPDATE accessory_fits SET ${sets.join(", ")} WHERE id = ?`, vals);
}

// ── Rig Acceptances ─────────────────────────────────────────────────────────

export async function insertRigAcceptance(
  conn: mysql.PoolConnection,
  data: { rigJobId: number; rigAttemptId: number; manifestId: number; acceptedByUser: string; manifestHash: string },
): Promise<number> {
  const [res]: any = await conn.query(
    `INSERT INTO rig_acceptances (rig_job_id, rig_attempt_id, manifest_id, accepted_by_user, manifest_hash) VALUES (?, ?, ?, ?, ?)`,
    [data.rigJobId, data.rigAttemptId, data.manifestId, data.acceptedByUser, data.manifestHash],
  );
  return res.insertId;
}

// ── Stale Lease Recovery ────────────────────────────────────────────────────

export async function findStaleRigAttempts(pool: mysql.Pool, limit: number = 10): Promise<any[]> {
  const [rows]: any = await pool.query(
    `SELECT ra.*, rj.job_uuid, rj.owner_id FROM rig_attempts ra
     JOIN rig_jobs rj ON ra.job_id = rj.id
     WHERE ra.state IN ('submitted', 'rigging', 'validating')
       AND ra.worker_lease_expiry IS NOT NULL
       AND ra.worker_lease_expiry < NOW()
     ORDER BY ra.worker_lease_expiry ASC LIMIT ?`,
    [limit],
  );
  return rows;
}
