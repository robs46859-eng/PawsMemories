import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyModel,
  validateRigGeometry,
  inventoryFacialMorphs,
  validateAccessoryFit,
} from "../server/rig-pipeline/validation.ts";

test("Phase 4 Validation Logic Suite", async (t) => {
  await t.test("classifyModel correctly classifies biped, quadruped, and unsupported", () => {
    const quad = classifyModel({
      triangleCount: 30000,
      boundingVolume: { x: 0.8, y: 0.5, z: 1.2 },
      subjectClass: "dog",
    });
    assert.equal(quad.classification, "quadruped");
    assert.equal(quad.selectedProfileId, "quadruped.dog.medium");

    const biped = classifyModel({
      triangleCount: 50000,
      boundingVolume: { x: 0.5, y: 1.7, z: 0.3 },
      subjectClass: "human",
    });
    assert.equal(biped.classification, "biped");
    assert.equal(biped.selectedProfileId, "biped.human.canonical");

    const staticObj = classifyModel({
      triangleCount: 10000,
      boundingVolume: { x: 0.4, y: 0.4, z: 0.4 },
      subjectClass: "chair",
    });
    assert.equal(staticObj.classification, "unsupported");
  });

  await t.test("validateRigGeometry checks bone count, influences, and mobile budgets", () => {
    const validMetrics = {
      boneCount: 32,
      jointCount: 32,
      skinnedVertexCount: 12000,
      maxInfluencesPerVertex: 3,
      unweightedIslands: 0,
      bindMatrixValid: true,
      animationSweepPass: true,
      silhouetteDeviation: 0.002,
      triangleCount: 40000,
      textureMaxDimension: 2048,
      boneNames: ["root", "spine", "head"],
    };

    const { report, metricsHash } = validateRigGeometry(validMetrics);
    assert.equal(report.mobileBudgetPass, true);
    assert.equal(report.maxInfluences, 3);
    assert.equal(report.unweightedIslands, 0);
    assert.equal(report.rules.every((r) => r.pass), true);
    assert.equal(metricsHash.length, 64);

    const badMetrics = {
      ...validMetrics,
      maxInfluencesPerVertex: 5, // exceeds limit of 4
      unweightedIslands: 2,
    };

    const badRes = validateRigGeometry(badMetrics);
    assert.equal(badRes.report.rules.find((r) => r.rule === "vertex_skin_influences")?.pass, false);
    assert.equal(badRes.report.rules.find((r) => r.rule === "no_unweighted_islands")?.pass, false);
  });

  await t.test("inventoryFacialMorphs maps canonical visemes and computes capability", () => {
    const fullFacial = inventoryFacialMorphs(
      ["viseme_a", "viseme_b", "viseme_c", "viseme_d", "viseme_e", "viseme_f", "viseme_g", "viseme_h", "viseme_x", "blink", "jaw_open"],
      { deformationPass: true },
    );
    assert.equal(fullFacial.capability, "full");
    assert.equal(fullFacial.visemeCoverage, 1.0);
    assert.equal(fullFacial.hasBlink, true);

    const bodyOnly = inventoryFacialMorphs([]);
    assert.equal(bodyOnly.capability, "body_only");
    assert.equal(bodyOnly.morphCount, 0);

    const unverified = inventoryFacialMorphs(["viseme_a", "jaw_open"]);
    assert.equal(unverified.capability, "unsupported");
    assert.equal(unverified.deformationPass, false);
  });

  await t.test("validateAccessoryFit evaluates attachment, clearance, and budgets", () => {
    const fit = validateAccessoryFit({
      targetBone: "head",
      availableBones: ["root", "spine", "head"],
      transform: { position: [0, 0.1, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
      accessoryTriangleCount: 1500,
      floatingDistance: 0.002,
      penetrationDepth: 0.001,
      animationSweepPass: true,
      printClearanceMm: 0.8,
    });
    assert.equal(fit.attachmentBone, "head");
    assert.equal(fit.polygonBudgetPass, true);
    assert.equal(fit.floatingDistance < 0.01, true);
  });
});
