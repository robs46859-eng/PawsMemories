import { JobRecord, enqueue } from "./queue.ts";
import { resolveWithinWorkspace } from "./paths.ts";
import fs from "fs";

export interface RigJobParams {
  assetId: string;
  profileId?: string; // Optional: specific bone definition profile (e.g. quadruped.dog.medium)
  useMLFallback?: boolean; // Enable UniRig fallback for irregular meshes
}

/**
 * Enqueues an auto-rig job to the blender-worker.
 * If useMLFallback is true, the worker will attempt UniRig ML prediction
 * if the heuristic landmark fitting fails.
 */
export function enqueueRigJob(userPhone: string, params: RigJobParams): JobRecord {
  // Validate asset exists
  const glbPath = resolveWithinWorkspace(`assets/${params.assetId}.glb`);
  if (!fs.existsSync(glbPath)) {
    throw new Error(`Asset ${params.assetId} not found.`);
  }

  const job = enqueue({
    userPhone,
    assetId: params.assetId,
    type: "rig",
    params: {
      profileId: params.profileId || "auto",
      useMLFallback: params.useMLFallback || false
    }
  });

  return job;
}
