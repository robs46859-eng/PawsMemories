/**
 * Act Node — GPT Code Generation
 * ================================
 * Generates actual bpy Python code based on the intent from Claude (reason node),
 * grounded by RAG context from the Blender API docs.
 *
 * Then executes the code via the MCP tool interface and returns the result.
 */

import type { BuildState, StepResult } from "./types";
import { executeBlenderTool } from "../../tools/blender_mcp";
import { retrieveBlenderContext, formatContextForPrompt } from "../../knowledge/retriever";
import { generateGeminiText } from "../../gemini";

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

  const code = await generateGeminiText({
    apiKey: geminiKey,
    model: "gemini-2.5-flash",
    input: userPrompt,
    fallbackContents: userPrompt,
    systemInstruction: CODE_GEN_SYSTEM_PROMPT,
    temperature: 0.1,
  });

  return cleanCodeResponse(code);
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

function deterministicCodeForAction(state: BuildState): string | null {
  const action = state.currentAction;
  if (!action) return null;

  const description = action.stepDescription.toLowerCase();
  const hasTail = state.petAnalysis.hasTail ? "True" : "False";

  if (description.includes("verify mesh import")) {
    return `import bpy
print("[Deterministic] Inspecting imported mesh")
meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
if not meshes:
    raise RuntimeError("No mesh objects found after GLB import")
for obj in meshes:
    print(f"Mesh {obj.name}: {len(obj.data.vertices)} verts, {len(obj.data.polygons)} faces")
print("[Deterministic] Mesh import verified")`;
  }

  if (description.includes("create") && description.includes("armature")) {
    return `import bpy
from mathutils import Vector
print("[Deterministic] Creating pet armature with stable bone names")
meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
if not meshes:
    raise RuntimeError("No mesh object available for armature creation")
mesh = max(meshes, key=lambda o: len(o.data.vertices))
points = [mesh.matrix_world @ Vector(corner) for corner in mesh.bound_box]
min_v = Vector((min(p.x for p in points), min(p.y for p in points), min(p.z for p in points)))
max_v = Vector((max(p.x for p in points), max(p.y for p in points), max(p.z for p in points)))
center = (min_v + max_v) * 0.5
dims = max_v - min_v
length_axis = 0 if dims.x >= dims.y else 1
forward = Vector((1, 0, 0)) if length_axis == 0 else Vector((0, 1, 0))
right = Vector((0, 1, 0)) if length_axis == 0 else Vector((1, 0, 0))
half_len = max(dims[length_axis] * 0.5, 0.2)
half_w = max((dims.y if length_axis == 0 else dims.x) * 0.5, 0.08)
low = min_v.z
mid_z = low + max(dims.z * 0.45, 0.12)
top_z = low + max(dims.z * 0.78, 0.2)
for obj in bpy.context.scene.objects:
    obj.select_set(False)
for obj in list(bpy.context.scene.objects):
    if obj.type == 'ARMATURE':
        bpy.data.objects.remove(obj, do_unlink=True)
arm_data = bpy.data.armatures.new("DogArmatureData")
arm_obj = bpy.data.objects.new("DogArmature", arm_data)
bpy.context.collection.objects.link(arm_obj)
bpy.context.view_layer.objects.active = arm_obj
arm_obj.select_set(True)
bpy.ops.object.mode_set(mode='EDIT')
for bone in list(arm_data.edit_bones):
    arm_data.edit_bones.remove(bone)
def add_bone(name, head, tail, parent=None):
    bone = arm_data.edit_bones.new(name)
    bone.head = head
    bone.tail = tail
    bone.parent = parent
    bone.use_connect = False
    return bone
hips_h = center - forward * (half_len * 0.35); hips_h.z = mid_z
spine_t = center + forward * (half_len * 0.05); spine_t.z = mid_z + dims.z * 0.05
chest_t = center + forward * (half_len * 0.35); chest_t.z = mid_z + dims.z * 0.08
neck_t = center + forward * (half_len * 0.48); neck_t.z = top_z
head_t = center + forward * (half_len * 0.68); head_t.z = top_z + dims.z * 0.04
hips = add_bone("hips", hips_h, spine_t)
spine = add_bone("spine", spine_t, chest_t, hips)
chest = add_bone("chest", chest_t, neck_t, spine)
neck = add_bone("neck", neck_t, head_t, chest)
head = add_bone("head", head_t, head_t + forward * max(half_len * 0.18, 0.08), neck)
for side, sign in (("L", 1), ("R", -1)):
    x_front = center + forward * (half_len * 0.28) + right * (half_w * sign)
    x_back = center - forward * (half_len * 0.28) + right * (half_w * sign)
    for prefix, base, parent in (("front", x_front, chest), ("back", x_back, hips)):
        shoulder = Vector((base.x, base.y, mid_z))
        knee = Vector((base.x, base.y, low + dims.z * 0.22))
        paw = Vector((base.x + forward.x * half_len * 0.04, base.y + forward.y * half_len * 0.04, low + dims.z * 0.03))
        upper = add_bone(f"{prefix}_leg_upper.{side}", shoulder, knee, parent)
        lower = add_bone(f"{prefix}_leg_lower.{side}", knee, paw, upper)
        add_bone(f"{prefix}_paw.{side}", paw, paw + forward * max(half_len * 0.08, 0.04), lower)
if ${hasTail}:
    t0 = hips_h - forward * max(half_len * 0.12, 0.05); t0.z = mid_z
    b1 = add_bone("tail_01", hips_h, t0, hips)
    b2 = add_bone("tail_02", t0, t0 - forward * max(half_len * 0.15, 0.06), b1)
    add_bone("tail_03", b2.tail, b2.tail - forward * max(half_len * 0.12, 0.05), b2)
bpy.ops.object.mode_set(mode='OBJECT')
arm_obj.show_in_front = True
bpy.context.view_layer.objects.active = arm_obj
print(f"[Deterministic] DogArmature created with {len(arm_obj.data.bones)} bones")`;
  }

  if (description.includes("parent mesh") || description.includes("automatic weights")) {
    return `import bpy
from mathutils import Vector
print("[Deterministic] Binding mesh to armature with explicit vertex groups")
meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
armatures = [o for o in bpy.context.scene.objects if o.type == 'ARMATURE']
if not meshes:
    raise RuntimeError("No mesh object found for binding")
if not armatures:
    raise RuntimeError("No armature object found for binding")
mesh = max(meshes, key=lambda o: len(o.data.vertices))
armature = armatures[0]
bone_names = [b.name for b in armature.data.bones]
for name in bone_names:
    if not mesh.vertex_groups.get(name):
        mesh.vertex_groups.new(name=name)
points = [mesh.matrix_world @ Vector(corner) for corner in mesh.bound_box]
min_v = Vector((min(p.x for p in points), min(p.y for p in points), min(p.z for p in points)))
max_v = Vector((max(p.x for p in points), max(p.y for p in points), max(p.z for p in points)))
span = max_v - min_v
length_axis = 0 if span.x >= span.y else 1
def choose_group(world):
    rel_len = ((world.x - min_v.x) / span.x) if length_axis == 0 and span.x else ((world.y - min_v.y) / span.y) if span.y else 0.5
    rel_z = (world.z - min_v.z) / span.z if span.z else 0.5
    if rel_z < 0.28:
        return "front_leg_lower.L" if rel_len > 0.5 else "back_leg_lower.L"
    if rel_len < 0.30:
        return "hips"
    if rel_len < 0.55:
        return "spine"
    if rel_len < 0.78:
        return "chest"
    return "neck" if rel_z < 0.75 else "head"
for vg in mesh.vertex_groups:
    try:
        vg.remove([v.index for v in mesh.data.vertices])
    except Exception:
        pass
for v in mesh.data.vertices:
    world = mesh.matrix_world @ v.co
    group_name = choose_group(world)
    if group_name not in bone_names:
        group_name = bone_names[0]
    mesh.vertex_groups[group_name].add([v.index], 1.0, 'REPLACE')
mod = next((m for m in mesh.modifiers if m.type == 'ARMATURE'), None)
if mod is None:
    mod = mesh.modifiers.new("DogArmature", 'ARMATURE')
mod.object = armature
mesh.parent = armature
bpy.context.view_layer.objects.active = armature
for obj in bpy.context.scene.objects:
    obj.select_set(False)
mesh.select_set(True)
armature.select_set(True)
print(f"[Deterministic] Bound {mesh.name} to {armature.name} with {len(bone_names)} vertex groups")`;
  }

  const animationMatch = description.match(/create (eating|drinking|running|playing|sleeping|photo) animation/);
  if (animationMatch) {
    const name = animationMatch[1];
    return `import bpy
import math
print("[Deterministic] Creating ${name} animation")
armatures = [o for o in bpy.context.scene.objects if o.type == 'ARMATURE']
if not armatures:
    raise RuntimeError("No armature object found for animation")
armature = armatures[0]
bpy.context.view_layer.objects.active = armature
if not armature.animation_data:
    armature.animation_data_create()
action = bpy.data.actions.new("${name}") if "${name}" not in bpy.data.actions else bpy.data.actions["${name}"]
armature.animation_data.action = action
frames = [0, 1, 2, 3] if "${name}" in ("eating", "drinking", "playing") else ([0, 1, 2, 3, 4, 5] if "${name}" == "running" else [0, 1, 2])
for frame in frames:
    bpy.context.scene.frame_set(frame)
    phase = (frame / max(len(frames) - 1, 1)) * math.tau
    for bone_name in ("hips", "spine", "chest", "neck", "head", "tail_01", "tail_02", "front_leg_upper.L", "front_leg_upper.R", "back_leg_upper.L", "back_leg_upper.R"):
        bone = armature.pose.bones.get(bone_name)
        if not bone:
            continue
        bone.rotation_mode = 'XYZ'
        bone.rotation_euler = (0, 0, 0)
        if "${name}" == "eating" and bone_name in ("neck", "head"):
            bone.rotation_euler.x = math.radians(10 + 12 * math.sin(phase))
        elif "${name}" == "drinking" and bone_name in ("neck", "head"):
            bone.rotation_euler.x = math.radians(18 + 5 * math.sin(phase * 2))
        elif "${name}" == "running" and "leg_upper" in bone_name:
            bone.rotation_euler.x = math.radians(22 * math.sin(phase + (math.pi if bone_name.endswith(".R") else 0)))
        elif "${name}" == "playing" and bone_name in ("hips", "spine", "chest"):
            bone.rotation_euler.x = math.radians(8 * math.sin(phase))
        elif "${name}" == "sleeping" and bone_name in ("spine", "neck", "head"):
            bone.rotation_euler.z = math.radians(6)
        elif "${name}" == "photo" and bone_name == "head":
            bone.rotation_euler.z = math.radians(8 * math.sin(phase))
        elif bone_name.startswith("tail_"):
            bone.rotation_euler.z = math.radians(12 * math.sin(phase))
        bone.keyframe_insert(data_path="rotation_euler", frame=frame)
bpy.context.scene.frame_start = min(frames)
bpy.context.scene.frame_end = max(frames)
print(f"[Deterministic] Animation '${name}' created with {len(frames)} keyframes")`;
  }

  return null;
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

  // Normal flow: use deterministic code for core rigging/animation, then LLM + RAG for the rest.
  console.log(`[Act] Generating code for: ${action.stepDescription}`);

  let code = deterministicCodeForAction(state);
  try {
    if (!code) {
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

      code = await generateCode(action.bpyIntent, action.constraints, sceneContext, ragContext);
    }
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
