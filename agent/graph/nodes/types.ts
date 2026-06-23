/**
 * Shared Types for the LangGraph Build Pipeline
 * ===============================================
 */

import type { SceneGraph } from "../../tools/blender_client";

// ---------------------------------------------------------------------------
// Pet Analysis (from existing ollama-agent)
// ---------------------------------------------------------------------------

export interface PetAnalysis {
  species: string;
  breed: string;
  bodyType: string;
  estimatedPose: string;
  legCount: number;
  hasTail: boolean;
  hasWings: boolean;
  bodyProportions: {
    headSize: string;
    legLength: string;
    bodyLength: string;
    neckLength: string;
  };
}

// ---------------------------------------------------------------------------
// Build Plan
// ---------------------------------------------------------------------------

export interface BuildStep {
  id: number;
  phase: "import" | "rigging" | "animation" | "camera" | "render" | "export";
  description: string;
  bpyIntent: string;
  constraints: string[];
  completed: boolean;
  retryCount: number;
}

// ---------------------------------------------------------------------------
// Scene Understanding (from Perceive Node)
// ---------------------------------------------------------------------------

export interface SceneObjectStatus {
  name: string;
  type: string;
  status: "ok" | "issues";
  issues?: string;
}

export interface ViewportChangeRequest {
  azimuth: number;
  elevation: number;
  reason: string;
}

export interface SceneUnderstanding {
  objectsPresent: SceneObjectStatus[];
  overallQuality: "clean" | "minor_issues" | "major_issues" | "geometry_soup";
  missingElements: string[];
  suggestedViewportChange: ViewportChangeRequest | null;
  readyForNextStep: boolean;
  notes: string;
}

// ---------------------------------------------------------------------------
// Reason Node Output
// ---------------------------------------------------------------------------

export interface NextAction {
  type: "execute_step" | "modify_plan" | "retry_step" | "change_viewport" | "finalize";
  stepIndex: number;
  stepDescription: string;
  bpyIntent: string;
  constraints: string[];
  reasoning: string;
}

// ---------------------------------------------------------------------------
// Verification Result (from Verify Node)
// ---------------------------------------------------------------------------

export interface VerificationResult {
  success: boolean;
  issuesFound: string[];
  driftSeverity: "none" | "minor" | "major" | "critical";
  recommendation: "proceed" | "undo_and_retry" | "undo_and_replan" | "abort";
  details: string;
}

// ---------------------------------------------------------------------------
// Step Result (execution history)
// ---------------------------------------------------------------------------

export interface StepResult {
  stepIndex: number;
  description: string;
  code: string;
  executeResult: {
    success: boolean;
    stdout: string;
    stderr: string;
    error: string | null;
  };
  verification: VerificationResult | null;
  timestamp: number;
}

// ---------------------------------------------------------------------------
// Build State (LangGraph state schema)
// ---------------------------------------------------------------------------

export interface BuildState {
  // Input
  petAnalysis: PetAnalysis;
  glbBase64: string;

  // Planning
  buildPlan: BuildStep[];
  currentStep: number;

  // Scene awareness
  sceneState: SceneGraph | null;
  sceneUnderstanding: SceneUnderstanding | null;
  viewportImage: string | null;

  // Current action
  currentAction: NextAction | null;

  // Execution history
  executionHistory: StepResult[];
  errorCount: number;
  consecutiveErrors: number;
  checkpoints: string[];

  // Output
  riggedGlbBase64: string | null;
  spriteSheetBase64: string | null;
  animationMetadata: any | null;
  status: "running" | "completed" | "failed";
  statusMessage: string;
}

// ---------------------------------------------------------------------------
// Initial State Factory
// ---------------------------------------------------------------------------

export function createInitialState(petAnalysis: PetAnalysis, glbBase64: string): BuildState {
  return {
    petAnalysis,
    glbBase64,
    buildPlan: [],
    currentStep: 0,
    sceneState: null,
    sceneUnderstanding: null,
    viewportImage: null,
    currentAction: null,
    executionHistory: [],
    errorCount: 0,
    consecutiveErrors: 0,
    checkpoints: [],
    riggedGlbBase64: null,
    spriteSheetBase64: null,
    animationMetadata: null,
    status: "running",
    statusMessage: "Initializing build pipeline...",
  };
}
