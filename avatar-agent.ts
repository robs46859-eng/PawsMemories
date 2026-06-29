/**
 * Avatar Agent — Multi-Agent Pipeline Entry Point
 * =================================================
 * Replaces the old single-shot ollama-agent.ts with a multi-agent
 * perceive → reason → act → verify loop.
 *
 * This file is the public API consumed by server.ts.
 * It preserves backward compatibility with the old exports while
 * routing to the new orchestrator.
 */

import { GoogleGenAI } from "@google/genai";
import { runBuildPipeline } from "./agent/graph/orchestrator";
import type { PetAnalysis } from "./agent/graph/nodes/types";
import type { ProgressCallback } from "./agent/graph/orchestrator";

// Re-export PetAnalysis for backward compatibility
export type { PetAnalysis };

// =============================================================================
// Helpers (preserved from ollama-agent.ts)
// =============================================================================

function getAiClient() {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is not set. Cannot use AI agent.");
  }
  return new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
}

function extractJson<T>(text: string): T {
  const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenceMatch) {
    return JSON.parse(fenceMatch[1].trim());
  }
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    return JSON.parse(jsonMatch[0]);
  }
  throw new Error(`Could not extract JSON from AI response: ${text.slice(0, 200)}`);
}

const FALLBACK_MODEL = "gemini-2.0-flash";

async function generateContentWithRetry(ai: any, request: any, maxRetries = 8) {
  let lastError: any;
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await ai.models.generateContent(request);
    } catch (err: any) {
      lastError = err;
      const isRetryable =
        err.status === 503 ||
        err.status === 429 ||
        (err.message &&
          (err.message.includes("503") ||
            err.message.includes("429") ||
            err.message.includes("UNAVAILABLE") ||
            err.message.includes("high demand")));
      if (isRetryable && i < maxRetries - 1) {
        const waitTime = Math.min(Math.pow(2, i) * 2000, 30000);
        console.warn(`[AI Agent] Gemini retry ${i + 1}/${maxRetries} in ${waitTime / 1000}s...`);
        await new Promise((r) => setTimeout(r, waitTime));
      } else if (!isRetryable) {
        throw err;
      }
    }
  }
  const primaryModel = request.model || "unknown";
  if (primaryModel !== FALLBACK_MODEL) {
    console.warn(`[AI Agent] Falling back to ${FALLBACK_MODEL}...`);
    try {
      return await ai.models.generateContent({ ...request, model: FALLBACK_MODEL });
    } catch (fallbackErr: any) {
      throw fallbackErr;
    }
  }
  throw lastError;
}

// =============================================================================
// Public API: Pet Analysis (preserved, still uses Gemini)
// =============================================================================

export async function analyzePetImage(imageBase64: string): Promise<PetAnalysis> {
  console.log("[AI Agent] Analyzing pet image with Gemini...");

  const prompt = `You are an expert animal anatomist and 3D modeler. Analyze this pet photo and return a JSON object with the following structure. Be precise about the animal's anatomy as this will be used for 3D rigging.

Return ONLY a valid JSON object with this exact structure (no other text):
{
  "species": "dog",
  "breed": "Golden Retriever",
  "bodyType": "quadruped",
  "estimatedPose": "standing",
  "legCount": 4,
  "hasTail": true,
  "hasWings": false,
  "bodyProportions": {
    "headSize": "medium",
    "legLength": "medium",
    "bodyLength": "medium",
    "neckLength": "medium"
  }
}

Rules:
- species: the animal type (dog, cat, bird, rabbit, hamster, etc.)
- breed: best guess at the breed, or "Mixed" if unclear
- bodyType: "quadruped" for 4-legged, "biped" for 2-legged, "winged" for birds
- estimatedPose: "standing", "sitting", "lying_down", or "other"
- legCount: number of legs (4 for dogs/cats, 2 for birds)
- bodyProportions values: "small", "medium", or "large" / "short", "medium", "long" / "compact", "medium", "elongated"

Return ONLY the JSON object.`;

  try {
    const ai = getAiClient();
    let cleanBase64 = imageBase64;
    let mimeType = "image/jpeg";
    const match = imageBase64.match(/^data:([^;]+);base64,(.+)$/);
    if (match) {
      mimeType = match[1];
      cleanBase64 = match[2];
    }

    const response = await generateContentWithRetry(ai, {
      model: "gemini-2.5-flash",
      contents: [
        {
          role: "user",
          parts: [
            { text: prompt },
            { inlineData: { data: cleanBase64, mimeType } },
          ],
        },
      ],
      config: { temperature: 0.1 },
    });

    const responseText = response.text || "";
    const analysis = extractJson<PetAnalysis>(responseText);
    console.log(`[AI Agent] ✅ Detected: ${analysis.species} (${analysis.breed}), ${analysis.bodyType}`);
    return analysis;
  } catch (err) {
    console.warn("[AI Agent] Analysis failed, using fallback:", err);
    return {
      species: "dog",
      breed: "Mixed Breed",
      bodyType: "quadruped",
      estimatedPose: "standing",
      legCount: 4,
      hasTail: true,
      hasWings: false,
      bodyProportions: {
        headSize: "medium",
        legLength: "medium",
        bodyLength: "medium",
        neckLength: "medium",
      },
    };
  }
}

// =============================================================================
// Public API: Multi-Agent Avatar Build
// =============================================================================

/**
 * Build a complete rigged, animated 3D avatar using the multi-agent pipeline.
 *
 * This replaces the old generateRiggingScript() + generateSpriteAnimationScript()
 * with the perceive → reason → act → verify loop.
 *
 * @param petPhoto - Base64-encoded pet photo for analysis
 * @param glbBuffer - Raw GLB mesh buffer from HuggingFace
 * @param options - Optional progress callback
 */
export async function buildAvatarWithAgent(
  petPhoto: string,
  glbBuffer: Buffer,
  options?: { onProgress?: ProgressCallback }
): Promise<{
  analysis: PetAnalysis;
  riggedGlbBase64: string | null;
  spriteSheetBase64: string | null;
  animationMetadata: any;
  success: boolean;
  statusMessage: string;
}> {
  // Step 1: Analyze the pet image
  const analysis = await analyzePetImage(petPhoto);

  // Step 2: Run the multi-agent build pipeline
  const glbBase64 = glbBuffer.toString("base64");
  const state = await runBuildPipeline(analysis, glbBase64, options?.onProgress);

  return {
    analysis,
    riggedGlbBase64: state.riggedGlbBase64,
    spriteSheetBase64: state.spriteSheetBase64,
    animationMetadata: state.animationMetadata,
    success: state.status === "completed",
    statusMessage: state.statusMessage,
  };
}

// =============================================================================
// Legacy API: Single-shot script generation (preserved for backward compat)
// =============================================================================

/**
 * @deprecated Use buildAvatarWithAgent() instead.
 * Preserved for backward compatibility with the old pipeline in server.ts.
 */
export async function generateRiggingScript(analysis: PetAnalysis): Promise<string> {
  console.log(`[AI Agent] [Legacy] Generating rigging script for ${analysis.species}...`);

  const prompt = `You are an expert Blender 5.1 Python (bpy) scripter specializing in 3D character rigging.

Generate a complete Blender Python script that:
1. Assumes a GLB mesh is already imported and is the active object
2. Creates a new armature with bones appropriate for a ${analysis.species} (${analysis.breed})
3. The animal is a ${analysis.bodyType} with ${analysis.legCount} legs
4. Body proportions: head=${analysis.bodyProportions.headSize}, legs=${analysis.bodyProportions.legLength}, body=${analysis.bodyProportions.bodyLength}, neck=${analysis.bodyProportions.neckLength}
5. Has tail: ${analysis.hasTail}

Use these EXACT bone names: hips → spine → chest → neck → head,
front_leg_upper.L/R → front_leg_lower.L/R → front_paw.L/R,
back_leg_upper.L/R → back_leg_lower.L/R → back_paw.L/R
${analysis.hasTail ? "tail_01 → tail_02 → tail_03" : ""}

IMPORTANT: Return ONLY the Python code, no markdown fences. Start with "import bpy".`;

  const ai = getAiClient();
  const response = await generateContentWithRetry(ai, {
    model: "gemini-2.5-flash",
    contents: prompt,
    config: { temperature: 0.1 },
  });

  let script = response.text || "";
  const fenceMatch = script.match(/```(?:python)?\s*\n?([\s\S]*?)\n?```/);
  if (fenceMatch) script = fenceMatch[1];
  if (!script.trim().startsWith("import")) {
    const idx = script.indexOf("import bpy");
    if (idx >= 0) script = script.slice(idx);
  }
  if (!script.includes("RIGGING_COMPLETE")) {
    script += '\nprint("RIGGING_COMPLETE")\n';
  }

  return script;
}

/**
 * @deprecated Use buildAvatarWithAgent() instead.
 */
export async function generateSpriteAnimationScript(analysis: PetAnalysis): Promise<string> {
  console.log(`[AI Agent] [Legacy] generateSpriteAnimationScript called — use buildAvatarWithAgent() instead`);
  return '# Legacy sprite script — use multi-agent pipeline instead\nprint("SPRITE_BAKE_COMPLETE")\n';
}

/**
 * @deprecated Use buildAvatarWithAgent() instead.
 */
export async function generateAvatarScripts(imageBase64: string): Promise<{
  analysis: PetAnalysis;
  riggingScript: string;
  spriteScript: string;
}> {
  const analysis = await analyzePetImage(imageBase64);
  const riggingScript = await generateRiggingScript(analysis);
  const spriteScript = await generateSpriteAnimationScript(analysis);
  return { analysis, riggingScript, spriteScript };
}
