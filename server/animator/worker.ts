import fs from "fs";
import path from "path";
import { claimJob, completeJob } from "./queue.ts";
import { resolveWithinWorkspace, ANIMATOR_DATA_DIR, buildOutputName } from "./paths.ts";
import { runSafe } from "./gltf.ts";
import { buildManifest, writeManifest } from "./manifest.ts";
import { uploadBase64Binary } from "../../storage.ts";
import type { JobRecord } from "../../src/animator/types.ts";

const WORKER_CONCURRENCY = parseInt(process.env.ANIMATOR_WORKER_CONCURRENCY || "1", 10);
const STALE_MS = parseInt(process.env.ANIMATOR_STALE_MS || `${10 * 60 * 1000}`, 10); // 10 mins

let isRunning = false;
let workerTimer: NodeJS.Timeout | null = null;

export function startWorker() {
  if (isRunning) return;
  isRunning = true;
  recoverStaleJobs();
  workerTimer = setInterval(tick, 2000);
}

export function stopWorker() {
  isRunning = false;
  if (workerTimer) clearInterval(workerTimer);
}

function recoverStaleJobs() {
  const runningDir = resolveWithinWorkspace("jobs/running");
  if (!fs.existsSync(runningDir)) return;
  
  const files = fs.readdirSync(runningDir);
  const now = Date.now();
  
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    const absPath = path.join(runningDir, file);
    try {
      const stat = fs.statSync(absPath);
      if (now - stat.mtimeMs > STALE_MS) {
        // Requeue: move to pending
        const pendingPath = resolveWithinWorkspace(`jobs/pending/${file}`);
        fs.renameSync(absPath, pendingPath);
        console.log(`[Animator Worker] Recovered stale job ${file} to pending.`);
      }
    } catch (e) {
      console.error(`[Animator Worker] Failed to recover stale job ${file}`, e);
    }
  }
}

async function processJob(jobId: string) {
  const job = claimJob(jobId);
  if (!job) return; // Claimed by someone else or doesn't exist
  
  try {
    // The optimize preset is now available.

    const metadataPath = resolveWithinWorkspace(`originals/${job.assetId}/metadata.json`);
    const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
    const originalFilename = metadata.originalFilename;
    const safeOriginal = originalFilename.replace(/[^a-zA-Z0-9_\-\.]/g, "");
    const inAbs = resolveWithinWorkspace(`originals/${job.assetId}/${safeOriginal}`);
    
    // Outputs tracking
    const outPaths: string[] = [];
    const opsApplied: string[] = [];
    
    const inputBytes = fs.readFileSync(inAbs);
    
    let currentInAbs = inAbs;
    
    // Process ops (For phase 2 we just map the 'type' to a single safe op mostly, 
    // or type 'convert' uses pack/unpack, type 'optimize' (safe) might use dedup/prune
    // Wait, the plan says:
    // "runSafe(op, inAbs, outAbs); hash + bucket-mirror each output."
    let safeOp: any = "inspect";
    if (job.type === "convert") {
      safeOp = metadata.format === "glb" ? "unpack" : "pack";
    } else if (job.type === "optimize") {
      // but optimize preset is blocked. If preset is "safe" and type is "optimize"?
      // The plan specifies dedup and prune are part of safe preset.
      // We will do a generic approach: if type === 'optimize' and preset === 'safe', run dedup then prune.
      // Let's simplify and assume the job 'type' defines the operation for now.
    }
    
    // From instructions: "For each pending job... runSafe(op, inAbs, outAbs)"
    // I'll execute the requested safe op based on type
    const op = job.type === "convert" ? (metadata.format === "glb" ? "unpack" : "pack") :
               job.type === "inspect" ? "inspect" : 
               job.type === "optimize" ? "optimize" : "dedup";
               
    if (op !== "inspect") {
      const outName = buildOutputName(originalFilename, op, job.params, inputBytes);
      const outDir = resolveWithinWorkspace(`outputs/${job.assetId}`);
      fs.mkdirSync(outDir, { recursive: true });
      const outAbs = resolveWithinWorkspace(`outputs/${job.assetId}/${outName}`);
      
      const applied = await runSafe(op as any, currentInAbs, outAbs);
      opsApplied.push(...applied);
      
      outPaths.push(outAbs);
    } else {
      opsApplied.push("inspect");
    }

    // Bucket mirror
    const outputsRecord: any[] = [];
    for (const opath of outPaths) {
      const outBytes = fs.readFileSync(opath);
      const base64Str = outBytes.toString('base64');
      const filename = path.basename(opath);
      const mimeType = opath.endsWith('.glb') ? 'model/gltf-binary' : 'model/gltf+json';
      try {
        const bucketUrl = await uploadBase64Binary(base64Str, mimeType);
        outputsRecord.push({ path: opath, op: op, bucketUrl });
      } catch (e) {
        console.error("Bucket upload failed", e);
        outputsRecord.push({ path: opath, op: op });
      }
    }

    const manifest = buildManifest({
      jobId: job.id,
      assetId: job.assetId,
      preset: job.preset as "safe" | "optimize",
      inputs: [{ path: inAbs }],
      outputs: outputsRecord,
      operations: opsApplied,
    });
    
    const manifestPath = writeManifest(manifest);
    completeJob(job.id, "done", { manifestPath });
    
  } catch (e: any) {
    console.error(`[Animator Worker] Job ${job.id} failed:`, e);
    completeJob(job.id, "failed", { error: e.message });
  }
}

async function tick() {
  const pendingDir = resolveWithinWorkspace("jobs/pending");
  if (!fs.existsSync(pendingDir)) return;
  
  const files = fs.readdirSync(pendingDir);
  const pendingJobs = files.filter(f => f.endsWith(".json"));
  
  // Throttle by concurrency
  // In a real multi-worker we might just attempt to claim. Here we do simple serial for now.
  for (const file of pendingJobs) {
    const jobId = file.replace(".json", "");
    await processJob(jobId);
  }
}
