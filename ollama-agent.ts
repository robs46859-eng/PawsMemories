/**
 * AI Agent for pet image analysis and Blender script generation.
 * (Note: Originally designed for Ollama, but switched to Google Gemini 1.5
 * to avoid 401 Unauthorized errors on public endpoints, since Gemini is 
 * already configured and authenticated in this project.)
 * 
 * Uses Gemini Pro/Flash vision model to:
 *   1. Analyze pet photos — identify species, breed, pose, anatomy
 *   2. Generate Blender Python rigging scripts — armature with proper bone structure
 *   3. Generate Blender Python animation scripts — 6 action animations baked to sprite sheet
 */

import { GoogleGenAI } from "@google/genai";

// =============================================================================
// Types
// =============================================================================

export interface PetAnalysis {
  species: string;        // "dog", "cat", "bird", "rabbit", etc.
  breed: string;          // "Golden Retriever", "Persian Cat", etc.
  bodyType: string;       // "quadruped", "biped", "winged"
  estimatedPose: string;  // "standing", "sitting", "lying_down"
  legCount: number;       // 4 for most pets
  hasTail: boolean;
  hasWings: boolean;
  bodyProportions: {
    headSize: string;     // "small", "medium", "large"
    legLength: string;    // "short", "medium", "long"
    bodyLength: string;   // "compact", "medium", "elongated"
    neckLength: string;   // "short", "medium", "long"
  };
}

// =============================================================================
// Helpers
// =============================================================================

function getAiClient() {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is not set. Cannot use AI agent.");
  }
  return new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
}

/**
 * Extract JSON from a potentially mixed text + JSON response.
 */
function extractJson<T>(text: string): T {
  // Try to find JSON block in markdown code fences
  const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenceMatch) {
    return JSON.parse(fenceMatch[1].trim());
  }

  // Try to find raw JSON object
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    return JSON.parse(jsonMatch[0]);
  }

  throw new Error(`Could not extract JSON from AI response: ${text.slice(0, 200)}`);
}

/**
 * Wraps Gemini API calls with exponential backoff to handle 503 "High Demand" errors.
 */
async function generateContentWithRetry(ai: any, request: any, maxRetries = 5) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await ai.models.generateContent(request);
    } catch (err: any) {
      const isRetryable = err.status === 503 || err.status === 429 || (err.message && (err.message.includes("503") || err.message.includes("429") || err.message.includes("UNAVAILABLE") || err.message.includes("high demand")));
      
      if (isRetryable && i < maxRetries - 1) {
        const waitTime = Math.pow(2, i) * 2000;
        console.warn(`[AI Agent] Gemini High Demand Error (Attempt ${i + 1}/${maxRetries}). Retrying in ${waitTime}ms...`);
        await new Promise(r => setTimeout(r, waitTime));
      } else {
        throw err;
      }
    }
  }
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Analyze a pet photo using Gemini vision model.
 * Returns structured data about the animal's species, breed, anatomy, and pose.
 */
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
    
    // Process base64
    let cleanBase64 = imageBase64;
    let mimeType = "image/jpeg";
    const match = imageBase64.match(/^data:([^;]+);base64,(.+)$/);
    if (match) {
      mimeType = match[1];
      cleanBase64 = match[2];
    }

    const response = await generateContentWithRetry(ai, {
      model: 'gemini-2.5-flash',
      contents: [
        {
          role: 'user',
          parts: [
            { text: prompt },
            {
              inlineData: {
                data: cleanBase64,
                mimeType,
              }
            }
          ]
        }
      ],
      config: {
        temperature: 0.1,
      }
    });

    const responseText = response.text || "";
    const analysis = extractJson<PetAnalysis>(responseText);
    console.log(`[AI Agent] ✅ Detected: ${analysis.species} (${analysis.breed}), ${analysis.bodyType}, pose: ${analysis.estimatedPose}`);
    return analysis;
  } catch (err) {
    console.warn("[AI Agent] Failed to parse analysis, using fallback:", err);
    // Fallback to a safe default (dog)
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

/**
 * Generate a Blender Python script for rigging a 3D mesh based on pet analysis.
 */
export async function generateRiggingScript(analysis: PetAnalysis): Promise<string> {
  console.log(`[AI Agent] Generating rigging script for ${analysis.species} (${analysis.breed}) using Gemini...`);

  const prompt = `You are an expert Blender Python (bpy) scripter specializing in 3D character rigging.

Generate a complete Blender Python script that:
1. Assumes a GLB mesh is already imported and is the active object
2. Creates a new armature with bones appropriate for a ${analysis.species} (${analysis.breed})
3. The animal is a ${analysis.bodyType} with ${analysis.legCount} legs
4. Body proportions: head=${analysis.bodyProportions.headSize}, legs=${analysis.bodyProportions.legLength}, body=${analysis.bodyProportions.bodyLength}, neck=${analysis.bodyProportions.neckLength}
5. Has tail: ${analysis.hasTail}

The armature MUST include these bone chains (using these EXACT bone names):
- ROOT bone at the center of mass
- Spine chain: "hips" → "spine" → "chest"
- Neck: "neck" → "head"
- Front left leg: "front_leg_upper.L" → "front_leg_lower.L" → "front_paw.L"
- Front right leg: "front_leg_upper.R" → "front_leg_lower.R" → "front_paw.R"
- Back left leg: "back_leg_upper.L" → "back_leg_lower.L" → "back_paw.L"
- Back right leg: "back_leg_upper.R" → "back_leg_lower.R" → "back_paw.R"
${analysis.hasTail ? '- Tail chain: "tail_01" → "tail_02" → "tail_03"' : ""}

The script must:
- Create the armature in edit mode
- Position bones approximately based on the mesh bounding box
- If calculating world bounding box corners, MUST use: "from mathutils import Vector; world_bbox_corners = [mesh_obj.matrix_world @ Vector(v) for v in mesh_obj.bound_box]"
- To parent with automatic weights, you MUST use exactly this code:
  bpy.context.view_layer.objects.active = armature_obj
  mesh_obj.select_set(True)
  armature_obj.select_set(True)
  bpy.ops.object.parent_set(type='ARMATURE_AUTO')
- ALWAYS switch back to OBJECT mode before finishing (e.g., bpy.ops.object.mode_set(mode='OBJECT'))
- Set the armature as the active object when done
- If using show_in_front, apply it to the armature object (e.g., armature_obj.show_in_front = True), NEVER to the armature data.
- If you need to calculate radians, use the standard Python "math" module (e.g., import math; math.radians(90)), NOT mathutils.radians().
- DO NOT use "return" outside of a function (use sys.exit(1) if you need to abort early).
- DO NOT use "edit_bones.clear()". To remove bones, use a loop: "for b in list(armature.edit_bones): armature.edit_bones.remove(b)"
- NOT render anything
- NOT save the file
- Print "RIGGING_COMPLETE" when done

IMPORTANT: Return ONLY the Python code, no markdown fences, no explanations. Start with "import bpy".`;

  const ai = getAiClient();
  const response = await generateContentWithRetry(ai, {
    model: 'gemini-2.5-flash', // Using 2.5-flash for compatibility
    contents: prompt,
    config: { temperature: 0.1 }
  });

  // Extract just the Python code
  let script = response.text || "";

  // Remove markdown fences if present
  const fenceMatch = script.match(/```(?:python)?\s*\n?([\s\S]*?)\n?```/);
  if (fenceMatch) {
    script = fenceMatch[1];
  }

  // Ensure script starts with import
  if (!script.trim().startsWith("import")) {
    const importIdx = script.indexOf("import bpy");
    if (importIdx >= 0) {
      script = script.slice(importIdx);
    }
  }

  // Ensure the completion marker is present
  if (!script.includes("RIGGING_COMPLETE")) {
    script += '\nprint("RIGGING_COMPLETE")\n';
  }

  console.log(`[AI Agent] ✅ Rigging script generated (${script.length} chars)`);
  return script;
}

/**
 * Generate a Blender Python script that creates 6 action animations
 * and bakes them into a sprite sheet PNG.
 */
export async function generateSpriteAnimationScript(analysis: PetAnalysis): Promise<string> {
  console.log(`[AI Agent] Generating sprite animation script for ${analysis.species} using Gemini...`);

  const prompt = `You are an expert Blender Python (bpy) scripter specializing in character animation and sprite sheet rendering.

Generate a complete Blender Python script that:
1. Assumes a rigged ${analysis.species} ARMATURE is the active object (and the mesh is its child)
2. The armature has these bone names: hips, spine, chest, neck, head, front_leg_upper.L/R, front_leg_lower.L/R, front_paw.L/R, back_leg_upper.L/R, back_leg_lower.L/R, back_paw.L/R${analysis.hasTail ? ", tail_01, tail_02, tail_03" : ""}
3. Creates 6 separate NLA actions with keyframe animations:

ACTION 1 - "eating" (8 frames at 12fps):
  - Head and neck dip down toward the ground
  - Small jaw-like bobbing motion on the head bone
  - Body stays mostly still, slight lean forward

ACTION 2 - "drinking" (8 frames at 12fps):
  - Similar to eating but head stays at a consistent low level
  - Slight rhythmic head bobbing (lapping motion)
  - Neck extends downward

ACTION 3 - "running" (12 frames at 16fps):
  - Full gallop/trot cycle
  - Front and back legs alternate in pairs
  - Body bobs up and down slightly
  - ${analysis.hasTail ? "Tail follows body motion with slight delay" : ""}

ACTION 4 - "playing" (10 frames at 14fps):
  - Playful bounce/jump
  - Front paws lift up, then spring up
  - ${analysis.hasTail ? "Tail wags rapidly" : ""}
  - Energetic, joyful motion

ACTION 5 - "sleeping" (6 frames at 6fps):
  - Body lowered to ground (legs tucked)
  - Slow breathing cycle (chest/spine gentle rise/fall)
  - Head resting on or near front paws
  - Very subtle, calm motion

ACTION 6 - "photo" (4 frames at 8fps):
  - Alert sitting/standing pose
  - Head tilts slightly to one side
  - Ears perk up (via head bone rotation)
  - Hold the pose for most frames

4. After creating all animations, renders a SPRITE SHEET:
  - Set up an orthographic camera facing the model from the side
  - Set render resolution to 128x128 per frame
  - For each action, render all frames in sequence
  - Arrange frames in a grid: each row = one animation, columns = frames
  - Total sheet: 12 columns wide × 6 rows tall (max frames across all animations × 6 actions)
  - Save as a single transparent PNG at the output path
  - Also save a JSON metadata file next to it with frame counts and FPS per animation

5. The output path variable should be called "output_path" and will be overridden by the server
6. The metadata JSON path should be "output_path" with extension changed to ".json"
7. Use transparent background (RGBA)
8. DO NOT use "return" outside of a function (use sys.exit(1) if you need to abort early).
9. Print "SPRITE_BAKE_COMPLETE" when done
10. IMPORTANT: If assigning an action, ALWAYS check if animation_data exists first! (e.g., "if not obj.animation_data: obj.animation_data_create()")
11. EXTREMELY IMPORTANT: Keep the code concise by using loops, helper functions, and math for keyframes. DO NOT hardcode every single frame manually, or the script will be truncated and crash with a SyntaxError. Maximum length: 400 lines.
12. DO NOT use bpy.ops.object.select_all() as it fails in headless mode context. To deselect, use: "for o in bpy.context.selected_objects: o.select_set(False)"
13. CRITICAL: Do NOT copy pixels using Python lists or read from 'Render Result' directly (it will crash with IndexError). You MUST:
    a) Render each frame to disk first (e.g. filepath = f"/tmp/frame_{i}.png", then ops.render.render(write_still=True))
    b) Load it: img = bpy.data.images.load(f"/tmp/frame_{i}.png")
    c) Create the sheet: sheet = bpy.data.images.new("Sheet", sheet_width, sheet_height, alpha=True)
    d) Use numpy for fast copying:
       import numpy as np
       sheet_pixels = np.zeros((sheet_height, sheet_width, 4), dtype=np.float32)
       for ... # load img
           src = np.empty((h, w, 4), dtype=np.float32)
           img.pixels.foreach_get(src.ravel())
           sheet_pixels[dest_y:dest_y+h, dest_x:dest_x+w] = src
       sheet.pixels.foreach_set(sheet_pixels.ravel())
       sheet.filepath_raw = output_path
       sheet.save()

14. CRITICAL RENDER SETTINGS — you MUST use these exact render settings to ensure fast rendering:
    scene.render.engine = 'BLENDER_EEVEE'
    scene.render.resolution_x = 128
    scene.render.resolution_y = 128
    scene.eevee.taa_render_samples = 16
    DO NOT use Cycles. EEVEE is mandatory for performance on the render server.

IMPORTANT: Return ONLY the Python code. Start with "import bpy".`;

  const ai = getAiClient();
  const response = await generateContentWithRetry(ai, {
    model: 'gemini-2.5-flash',
    contents: prompt,
    config: { temperature: 0.1 }
  });

  // Extract the Python code
  let script = response.text || "";
  const fenceMatch = script.match(/```(?:python)?\s*\n?([\s\S]*?)\n?```/);
  if (fenceMatch) {
    script = fenceMatch[1];
  }

  if (!script.trim().startsWith("import")) {
    const importIdx = script.indexOf("import bpy");
    if (importIdx >= 0) {
      script = script.slice(importIdx);
    }
  }

  if (!script.includes("SPRITE_BAKE_COMPLETE")) {
    script += '\nprint("SPRITE_BAKE_COMPLETE")\n';
  }

  console.log(`[AI Agent] ✅ Animation/sprite script generated (${script.length} chars)`);
  return script;
}

/**
 * Convenience: run the full analysis + script generation pipeline.
 * Returns both scripts ready for the Blender worker.
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
