import { JobRecord, enqueue } from "./queue.ts";
import { resolveWithinWorkspace } from "./paths.ts";
import fs from "fs";

export interface BakeJobParams {
  projectId: string;
  targetFormat: "glb" | "gltf";
}

/**
 * Creates a bake job to package a sequencer project (multiple clips/actors)
 * into a single baked GLB with all animations applied as a single track.
 * This is executed by the blender-worker.
 */
export function enqueueBakeJob(userPhone: string, params: BakeJobParams): JobRecord {
  // Validate project exists
  const projectPath = resolveWithinWorkspace(`projects/${params.projectId}.json`);
  if (!fs.existsSync(projectPath)) {
    throw new Error(`Project ${params.projectId} not found.`);
  }

  const job = enqueue({
    userPhone,
    assetId: params.projectId, // Reusing assetId field for projectId
    type: "bake",
    params: {
      format: params.targetFormat
    }
  });

  return job;
}
