/**
 * Pure Animator Phase 3 rigging policy.
 *
 * This module deliberately performs no file, network, provider, or Blender I/O.
 * Workers can feed it profile records and measured rig evidence, then persist the
 * deterministic plan/manifest returned here.
 */
import { SKELETON_CONTRACTS } from "../../skeletonContract";
import { BUDGET, checkBudget } from "../rigBudget";
import type { BoneDefinitionProfile } from "./schemas";

export type RigBodyType = keyof typeof SKELETON_CONTRACTS;

/** Versioned profile parsed by BoneDefinitionProfileV1. */
export type RiggingProfile = BoneDefinitionProfile;

export interface RigProfileSelectionInput {
  profiles: readonly RiggingProfile[];
  requestedProfileId?: string;
  bodyType?: RigBodyType;
  /** Optional classifier scores. They are only used when bodyType is absent. */
  bodyTypeScores?: Partial<Record<RigBodyType, number>>;
}

export interface RigProfileSelection {
  ok: boolean;
  bodyType: RigBodyType | null;
  profile: RiggingProfile | null;
  reason: "requested-profile" | "body-type-default" | "classifier-score" | "unresolved";
  failureReasons: string[];
}

const BODY_TYPE_ORDER: readonly RigBodyType[] = ["quadruped", "biped", "winged"];

function sortedProfiles(profiles: readonly RiggingProfile[]): RiggingProfile[] {
  return [...profiles].sort((a, b) => a.id.localeCompare(b.id));
}

/** Select an explicit profile first, otherwise the lexically first profile for a body type. */
export function selectRiggingProfile(input: RigProfileSelectionInput): RigProfileSelection {
  const profiles = sortedProfiles(input.profiles);
  const requestedId = input.requestedProfileId?.trim();

  if (requestedId) {
    const profile = profiles.find((candidate) => candidate.id === requestedId);
    if (!profile) {
      return {
        ok: false, bodyType: input.bodyType ?? null, profile: null, reason: "unresolved",
        failureReasons: [`profile_not_found:${requestedId}`],
      };
    }
    if (input.bodyType && profile.skeleton !== input.bodyType) {
      return {
        ok: false, bodyType: input.bodyType, profile: null, reason: "unresolved",
        failureReasons: [`profile_body_type_mismatch:${profile.id}:${profile.skeleton}:${input.bodyType}`],
      };
    }
    return {
      ok: true, bodyType: profile.skeleton, profile, reason: "requested-profile", failureReasons: [],
    };
  }

  let bodyType = input.bodyType;
  let reason: RigProfileSelection["reason"] = "body-type-default";
  if (!bodyType && input.bodyTypeScores) {
    const scored = BODY_TYPE_ORDER
      .map((type) => ({ type, score: input.bodyTypeScores?.[type] }))
      .filter((entry): entry is { type: RigBodyType; score: number } =>
        typeof entry.score === "number" && Number.isFinite(entry.score) && entry.score >= 0)
      .sort((a, b) => b.score - a.score || BODY_TYPE_ORDER.indexOf(a.type) - BODY_TYPE_ORDER.indexOf(b.type));
    bodyType = scored[0]?.type;
    reason = "classifier-score";
  }

  if (!bodyType) {
    return {
      ok: false, bodyType: null, profile: null, reason: "unresolved",
      failureReasons: ["body_type_unresolved"],
    };
  }
  const profile = profiles.find((candidate) => candidate.skeleton === bodyType);
  if (!profile) {
    return {
      ok: false, bodyType, profile: null, reason: "unresolved",
      failureReasons: [`profile_unavailable_for_body_type:${bodyType}`],
    };
  }
  return { ok: true, bodyType, profile, reason, failureReasons: [] };
}

export interface RequiredBoneContractEvaluation {
  bodyType: RigBodyType;
  pass: boolean;
  requiredBones: string[];
  presentBones: string[];
  maskedBones: string[];
  missingBones: string[];
  unexpectedMaskBones: string[];
  failureReasons: string[];
}

/** Evaluate the canonical skeletonContract after applying a partial-rig bone mask. */
export function evaluateRequiredBoneContract(
  bodyType: RigBodyType,
  availableBones: readonly string[],
  boneMask: readonly string[] = [],
): RequiredBoneContractEvaluation {
  const contractBones = SKELETON_CONTRACTS[bodyType].allBones;
  const available = new Set(availableBones);
  const masked = new Set(boneMask);
  const requiredBones = contractBones.filter((bone) => !masked.has(bone));
  const presentBones = requiredBones.filter((bone) => available.has(bone));
  const missingBones = requiredBones.filter((bone) => !available.has(bone));
  const maskedBones = contractBones.filter((bone) => masked.has(bone));
  const unexpectedMaskBones = [...masked]
    .filter((bone) => !contractBones.includes(bone))
    .sort((a, b) => a.localeCompare(b));
  return {
    bodyType,
    pass: missingBones.length === 0,
    requiredBones,
    presentBones,
    maskedBones,
    missingBones,
    unexpectedMaskBones,
    failureReasons: missingBones.map((bone) => `required_bone_missing:${bone}`),
  };
}

export type SubmeshRigOverride = "soft" | "rigid";

export interface RigSubmeshInput {
  id: string;
  name: string;
  materialName?: string;
  deformationVariance?: number;
  nearestBone?: string;
  override?: SubmeshRigOverride;
}

export interface SelectiveRiggingEntry {
  id: string;
  name: string;
  classification: "soft" | "rigid";
  operation: "skin" | "parent-attach" | "reject";
  parentBone?: string;
  reason: "manual-override" | "profile-glob" | "deformation-variance" | "default-soft";
  failureReason?: string;
}

export interface SelectiveRiggingPlan {
  entries: SelectiveRiggingEntry[];
  skinnedSubmeshes: number;
  rigidAttachments: number;
  rejectedSubmeshes: number;
  failureReasons: string[];
}

export const DEFAULT_RIGID_DEFORMATION_VARIANCE = 0.025;

function globMatches(value: string, glob: string): boolean {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`, "i").test(value);
}

/**
 * Plan skinning versus rigid parent attachment. Manual overrides win, followed
 * by profile globs and measured deformation variance.
 */
export function planSelectiveRigging(
  profile: RiggingProfile,
  submeshes: readonly RigSubmeshInput[],
  availableBones: readonly string[],
  rigidVarianceThreshold = DEFAULT_RIGID_DEFORMATION_VARIANCE,
): SelectiveRiggingPlan {
  if (!Number.isFinite(rigidVarianceThreshold) || rigidVarianceThreshold < 0) {
    throw new Error("rigidVarianceThreshold must be a finite non-negative number");
  }
  const available = new Set(availableBones);
  const masked = new Set(profile.boneMask);
  const seenIds = new Set<string>();
  const entries = [...submeshes]
    .sort((a, b) => a.id.localeCompare(b.id) || a.name.localeCompare(b.name))
    .map((submesh): SelectiveRiggingEntry => {
      let classification: SelectiveRiggingEntry["classification"] = "soft";
      let reason: SelectiveRiggingEntry["reason"] = "default-soft";
      if (submesh.override) {
        classification = submesh.override;
        reason = "manual-override";
      } else if (profile.rigidAttachments.some((glob) =>
        globMatches(submesh.name, glob) || globMatches(submesh.materialName ?? "", glob))) {
        classification = "rigid";
        reason = "profile-glob";
      } else if (typeof submesh.deformationVariance === "number"
        && Number.isFinite(submesh.deformationVariance)
        && submesh.deformationVariance <= rigidVarianceThreshold) {
        classification = "rigid";
        reason = "deformation-variance";
      }

      let failureReason: string | undefined;
      if (!submesh.id.trim() || seenIds.has(submesh.id)) {
        failureReason = !submesh.id.trim() ? "submesh_id_missing" : `duplicate_submesh_id:${submesh.id}`;
      }
      seenIds.add(submesh.id);
      if (classification === "rigid" && !failureReason) {
        if (!submesh.nearestBone) failureReason = `rigid_parent_missing:${submesh.id}`;
        else if (!available.has(submesh.nearestBone) || masked.has(submesh.nearestBone)) {
          failureReason = `rigid_parent_unavailable:${submesh.id}:${submesh.nearestBone}`;
        }
      }
      return {
        id: submesh.id,
        name: submesh.name,
        classification,
        operation: failureReason ? "reject" : classification === "rigid" ? "parent-attach" : "skin",
        ...(classification === "rigid" && submesh.nearestBone ? { parentBone: submesh.nearestBone } : {}),
        reason,
        ...(failureReason ? { failureReason } : {}),
      };
    });
  const failureReasons = entries.flatMap((entry) => entry.failureReason ? [entry.failureReason] : []);
  return {
    entries,
    skinnedSubmeshes: entries.filter((entry) => entry.operation === "skin").length,
    rigidAttachments: entries.filter((entry) => entry.operation === "parent-attach").length,
    rejectedSubmeshes: entries.filter((entry) => entry.operation === "reject").length,
    failureReasons,
  };
}

export interface RigValidationEvidence {
  twistBoneCounts?: Readonly<Record<string, number>>;
  neckJawAngleDegrees?: number;
  silhouetteDeviation?: number;
  purlicueAligned?: boolean;
}

export interface RigValidationStats {
  boneCount: number;
  skinnedVerts: number;
  rigidAttachments: number;
  triangles?: number;
  bytes?: number;
}

export interface RigValidationInput {
  jobId: string;
  profile: RiggingProfile;
  availableBones: readonly string[];
  selectivePlan: SelectiveRiggingPlan;
  stats: RigValidationStats;
  evidence: RigValidationEvidence;
  operationalFailureReasons?: readonly string[];
  neckJawToleranceDegrees?: number;
  silhouetteTolerance?: number;
}

export interface DeterministicRigManifest {
  version: "1";
  jobId: string;
  state: "pending" | "running" | "done" | "failed" | "needs_manual";
  profileId: string;
  validation: Array<{ rule: string; pass: boolean; detail: string }>;
  stats: { boneCount: number; skinnedVerts: number; rigidAttachments: number };
  bodyType: RigBodyType;
  accepted: boolean;
  failureReasons: string[];
}

function validationRule(rule: string, pass: boolean, detail: string) {
  return { rule, pass, detail };
}

/** Build a stable, fail-closed Phase 3 validation manifest from worker measurements. */
export function buildRigValidationManifest(input: RigValidationInput): DeterministicRigManifest {
  const neckTolerance = input.neckJawToleranceDegrees ?? 10;
  const silhouetteTolerance = input.silhouetteTolerance ?? 0.03;
  const bones = evaluateRequiredBoneContract(
    input.profile.skeleton,
    input.availableBones,
    input.profile.boneMask,
  );
  const budgetMeasurementsValid = [
    input.stats.boneCount,
    input.stats.triangles,
    input.stats.bytes,
  ].every((value) => typeof value === "number" && Number.isFinite(value) && value >= 0);
  const budget = checkBudget({
    tris: input.stats.triangles ?? Number.POSITIVE_INFINITY,
    bones: input.stats.boneCount,
    bytes: input.stats.bytes ?? Number.POSITIVE_INFINITY,
    retarget_confidence: 1,
    leg_chains_ok: bones.pass,
  });
  const expectedTwists = Object.entries(input.profile.twistBones ?? {}).sort(([a], [b]) => a.localeCompare(b));
  const twistFailures = expectedTwists.filter(([bone, count]) =>
    (input.evidence.twistBoneCounts?.[bone] ?? 0) < count);
  const neckMeasured = input.evidence.neckJawAngleDegrees;
  const neckPass = input.profile.skeleton !== "quadruped"
    || (typeof neckMeasured === "number" && Number.isFinite(neckMeasured) && neckMeasured <= neckTolerance);
  const silhouetteMeasured = input.evidence.silhouetteDeviation;
  const silhouettePass = typeof silhouetteMeasured === "number"
    && Number.isFinite(silhouetteMeasured)
    && silhouetteMeasured <= silhouetteTolerance;
  const purlicuePass = input.profile.skeleton !== "biped" || input.evidence.purlicueAligned === true;
  const operationalFailures = [...(input.operationalFailureReasons ?? [])].sort((a, b) => a.localeCompare(b));
  const selectivePass = input.selectivePlan.failureReasons.length === 0
    && input.stats.rigidAttachments === input.selectivePlan.rigidAttachments;

  const validation = [
    validationRule(
      "required_bone_contract",
      bones.pass,
      bones.pass ? `${bones.requiredBones.length} required bones present; ${bones.maskedBones.length} masked`
        : `missing: ${bones.missingBones.join(", ")}`,
    ),
    validationRule(
      "rig_budget",
      budgetMeasurementsValid && budget.ok,
      !budgetMeasurementsValid ? "bone, triangle, and byte measurements must be finite non-negative numbers"
        : budget.ok ? `bones ${input.stats.boneCount}/${BUDGET.maxBones}; tris ${input.stats.triangles}/${BUDGET.maxTris}; bytes ${input.stats.bytes}/${BUDGET.maxBytes}`
          : budget.reasons.join("; "),
    ),
    validationRule(
      "twist_bones_present",
      twistFailures.length === 0,
      expectedTwists.length === 0 ? "not required by profile"
        : twistFailures.length === 0 ? `${expectedTwists.length} twist allocations satisfied`
          : `insufficient: ${twistFailures.map(([bone, count]) => `${bone} requires ${count}`).join(", ")}`,
    ),
    validationRule(
      "neck_jaw_parallel",
      neckPass,
      input.profile.skeleton !== "quadruped" ? "not applicable"
        : typeof neckMeasured === "number" && Number.isFinite(neckMeasured)
          ? `${neckMeasured} degrees (maximum ${neckTolerance})` : "measurement missing",
    ),
    validationRule(
      "silhouette_probe",
      silhouettePass,
      typeof silhouetteMeasured === "number" && Number.isFinite(silhouetteMeasured)
        ? `${silhouetteMeasured} normalized deviation (maximum ${silhouetteTolerance})` : "measurement missing",
    ),
    validationRule(
      "purlicue_alignment",
      purlicuePass,
      input.profile.skeleton !== "biped" ? "not applicable"
        : input.evidence.purlicueAligned === true ? "thumb base aligned to purlicue" : "alignment missing or failed",
    ),
    validationRule(
      "selective_rigging",
      selectivePass,
      input.selectivePlan.failureReasons.length > 0 ? input.selectivePlan.failureReasons.join("; ")
        : input.stats.rigidAttachments !== input.selectivePlan.rigidAttachments
          ? `manifest reports ${input.stats.rigidAttachments} rigid attachments; plan requires ${input.selectivePlan.rigidAttachments}`
          : `${input.selectivePlan.skinnedSubmeshes} skinned; ${input.selectivePlan.rigidAttachments} rigid parent-attached`,
    ),
    validationRule(
      "worker_execution",
      operationalFailures.length === 0,
      operationalFailures.length === 0 ? "no operational failures" : operationalFailures.join("; "),
    ),
  ];
  const failureReasons = collectRigFailureReasons(validation, operationalFailures);
  const accepted = failureReasons.length === 0;
  return {
    version: "1",
    jobId: input.jobId,
    state: accepted ? "done" : operationalFailures.length > 0 ? "failed" : "needs_manual",
    profileId: input.profile.id,
    bodyType: input.profile.skeleton,
    validation,
    stats: {
      boneCount: input.stats.boneCount,
      skinnedVerts: input.stats.skinnedVerts,
      rigidAttachments: input.stats.rigidAttachments,
    },
    accepted,
    failureReasons,
  };
}

export function collectRigFailureReasons(
  validation: readonly { rule: string; pass: boolean; detail: string }[],
  additionalReasons: readonly string[] = [],
): string[] {
  return [
    ...validation.filter((rule) => !rule.pass).map((rule) => `${rule.rule}:${rule.detail}`),
    ...additionalReasons.map((reason) => `operation:${reason}`),
  ].filter((reason, index, all) => all.indexOf(reason) === index);
}

export interface RiggingCorpusEntry {
  meshId: string;
  manifest: Pick<DeterministicRigManifest, "accepted" | "validation">;
}

export interface RiggingAcceptanceMetrics {
  corpusSize: number;
  acceptedMeshes: number;
  rejectedMeshes: number;
  acceptanceRate: number;
  minimumCorpusSize: number;
  minimumAcceptedMeshes: number;
  corpusSizeMet: boolean;
  acceptedCountMet: boolean;
  pass: boolean;
  acceptedMeshIds: string[];
  rejectedMeshIds: string[];
  failureReasons: string[];
}

export const PHASE3_MIN_CORPUS_SIZE = 10;
export const PHASE3_MIN_ACCEPTED_MESHES = 8;

/** Aggregate the Phase 3 exit evidence without allowing duplicate mesh IDs to inflate it. */
export function evaluateRiggingCorpusAcceptance(
  entries: readonly RiggingCorpusEntry[],
  minimumCorpusSize = PHASE3_MIN_CORPUS_SIZE,
  minimumAcceptedMeshes = PHASE3_MIN_ACCEPTED_MESHES,
): RiggingAcceptanceMetrics {
  if (!Number.isInteger(minimumCorpusSize) || minimumCorpusSize <= 0
    || !Number.isInteger(minimumAcceptedMeshes) || minimumAcceptedMeshes <= 0) {
    throw new Error("acceptance minima must be positive integers");
  }
  const byId = new Map<string, RiggingCorpusEntry>();
  const duplicateIds = new Set<string>();
  for (const entry of entries) {
    const id = entry.meshId.trim();
    if (!id || byId.has(id)) {
      duplicateIds.add(id || "<empty>");
      continue;
    }
    byId.set(id, entry);
  }
  const uniqueEntries = [...byId.entries()].sort(([a], [b]) => a.localeCompare(b));
  const acceptedMeshIds = uniqueEntries
    .filter(([, entry]) => entry.manifest.accepted && entry.manifest.validation.every((rule) => rule.pass))
    .map(([id]) => id);
  const rejectedMeshIds = uniqueEntries.filter(([id]) => !acceptedMeshIds.includes(id)).map(([id]) => id);
  const corpusSize = uniqueEntries.length;
  const corpusSizeMet = corpusSize >= minimumCorpusSize;
  const acceptedCountMet = acceptedMeshIds.length >= minimumAcceptedMeshes;
  const failureReasons = [
    ...(!corpusSizeMet ? [`corpus_too_small:${corpusSize}:${minimumCorpusSize}`] : []),
    ...(!acceptedCountMet ? [`accepted_meshes_below_minimum:${acceptedMeshIds.length}:${minimumAcceptedMeshes}`] : []),
    ...[...duplicateIds].sort((a, b) => a.localeCompare(b)).map((id) => `duplicate_or_empty_mesh_id:${id}`),
  ];
  return {
    corpusSize,
    acceptedMeshes: acceptedMeshIds.length,
    rejectedMeshes: rejectedMeshIds.length,
    acceptanceRate: corpusSize === 0 ? 0 : acceptedMeshIds.length / corpusSize,
    minimumCorpusSize,
    minimumAcceptedMeshes,
    corpusSizeMet,
    acceptedCountMet,
    pass: corpusSizeMet && acceptedCountMet && duplicateIds.size === 0,
    acceptedMeshIds,
    rejectedMeshIds,
    failureReasons,
  };
}

// Readable aliases for worker/integration call sites.
export const createSelectiveRiggingPlan = planSelectiveRigging;
export const createRigValidationManifest = buildRigValidationManifest;
export const calculateRiggingAcceptanceMetrics = evaluateRiggingCorpusAcceptance;
