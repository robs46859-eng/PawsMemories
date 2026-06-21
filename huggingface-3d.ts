/**
 * HuggingFace Gradio API client for image-to-3D mesh generation.
 * Uses the Hunyuan3D-2 Space (tencent/Hunyuan3D-2) via the official @gradio/client.
 */

import { client, Client, handle_file } from "@gradio/client";

const DEFAULT_SPACE = "tencent/Hunyuan3D-2";

/** Maximum time (ms) to wait for the HuggingFace predict() call. */
const PREDICT_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

/** Maximum retries for transient connection failures. */
const MAX_RETRIES = 2;

/**
 * Main entry point: takes a pet photo (base64) and returns a GLB 3D mesh buffer.
 * Uses the official @gradio/client to robustly handle queuing, SSE, and polling.
 *
 * Includes timeout protection and retry logic to prevent the server from hanging
 * indefinitely when the HuggingFace Space is cold-starting or overloaded.
 */
export async function generateMeshFromImage(imageBase64: string): Promise<Buffer> {
  console.log("[HF-3D] Connecting to HuggingFace Space via @gradio/client...");

  const space = process.env.HUGGINGFACE_SPACE || DEFAULT_SPACE;
  
  console.log(`[HF-3D] Token present: ${!!process.env.HUGGINGFACE_TOKEN}`);

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const backoff = Math.pow(2, attempt) * 3000;
      console.warn(`[HF-3D] Retry attempt ${attempt}/${MAX_RETRIES} after ${backoff}ms...`);
      await new Promise(r => setTimeout(r, backoff));
    }

    try {
      const hfToken = process.env.HUGGINGFACE_TOKEN?.replace(/['"]/g, '').trim();
      
      // Initialize the Gradio client with a connection timeout
      const app = await Promise.race([
        Client.connect(space, {
          hf_token: hfToken,
          token: hfToken, // @gradio/client v2.x expects `token` internally
        } as any),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("HuggingFace Space connection timed out after 60s")), 60000)
        ),
      ]);

      // Ensure base64 string has standard prefix if missing
      let dataUri = imageBase64;
      if (!dataUri.startsWith("data:")) {
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
      // Wrap in a timeout to prevent indefinite hangs when the space is overloaded.
      const result = await Promise.race([
        app.predict("/shape_generation", [
          "",                // caption
          handle_file(imageBlob as any), // image
          null,              // mv_image_front
          null,              // mv_image_back
          null,              // mv_image_left
          null,              // mv_image_right
          30,                // steps (lowered slightly from default 50 for speed)
          5,                 // guidance_scale
          1234,              // seed
          128,               // octree_resolution (lowered from 256 to reduce GLB size and prevent worker OOM)
          true,              // check_box_rembg (remove background)
          8000,              // num_chunks
          true,              // randomize_seed
        ]),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error(`HuggingFace prediction timed out after ${PREDICT_TIMEOUT_MS / 1000}s`)),
            PREDICT_TIMEOUT_MS
          )
        ),
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

      // Fetch the actual file with a timeout
      const dlRes = await fetch(fileUrl, {
        headers: process.env.HUGGINGFACE_TOKEN
          ? { Authorization: `Bearer ${process.env.HUGGINGFACE_TOKEN}` }
          : {},
        signal: AbortSignal.timeout(60000), // 60s download timeout
      });

      if (!dlRes.ok) {
        throw new Error(`Failed to download GLB (${dlRes.status}): ${await dlRes.text()}`);
      }

      const arrayBuffer = await dlRes.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      console.log(`[HF-3D] ✅ 3D mesh generated and downloaded (${buffer.length} bytes)`);
      return buffer;

    } catch (err: any) {
      lastError = err;
      const isRetryable = err.message?.includes("timed out") ||
                           err.message?.includes("fetch") ||
                           err.message?.includes("ECONNREFUSED") ||
                           err.message?.includes("503") ||
                           err.message?.includes("429") ||
                           err.message?.includes("network");
      
      if (isRetryable && attempt < MAX_RETRIES) {
        console.warn(`[HF-3D] Transient error (attempt ${attempt + 1}): ${err.message}`);
        continue;
      }

      // Non-retryable or exhausted retries — rethrow
      throw err;
    }
  }

  // Should not reach here, but just in case
  throw lastError || new Error("HuggingFace mesh generation failed after retries");
}
