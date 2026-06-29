/**
 * DSPy Signatures
 * ================
 * Defines the input/output signatures for each agent node.
 * These are used by the DSPy optimizer to train and optimize
 * the system prompts against gold-standard examples.
 *
 * DSPy works by:
 * 1. Defining signatures (input → output schema)
 * 2. Running a few-shot bootstrapping optimizer against training examples
 * 3. Producing optimized prompt templates that maximize output quality
 */

// ---------------------------------------------------------------------------
// Signature Definitions
// ---------------------------------------------------------------------------

export interface DSPySignature {
  name: string;
  description: string;
  input_fields: Record<string, { type: string; description: string }>;
  output_fields: Record<string, { type: string; description: string }>;
}

export const PERCEIVE_SIGNATURE: DSPySignature = {
  name: "PerceiveScene",
  description:
    "Analyze a Blender viewport screenshot and scene graph to understand the current state of a 3D pet avatar build.",
  input_fields: {
    viewport_image: {
      type: "image",
      description: "Base64 PNG screenshot of the Blender viewport",
    },
    scene_json: {
      type: "json",
      description: "JSON scene graph with all objects, types, transforms, bones",
    },
    build_context: {
      type: "string",
      description: "Current build step and what was just executed",
    },
  },
  output_fields: {
    scene_understanding: {
      type: "json",
      description:
        "Structured analysis: objectsPresent, overallQuality, missingElements, suggestedViewportChange",
    },
  },
};

export const REASON_SIGNATURE: DSPySignature = {
  name: "PlanBuildStep",
  description:
    "Given a pet's anatomy and the current scene state, decide the next build step for creating a rigged animated avatar in Blender 5.1.",
  input_fields: {
    pet_analysis: {
      type: "json",
      description: "PetAnalysis: species, breed, bodyType, proportions",
    },
    scene_understanding: {
      type: "json",
      description: "Current scene state analysis from the perceive step",
    },
    execution_history: {
      type: "json",
      description: "Array of previous step results (success/failure, errors)",
    },
    build_plan: {
      type: "json",
      description: "The full build plan with completion status",
    },
  },
  output_fields: {
    next_action: {
      type: "json",
      description:
        "NextAction: type, stepIndex, stepDescription, bpyIntent (natural language), constraints",
    },
  },
};

export const ACT_SIGNATURE: DSPySignature = {
  name: "GenerateBPYCode",
  description:
    "Generate valid Blender 5.1 Python (bpy) code that accomplishes a specific rigging, animation, or rendering intent.",
  input_fields: {
    intent: {
      type: "string",
      description: "Natural language description of what the code should do",
    },
    constraints: {
      type: "string[]",
      description: "List of constraints and forbidden patterns to avoid",
    },
    scene_state: {
      type: "string",
      description: "Current scene objects and their types",
    },
    api_docs: {
      type: "string",
      description: "Relevant Blender Python API documentation from RAG",
    },
  },
  output_fields: {
    code: {
      type: "string",
      description: "Valid Python code starting with 'import bpy'",
    },
    expected_outcome: {
      type: "string",
      description: "Description of what should change in the scene after execution",
    },
  },
};

export const VERIFY_SIGNATURE: DSPySignature = {
  name: "VerifyExecution",
  description:
    "Compare viewport screenshots before and after code execution to detect geometry drift, rigging errors, or animation issues.",
  input_fields: {
    before_image: {
      type: "image",
      description: "Viewport screenshot before execution (may be null)",
    },
    after_image: {
      type: "image",
      description: "Viewport screenshot after execution",
    },
    expected_outcome: {
      type: "string",
      description: "What the step was supposed to accomplish",
    },
    execution_result: {
      type: "json",
      description: "Code execution result: success, stdout, stderr, error",
    },
  },
  output_fields: {
    verification: {
      type: "json",
      description:
        "VerificationResult: success, issuesFound[], driftSeverity, recommendation",
    },
  },
};

// ---------------------------------------------------------------------------
// All Signatures
// ---------------------------------------------------------------------------

export const ALL_SIGNATURES: DSPySignature[] = [
  PERCEIVE_SIGNATURE,
  REASON_SIGNATURE,
  ACT_SIGNATURE,
  VERIFY_SIGNATURE,
];

/**
 * Export signatures in a format compatible with DSPy's Python API.
 * This can be written to a JSON file and loaded by the Python DSPy optimizer.
 */
export function exportSignaturesForPython(): string {
  return JSON.stringify(ALL_SIGNATURES, null, 2);
}
