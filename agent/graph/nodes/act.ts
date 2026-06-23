/**
 * Act Node — GPT Code Generation
 * ================================
 * Generates actual bpy Python code based on the intent from Claude (reason node),
 * grounded by RAG context from the Blender API docs.
 *
 * Then executes the code via the MCP tool interface and returns the result.
 */

import { GoogleGenAI } from "@google/genai";
import type { BuildState, StepResult } from "./types";
import { executeBlenderTool } from "../../tools/blender_mcp";
import { retrieveBlenderContext, formatContextForPrompt } from "../../knowledge/retriever";

// ---------------------------------------------------------------------------
// Forbidden patterns (from the existing sanitizeBlenderScript in ollama-agent.ts)
// ---------------------------------------------------------------------------

const FORBIDDEN_PATTERNS = `
FORBIDDEN PATTERNS (these WILL crash Blender 5.1):
- ❌ bpy.ops.object.select_all() → use: for o in bpy.context.scene.objects: o.select_set(False)
- ❌ bpy.context.selected_objects → unavailable in Render/worker background contexts; iterate bpy.context.scene.objects instead
- ❌ bpy.context.active_object → unavailable in some background contexts; use bpy.context.view_layer.objects.active
- ❌ bpy.ops.import_scene.gltf(...) in generated code → the pipeline imports the input GLB before code generation
- ❌ Hard-coded GLB paths such as /tmp/input.glb, /tmp/model.glb, model.glb, or Windows temp paths
- ❌ edit_bones.clear() → use: for b in list(arm.edit_bones): arm.edit_bones.remove(b)
- ❌ strip.is_active → use: strip.mute = True/False
- ❌ mathutils.radians() → use: import math; math.radians()
- ❌ "return" outside a function → use: sys.exit(1) if needed
- ❌ Full-path keyframe_insert data_path → use RELATIVE path only (e.g., "rotation_euler")
- ❌ Reading pixels from 'Render Result' image → render to disk first
- ❌ light_data.distance = X → Use .energy instead
- ❌ use_contact_shadow(s) = True → removed in EEVEE-Next
- ❌ action.fcurves → removed in Blender 5 Animation 2.0
- ❌ scene.render.engine = 'BLENDER_EEVEE' → use 'BLENDER_WORKBENCH'
- ❌ bpy.data.lights.remove() / bpy.data.cameras.remove() → causes StructRNA ReferenceError
- ❌ BLENDER_EEVEE_NEXT → use BLENDER_EEVEE if needed, but prefer BLENDER_WORKBENCH for headless

MANDATORY PATTERNS:
- ✅ Work with the existing imported mesh in bpy.context.scene.objects; Do not import GLB files from generated code
- ✅ active = bpy.context.view_layer.objects.active — use view_layer for active object access
- ✅ for obj in bpy.context.scene.objects: obj.select_set(False) — safe background deselection
- ✅ bone = armature.pose.bones.get("name") — ALWAYS use .get(), NEVER direct indexing
- ✅ bone.rotation_mode = 'XYZ' — set before using rotation_euler
- ✅ bone.keyframe_insert(data_path="rotation_euler") — RELATIVE path
- ✅ from mathutils import Vector — for bounding box calculations
- ✅ world_bbox = [obj.matrix_world @ Vector(v) for v in obj.bound_box]
- ✅ import math — for math.radians(), math.sin(), math.cos()
`;

const CODE_GEN_SYSTEM_PROMPT = `You are an expert Blender 5.1 Python (bpy) code generator.

You receive:
1. A natural language description of what the code should do (the "intent")
2. Constraints to follow
3. Relevant Blender API documentation (from RAG)
4. The current scene state

Generate ONLY valid Python code that accomplishes the intent. The code will be executed directly in Blender 5.1.2 running headless (--background).

${FORBIDDEN_PATTERNS}

CODE STYLE:
- Start with "import bpy" and any other needed imports
- Assume the pet mesh is already imported into the current scene by the pipeline
- Never load external GLB files or guess filesystem paths
- Use print() for progress logging
- Handle errors gracefully — catch exceptions where appropriate
- Keep code under 200 lines
- Use helper functions for repeated operations
- End with a print statement confirming completion

Return ONLY the Python code. No markdown fences, no explanations. Start with "import".`;

/**
 * Generate bpy code using GPT (or Gemini as fallback), grounded by RAG.
 */
async function generateCode(
  intent: string,
  constraints: string[],
  sceneContext: string,
  ragContext: string
): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;

  // Build the prompt
  const userPrompt = [
    `INTENT: ${intent}`,
    "",
    `CONSTRAINTS:`,
    ...constraints.map((c) => `- ${c}`),
    "",
    `CURRENT SCENE STATE:`,
    sceneContext,
    "",
    ragContext,
    "",
    "Generate the Python code now. Return ONLY code, starting with 'import'.",
  ].join("\n");

  // Try OpenAI GPT first
  if (apiKey) {
    try {
      const baseUrl = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
      const endpoint = baseUrl.endsWith("/") ? `${baseUrl}chat/completions` : `${baseUrl}/chat/completions`;
      
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      };

      // Add OpenRouter specific headers if configured
      if (process.env.OPENAI_HTTP_REFERER) headers["HTTP-Referer"] = process.env.OPENAI_HTTP_REFERER;
      if (process.env.OPENAI_X_TITLE) headers["X-Title"] = process.env.OPENAI_X_TITLE;

      const response = await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: "gpt-4o",
          messages: [
            { role: "system", content: CODE_GEN_SYSTEM_PROMPT },
            { role: "user", content: userPrompt },
          ],
          temperature: 0.1,
          max_tokens: 4096,
        }),
      });

      if (response.ok) {
        const data = (await response.json()) as {
          choices: { message: { content: string } }[];
        };
        let code = data.choices[0]?.message?.content || "";
        code = cleanCodeResponse(code);
        if (code) return code;
      }
    } catch (err: any) {
      console.warn("[Act] OpenAI GPT failed, falling back to Gemini:", err.message);
    }
  }

  // Fallback: use Gemini
  const geminiKey = process.env.GEMINI_API_KEY;
  if (!geminiKey) throw new Error("No OPENAI_API_KEY or GEMINI_API_KEY available for code generation");

  const ai = new GoogleGenAI({ apiKey: geminiKey });
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: userPrompt,
    config: {
      systemInstruction: CODE_GEN_SYSTEM_PROMPT,
      temperature: 0.1,
    },
  });

  let code = response.text || "";
  code = cleanCodeResponse(code);
  return code;
}

/**
 * Clean markdown fences and extract pure Python code from LLM response.
 */
function cleanCodeResponse(code: string): string {
  // Remove markdown fences
  const fenceMatch = code.match(/```(?:python)?\s*\n?([\s\S]*?)\n?```/);
  if (fenceMatch) {
    code = fenceMatch[1];
  }

  // Ensure starts with import
  if (!code.trim().startsWith("import")) {
    const importIdx = code.indexOf("import bpy");
    if (importIdx >= 0) {
      code = code.slice(importIdx);
    }
  }

  return code.trim();
}

/**
 * Apply post-generation sanitization (from existing ollama-agent.ts).
 */
function sanitizeCode(script: string): string {
  let s = script;

  // Fix: strip.is_active → strip.mute
  s = s.replace(/\.is_active\s*=\s*False/g, ".mute = True");
  s = s.replace(/\.is_active\s*=\s*True/g, ".mute = False");

  // Fix: BLENDER_EEVEE_NEXT → BLENDER_EEVEE
  s = s.replace(/BLENDER_EEVEE_NEXT/g, "BLENDER_EEVEE");

  // Fix: background-safe object selection/context access
  s = s.replace(/bpy\.context\.selected_objects/g, "bpy.context.scene.objects");
  s = s.replace(/bpy\.context\.active_object/g, "bpy.context.view_layer.objects.active");
  s = s.replace(
    /bpy\.ops\.object\.select_all\s*\(\s*action\s*=\s*['"](?:SELECT|DESELECT)['"]\s*\)/g,
    "for _o in bpy.context.scene.objects: _o.select_set(False)"
  );

  // Fix: generated code must operate on the already-imported scene, not random paths.
  s = s.replace(/^.*bpy\.ops\.import_scene\.gltf\s*\(.*$/gm, "# import_scene.gltf removed: pipeline already imported the GLB");

  // Fix: Full-path keyframe_insert
  s = s.replace(
    /keyframe_insert\s*\(\s*data_path\s*=\s*f?['"]\s*pose\.bones\[.*?\]\.(rotation_euler|location|scale|rotation_quaternion)['"]/g,
    (_, prop) => `keyframe_insert(data_path="${prop}"`
  );

  // Fix: mathutils.radians → math.radians
  s = s.replace(/mathutils\.radians\s*\(/g, "math.radians(");

  // Fix: Remove bare 'return' outside functions
  s = s.replace(/^return\b.*$/gm, "# return removed (top-level)");

  // Fix: edit_bones.clear() → safe loop
  s = s.replace(
    /(\w+)\.edit_bones\.clear\(\)/g,
    "for _b in list($1.edit_bones): $1.edit_bones.remove(_b)"
  );

  // Fix: Ensure math import
  if (s.includes("math.radians") && !s.includes("import math")) {
    s = "import math\n" + s;
  }

  // Fix: Remove obsolete light.distance
  s = s.replace(/(\w+)\.distance\s*=\s*([^#\n]+)/g, "# legacy light distance removed");

  // Fix: Remove obsolete contact shadows
  s = s.replace(/(\w+)\.use_contact_shadows?\s*=\s*(True|False)/g, "# contact shadows removed in EEVEE-Next");

  // Fix: Remove direct .fcurves access
  s = s.replace(/^.*\.fcurves.*$/gm, "# fcurves access removed in Blender 5 Animation 2.0");

  // Fix: Neutralize bpy.data.lights.remove()
  s = s.replace(/bpy\.data\.lights\.remove\s*\([^)]*\)/g, "pass  # light data removal skipped");

  // Fix: Neutralize bpy.data.cameras.remove()
  s = s.replace(/bpy\.data\.cameras\.remove\s*\([^)]*\)/g, "pass  # camera data removal skipped");

  return s;
}

/**
 * Act node: generate code, sanitize it, execute it, return results.
 */
export async function actNode(state: BuildState): Promise<Partial<BuildState>> {
  const action = state.currentAction;
  if (!action) {
    return { statusMessage: "No action to execute" };
  }

  // Special case: checkpoint step
  if (action.stepDescription.toLowerCase().includes("checkpoint")) {
    const checkpointName = `step_${action.stepIndex}`;
    const result = await executeBlenderTool("save_checkpoint", { name: checkpointName });
    
    const stepResult: StepResult = {
      stepIndex: action.stepIndex,
      description: action.stepDescription,
      code: `# Checkpoint: ${checkpointName}`,
      executeResult: { success: result.success, stdout: "", stderr: "", error: result.error || null },
      verification: null,
      timestamp: Date.now(),
    };

    const updatedPlan = [...state.buildPlan];
    if (updatedPlan[action.stepIndex]) {
      updatedPlan[action.stepIndex] = { ...updatedPlan[action.stepIndex], completed: true };
    }

    return {
      executionHistory: [...state.executionHistory, stepResult],
      checkpoints: [...state.checkpoints, checkpointName],
      buildPlan: updatedPlan,
      statusMessage: `Checkpoint saved: ${checkpointName}`,
    };
  }

  // Special case: export step
  if (action.type === "finalize" || action.stepDescription.toLowerCase().includes("export")) {
    const exportResult = await executeBlenderTool("export_glb", {});
    
    const stepResult: StepResult = {
      stepIndex: action.stepIndex,
      description: action.stepDescription,
      code: "# GLB export",
      executeResult: {
        success: exportResult.success,
        stdout: `Exported ${exportResult.data?.size_bytes || 0} bytes`,
        stderr: "",
        error: exportResult.error || null,
      },
      verification: null,
      timestamp: Date.now(),
    };

    const updatedPlan = [...state.buildPlan];
    if (updatedPlan[action.stepIndex]) {
      updatedPlan[action.stepIndex] = { ...updatedPlan[action.stepIndex], completed: true };
    }

    return {
      executionHistory: [...state.executionHistory, stepResult],
      riggedGlbBase64: exportResult.data?.glb_base64 || null,
      buildPlan: updatedPlan,
      statusMessage: "Exported GLB",
    };
  }

  // Normal flow: generate code via LLM + RAG, then execute
  console.log(`[Act] Generating code for: ${action.stepDescription}`);

  // Get RAG context
  let ragContext = "";
  try {
    const ragResults = await retrieveBlenderContext(action.bpyIntent, 6);
    ragContext = formatContextForPrompt(ragResults);
  } catch {
    ragContext = "No RAG context available.";
  }

  // Build scene context string
  const sceneContext = state.sceneState
    ? `Objects: ${(state.sceneState.objects || []).map((o: any) => `${o.name}(${o.type})`).join(", ")}`
    : "Scene state unknown.";

  // Generate code
  let code: string;
  try {
    code = await generateCode(action.bpyIntent, action.constraints, sceneContext, ragContext);
  } catch (err: any) {
    const stepResult: StepResult = {
      stepIndex: action.stepIndex,
      description: action.stepDescription,
      code: "",
      executeResult: { success: false, stdout: "", stderr: "", error: `Code generation failed: ${err.message}` },
      verification: null,
      timestamp: Date.now(),
    };
    return {
      executionHistory: [...state.executionHistory, stepResult],
      errorCount: state.errorCount + 1,
      consecutiveErrors: state.consecutiveErrors + 1,
      statusMessage: `Code generation failed: ${err.message}`,
    };
  }

  // Sanitize
  code = sanitizeCode(code);

  // Execute via bridge
  console.log(`[Act] Executing ${code.length} chars of bpy code...`);
  const execResult = await executeBlenderTool("execute_bpy", { code });

  const stepResult: StepResult = {
    stepIndex: action.stepIndex,
    description: action.stepDescription,
    code,
    executeResult: {
      success: execResult.success && (execResult.data?.success ?? true),
      stdout: execResult.data?.stdout || "",
      stderr: execResult.data?.stderr || "",
      error: execResult.data?.error || execResult.error || null,
    },
    verification: null,
    timestamp: Date.now(),
  };

  const newErrorCount = stepResult.executeResult.success ? state.errorCount : state.errorCount + 1;
  const newConsecutiveErrors = stepResult.executeResult.success ? 0 : state.consecutiveErrors + 1;

  return {
    executionHistory: [...state.executionHistory, stepResult],
    errorCount: newErrorCount,
    consecutiveErrors: newConsecutiveErrors,
    statusMessage: stepResult.executeResult.success
      ? `Executed: ${action.stepDescription}`
      : `Execution failed: ${stepResult.executeResult.error?.slice(0, 200)}`,
  };
}
