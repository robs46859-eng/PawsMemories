import { getPool } from "../db";

export type PersistenceEventType =
  | "provider_done"
  | "static_glb_stored"
  | "rig_started"
  | "rig_complete"
  | "done_static_fallback"
  | "canonical_asset_registered"
  | "failed"
  | "refunded"
  | "recovered";

export async function recordPersistenceEvent(
  eventType: PersistenceEventType,
  opts: {
    jobId?: number;
    modelBuildJobUuid?: string;
    detail?: string;
    assetUuid?: string;
  },
): Promise<void> {
  const pool = getPool();
  try {
    await pool.query(
      `INSERT INTO model_persistence_events (job_id, model_build_job_uuid, event_type, detail, asset_uuid)
       VALUES (?, ?, ?, ?, ?)`,
      [
        opts.jobId ?? null,
        opts.modelBuildJobUuid ?? null,
        eventType,
        (opts.detail || "").slice(0, 512),
        opts.assetUuid ?? null,
      ],
    );
  } catch (err: any) {
    console.error("[model-persistence-events] Failed to record event:", err?.message);
    // Non-fatal — never throw from audit
  }
}
