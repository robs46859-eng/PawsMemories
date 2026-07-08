const TRIPO_BASE = "https://api.tripo3d.ai/v2/openapi";
export const TRIPO_PREFIX = "tripo:";

function apiKey(): string {
  const key = process.env.TRIPO_API_KEY;
  if (!key) throw new Error("TRIPO_API_KEY is not configured.");
  return key;
}

export function isTripoHandle(operationName: string | null | undefined): boolean {
  return !!operationName && operationName.startsWith(TRIPO_PREFIX);
}

export function tripoTaskId(operationName: string): string {
  return operationName.slice(TRIPO_PREFIX.length);
}

/**
 * Optional turnaround views used for Tripo's `multiview_to_model`. The front
 * image is always `imageUrl`; any subset of the others may be supplied. When at
 * least one of left/back/right is present the job runs as multiview, otherwise
 * it degrades to single-image `image_to_model`.
 *
 * IMPORTANT: Tripo's multiview slot order is fixed — [FRONT, LEFT, BACK, RIGHT].
 * There is no "top" slot; missing slots are sent as empty objects.
 */
export interface TripoViewSet {
  left?: string;
  back?: string;
  right?: string;
}

export interface TripoJobInput {
  /** Front / primary reference image (public URL or data URL). Always required. */
  imageUrl: string;
  /** Optional turnaround views. Presence of any one triggers multiview mode. */
  views?: TripoViewSet;
}

interface UploadedImage {
  ext: string;
  token: string;
}

/** Download an image (URL or data URL) and upload its bytes to Tripo → image_token. */
async function uploadToTripo(imageUrl: string): Promise<UploadedImage> {
  let arrayBuffer: ArrayBuffer;
  let mimeType = "image/jpeg";

  const dataMatch = imageUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (dataMatch) {
    mimeType = dataMatch[1] || "image/jpeg";
    arrayBuffer = Buffer.from(dataMatch[2], "base64").buffer;
  } else {
    const imgRes = await fetch(imageUrl);
    if (!imgRes.ok) throw new Error(`Failed to download image for Tripo: ${imgRes.statusText}`);
    arrayBuffer = await imgRes.arrayBuffer();
    mimeType = imgRes.headers.get("content-type") || "image/jpeg";
  }

  let ext = "jpg";
  if (mimeType.includes("png")) ext = "png";
  if (mimeType.includes("webp")) ext = "webp";

  const blob = new Blob([arrayBuffer], { type: mimeType });
  const formData = new FormData();
  formData.append("file", blob, `upload.${ext}`);

  const uploadRes = await fetch(`${TRIPO_BASE}/upload`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey()}` },
    body: formData,
  });

  const uploadJson: any = await uploadRes.json().catch(() => ({}));
  if (!uploadRes.ok) {
    throw new Error(`Tripo upload failed (${uploadRes.status}): ${JSON.stringify(uploadJson)}`);
  }
  const token = uploadJson?.data?.image_token;
  if (!token) {
    throw new Error(`Tripo upload returned no image_token: ${JSON.stringify(uploadJson)}`);
  }
  return { ext, token };
}

async function submitTask(body: Record<string, unknown>): Promise<string> {
  const res = await fetch(`${TRIPO_BASE}/task`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Tripo task failed (${res.status}): ${JSON.stringify(json)}`);
  }
  const taskId = json?.data?.task_id;
  if (!taskId) {
    throw new Error(`Tripo task returned no task id: ${JSON.stringify(json)}`);
  }
  return `${TRIPO_PREFIX}${taskId}`;
}

/**
 * Start a Tripo 3D generation.
 *
 * - With turnaround views → `multiview_to_model` (front/left/back/right) for
 *   dramatically better geometry + texture wrap on the sides and back.
 * - Without → `image_to_model` from the single front image.
 *
 * Both request DETAILED PBR textures (texture_quality="detailed") for the
 * richest color/fur fidelity. `texture_alignment: "original_image"` keeps the
 * generated texture faithful to the reference colours (the "color coordination"
 * requirement) rather than letting Tripo re-tint from geometry.
 *
 * NOTE: do NOT set quad: true — Tripo forces FBX output when quad is enabled,
 * but this pipeline downloads output.model expecting a GLB.
 */
export async function startImageTo3D(input: TripoJobInput): Promise<string> {
  const left = input.views?.left;
  const back = input.views?.back;
  const right = input.views?.right;
  const hasMultiview = !!(left || back || right);

  // Shared high-fidelity flags.
  const common = {
    texture: true,
    pbr: true,
    texture_quality: "detailed",
    texture_alignment: "original_image",
    face_limit: 40000,
  };

  if (!hasMultiview) {
    const front = await uploadToTripo(input.imageUrl);
    return submitTask({
      type: "image_to_model",
      file: { type: front.ext, file_token: front.token },
      ...common,
    });
  }

  // Multiview: upload each present view; keep Tripo's fixed slot order.
  // Empty slots must be sent as {} so the array stays [front, left, back, right].
  const [frontU, leftU, backU, rightU] = await Promise.all([
    uploadToTripo(input.imageUrl),
    left ? uploadToTripo(left) : Promise.resolve(null),
    back ? uploadToTripo(back) : Promise.resolve(null),
    right ? uploadToTripo(right) : Promise.resolve(null),
  ]);

  const slot = (u: UploadedImage | null) =>
    u ? { type: u.ext, file_token: u.token } : {};

  // Files are ordered by Tripo's fixed convention [FRONT, LEFT, BACK, RIGHT];
  // no separate orientation field is sent so unknown-param validation can't fail.
  return submitTask({
    type: "multiview_to_model",
    files: [slot(frontU), slot(leftU), slot(backU), slot(rightU)],
    ...common,
  });
}

/**
 * Start a Tripo auto-rig (UniRig quadruped) on a previously generated model.
 * Body confirmed against Tripo docs (platform.tripo3d.ai/docs/animation) + the
 * ComfyUI-Tripo node schema: { type:"animate_rig", original_model_task_id,
 * out_format:"glb", spec:"tripo", model_version }.
 *
 * `originalModelTaskId` may be passed with or without the `tripo:` prefix.
 */
export async function startRig(
  originalModelTaskId: string,
  opts?: { modelVersion?: string; avatarType?: 'dog' | 'human' }
): Promise<string> {
  const original = originalModelTaskId.startsWith(TRIPO_PREFIX)
    ? tripoTaskId(originalModelTaskId)
    : originalModelTaskId;
  const spec = opts?.avatarType === "human" ? "humanoid" : "tripo";
  return submitTask({
    type: "animate_rig",
    original_model_task_id: original,
    out_format: "glb",
    spec,
    // Pin a rig model version for reproducibility; override via env if Tripo bumps it.
    model_version: opts?.modelVersion || process.env.TRIPO_RIG_MODEL_VERSION || "v2.0-20250506",
  });
}

/**
 * Fallback path (spec §3.1): if clip retarget confidence is too low, request one
 * of Tripo's own preset animations on the rigged model via `animate_retarget`.
 */
export async function startRetarget(
  originalModelTaskId: string,
  animation: "preset:walk" | "preset:run" | "preset:idle"
): Promise<string> {
  const original = originalModelTaskId.startsWith(TRIPO_PREFIX)
    ? tripoTaskId(originalModelTaskId)
    : originalModelTaskId;
  return submitTask({
    type: "animate_retarget",
    original_model_task_id: original,
    out_format: "glb",
    animation,
  });
}

export interface TripoPollResult {
  done: boolean;
  glbUrl?: string;
  error?: string;
  progress?: number;
}

/** Poll any Tripo task (generation, rig, or retarget) for its GLB output. */
export const pollTripoTask = pollImageTo3D;

export async function pollImageTo3D(operationName: string): Promise<TripoPollResult> {
  const taskId = tripoTaskId(operationName);
  const res = await fetch(`${TRIPO_BASE}/task/${encodeURIComponent(taskId)}`, {
    headers: { Authorization: `Bearer ${apiKey()}` },
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Tripo status check failed (${res.status}): ${JSON.stringify(json)}`);
  }

  const status = json?.data?.status;
  const progress = typeof json?.data?.progress === "number" ? json.data.progress : undefined;

  if (status === "success") {
    const output = json?.data?.output || {};
    // Try multiple possible field names for the GLB download URL
    const glbUrl = output.model || output.model_url || output.pbr_model || output.base_model;
    console.log(`[Tripo] Task ${taskId} succeeded. Output keys: ${Object.keys(output).join(", ")}. glbUrl: ${glbUrl}`);
    if (!glbUrl) {
      throw new Error(`Tripo task succeeded but no model URL found in output: ${JSON.stringify(output)}`);
    }
    return { done: true, glbUrl, progress: 100 };
  } else if (status === "failed" || status === "cancelled") {
    return { done: true, error: `Tripo generation failed: ${status}`, progress };
  } else {
    return { done: false, progress };
  }
}
