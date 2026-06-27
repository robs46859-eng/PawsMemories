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

export interface TripoJobInput {
  imageUrl: string;
}

export async function startImageTo3D(input: TripoJobInput): Promise<string> {
  // 1. Download image
  const imgRes = await fetch(input.imageUrl);
  if (!imgRes.ok) throw new Error(`Failed to download image for Tripo: ${imgRes.statusText}`);
  const arrayBuffer = await imgRes.arrayBuffer();
  const mimeType = imgRes.headers.get("content-type") || "image/jpeg";
  let ext = "jpg";
  if (mimeType.includes("png")) ext = "png";

  // 2. Upload to Tripo using native FormData and Blob (Node 18+)
  const blob = new Blob([arrayBuffer], { type: mimeType });
  const formData = new FormData();
  formData.append("file", blob, `upload.${ext}`);

  const uploadRes = await fetch(`${TRIPO_BASE}/upload`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      // Native fetch automatically sets Content-Type boundary for native FormData
    },
    body: formData,
  });

  const uploadJson: any = await uploadRes.json().catch(() => ({}));
  if (!uploadRes.ok) {
    throw new Error(`Tripo upload failed (${uploadRes.status}): ${JSON.stringify(uploadJson)}`);
  }
  
  // Tripo v2 upload endpoint returns data.image_token
  const fileToken = uploadJson?.data?.image_token;
  if (!fileToken) {
    throw new Error(`Tripo upload returned no image_token: ${JSON.stringify(uploadJson)}`);
  }

  // 3. Start task
  const body = {
    type: "image_to_model",
    file: {
      type: ext,
      file_token: fileToken
    }
  };

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
    throw new Error(`Tripo image-to-3d failed (${res.status}): ${JSON.stringify(json)}`);
  }
  
  const taskId = json?.data?.task_id;
  if (!taskId) {
    throw new Error(`Tripo image-to-3d returned no task id: ${JSON.stringify(json)}`);
  }
  return `${TRIPO_PREFIX}${taskId}`;
}

export interface TripoPollResult {
  done: boolean;
  glbUrl?: string;
  error?: string;
  progress?: number;
}

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
