/**
 * LangGraph Orchestrator
 * =======================
 * The core perceive → reason → act → verify loop.
 *
 * This is a simplified state-machine implementation that mirrors
 * LangGraph's architecture without requiring the full @langchain/langgraph
 * dependency. It runs the multi-agent loop synchronously (step by step)
 * and can be easily migrated to the full LangGraph SDK later.
 *
 * Architecture:
 *   perceive (Gemini Vision) → reason (Claude) → act (GPT) → verify (Gemini Vision)
 *       ↑                                                            |
 *       |←──────── proceed ←─────────────────────────────────────────|
 *       |                                                            |
 *       |←──────── recover ←── undo_and_retry / undo_and_replan ←───|
 */

import { perceiveNode } from "./nodes/perceive.js";
import { reasonNode } from "./nodes/reason.js";
import { actNode } from "./nodes/act.js";
import { verifyNode } from "./nodes/verify.js";
import { recoverNode } from "./nodes/recover.js";
import { finalizeNode } from "./nodes/finalize.js";
import { createInitialState } from "./nodes/types.js";
import type { BuildState, PetAnalysis } from "./nodes/types.js";
import { executeBlenderTool } from "../tools/blender_mcp.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const MAX_ITERATIONS = 50; // Safety: max loop iterations before forced stop
const MAX_ERRORS = 15;     // Circuit breaker: max total errors

// ---------------------------------------------------------------------------
// Progress Callback
// ---------------------------------------------------------------------------

export type ProgressCallback = (
  step: string,
  percentComplete: number,
  detail: string
) => void | Promise<void>;

// ---------------------------------------------------------------------------
// Main Orchestrator
// ---------------------------------------------------------------------------

/**
 * Run the full multi-agent avatar build pipeline.
 *
 * @param petAnalysis - Analyzed pet anatomy data
 * @param glbBase64 - Base64-encoded GLB mesh to rig and animate
 * @param onProgress - Optional callback for progress updates
 * @returns Final build state with GLB, sprite sheet, and metadata
 */
export async function runBuildPipeline(
  petAnalysis: PetAnalysis,
  glbBase64: string,
  onProgress?: ProgressCallback
): Promise<BuildState> {
  let state = createInitialState(petAnalysis, glbBase64);

  console.log("[Orchestrator] Starting multi-agent build pipeline");
  console.log(`[Orchestrator] Pet: ${petAnalysis.species} (${petAnalysis.breed}), ${petAnalysis.bodyType}`);

  // Step 0: Import the GLB into Blender
  await reportProgress(onProgress, "importing_mesh", 0, "Importing 3D mesh into Blender...");

  try {
    const importResult = await executeBlenderTool("execute_bpy", {
      code: `
import bpy, base64, os, sys

# Clear scene
for obj in list(bpy.data.objects):
    bpy.data.objects.remove(obj, do_unlink=True)

print("Scene cleared, ready for import")
`,
    });

    if (!importResult.success) {
      state.status = "failed";
      state.statusMessage = `Scene clear failed: ${importResult.error}`;
      return state;
    }
  } catch (err: any) {
    state.status = "failed";
    state.statusMessage = `Bridge connection failed: ${err.message}`;
    return state;
  }

  // Main orchestration loop
  let iteration = 0;

  while (iteration < MAX_ITERATIONS && state.status === "running") {
    iteration++;
    const progress = Math.min(90, Math.round((iteration / MAX_ITERATIONS) * 90));

    console.log(`\n[Orchestrator] === Iteration ${iteration}/${MAX_ITERATIONS} ===`);

    // PERCEIVE: Gemini Vision analyzes the viewport + scene
    await reportProgress(onProgress, "perceiving", progress, "Analyzing scene state...");
    try {
      const perceiveUpdates = await perceiveNode(state);
      state = { ...state, ...perceiveUpdates };
    } catch (err: any) {
      console.warn("[Orchestrator] Perceive failed:", err.message);
      // Non-fatal: continue without updated perception
    }

    // REASON: Claude decides what to do next
    await reportProgress(onProgress, "reasoning", progress + 1, "Planning next step...");
    try {
      const reasonUpdates = await reasonNode(state);
      state = { ...state, ...reasonUpdates };
    } catch (err: any) {
      console.error("[Orchestrator] Reason failed:", err.message);
      state.errorCount++;
      if (state.errorCount >= MAX_ERRORS) {
        state.status = "failed";
        state.statusMessage = `Reasoning failed too many times: ${err.message}`;
        break;
      }
      continue;
    }

    // Check if we should finalize
    if (state.currentAction?.type === "finalize") {
      await reportProgress(onProgress, "finalizing", 95, "Exporting final assets...");
      try {
        const finalUpdates = await finalizeNode(state);
        state = { ...state, ...finalUpdates };
      } catch (err: any) {
        state.status = "failed";
        state.statusMessage = `Finalization failed: ${err.message}`;
      }
      break;
    }

    // ACT: GPT generates and executes bpy code
    const stepDesc = state.currentAction?.stepDescription || "Unknown step";
    await reportProgress(onProgress, "executing", progress + 2, `Executing: ${stepDesc}`);
    try {
      const actUpdates = await actNode(state);
      state = { ...state, ...actUpdates };
    } catch (err: any) {
      console.error("[Orchestrator] Act failed:", err.message);
      state.errorCount++;
      state.consecutiveErrors++;
      continue;
    }

    // VERIFY: Gemini Vision checks the result
    await reportProgress(onProgress, "verifying", progress + 3, "Verifying result...");
    try {
      const verifyUpdates = await verifyNode(state);
      state = { ...state, ...verifyUpdates };
    } catch (err: any) {
      console.warn("[Orchestrator] Verify failed:", err.message);
      // If verification fails, assume step was ok if execution succeeded
    }

    // Check verification result and potentially recover
    const lastResult = state.executionHistory[state.executionHistory.length - 1];
    const verification = lastResult?.verification;

    if (verification && !verification.success) {
      if (
        verification.recommendation === "undo_and_retry" ||
        verification.recommendation === "undo_and_replan"
      ) {
        await reportProgress(onProgress, "recovering", progress + 4, "Recovering from error...");
        try {
          const recoverUpdates = await recoverNode(state);
          state = { ...state, ...recoverUpdates };
        } catch (err: any) {
          console.warn("[Orchestrator] Recovery failed:", err.message);
        }
      } else if (verification.recommendation === "abort") {
        state.status = "failed";
        state.statusMessage = `Aborted: ${verification.details}`;
        break;
      }
    }

    // Check circuit breaker
    if (state.errorCount >= MAX_ERRORS) {
      console.warn(`[Orchestrator] Circuit breaker: ${state.errorCount} errors`);
      // Try to finalize with whatever we have
      await reportProgress(onProgress, "finalizing", 95, "Circuit breaker hit — saving partial result...");
      try {
        const finalUpdates = await finalizeNode(state);
        state = { ...state, ...finalUpdates };
      } catch {
        state.status = "failed";
        state.statusMessage = `Circuit breaker at ${state.errorCount} errors`;
      }
      break;
    }
  }

  // If we hit max iterations, try to finalize
  if (iteration >= MAX_ITERATIONS && state.status === "running") {
    console.warn("[Orchestrator] Max iterations reached, finalizing...");
    try {
      const finalUpdates = await finalizeNode(state);
      state = { ...state, ...finalUpdates };
    } catch {
      state.status = "failed";
      state.statusMessage = "Max iterations reached";
    }
  }

  await reportProgress(onProgress, state.status, 100, state.statusMessage);

  // Summary
  const completedSteps = state.buildPlan.filter((s) => s.completed).length;
  console.log(`\n[Orchestrator] ===== BUILD COMPLETE =====`);
  console.log(`[Orchestrator] Status: ${state.status}`);
  console.log(`[Orchestrator] Steps: ${completedSteps}/${state.buildPlan.length}`);
  console.log(`[Orchestrator] Iterations: ${iteration}`);
  console.log(`[Orchestrator] Errors: ${state.errorCount}`);
  console.log(`[Orchestrator] Checkpoints: ${state.checkpoints.length}`);
  console.log(`[Orchestrator] GLB: ${state.riggedGlbBase64 ? "yes" : "no"}`);

  return state;
}

async function reportProgress(
  callback: ProgressCallback | undefined,
  step: string,
  pct: number,
  detail: string
) {
  if (callback) {
    try {
      await callback(step, pct, detail);
    } catch {}
  }
}
