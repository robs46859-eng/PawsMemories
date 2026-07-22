// ─── Phase 4: Rig, Facial, and Accessory Validation ──────────────────────────
import crypto from "node:crypto";
import type {
  RigValidationReport,
  RigValidationRule,
  FacialInventory,
  AccessoryFitResult,
  ClassificationResult,
} from "./schemas";
import {
  MOBILE_JOINT_BUDGET,
  MOBILE_TRIANGLE_BUDGET,
  MOBILE_TEXTURE_MAX,
  MAX_BONE_INFLUENCES,
} from "./types";

// ─── 1. Species & Profile Classification ────────────────────────────────────

export function classifyModel(
  glbMetadata: {
    nodeNames?: string[];
    meshNames?: string[];
    triangleCount: number;
    boundingVolume: { x: number; y: number; z: number };
    subjectClass?: string;
  },
): ClassificationResult {
  const { boundingVolume, subjectClass } = glbMetadata;
  const isHorizontalBody = boundingVolume.z > boundingVolume.y * 0.9 || (boundingVolume.x > boundingVolume.y * 1.5 && boundingVolume.z > boundingVolume.y * 0.5);

  const subject = (subjectClass || "").toLowerCase();

  let classification: "biped" | "quadruped" | "unsupported" = "unsupported";
  let profileId = "unsupported";
  let confidence = 0.85;

  const isStaticSubject = ["chair", "table", "car", "building", "object", "item", "furniture", "stationery"].includes(subject);

  if (isStaticSubject) {
    classification = "unsupported";
    profileId = "unsupported.static";
    confidence = 0.99;
  } else if (["human", "biped", "person", "character"].includes(subject) || (boundingVolume.y > boundingVolume.x * 1.3 && boundingVolume.y > boundingVolume.z * 1.3)) {
    classification = "biped";
    profileId = "biped.human.canonical";
    confidence = 0.95;
  } else if (["dog", "cat", "horse", "quadruped", "animal"].includes(subject) || isHorizontalBody) {
    classification = "quadruped";
    profileId = "quadruped.dog.medium";
    confidence = 0.92;
  } else if (boundingVolume.y > 0 && boundingVolume.x > 0) {
    // Rigid/static object or unsupported topology
    classification = "unsupported";
    profileId = "unsupported.static";
    confidence = 0.99;
  }

  return {
    classification,
    classifierVersion: "v4.1.0-deterministic",
    confidence,
    evidence: {
      boundingVolume,
      aspectRatio: boundingVolume.z > 0 ? boundingVolume.x / boundingVolume.z : 1,
      subjectClass: subjectClass || "unknown",
      triangleCount: glbMetadata.triangleCount,
    },
    selectedProfileId: profileId,
  };
}

// ─── 2. Rig Skeleton & Weights Validation ────────────────────────────────────

export interface ModelRigMetrics {
  boneCount: number;
  jointCount: number;
  skinnedVertexCount: number;
  maxInfluencesPerVertex: number;
  unweightedIslands: number;
  bindMatrixValid: boolean;
  animationSweepPass: boolean;
  silhouetteDeviation: number;
  triangleCount: number;
  textureMaxDimension: number;
  boneNames: string[];
}

export function validateRigGeometry(
  metrics: ModelRigMetrics,
): { report: RigValidationReport; metricsHash: string } {
  const rules: RigValidationRule[] = [];

  // Rule 1: Bone count and hierarchy
  const bonePass = metrics.boneCount >= 4 && metrics.boneCount <= 256;
  rules.push({
    rule: "bone_hierarchy_bounds",
    pass: bonePass,
    detail: bonePass
      ? `Valid skeleton structure with ${metrics.boneCount} bones`
      : `Bone count ${metrics.boneCount} outside valid range [4..256]`,
    measured: metrics.boneCount,
  });

  // Rule 2: Max influences per vertex (strict <= 4)
  const influencesPass = metrics.maxInfluencesPerVertex <= MAX_BONE_INFLUENCES;
  rules.push({
    rule: "vertex_skin_influences",
    pass: influencesPass,
    detail: influencesPass
      ? `Maximum vertex influences = ${metrics.maxInfluencesPerVertex} (<= ${MAX_BONE_INFLUENCES})`
      : `Vertex influences ${metrics.maxInfluencesPerVertex} exceeds limit of ${MAX_BONE_INFLUENCES}`,
    measured: metrics.maxInfluencesPerVertex,
  });

  // Rule 3: Unweighted islands check
  const islandsPass = metrics.unweightedIslands === 0;
  rules.push({
    rule: "no_unweighted_islands",
    pass: islandsPass,
    detail: islandsPass
      ? "Zero unweighted mesh islands detected"
      : `Found ${metrics.unweightedIslands} unweighted mesh islands`,
    measured: metrics.unweightedIslands,
  });

  // Rule 4: Inverse bind matrices validity
  rules.push({
    rule: "bind_matrix_finite",
    pass: metrics.bindMatrixValid,
    detail: metrics.bindMatrixValid
      ? "All inverse bind matrices are finite and invertible"
      : "Invalid or non-invertible inverse bind matrices detected",
  });

  // Rule 5: Animation sweep & deformation
  rules.push({
    rule: "animation_sweep_deformation",
    pass: metrics.animationSweepPass,
    detail: metrics.animationSweepPass
      ? "Deformation sweep passed without self-intersection or collapse"
      : "Mesh self-intersection or volume collapse detected during sweep",
  });

  // Rule 6: Mobile budgets
  const mobileBudgetPass =
    metrics.jointCount <= MOBILE_JOINT_BUDGET &&
    metrics.triangleCount <= MOBILE_TRIANGLE_BUDGET &&
    metrics.textureMaxDimension <= MOBILE_TEXTURE_MAX;

  rules.push({
    rule: "mobile_runtime_budget",
    pass: mobileBudgetPass,
    detail: mobileBudgetPass
      ? `Within mobile budget (${metrics.jointCount} joints, ${metrics.triangleCount} tris, ${metrics.textureMaxDimension}px tex)`
      : `Exceeds mobile budget bounds: joints=${metrics.jointCount} (max ${MOBILE_JOINT_BUDGET}), tris=${metrics.triangleCount} (max ${MOBILE_TRIANGLE_BUDGET}), tex=${metrics.textureMaxDimension} (max ${MOBILE_TEXTURE_MAX})`,
  });

  const report: RigValidationReport = {
    validatorVersion: "v4.1.0-rig-verifier",
    boneCount: metrics.boneCount,
    skinnedVertexCount: metrics.skinnedVertexCount,
    maxInfluences: metrics.maxInfluencesPerVertex,
    unweightedIslands: metrics.unweightedIslands,
    bindMatrixValid: metrics.bindMatrixValid,
    animationSweepPass: metrics.animationSweepPass,
    silhouetteDeviation: metrics.silhouetteDeviation,
    mobileBudgetPass,
    triangleCount: metrics.triangleCount,
    textureMaxDimension: metrics.textureMaxDimension,
    jointCount: metrics.jointCount,
    rules,
  };

  const metricsHash = crypto
    .createHash("sha256")
    .update(JSON.stringify(report))
    .digest("hex");

  return { report, metricsHash };
}

// ─── 3. Facial Morph & Viseme Inventory ──────────────────────────────────────

const CANONICAL_VISEMES = ["A", "B", "C", "D", "E", "F", "G", "H", "X"];

export function inventoryFacialMorphs(
  morphNames: string[],
  options: { hasBlink?: boolean; hasJaw?: boolean; hasEyeControls?: boolean; deformationPass?: boolean } = {},
): FacialInventory {
  const normalizedNames = morphNames.map((n) => n.trim().toLowerCase());
  const canonicalMap: Record<string, string> = {};
  let mappedVisemes = 0;

  // Search for canonical visemes in morph targets
  for (const viseme of CANONICAL_VISEMES) {
    const match = morphNames.find((name) => {
      const lower = name.toLowerCase();
      return (
        lower === `viseme_${viseme.toLowerCase()}` ||
        lower === `viseme_${viseme}` ||
        lower === `v_${viseme.toLowerCase()}` ||
        lower === viseme.toLowerCase()
      );
    });
    if (match) {
      canonicalMap[match] = viseme;
      mappedVisemes++;
    }
  }

  const visemeCoverage = mappedVisemes / CANONICAL_VISEMES.length;

  const hasBlink =
    options.hasBlink ??
    normalizedNames.some((n) => n.includes("blink") || n.includes("eye_close"));
  const hasJaw =
    options.hasJaw ??
    normalizedNames.some((n) => n.includes("jaw_open") || n.includes("mouth_open"));
  const hasEyeControls =
    options.hasEyeControls ??
    normalizedNames.some((n) => n.includes("eye_look") || n.includes("eye_target"));

  const deformationPass = options.deformationPass ?? false;
  let capability: "full" | "partial" | "body_only" | "unsupported" = "body_only";
  if (!deformationPass && morphNames.length > 0) {
    capability = "unsupported";
  } else if (visemeCoverage >= 0.8 && hasBlink && hasJaw) {
    capability = "full";
  } else if (mappedVisemes > 0 || hasBlink || hasJaw) {
    capability = "partial";
  } else if (morphNames.length === 0) {
    capability = "body_only";
  }

  return {
    capability,
    morphCount: morphNames.length,
    visemeCoverage,
    hasBlink,
    hasJaw,
    hasEyeControls,
    morphNames,
    canonicalMap,
    deformationPass,
    notes:
      capability === "body_only"
        ? "No facial morph targets found; body-only animation supported"
        : `Facial inventory complete: ${mappedVisemes}/9 visemes mapped`,
  };
}

// ─── 4. Accessory Fit Validation ─────────────────────────────────────────────

export function validateAccessoryFit(params: {
  targetBone: string;
  availableBones: string[];
  transform: { position: [number, number, number]; rotation: [number, number, number, number]; scale: [number, number, number] };
  accessoryTriangleCount: number;
  floatingDistance: number;
  penetrationDepth: number;
  animationSweepPass: boolean;
  printClearanceMm: number;
}): AccessoryFitResult {
  const boneExists = params.availableBones.includes(params.targetBone);
  const polygonBudgetPass = params.accessoryTriangleCount <= 25_000;
  const animationSweepPass = boneExists && params.animationSweepPass;

  return {
    attachmentBone: params.targetBone,
    transform: params.transform,
    floatingDistance: params.floatingDistance,
    penetrationDepth: params.penetrationDepth,
    animationSweepPass,
    polygonBudgetPass,
    printClearanceMm: params.printClearanceMm,
  };
}
