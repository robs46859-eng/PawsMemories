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

const REASON_SYSTEM_PROMPT = `You are an expert 3D artist and Blender pipeline architect. Your role is to plan and orchestrate the construction of rigged, animated 3D pet avatars in Blender 5.1.

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
1. Verify mesh import — check the GLB loaded correctly, count vertices/faces
2. Create armature — bone hierarchy matching the pet anatomy
3. Position bones — calculate actual vertex centroids for each body part (e.g., head is top 20% Z, legs are bottom 30% Z, tail is rear 20% Y, jaw is bottom-front 10% of head, ears are top-rear 20% of head) to ensure precise alignment
4. Parent mesh to armature — use automatic weights (ARMATURE_AUTO)
5. Test deformations — rotate key bones slightly, verify no distortion
6. Enhance Material — locate mesh material, add Bump node using Image Texture as height, plug into Normal, set Roughness to 0.8
7. Create eat animation — head/neck dip cycle, jaw rotates open/closed rhythmically (24 frames)
8. Create drink animation — head stays low, jaw bobbing (24 frames)
9. Create run animation — gallop/trot leg cycle (24 frames)
10. Create play animation — bounce/jump cycle, rapid tail wag (24 frames)
11. Create sleep animation — curled up, breathing (24 frames)
12. Create photo animation — alert pose, head tilt, ear twitches, eye scale down (blink) (12 frames)
13. Setup camera + lighting — orthographic side view, 3-point light rig
14. Render sprite sheet — 128×128 per frame, 6 rows

CONSTRAINTS:
- ALWAYS use .get() for bone access, NEVER direct indexing
- Keep rotations within anatomical limits (±60° legs, ±45° spine, ±60° tail)
- Use Bezier interpolation for all animation keyframes to ensure smooth, realistic movement
- Use BLENDER_EEVEE engine for fast realistic PBR rendering
- Film transparent = True for sprite sheets
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
  const animMods = anatomy.animationModifiers;

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
        "Use the exact bone naming convention: hips → spine → chest → neck → head, " +
        "jaw, ear.L, ear.R, eye.L, eye.R attached to head, " +
        "front_leg_upper.L/R → front_leg_lower.L/R → front_paw.L/R, " +
        "back_leg_upper.L/R → back_leg_lower.L/R → back_paw.L/R" +
        (petAnalysis.hasTail ? ", tail_01 → tail_02 → tail_03" : ""),
      constraints: [
        "Use edit mode to create bones",
        "Position bones by calculating actual vertex centroids for each body part (e.g., head is top 20% Z, legs are bottom 30% Z) to ensure precise alignment",
        "Use Vector from mathutils for world-space coordinates",
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

  // Add animation steps with breed-specific gait info
  const gaitDesc: Record<string, string> = {
    gallop: "full gallop cycle, alternating diagonal leg pairs",
    trot: "smooth trot cycle, alternating diagonal leg pairs",
    waddle: "short waddle cycle, body sways side-to-side with short leg strides",
    hop: "hopping cycle, legs move synchronously",
  };

  const animations = [
    { name: "eating", frames: 24, desc: `Head/neck dip down (reach multiplier: ${animMods.eatingReach.toFixed(1)}x), jaw bone opens and closes rhythmically, slight forward lean, smooth transitions` },
    { name: "drinking", frames: 24, desc: `Head at consistent low level (reach: ${animMods.eatingReach.toFixed(1)}x), jaw bobbing, rhythmic continuous looping` },
    { name: "running", frames: 24, desc: `${gaitDesc[animMods.runGaitType] || "trot cycle"}, body bob (spine flex: ${animMods.spineFlexMultiplier.toFixed(1)}x), max leg angle: ${boneProps.frontLegs.jointAngleMax}°, large expressive leg arcs` },
    { name: "playing", frames: 24, desc: `Playful bounce/jump (bounce: ${animMods.playBounce.toFixed(1)}x), front paws lift, energetic full-body movement, rapid tail wag` },
    { name: "sleeping", frames: 24, desc: "Body lowered, slow continuous breathing (scale chest), head resting, very subtle smooth motion" },
    { name: "photo", frames: 12, desc: "Alert sitting, head tilts, ear twitches, eye blinks (scale Z to 0.1 briefly), natural idle" },
  ];

  for (const anim of animations) {
    steps.push({
      id: steps.length + 1,
      phase: "animation",
      description: `Create ${anim.name} animation (${anim.frames} frames)`,
      bpyIntent: `Create a bpy.data.actions entry named "${anim.name}" with ${anim.frames} keyframes. ` +
        `Animation for ${petAnalysis.breed}: ${anim.desc}. ` +
        (petAnalysis.hasTail && (anim.name === "running" || anim.name === "playing")
          ? `Include tail wagging (amplitude: ${animMods.tailWagAmplitude.toFixed(1)}x).`
          : "") +
        " Use pose.bones.get() for safe bone access. Use relative data_path for keyframe_insert.",
      constraints: [
        "Use armature_obj.pose.bones.get('name') — NEVER direct indexing",
        "Set bone.rotation_mode = 'XYZ' before setting rotation_euler",
        "Use keyframe_insert(data_path='rotation_euler') — relative path only",
        `Keep rotations within breed-specific limits (legs: ±${boneProps.frontLegs.jointAngleMax}°, tail: ±${boneProps.tail?.jointAngleMax ?? 30}°)`,
        "Create animation_data if not exists",
      ],
      completed: false,
      retryCount: 0,
    });
  }

  // Camera, lighting, render steps
  steps.push(
    {
      id: steps.length + 1,
      phase: "camera",
      description: "Setup orthographic camera and 3-point lighting",
      bpyIntent: "Create an orthographic camera positioned to the side, with ortho_scale fitting the model. " +
        "Add 3-point lighting: key (SUN, energy 2.0), fill (POINT, energy 0.5), rim (SUN, energy 1.0). " +
        "Set film_transparent = True.",
      constraints: [
        "Camera type = ORTHO",
        "Use Damped Track or manual rotation to point at model center",
        "15% margin so ears/tail aren't clipped",
      ],
      completed: false,
      retryCount: 0,
    },
    {
      id: steps.length + 2,
      phase: "render",
      description: "Render sprite sheet (6 animations × max frames)",
      bpyIntent: "Set render engine to BLENDER_WORKBENCH, resolution 128×128, RGBA PNG. " +
        "For each animation action, set it active, render each frame to temp file, " +
        "then composite into a sprite sheet using numpy. " +
        "Save sprite sheet and animation metadata JSON.",
      constraints: [
        "Use BLENDER_WORKBENCH — do NOT use Cycles or EEVEE",
        "Render to temp files first, then composite",
        "Do NOT read from 'Render Result' directly",
        "Sprite sheet: 6 columns × 6 rows, 128×128 per cell",
      ],
      completed: false,
      retryCount: 0,
    },
    {
      id: steps.length + 3,
      phase: "export",
      description: "Export final rigged GLB",
      bpyIntent: "Export the scene as GLB with animations and skins enabled",
      constraints: [],
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
