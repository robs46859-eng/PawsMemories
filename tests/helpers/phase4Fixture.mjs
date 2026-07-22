import crypto from "node:crypto";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);

async function createAssetVersion(conn, ownerId, assetType, sha256, mimeType) {
  const assetUuid = crypto.randomUUID();
  const [assetResult] = await conn.query(
    `INSERT INTO assets (asset_uuid, owner_id, asset_type, visibility, status)
     VALUES (?, ?, ?, 'private', 'active')`,
    [assetUuid, ownerId, assetType],
  );
  const [versionResult] = await conn.query(
    `INSERT INTO asset_versions
       (asset_id, version_number, sha256, mime_type, size_bytes, bucket, object_key, commercial_use_eligible)
     VALUES (?, 1, ?, ?, 1024, 'private', ?, 0)`,
    [assetResult.insertId, sha256, mimeType, `tests/${assetUuid}`],
  );
  await conn.query("UPDATE assets SET current_version_id = ? WHERE id = ?", [versionResult.insertId, assetResult.insertId]);
  return { assetId: assetResult.insertId, versionId: versionResult.insertId };
}

export async function createAcceptedModelBuildFixture(pool, ownerPhone, subjectClass = "dog") {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(
      `INSERT INTO users (phone, email, password_hash, full_name, credits)
       VALUES (?, ?, 'hash', 'Rig Fixture User', 100)
       ON DUPLICATE KEY UPDATE credits = 100`,
      [ownerPhone, `${crypto.randomUUID()}@fixture.test`],
    );

    const manifest = await createAssetVersion(conn, ownerPhone, "approval_manifest", HASH_A, "application/json");
    const model = await createAssetVersion(conn, ownerPhone, "model_glb", HASH_B, "model/gltf-binary");
    const reportAsset = await createAssetVersion(conn, ownerPhone, "validation_report", HASH_C, "application/json");

    const sessionUuid = crypto.randomUUID();
    const [sessionResult] = await conn.query(
      `INSERT INTO reference_sessions (session_uuid, owner_id, input_mode, subject_class, state)
       VALUES (?, ?, 'photo', ?, 'approved')`,
      [sessionUuid, ownerPhone, subjectClass],
    );
    const [referenceAttemptResult] = await conn.query(
      `INSERT INTO reference_attempts
       (session_id, attempt_number, idempotency_key, provider, model, prompt_config_hash, state)
       VALUES (?, 1, ?, 'fixture', 'fixture', ?, 'ready')`,
      [sessionResult.insertId, crypto.randomUUID(), HASH_A],
    );
    await conn.query(
      "UPDATE reference_sessions SET current_attempt_id = ?, approved_attempt_id = ? WHERE id = ?",
      [referenceAttemptResult.insertId, referenceAttemptResult.insertId, sessionResult.insertId],
    );

    const jobUuid = crypto.randomUUID();
    const [jobResult] = await conn.query(
      `INSERT INTO model_build_jobs
       (job_uuid, owner_id, reference_session_id, reference_attempt_id,
        manifest_asset_id, manifest_asset_version_id, manifest_hash,
        requested_output, pricing_key, quoted_credits, state)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'glb', 'fixture', 0, 'accepted')`,
      [
        jobUuid,
        ownerPhone,
        sessionResult.insertId,
        referenceAttemptResult.insertId,
        manifest.assetId,
        manifest.versionId,
        HASH_A,
      ],
    );
    const [attemptResult] = await conn.query(
      `INSERT INTO model_build_attempts
       (job_id, attempt_number, idempotency_key, provider, model, input_config_hash, state, completed_at)
       VALUES (?, 1, ?, 'fixture', 'fixture', ?, 'ready', NOW())`,
      [jobResult.insertId, crypto.randomUUID(), HASH_A],
    );
    const [artifactResult] = await conn.query(
      `INSERT INTO model_build_artifacts
       (attempt_id, asset_id, asset_version_id, role, computed_hash, size_bytes, mime_type)
       VALUES (?, ?, ?, 'validated_glb', ?, 1024, 'model/gltf-binary')`,
      [attemptResult.insertId, model.assetId, model.versionId, HASH_B],
    );
    const [reportResult] = await conn.query(
      `INSERT INTO model_post_build_reports
       (attempt_id, report_asset_id, report_asset_version_id, status, validator_versions, metrics_hash, metrics_json)
       VALUES (?, ?, ?, 'pass', 'fixture', ?, ?)`,
      [
        attemptResult.insertId,
        reportAsset.assetId,
        reportAsset.versionId,
        HASH_C,
        JSON.stringify({ triangleCount: 45000, dimensions: { width: 1.2, height: 0.8, depth: 0.5, unit: "unscaled" } }),
      ],
    );
    await conn.query(
      `UPDATE model_build_jobs
       SET current_attempt_id = ?, accepted_artifact_id = ?, accepted_report_id = ?
       WHERE id = ?`,
      [attemptResult.insertId, artifactResult.insertId, reportResult.insertId, jobResult.insertId],
    );

    await conn.commit();
    return { sessionUuid, jobUuid, modelBuildJobId: jobResult.insertId, ownerPhone };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}
