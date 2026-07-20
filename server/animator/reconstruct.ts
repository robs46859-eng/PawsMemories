import { JobRecord, enqueue } from "./queue.ts";
import { resolveWithinWorkspace } from "./paths.ts";
import fs from "fs";

export interface ReconstructJobParams {
  assetId: string; // The point cloud asset ID (e.g. .ply, .las, .laz)
  octreeDepth?: number; // Adaptive octree depth (max 10)
  useMlsPreSmooth?: boolean; // Moving Least Squares pre-smoothing
  deviationTolerance?: number; // Deviation map gate tolerance
}

/**
 * Enqueues a Poisson Surface Reconstruction job.
 * Transforms a point cloud into a watertight mesh suitable for rigging.
 * Executed via Open3D/meshlab in the blender-worker.
 */
export function enqueueReconstructJob(userPhone: string, params: ReconstructJobParams): JobRecord {
  const job = enqueue({
    userPhone,
    assetId: params.assetId,
    type: "reconstruct",
    params: {
      octreeDepth: Math.min(params.octreeDepth || 10, 10), // Enforce <= 10
      useMlsPreSmooth: params.useMlsPreSmooth !== false, // Default true
      deviationTolerance: params.deviationTolerance || 0.05,
    }
  });

  return job;
}
