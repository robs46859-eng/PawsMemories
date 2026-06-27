// Meshy AI "3D pet figurine" integration.
//
// Mirrors the async job pattern used for Veo / HeyGen in server.ts: we kick off
// an image-to-3D generation, store the Meshy task id in
// generation_jobs.operation_name, and poll until it is done. To distinguish
// Meshy jobs from Veo operations and HeyGen videos (which share that DB
// column), Meshy handles are stored with a "meshy:" prefix, e.g.
// "meshy:<task_id>".
//
// Meshy flow (OpenAPI v1, image-to-3d):
//   1. POST /openapi/v1/image-to-3d   { image_url, ai_model, ... } -> { result: task_id }
//   2. GET  /openapi/v1/image-to-3d/<task_id>  -> { status, progress, model_urls.glb }
//   3. On SUCCEEDED: download model_urls.glb and mirror it to our own bucket.
//
// Docs: https://docs.meshy.ai/

const MESHY_BASE = "https://api.meshy.ai";
export const MESHY_PREFIX = "meshy:";

function apiKey(): string {
  const key = process.env.MESHY_API_KEY;
  if (!key) throw new Error("MESHY_API_KEY is not configured.");
  return key;
}

/** True if a generation_jobs.operation_name belongs to Meshy. */
export function isMeshyHandle(operationName: string | null | undefined): boolean {
  return !!operationName && operationName.startsWith(MESHY_PREFIX);
}

/** Extract the raw Meshy task id from a stored handle. */
export function meshyTaskId(operationName: string): string {
  return operationName.slice(MESHY_PREFIX.length);
}

export interface MeshyJobInput {
  /** Public URL of the pet image to convert to 3D. */
  imageUrl: string;
}

/**
 * Start a Meshy image-to-3D generation.
 * Returns the prefixed handle to store in generation_jobs.operation_name.
 */
export async function startImageTo3D(input: MeshyJobInput): Promise<string> {
  const body = {
    image_url: input.imageUrl,
    ai_model: "meshy-5",
    topology: "triangle",
    target_polycount: 30000,
    should_texture: true,
    enable_pbr: true,
    art_style: "realistic",
    texture_resolution: "2048",
  };

  const res = await fetch(`${MESHY_BASE}/openapi/v1/image-to-3d`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Meshy image-to-3d failed (${res.status}): ${JSON.stringify(json)}`);
  }
  // Meshy returns the new task id under "result".
  const taskId = json?.result || json?.data?.result;
  if (!taskId) {
    throw new Error(`Meshy image-to-3d returned no task id: ${JSON.stringify(json)}`);
  }
  return `${MESHY_PREFIX}${taskId}`;
}

export interface MeshyPollResult {
  done: boolean;
  /** Remote GLB url, present only when done and successful. */
  glbUrl?: string;
  /** Present when done and failed. */
  error?: string;
  /** 0-100 progress for in-flight tasks. */
  progress?: number;
}

/** Poll a Meshy task by its stored handle. */
export async function pollImageTo3D(operationName: string): Promise<MeshyPollResult> {
  const taskId = meshyTaskId(operationName);
  const res = await fetch(`${MESHY_BASE}/openapi/v1/image-to-3d/${encodeURIComponent(taskId)}`, {
    headers: { Authorization: `Bearer ${apiKey()}` },
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Meshy status check failed (${res.status}): ${JSON.stringify(json)}`);
  }

  const status = json?.status;
  const progress = typeof json?.progress === "number" ? json.progress : undefined;

  if (status === "SUCCEEDED") {
    const glbUrl = json?.model_urls?.glb;
    if (!glbUrl) return { done: true, error: "Meshy succeeded but returned no GLB url" };
    return { done: true, glbUrl, progress: 100 };
  }
  if (status === "FAILED" || status === "CANCELED") {
    return { done: true, error: json?.task_error?.message || `Meshy task ${status}` };
  }
  // PENDING | IN_PROGRESS
  return { done: false, progress };
}
