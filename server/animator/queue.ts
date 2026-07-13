import fs from "fs";
import path from "path";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import { ANIMATOR_DATA_DIR, resolveWithinWorkspace } from "./paths.ts";

// Needs type definitions
export const JobSpecSchema = z.object({
  id: z.string().uuid(),
  userPhone: z.string(),
  assetId: z.string().uuid(),
  type: z.enum(["inspect", "convert", "optimize", "rig", "retarget", "repurpose", "lipsync", "reconstruct", "bake"]),
  preset: z.enum(["safe", "optimize"]).optional(),
  params: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
});

export const JobRecordSchema = JobSpecSchema.extend({
  state: z.enum(["pending", "running", "done", "failed"]),
  startedAt: z.string().optional(),
  finishedAt: z.string().optional(),
  error: z.string().optional(),
  manifestPath: z.string().optional(),
  /** Typed, structured result payload (e.g. a validated VisemeTrack). Optional. */
  result: z.unknown().optional(),
  /** Machine-readable failure code when the job failed (see RhubarbError codes). */
  errorCode: z.string().optional(),
  /** Whether the result was served from the source-hash cache. */
  cached: z.boolean().optional(),
});

export type JobSpec = z.infer<typeof JobSpecSchema>;
export type JobRecord = z.infer<typeof JobRecordSchema>;

export function parseJobFile(content: string): JobRecord {
  const data = JSON.parse(content);
  return JobRecordSchema.parse(data);
}

export function enqueue(
  spec: Omit<JobSpec, "id" | "createdAt">,
  workspaceRoot: string = ANIMATOR_DATA_DIR
): JobRecord {
  const jobId = uuidv4();
  const jobRecord: JobRecord = {
    ...spec,
    id: jobId,
    createdAt: new Date().toISOString(),
    state: "pending",
  };
  
  JobRecordSchema.parse(jobRecord);

  const pendingPath = resolveWithinWorkspace(`jobs/pending/${jobId}.json`, workspaceRoot);
  const tmpPath = resolveWithinWorkspace(`tmp/${jobId}.json`, workspaceRoot);

  fs.writeFileSync(tmpPath, JSON.stringify(jobRecord, null, 2), "utf8");
  fs.renameSync(tmpPath, pendingPath);

  return jobRecord;
}

export function claimJob(jobId: string, workspaceRoot: string = ANIMATOR_DATA_DIR): JobRecord | null {
  const pendingPath = resolveWithinWorkspace(`jobs/pending/${jobId}.json`, workspaceRoot);
  const runningPath = resolveWithinWorkspace(`jobs/running/${jobId}.json`, workspaceRoot);

  try {
    fs.renameSync(pendingPath, runningPath);
    const content = fs.readFileSync(runningPath, "utf8");
    const record = parseJobFile(content);
    
    record.state = "running";
    record.startedAt = new Date().toISOString();
    
    const tmpPath = resolveWithinWorkspace(`tmp/${jobId}.json`, workspaceRoot);
    fs.writeFileSync(tmpPath, JSON.stringify(record, null, 2), "utf8");
    fs.renameSync(tmpPath, runningPath);
    
    return record;
  } catch (error: any) {
    if (error.code === "ENOENT") {
      return null; // Job already claimed or doesn't exist
    }
    throw error;
  }
}

export function completeJob(
  jobId: string,
  state: "done" | "failed",
  updates: Partial<JobRecord>,
  workspaceRoot: string = ANIMATOR_DATA_DIR
): JobRecord {
  const runningPath = resolveWithinWorkspace(`jobs/running/${jobId}.json`, workspaceRoot);
  const finalPath = resolveWithinWorkspace(`jobs/${state}/${jobId}.json`, workspaceRoot);
  
  const content = fs.readFileSync(runningPath, "utf8");
  const record = parseJobFile(content);
  
  const finalRecord: JobRecord = {
    ...record,
    ...updates,
    state,
    finishedAt: new Date().toISOString()
  };

  const tmpPath = resolveWithinWorkspace(`tmp/${jobId}.json`, workspaceRoot);
  fs.writeFileSync(tmpPath, JSON.stringify(finalRecord, null, 2), "utf8");
  fs.renameSync(tmpPath, finalPath);
  
  // Cleanup running file happens automatically due to rename from tmpPath directly to finalPath
  // Wait, no. We rename tmpPath to finalPath, but runningPath still exists!
  // We should remove runningPath.
  fs.unlinkSync(runningPath);
  
  return finalRecord;
}
