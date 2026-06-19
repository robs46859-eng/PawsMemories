/**
 * HuggingFace Gradio API client for image-to-3D mesh generation.
 * Uses the Hunyuan3D-2 Space (tencent/Hunyuan3D-2) via its REST API.
 *
 * The Gradio HTTP API exposes three phases:
 *   1. Upload the image file
 *   2. Submit a prediction job
 *   3. Poll for completion and download the result GLB
 */

const DEFAULT_SPACE = "tencent/Hunyuan3D-2";

interface GradioUploadResult {
  path: string;
  url: string;
  size: number;
  orig_name: string;
  mime_type: string;
}

interface GradioPredictResponse {
  event_id?: string;
  hash?: string;
  data?: any[];
}

interface GradioStatusResponse {
  msg: string; // "process_starts" | "process_generating" | "process_completed" | "estimation" | "queue_full"
  output?: { data: any[] };
  success?: boolean;
  event_id?: string;
}

function getSpaceUrl(): string {
  const space = process.env.HUGGINGFACE_SPACE || DEFAULT_SPACE;
  // Convert "owner/repo" to the Spaces URL format
  const [owner, repo] = space.split("/");
  return `https://${owner}-${repo}.hf.space`;
}

function getHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const token = process.env.HUGGINGFACE_TOKEN;
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  return headers;
}

/**
 * Upload an image (as base64) to the Gradio Space's file upload endpoint.
 * Returns the server-side path for use in prediction calls.
 */
async function uploadImageToSpace(imageBase64: string): Promise<string> {
  const spaceUrl = getSpaceUrl();

  // Strip the data URI prefix if present
  let rawBase64 = imageBase64;
  let mimeType = "image/png";
  const dataUriMatch = imageBase64.match(/^data:([^;]+);base64,(.+)$/);
  if (dataUriMatch) {
    mimeType = dataUriMatch[1];
    rawBase64 = dataUriMatch[2];
  }

  // Convert base64 to a Blob/Buffer for multipart upload
  const imageBuffer = Buffer.from(rawBase64, "base64");
  const ext = mimeType.includes("png") ? "png" : mimeType.includes("webp") ? "webp" : "jpg";
  const filename = `pet_photo.${ext}`;

  // Gradio's upload endpoint accepts multipart/form-data
  const formBoundary = `----FormBoundary${Date.now()}`;
  const formParts: Buffer[] = [];

  // Build multipart body manually (no external dependency needed)
  const fileHeader = [
    `--${formBoundary}`,
    `Content-Disposition: form-data; name="files"; filename="${filename}"`,
    `Content-Type: ${mimeType}`,
    "",
    "",
  ].join("\r\n");

  formParts.push(Buffer.from(fileHeader, "utf-8"));
  formParts.push(imageBuffer);
  formParts.push(Buffer.from(`\r\n--${formBoundary}--\r\n`, "utf-8"));

  const formBody = Buffer.concat(formParts);

  const uploadRes = await fetch(`${spaceUrl}/upload`, {
    method: "POST",
    headers: {
      "Content-Type": `multipart/form-data; boundary=${formBoundary}`,
      ...(process.env.HUGGINGFACE_TOKEN
        ? { Authorization: `Bearer ${process.env.HUGGINGFACE_TOKEN}` }
        : {}),
    },
    body: formBody,
  });

  if (!uploadRes.ok) {
    const errText = await uploadRes.text();
    throw new Error(`HuggingFace upload failed (${uploadRes.status}): ${errText}`);
  }

  const uploadData = (await uploadRes.json()) as GradioUploadResult[];
  if (!uploadData || !uploadData[0]?.path) {
    throw new Error("HuggingFace upload returned no file path");
  }

  console.log(`[HF-3D] Image uploaded to Space: ${uploadData[0].path}`);
  return uploadData[0].path;
}

/**
 * Submit a prediction job to the Gradio Space and return the event_id for polling.
 */
async function submitPrediction(uploadedFilePath: string): Promise<string> {
  const spaceUrl = getSpaceUrl();
  const headers = getHeaders();

  // The Hunyuan3D-2 Space typically expects:
  //   - An image input
  //   - Optional parameters (seed, steps, etc.)
  // The exact API shape can vary — we use the standard Gradio predict endpoint
  const payload = {
    data: [
      {
        path: uploadedFilePath,
        meta: { _type: "gradio.FileData" },
      },
      // Default generation params (seed=-1 for random, 50 steps)
      -1,  // seed
      50,   // steps
    ],
    fn_index: 0,
    session_hash: `paws_${Date.now()}`,
  };

  const res = await fetch(`${spaceUrl}/api/predict`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });

  // Some Spaces use the queue system instead of direct predict
  if (res.status === 422 || res.status === 404) {
    // Fall back to queue-based approach
    return await submitViaQueue(uploadedFilePath);
  }

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`HuggingFace predict failed (${res.status}): ${errText}`);
  }

  const data = (await res.json()) as GradioPredictResponse;
  if (data.event_id) return data.event_id;
  if (data.hash) return data.hash;

  // If we got a direct result (no queue), handle it here
  if (data.data) {
    // Direct result — return a special marker
    return `__DIRECT__${JSON.stringify(data.data)}`;
  }

  throw new Error("HuggingFace predict returned no event_id or direct result");
}

/**
 * Submit via the queue-based API (used by most Spaces with GPU requirements).
 */
async function submitViaQueue(uploadedFilePath: string): Promise<string> {
  const spaceUrl = getSpaceUrl();
  const headers = getHeaders();
  const sessionHash = `paws_${Date.now()}`;

  const payload = {
    data: [
      {
        path: uploadedFilePath,
        meta: { _type: "gradio.FileData" },
      },
      -1,  // seed
      50,   // steps
    ],
    fn_index: 0,
    session_hash: sessionHash,
  };

  const res = await fetch(`${spaceUrl}/queue/push`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`HuggingFace queue push failed (${res.status}): ${errText}`);
  }

  const data = await res.json();
  const eventId = data.event_id || data.hash || sessionHash;
  console.log(`[HF-3D] Job queued with event_id: ${eventId}`);
  return eventId;
}

/**
 * Poll the Space's queue for job completion. Returns the raw result data.
 * Uses Server-Sent Events (SSE) or polling depending on Space configuration.
 */
async function pollForResult(eventId: string, maxWaitMs = 300000): Promise<any[]> {
  // Handle direct results (no polling needed)
  if (eventId.startsWith("__DIRECT__")) {
    return JSON.parse(eventId.slice(10));
  }

  const spaceUrl = getSpaceUrl();
  const startTime = Date.now();

  // Poll the queue status endpoint
  while (Date.now() - startTime < maxWaitMs) {
    try {
      const statusRes = await fetch(`${spaceUrl}/queue/status`, {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify({ hash: eventId }),
      });

      if (statusRes.ok) {
        const status = (await statusRes.json()) as GradioStatusResponse;
        console.log(`[HF-3D] Queue status: ${status.msg}`);

        if (status.msg === "process_completed" && status.output?.data) {
          return status.output.data;
        }
        if (status.msg === "process_completed" && !status.success) {
          throw new Error("HuggingFace generation failed on the server");
        }
      }
    } catch (err: any) {
      if (err.message.includes("generation failed")) throw err;
      console.warn(`[HF-3D] Poll error (retrying): ${err.message}`);
    }

    // Wait 5 seconds between polls
    await new Promise((r) => setTimeout(r, 5000));
  }

  throw new Error(`HuggingFace generation timed out after ${maxWaitMs / 1000}s`);
}

/**
 * Download a GLB file from the Space's file server.
 * The result data typically contains a file reference we need to fetch.
 */
async function downloadGlbFromResult(resultData: any[]): Promise<Buffer> {
  const spaceUrl = getSpaceUrl();

  // The result structure varies by Space. Common patterns:
  // 1. Direct file reference: { path: "...", url: "..." }
  // 2. Nested in a dict: { value: { path: "..." } }
  // 3. URL string directly

  let fileUrl: string | null = null;

  for (const item of resultData) {
    if (!item) continue;

    // Pattern: { path: "file/...", url: "..." }
    if (typeof item === "object" && item.url) {
      fileUrl = item.url.startsWith("http") ? item.url : `${spaceUrl}/file=${item.path || item.url}`;
      break;
    }
    if (typeof item === "object" && item.path) {
      fileUrl = `${spaceUrl}/file=${item.path}`;
      break;
    }
    // Pattern: { value: { path: "..." } }
    if (typeof item === "object" && item.value?.path) {
      fileUrl = `${spaceUrl}/file=${item.value.path}`;
      break;
    }
    // Pattern: plain URL string ending in .glb
    if (typeof item === "string" && (item.endsWith(".glb") || item.endsWith(".gltf"))) {
      fileUrl = item.startsWith("http") ? item : `${spaceUrl}/file=${item}`;
      break;
    }
  }

  if (!fileUrl) {
    // Fallback: look for any file path in the result
    const jsonStr = JSON.stringify(resultData);
    const glbMatch = jsonStr.match(/([^"]+\.glb)/);
    if (glbMatch) {
      fileUrl = `${spaceUrl}/file=${glbMatch[1]}`;
    }
  }

  if (!fileUrl) {
    console.error("[HF-3D] Could not extract GLB URL from result:", JSON.stringify(resultData).slice(0, 500));
    throw new Error("Could not extract GLB file URL from HuggingFace result");
  }

  console.log(`[HF-3D] Downloading GLB from: ${fileUrl}`);

  const dlRes = await fetch(fileUrl, {
    headers: process.env.HUGGINGFACE_TOKEN
      ? { Authorization: `Bearer ${process.env.HUGGINGFACE_TOKEN}` }
      : {},
  });

  if (!dlRes.ok) {
    throw new Error(`Failed to download GLB (${dlRes.status}): ${await dlRes.text()}`);
  }

  const arrayBuffer = await dlRes.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  console.log(`[HF-3D] Downloaded GLB: ${buffer.length} bytes`);
  return buffer;
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Main entry point: takes a pet photo (base64) and returns a GLB 3D mesh buffer.
 * This is the full pipeline: upload → predict → poll → download.
 */
export async function generateMeshFromImage(imageBase64: string): Promise<Buffer> {
  console.log("[HF-3D] Starting image-to-3D generation via HuggingFace...");

  // Step 1: Upload image
  const filePath = await uploadImageToSpace(imageBase64);

  // Step 2: Submit prediction
  const eventId = await submitPrediction(filePath);

  // Step 3: Poll for result (up to 5 minutes)
  const resultData = await pollForResult(eventId, 300000);

  // Step 4: Download the GLB file
  const glbBuffer = await downloadGlbFromResult(resultData);

  console.log(`[HF-3D] ✅ 3D mesh generated successfully (${glbBuffer.length} bytes)`);
  return glbBuffer;
}
