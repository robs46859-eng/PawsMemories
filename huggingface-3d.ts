/**
 * HuggingFace Gradio API client for image-to-3D mesh generation.
 * Uses the Hunyuan3D-2 Space (tencent/Hunyuan3D-2) via the official @gradio/client.
 */

import { client, handle_file } from "@gradio/client";
import fetch from "node-fetch"; // Assuming global fetch is available in Node 18+, but we can use global fetch.

const DEFAULT_SPACE = "tencent/Hunyuan3D-2";

/**
 * Main entry point: takes a pet photo (base64) and returns a GLB 3D mesh buffer.
 * Uses the official @gradio/client to robustly handle queuing, SSE, and polling.
 */
export async function generateMeshFromImage(imageBase64: string): Promise<Buffer> {
  console.log("[HF-3D] Connecting to HuggingFace Space via @gradio/client...");

  const space = process.env.HUGGINGFACE_SPACE || DEFAULT_SPACE;
  
  // Initialize the Gradio client
  const app = await client(space, {
    hf_token: process.env.HUGGINGFACE_TOKEN as any, // Works whether token is set or undefined
  });

  // Ensure base64 string has standard prefix if missing
  let dataUri = imageBase64;
  if (!dataUri.startsWith("data:")) {
    // Attempt to guess mime type from base64 start or default to png
    const mime = dataUri.startsWith("/9j/") ? "image/jpeg" : "image/png";
    dataUri = `data:${mime};base64,${dataUri}`;
  }

  // Convert base64 to Blob so @gradio/client uploads it instead of treating it as a local path
  const mimeType = dataUri.match(/^data:(image\/\w+);base64,/)?.[1] || "image/png";
  const base64Data = dataUri.replace(/^data:image\/\w+;base64,/, "");
  const imageBuffer = Buffer.from(base64Data, "base64");
  const imageBlob = new Blob([imageBuffer], { type: mimeType });

  console.log("[HF-3D] Submitting prediction job to /shape_generation...");

  // The Hunyuan3D-2 endpoint `/shape_generation` expects 13 arguments.
  const result = await app.predict("/shape_generation", [
    "",                // caption
    handle_file(imageBlob as any), // image
    null,              // mv_image_front
    null,              // mv_image_back
    null,              // mv_image_left
    null,              // mv_image_right
    30,                // steps (lowered slightly from default 50 for speed)
    5,                 // guidance_scale
    1234,              // seed
    256,               // octree_resolution
    true,              // check_box_rembg (remove background)
    8000,              // num_chunks
    true,              // randomize_seed
  ]);

  console.log("[HF-3D] Prediction completed successfully.");

  // The first item in the returned array is the generated GLB file info
  let fileData = result.data[0] as any;
  if (fileData && fileData.value) {
    fileData = fileData.value;
  }
  
  if (!fileData || (!fileData.url && !fileData.path)) {
    console.error("[HF-3D] Unexpected output from Gradio:", JSON.stringify(result.data, null, 2));
    throw new Error("No GLB file returned from HuggingFace");
  }

  const fileUrl = fileData.url || fileData.path;
  console.log(`[HF-3D] Downloading GLB from: ${fileUrl}`);

  // Fetch the actual file
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

  console.log(`[HF-3D] ✅ 3D mesh generated and downloaded (${buffer.length} bytes)`);
  return buffer;
}
