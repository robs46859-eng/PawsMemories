/**
 * Reason Node — Claude
 * =====================
 * Takes the scene understanding, build plan, and execution history.
 * Decides what to do next: execute a step, modify the plan, retry, or finalize.
 *
 * Claude is the "brain" — it breaks complex avatar builds into stages,
 * decides build order, and adapts the plan based on verification feedback.
 */

import type { BuildState, NextAction, BuildStep } from "./types";
import { lookupBreedAnatomy } from "../../knowledge/breed-anatomy";

const REASON_SYSTEM_PROMPT = `You are an expert 3D artist and Blender pipeline architect. Your role is to plan and orchestrate the construction of static, rig-ready 3D pet avatars in Blender 5.1.

You receive:
1. Pet analysis (species, breed, anatomy)
2. Current scene understanding (what objects exist, their state)
3. Build plan (list of steps)
4. Execution history (what has been done, what succeeded/failed)

Your job is to decide the NEXT ACTION. You must return a JSON object:

{
  "type": "execute_step" | "modify_plan" | "retry_step" | "change_viewport" | "finalize",
  "stepIndex": <number>,
  "stepDescription": "<what this step does>",
  "bpyIntent": "<natural language description of the bpy code needed>",
  "constraints": ["<constraint 1>", "<constraint 2>"],
  "reasoning": "<why you chose this action>"
}

BUILD ORDER for pet avatars:
1. Verify mesh import — check the GLB loaded correctly, rotate mesh to face -Y (forward) and apply rotation
2. Create armature — bone hierarchy matching the pet anatomy
3. Position bones — calculate actual vertex centroids for each body part (e.g., head is top 20% Z, legs are bottom 30% Z, tail is rear 20% Y, jaw is bottom-front 10% of head, ears are top-rear 20% of head) to ensure precise alignment
4. Parent mesh to armature — use automatic weights (ARMATURE_AUTO)
5. Test deformations — rotate key bones slightly, verify no distortion
6. Enhance Material — locate mesh material, add Bump node using Image Texture as height, plug into Normal, set Roughness to 0.8
7. Remove any inherited animation actions and reset the armature to its neutral rest pose
8. Export one static rig-ready GLB. Motion is authored separately in the Animation Builder.

CONSTRAINTS:
- ALWAYS use .get() for bone access, NEVER direct indexing
- Keep rotations within anatomical limits (±60° legs, ±45° spine, ±60° tail)
- Use BLENDER_EEVEE engine for fast realistic PBR rendering
- Bone names: hips, spine, chest, neck, head, jaw, ear.L, ear.R, eye.L, eye.R, front_leg_upper.L/R, front_leg_lower.L/R, front_paw.L/R, back_leg_upper.L/R, back_leg_lower.L/R, back_paw.L/R, tail_01/02/03

ADAPTATION:
- If a step failed, analyze WHY and adjust the approach (don't just retry the same thing)
- If verification found geometry issues, add a cleanup step before continuing
- If the mesh is too complex (>50k verts), add a decimate modifier step
- If automatic weights fail, try manual bone heat weighting or envelope weights

Return ONLY the JSON object.`;

/**
 * Generate the initial build plan based on pet analysis.
 */
export function generateBuildPlan(state: BuildState): BuildStep[] {
  const { petAnalysis } = state;

  // Look up breed-specific anatomy for constraint context
  const anatomy = lookupBreedAnatomy(petAnalysis.species, petAnalysis.breed);
  const boneProps = anatomy.sections;

  const steps: BuildStep[] = [
    {
      id: 1,
      phase: "import",
      description: "Verify mesh import and inspect geometry",
      bpyIntent: "Check that the imported GLB mesh is valid, count vertices and faces, verify normals",
      constraints: ["Do not modify the mesh", "Report vertex/face count"],
      completed: false,
      retryCount: 0,
    },
    {
      id: 2,
      phase: "rigging",
      description: `Create ${petAnalysis.species} armature with proper bone hierarchy`,
      bpyIntent: `Create a new armature for a ${petAnalysis.species} (${petAnalysis.breed}). ` +
        `It is a ${petAnalysis.bodyType} with ${petAnalysis.legCount} legs. ` +
        `Body proportions: head=${petAnalysis.bodyProportions.headSize}, legs=${petAnalysis.bodyProportions.legLength}, ` +
        `body=${petAnalysis.bodyProportions.bodyLength}, neck=${petAnalysis.bodyProportions.neckLength}. ` +
        `Breed anatomy: head length ratio=${boneProps.head.lengthRatio}, ` +
        `front leg ratio=${boneProps.frontLegs.lengthRatio}, rear leg ratio=${boneProps.rearLegs.lengthRatio}, ` +
        `torso ratio=${boneProps.torso.lengthRatio}. ` +
        `Has tail: ${petAnalysis.hasTail}. ` +
        "Use the exact bone naming convention: " +
        (petAnalysis.hasWings
          ? "hips → spine → chest → neck → head, jaw, eye.L, eye.R, wing_inner.L/R → wing_outer.L/R, back_leg_upper.L/R → back_leg_lower.L/R → back_paw.L/R, tail_01/02/03. "
          : "hips → spine → chest → neck → head, jaw, ear.L, ear.R, eye.L, eye.R attached to head, front_leg_upper.L/R → front_leg_lower.L/R → front_paw.L/R, back_leg_upper.L/R → back_leg_lower.L/R → back_paw.L/R, tail_01/02/03. ") +
        "Position bones precisely by calculating actual vertex centroids for each body part based on the mesh bounding box.",
      constraints: [
        "Create bones starting from root (hips)",
        "Bone names MUST match the required convention exactly",
        "Use edit_bones to position heads and tails",
        "Return to OBJECT mode when done",
        `Breed-specific: front leg joint max ${boneProps.frontLegs.jointAngleMax}°, rear leg joint max ${boneProps.rearLegs.jointAngleMax}°`,
      ],
      completed: false,
      retryCount: 0,
    },
    {
      id: 3,
      phase: "rigging",
      description: "Parent mesh to armature with automatic weights",
      bpyIntent: "Select both the mesh and armature, set armature as active, use bpy.ops.object.parent_set(type='ARMATURE_AUTO')",
      constraints: [
        "Set view_layer.objects.active = armature_obj first",
        "Select both mesh and armature",
        "Handle weight painting failures gracefully",
      ],
      completed: false,
      retryCount: 0,
    },
    {
      id: 4,
      phase: "rigging",
      description: "Save checkpoint after rigging",
      bpyIntent: "Save a checkpoint named 'after_rigging' for rollback safety",
      constraints: [],
      completed: false,
      retryCount: 0,
    },
  ];

  // Keep model generation static. Animation and video assets are authored in
  // their own studios and must never be uploaded as model reference images.
  steps.push(
    {
      id: steps.length + 1,
      phase: "rigging",
      description: "Clear inherited animation and restore neutral pose",
      bpyIntent: "Remove all bpy.data.actions, clear animation_data from every object and armature, and reset pose bones to their neutral transforms.",
      constraints: [
        "Do not alter mesh geometry or materials",
        "Leave the armature in its neutral rest pose",
        "The exported GLB must contain zero animation clips",
      ],
      completed: false,
      retryCount: 0,
    },
    {
      id: steps.length + 2,
      phase: "export",
      description: "Export final static rig-ready GLB",
      bpyIntent: "Export the scene as GLB with skins enabled and animations disabled",
      constraints: ["Export exactly one static model asset", "Do not render or export a sprite sheet"],
      completed: false,
      retryCount: 0,
    }
  );

  return steps;
}

/**
 * Reason node: decide the next action based on current state.
 */
export async function reasonNode(state: BuildState): Promise<Partial<BuildState>> {
  // If no build plan exists yet, generate one
  if (!state.buildPlan || state.buildPlan.length === 0) {
    const plan = generateBuildPlan(state);
    return {
      buildPlan: plan,
      currentStep: 0,
      currentAction: {
        type: "execute_step",
        stepIndex: 0,
        stepDescription: plan[0].description,
        bpyIntent: plan[0].bpyIntent,
        constraints: plan[0].constraints,
        reasoning: "Starting build with the first step: verify mesh import.",
      },
      statusMessage: `Planning: ${plan.length} steps generated`,
    };
  }

  // Check if we've completed all steps
  const nextIncomplete = state.buildPlan.findIndex((s) => !s.completed);
  if (nextIncomplete === -1) {
    return {
      currentAction: {
        type: "finalize",
        stepIndex: state.buildPlan.length,
        stepDescription: "All steps completed — finalizing build",
        bpyIntent: "Export final assets",
        constraints: [],
        reasoning: "All build plan steps have been marked complete.",
      },
      statusMessage: "All steps complete, finalizing...",
    };
  }

  // Check for too many consecutive errors
  if (state.consecutiveErrors >= 3) {
    // Try to adapt: skip the problematic step if it's non-critical
    const currentStep = state.buildPlan[state.currentStep];
    if (currentStep && !["import", "rigging"].includes(currentStep.phase)) {
      // Non-critical phases (animation, camera, render, export) can be skipped
      const updatedPlan = [...state.buildPlan];
      updatedPlan[state.currentStep] = { ...currentStep, completed: true };
      return {
        buildPlan: updatedPlan,
        currentStep: state.currentStep + 1,
        consecutiveErrors: 0,
        currentAction: null,
        statusMessage: `Skipping failed step: ${currentStep.description}`,
      };
    }
  }

  // Circuit breaker
  if (state.errorCount >= 15) {
    return {
      currentAction: {
        type: "finalize",
        stepIndex: state.currentStep,
        stepDescription: "Too many errors — aborting and exporting partial result",
        bpyIntent: "Export whatever we have",
        constraints: [],
        reasoning: `Circuit breaker: ${state.errorCount} total errors exceeded threshold.`,
      },
      status: "failed",
      statusMessage: `Aborting: ${state.errorCount} errors exceeded circuit breaker`,
    };
  }

  // Normal flow: execute the next incomplete step
  const step = state.buildPlan[nextIncomplete];

  // Use Claude-style reasoning to adapt based on history
  let adaptedIntent = step.bpyIntent;
  let adaptedConstraints = [...step.constraints];

  // If this step has been retried, add context from previous failures
  if (step.retryCount > 0) {
    const previousAttempts = state.executionHistory.filter(
      (h) => h.stepIndex === nextIncomplete
    );
    if (previousAttempts.length > 0) {
      const lastAttempt = previousAttempts[previousAttempts.length - 1];
      adaptedConstraints.push(
        `PREVIOUS ATTEMPT FAILED: ${lastAttempt.executeResult.error || "unknown error"}. ` +
        `Adapt your approach to avoid the same failure.`
      );
      if (lastAttempt.verification?.issuesFound) {
        adaptedConstraints.push(
          `Issues found: ${lastAttempt.verification.issuesFound.join(", ")}`
        );
      }
    }
  }

  // Adapt based on scene understanding
  if (state.sceneUnderstanding) {
    if (state.sceneUnderstanding.overallQuality === "geometry_soup") {
      adaptedConstraints.push("WARNING: Scene has geometry issues. Be extra careful with transforms.");
    }
    if (state.sceneUnderstanding.missingElements.length > 0) {
      adaptedConstraints.push(
        `Missing elements noted: ${state.sceneUnderstanding.missingElements.join(", ")}`
      );
    }
  }

  return {
    currentStep: nextIncomplete,
    currentAction: {
      type: step.retryCount > 0 ? "retry_step" : "execute_step",
      stepIndex: nextIncomplete,
      stepDescription: step.description,
      bpyIntent: adaptedIntent,
      constraints: adaptedConstraints,
      reasoning: step.retryCount > 0
        ? `Retrying step ${nextIncomplete + 1} (attempt ${step.retryCount + 1})`
        : `Executing step ${nextIncomplete + 1}: ${step.description}`,
    },
    statusMessage: `Step ${nextIncomplete + 1}/${state.buildPlan.length}: ${step.description}`,
  };
}
