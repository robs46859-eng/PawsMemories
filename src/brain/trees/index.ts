/**
 * src/brain/trees/index.ts
 * One BT per action goal (AR_PET_SIM_SPEC §4.4). Each goal:
 *   pathfind → orient → play clip(s) → apply recovery → emit vocalization.
 *
 * Leaves are registered against a LeafRegistry by the host (the stage in AR5
 * supplies real pathfind/playClip/vocalize; AR1 ships default no-op-ish leaves
 * that immediately succeed so the tree structure is testable in isolation).
 */

import { ActionId } from "../types";
import { BTNode, LeafRegistry, seq } from "../behaviorTree";

/** Default leaves for AR1: structurally correct, host overrides in AR5. */
export function registerDefaultLeaves(reg: LeafRegistry): LeafRegistry {
  reg.register("pathfind", () => "success")
    .register("orient", () => "success")
    .register("playClip", (ctx) => {
      ctx.emit?.({ type: "clip" });
      return "success";
    })
    .register("applyRecovery", () => "success")
    .register("vocalize", (ctx) => {
      ctx.emit?.({ type: "vocalize" });
      return "success";
    });
  return reg;
}

/** Build the goal tree for an action. Vocal actions append a vocalize leaf. */
export function buildTree(action: ActionId, reg: LeafRegistry): BTNode {
  const steps: BTNode[] = [
    reg.leaf("pathfind"),
    reg.leaf("orient"),
    reg.leaf("playClip"),
    reg.leaf("applyRecovery"),
  ];
  if (action === "bark" || action === "greet") {
    steps.push(reg.leaf("vocalize"));
  }
  return seq(...steps);
}

/** Convenience: a registry with defaults, ready for tests. */
export function defaultRegistry(): LeafRegistry {
  return registerDefaultLeaves(new LeafRegistry());
}
