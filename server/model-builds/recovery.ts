import type mysql from "mysql2/promise";
import { getPool } from "../../db";
import { findExpiredLeases } from "./repository";
import { isModelBuildV3Enabled } from "./featureFlag";

export interface RecoveryReport {
  timestamp: string;
  expiredLeases: number;
  recoveredJobs: string[];
}

/**
 * Stale lease recovery: find attempts with expired leases in active states
 * and log them for manual investigation or automatic re-processing.
 *
 * Called at server startup and from the admin reconcile endpoint.
 * Does NOT automatically restart jobs — it reports findings only.
 */
export async function recoverStaleLeases(
  pool: mysql.Pool = getPool(),
): Promise<RecoveryReport> {
  if (!isModelBuildV3Enabled()) {
    return { timestamp: new Date().toISOString(), expiredLeases: 0, recoveredJobs: [] };
  }

  const expired = await findExpiredLeases(pool);
  const recoveredJobs: string[] = [];

  for (const attempt of expired) {
    // Log for manual investigation
    console.warn(
      `[model-build recovery] Expired lease: attempt ${attempt.id}, job ${attempt.job_id}, ` +
      `state ${attempt.state}, lease_owner ${attempt.lease_owner}, ` +
      `expired at ${attempt.lease_expires_at}`,
    );

    // Record the job ID for the report
    const [rows] = await pool.query(
      "SELECT job_uuid FROM model_build_jobs WHERE id = ?",
      [attempt.job_id],
    ) as any;
    if (rows[0]) {
      recoveredJobs.push(rows[0].job_uuid);
    }
  }

  return {
    timestamp: new Date().toISOString(),
    expiredLeases: expired.length,
    recoveredJobs,
  };
}
