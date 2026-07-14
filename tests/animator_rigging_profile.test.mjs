import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { SKELETON_CONTRACTS } from "../skeletonContract.ts";
import {
  buildRigValidationManifest,
  evaluateRequiredBoneContract,
  evaluateRiggingCorpusAcceptance,
  planSelectiveRigging,
  selectRiggingProfile,
} from "../server/animator/rigging-profile.ts";

const profile = {
  id: "quadruped.dog.medium",
  skeleton: "quadruped",
  version: "1",
  joints: {},
  twistBones: { "front_leg_upper.L": 1, "front_leg_upper.R": 1 },
  boneMask: [],
  rigidAttachments: ["*collar*", "*tag*"],
  physics: [],
};
const bipedProfile = { ...profile, id: "biped.standard", skeleton: "biped", twistBones: {} };
const allQuadrupedBones = SKELETON_CONTRACTS.quadruped.allBones;

describe("Animator Phase 3 profile selection", () => {
  test("honors an explicit profile and rejects body-type mismatch", () => {
    const selected = selectRiggingProfile({ profiles: [bipedProfile, profile], requestedProfileId: profile.id });
    assert.equal(selected.ok, true);
    assert.equal(selected.profile?.id, profile.id);
    assert.equal(selected.reason, "requested-profile");

    const mismatch = selectRiggingProfile({ profiles: [profile], requestedProfileId: profile.id, bodyType: "biped" });
    assert.equal(mismatch.ok, false);
    assert.match(mismatch.failureReasons[0], /profile_body_type_mismatch/);
  });

  test("uses classifier score and deterministic profile ordering", () => {
    const alternate = { ...profile, id: "quadruped.cat.small" };
    const selected = selectRiggingProfile({
      profiles: [profile, alternate, bipedProfile],
      bodyTypeScores: { biped: 0.1, quadruped: 0.9 },
    });
    assert.equal(selected.bodyType, "quadruped");
    assert.equal(selected.profile?.id, alternate.id);
    assert.equal(selected.reason, "classifier-score");
  });
});

describe("required-bone contract", () => {
  test("reports canonical missing bones in contract order", () => {
    const result = evaluateRequiredBoneContract("quadruped", ["hips", "spine"]);
    assert.equal(result.pass, false);
    assert.deepEqual(result.presentBones, ["hips", "spine"]);
    assert.equal(result.missingBones[0], "chest");
    assert.match(result.failureReasons[0], /required_bone_missing:chest/);
  });

  test("a three-legged model passes when the absent chain is explicitly masked", () => {
    const removedLeg = ["front_leg_upper.R", "front_leg_lower.R", "front_paw.R"];
    const available = allQuadrupedBones.filter((bone) => !removedLeg.includes(bone));
    const result = evaluateRequiredBoneContract("quadruped", available, removedLeg);
    assert.equal(result.pass, true);
    assert.deepEqual(result.maskedBones, removedLeg);
    assert.deepEqual(result.missingBones, []);
  });
});

describe("selective rigging plan", () => {
  test("keeps body soft and parent-attaches collar/tag meshes", () => {
    const plan = planSelectiveRigging(profile, [
      { id: "tag", name: "ID_Tag", nearestBone: "neck" },
      { id: "body", name: "Body", nearestBone: "hips" },
      { id: "collar", name: "Leather_Collar", nearestBone: "neck" },
    ], allQuadrupedBones);
    assert.deepEqual(plan.entries.map((entry) => [entry.id, entry.operation]), [
      ["body", "skin"], ["collar", "parent-attach"], ["tag", "parent-attach"],
    ]);
    assert.equal(plan.rigidAttachments, 2);
    assert.deepEqual(plan.failureReasons, []);
  });

  test("manual override wins and unavailable rigid parents fail explicitly", () => {
    const plan = planSelectiveRigging(profile, [
      { id: "collar", name: "collar", override: "soft" },
      { id: "armor", name: "armor", override: "rigid", nearestBone: "missing" },
    ], allQuadrupedBones);
    assert.equal(plan.entries[0].operation, "reject");
    assert.equal(plan.entries[1].operation, "skin");
    assert.match(plan.failureReasons[0], /rigid_parent_unavailable/);
  });

  test("low measured deformation selects rigid attachment while high variance stays soft", () => {
    const plan = planSelectiveRigging(profile, [
      { id: "badge", name: "Badge", deformationVariance: 0.01, nearestBone: "chest" },
      { id: "fur", name: "Fur", deformationVariance: 0.2, nearestBone: "chest" },
    ], allQuadrupedBones);
    assert.deepEqual(plan.entries.map((entry) => [entry.id, entry.operation]), [
      ["badge", "parent-attach"],
      ["fur", "skin"],
    ]);
  });
});

function passingManifest(jobId = "rig-1") {
  const selectivePlan = planSelectiveRigging(profile, [
    { id: "body", name: "Body" },
    { id: "collar", name: "Collar", nearestBone: "neck" },
  ], allQuadrupedBones);
  return buildRigValidationManifest({
    jobId,
    profile,
    availableBones: allQuadrupedBones,
    selectivePlan,
    stats: { boneCount: allQuadrupedBones.length, skinnedVerts: 12_000, rigidAttachments: 1, triangles: 24_000, bytes: 3_000_000 },
    evidence: {
      twistBoneCounts: { "front_leg_upper.L": 1, "front_leg_upper.R": 1 },
      neckJawAngleDegrees: 4,
      silhouetteDeviation: 0.012,
    },
  });
}

describe("deterministic validation manifest", () => {
  test("accepts complete evidence and conforms to the existing rig manifest shape", () => {
    const manifest = passingManifest();
    assert.equal(manifest.version, "1");
    assert.equal(manifest.state, "done");
    assert.equal(manifest.accepted, true);
    assert.deepEqual(manifest.validation.map((rule) => rule.rule), [
      "required_bone_contract", "rig_budget", "twist_bones_present", "neck_jaw_parallel",
      "silhouette_probe", "purlicue_alignment", "selective_rigging", "worker_execution",
    ]);
    assert.ok(manifest.validation.every((rule) => rule.pass));
  });

  test("fails closed with named reasons for absent evidence and budget overflow", () => {
    const plan = planSelectiveRigging(profile, [{ id: "body", name: "Body" }], allQuadrupedBones);
    const manifest = buildRigValidationManifest({
      jobId: "rig-fail",
      profile,
      availableBones: allQuadrupedBones,
      selectivePlan: plan,
      stats: { boneCount: 41, skinnedVerts: 100, rigidAttachments: 0 },
      evidence: {},
    });
    assert.equal(manifest.state, "needs_manual");
    assert.equal(manifest.accepted, false);
    assert.match(manifest.failureReasons.join("\n"), /rig_budget/);
    assert.match(manifest.failureReasons.join("\n"), /twist_bones_present/);
    assert.match(manifest.failureReasons.join("\n"), /neck_jaw_parallel/);
    assert.match(manifest.failureReasons.join("\n"), /silhouette_probe/);
  });

  test("is byte-for-byte deterministic for equivalent input", () => {
    assert.equal(JSON.stringify(passingManifest("same")), JSON.stringify(passingManifest("same")));
  });
});

describe("Phase 3 corpus acceptance metrics", () => {
  test("passes a ten-mesh corpus with eight complete manifests", () => {
    const good = passingManifest();
    const bad = { ...good, accepted: false, validation: good.validation.map((rule, index) => index === 0 ? { ...rule, pass: false } : rule) };
    const entries = Array.from({ length: 10 }, (_, index) => ({
      meshId: `mesh-${String(index + 1).padStart(2, "0")}`,
      manifest: index < 8 ? good : bad,
    }));
    const metrics = evaluateRiggingCorpusAcceptance(entries);
    assert.equal(metrics.pass, true);
    assert.equal(metrics.corpusSize, 10);
    assert.equal(metrics.acceptedMeshes, 8);
    assert.equal(metrics.acceptanceRate, 0.8);
  });

  test("rejects undersized and duplicate-inflated corpora", () => {
    const good = passingManifest();
    const entries = Array.from({ length: 9 }, (_, index) => ({ meshId: `mesh-${index}`, manifest: good }));
    entries.push({ meshId: "mesh-0", manifest: good });
    const metrics = evaluateRiggingCorpusAcceptance(entries);
    assert.equal(metrics.pass, false);
    assert.equal(metrics.corpusSize, 9);
    assert.match(metrics.failureReasons.join("\n"), /corpus_too_small/);
    assert.match(metrics.failureReasons.join("\n"), /duplicate_or_empty_mesh_id/);
  });
});
