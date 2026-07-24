/**
 * Finalize Node
 * ==============
 * Exports the final static, rig-ready GLB after all build steps complete.
 */

import type { BuildState } from "./types";
import { executeBlenderTool } from "../../tools/blender_mcp";
import { facialVisemeBpyScript, facialPassthroughMetadata, parseVisemeResult } from "./facialVisemes";

export async function finalizeNode(state: BuildState): Promise<Partial<BuildState>> {
  console.log("[Finalize] Exporting final assets...");

  // Export GLB if not already done
  let riggedGlb = state.riggedGlbBase64;
  let facialPassthrough = state.facialPassthrough ?? null;
  if (!riggedGlb) {
    // Provider-morph passthrough (not a facial rig): optional, deterministic,
    // and never blocks a valid model export — models with no usable face keep
    // the jaw-bone fallback. The measured VISEME_RESULT drives the metadata.
    // P4: skipped when the facial rig was not purchased (facialVisemes=false).
    if (state.facialVisemes !== false) {
      try {
        const viseme = await executeBlenderTool("execute_bpy", { code: facialVisemeBpyScript() });
        if (!viseme.success) console.warn("[Finalize] Facial morph passthrough skipped:", viseme.error || viseme.data?.error);
        facialPassthrough = parseVisemeResult(viseme.data?.stdout) ?? facialPassthrough;
      } catch (err: any) {
        console.warn("[Finalize] Facial morph passthrough skipped:", err?.message || err);
      }
    }
    try {
      const result = await executeBlenderTool("export_glb", {});
      if (result.success && result.data?.glb_base64) {
        let b64 = result.data.glb_base64;
        if (!b64.startsWith("data:")) {
          b64 = `data:model/gltf-binary;base64,${b64}`;
        }
        riggedGlb = b64;
        console.log(`[Finalize] GLB exported: ${result.data.size_bytes} bytes`);
      } else {
        console.error(
          "[Finalize] GLB export failed:",
          result.error || result.data?.error || "worker returned no GLB data"
        );
      }
    } catch (err: any) {
      console.error("[Finalize] GLB export failed:", err.message);
    }
  }

  // Count completed vs total steps
  const completedSteps = state.buildPlan.filter((s) => s.completed).length;
  const totalSteps = state.buildPlan.length;
  const successRate = totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0;

  console.log(`[Finalize] ✅ Build complete: ${completedSteps}/${totalSteps} steps (${successRate}%)`);
  console.log(`[Finalize]    Errors: ${state.errorCount}, Checkpoints: ${state.checkpoints.length}`);

  if (riggedGlb && !riggedGlb.startsWith("data:")) {
    riggedGlb = `data:model/gltf-binary;base64,${riggedGlb}`;
  }

  return {
    riggedGlbBase64: riggedGlb,
    spriteSheetBase64: null,
    facialPassthrough,
    // Truthful facial metadata: the viseme contract is reported only when the
    // passthrough measured real provider shapes (BO-2). No hardcoded claims.
    animationMetadata: {
      animations: {},
      static: true,
      ...facialPassthroughMetadata(facialPassthrough, state.facialVisemes !== false),
    },
    status: riggedGlb ? "completed" : "failed",
    statusMessage: riggedGlb
      ? `Build complete: ${completedSteps}/${totalSteps} steps, ${successRate}% success rate`
      : "Build finished but GLB export failed",
  };
}
