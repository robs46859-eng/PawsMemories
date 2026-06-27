/**
 * Finalize Node
 * ==============
 * Exports the final GLB and sprite sheet after all build steps complete.
 */

import type { BuildState } from "./types";
import { executeBlenderTool } from "../../tools/blender_mcp";

export async function finalizeNode(state: BuildState): Promise<Partial<BuildState>> {
  console.log("[Finalize] Exporting final assets...");

  // Export GLB if not already done
  let riggedGlb = state.riggedGlbBase64;
  if (!riggedGlb) {
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

  // Build animation metadata from the build plan
  const animationMeta: Record<string, any> = {
    frameWidth: 128,
    frameHeight: 128,
    animations: {},
  };

  const animSteps = state.buildPlan.filter((s) => s.phase === "animation" && s.completed);
  const animNames = ["eating", "drinking", "running", "playing", "sleeping", "photo"];
  const animFrames = [4, 4, 6, 4, 3, 3];
  const animFps = [8, 8, 12, 10, 4, 6];

  for (let i = 0; i < animNames.length; i++) {
    animationMeta.animations[animNames[i]] = {
      row: i,
      frames: animFrames[i],
      fps: animFps[i],
    };
  }

  // Count completed vs total steps
  const completedSteps = state.buildPlan.filter((s) => s.completed).length;
  const totalSteps = state.buildPlan.length;
  const successRate = totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0;

  console.log(`[Finalize] ✅ Build complete: ${completedSteps}/${totalSteps} steps (${successRate}%)`);
  console.log(`[Finalize]    Errors: ${state.errorCount}, Checkpoints: ${state.checkpoints.length}`);

  return {
    riggedGlbBase64: riggedGlb,
    animationMetadata: animationMeta,
    status: riggedGlb ? "completed" : "failed",
    statusMessage: riggedGlb
      ? `Build complete: ${completedSteps}/${totalSteps} steps, ${successRate}% success rate`
      : "Build finished but GLB export failed",
  };
}
