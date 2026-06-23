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
      // Undo the last operation
      try {
        await executeBlenderTool("undo_last", {});
        console.log("[Recover] Undo successful");
      } catch (err: any) {
        console.warn("[Recover] Undo failed:", err.message);
      }
      return {
        statusMessage: `Undid last step, will retry: ${verification.details}`,
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
          // Try undo instead
          try {
            await executeBlenderTool("undo_last", {});
          } catch {}
        }
      } else {
        try {
          await executeBlenderTool("undo_last", {});
        } catch {}
      }
      return {
        statusMessage: `Restored from checkpoint, replanning from step ${state.currentStep + 1}`,
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
