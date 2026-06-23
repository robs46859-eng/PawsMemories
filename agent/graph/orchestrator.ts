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

import { perceiveNode } from "./nodes/perceive";
import { reasonNode } from "./nodes/reason";
import { actNode } from "./nodes/act";
import { verifyNode } from "./nodes/verify";
import { recoverNode } from "./nodes/recover";
import { finalizeNode } from "./nodes/finalize";
import { createInitialState } from "./nodes/types";
import type { BuildState, PetAnalysis } from "./nodes/types";
import { executeBlenderTool } from "../tools/blender_mcp";

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

  // Step 0: Deterministically import the GLB before any LLM-generated bpy runs.
  await reportProgress(onProgress, "importing_mesh", 0, "Importing 3D mesh into Blender...");

  try {
    const importResult = await executeBlenderTool("import_glb", { glb_base64: glbBase64 });

    if (!importResult.success || !importResult.data?.success || importResult.data?.mesh_count < 1) {
      state.status = "failed";
      state.statusMessage = `GLB import failed: ${importResult.error || importResult.data?.error || "no mesh imported"}`;
      return state;
    }

    const scene = await executeBlenderTool("read_scene", {});
    state = {
      ...state,
      sceneState: scene.success ? scene.data : null,
      statusMessage: `Imported ${importResult.data.mesh_count} mesh object(s)`,
    };
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

    // Check verification result and decide: advance, recover, or abort
    const lastResult = state.executionHistory[state.executionHistory.length - 1];
    const verification = lastResult?.verification;

    if (verification && verification.recommendation === "proceed") {
      // Step verified successfully — advance to the next step
      state.currentStep = (state.currentStep ?? 0) + 1;
      state.consecutiveErrors = 0;
    } else if (verification && !verification.success) {
      // Per-step retry cap: don't let a single step consume all iterations
      const currentBuildStep = state.buildPlan[state.currentStep];
      if (currentBuildStep && currentBuildStep.retryCount >= 3) {
        if (currentBuildStep.phase === "import" || currentBuildStep.phase === "rigging") {
          // Critical step failed too many times — abort the build
          state.status = "failed";
          state.statusMessage = `Critical step "${currentBuildStep.description}" failed after ${currentBuildStep.retryCount} retries`;
          break;
        } else {
          // Non-critical step — skip it and move on
          console.warn(`[Orchestrator] Skipping step "${currentBuildStep.description}" after ${currentBuildStep.retryCount} retries`);
          state.buildPlan[state.currentStep] = { ...currentBuildStep, completed: true };
          state.currentStep++;
          state.consecutiveErrors = 0;
          continue;
        }
      }

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
