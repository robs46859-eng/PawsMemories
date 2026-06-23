/**
 * Recover Node
 * =============
 * Handles failures by undoing bad operations and deciding whether to retry or abort.
 */

import type { BuildState } from "./types";
import { executeBlenderTool } from "../../tools/blender_mcp";

export async function recoverNode(state: BuildState): Promise<Partial<BuildState>> {
  const lastResult = state.executionHistory[state.executionHistory.length - 1];
  const verification = lastResult?.verification;

  if (!verification) {
    return { statusMessage: "No verification to recover from" };
  }

  console.log(`[Recover] Handling ${verification.driftSeverity} drift: ${verification.recommendation}`);

  switch (verification.recommendation) {
    case "undo_and_retry": {
      const lastCheckpoint = state.checkpoints[state.checkpoints.length - 1];
      if (lastCheckpoint) {
        try {
          await executeBlenderTool("restore_checkpoint", { name: lastCheckpoint });
          console.log(`[Recover] Restored checkpoint instead of raw undo: ${lastCheckpoint}`);
        } catch (err: any) {
          console.warn("[Recover] Checkpoint restore failed:", err.message);
        }
      } else {
        console.warn("[Recover] No checkpoint available; leaving scene unchanged for adapted retry");
      }
      return {
        statusMessage: `Prepared retry from stable state: ${verification.details}`,
      };
    }

    case "undo_and_replan": {
      // Restore from last checkpoint
      const lastCheckpoint = state.checkpoints[state.checkpoints.length - 1];
      if (lastCheckpoint) {
        try {
          await executeBlenderTool("restore_checkpoint", { name: lastCheckpoint });
          console.log(`[Recover] Restored checkpoint: ${lastCheckpoint}`);
        } catch (err: any) {
          console.warn("[Recover] Checkpoint restore failed:", err.message);
        }
      } else {
        // No checkpoint available — don't waste time calling undo_last on
        // deterministic/read-only steps (it's a no-op that changes nothing).
        console.warn("[Recover] No checkpoint available, nothing to undo");
      }
      return {
        errorCount: state.errorCount + 1,
        consecutiveErrors: state.consecutiveErrors + 1,
        statusMessage: `Replanning from step ${state.currentStep + 1}`,
      };
    }

    case "abort": {
      return {
        status: "failed",
        statusMessage: `Build aborted: ${verification.details}`,
      };
    }

    default:
      return {};
  }
}
