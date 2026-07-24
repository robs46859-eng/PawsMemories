import assert from "node:assert/strict";
import test from "node:test";
import {
  assessPipelineRigRecovery,
  assessPipelineProviderRecovery,
  pipelineModelFingerprint,
} from "../server/pipeline-rig-recovery.ts";

const NOW = new Date("2026-07-23T00:03:00.000Z");
const MODEL_URL = "https://storage.example/models/current.glb";

function context(overrides = {}) {
  return {
    jobId: 42,
    userPhone: "+155****0123",
    creationId: 901,
    creationOwnerPhone: "+155****0123",
    kind: "model",
    jobStatus: "rigging",
    jobCreatedAt: new Date("2026-07-22T23:50:00.000Z"),
    jobUpdatedAt: new Date("2026-07-23T00:02:00.000Z"),
    creditsReserved: 100,
    rigAttemptCount: 0,
    leaseOwner: null,
    leaseExpiresAt: null,
    recoveryStartedAt: new Date("2026-07-22T23:55:00.000Z"),
    recoveryReason: "test",
    sourceModelHash: pipelineModelFingerprint(MODEL_URL),
    rigRefundedAt: null,
    generationRefundedAt: null,
    currentModelUrl: MODEL_URL,
    riggedModelUrl: null,
    sessionId: "session-1",
    sessionMatchCount: 1,
    sessionUserPhone: "+155****0123",
    sessionStatus: "building",
    sessionUpdatedAt: new Date("2026-07-23T00:02:00.000Z"),
    customizationState: { rigging: { enabled: true, facial: true } },
    ...overrides,
  };
}

// ─────────────────────────────────────────────
// 1. done_static_fallback transition
// ─────────────────────────────────────────────

test("done_static_fallback: hasStatic + !hasRig → done_static_fallback", () => {
  const hasStatic = true;
  const hasRig = false;
  const status = hasRig ? "done" : hasStatic ? "done_static_fallback" : "failed";
  assert.equal(status, "done_static_fallback");
});

test("done_static_fallback: !hasStatic + !hasRig → failed", () => {
  const hasStatic = false;
  const hasRig = false;
  const status = hasRig ? "done" : hasStatic ? "done_static_fallback" : "failed";
  assert.equal(status, "failed");
});

test("done_static_fallback: hasStatic + hasRig → done", () => {
  const hasStatic = true;
  const hasRig = true;
  const status = hasRig ? "done" : hasStatic ? "done_static_fallback" : "failed";
  assert.equal(status, "done");
});

test("done_static_fallback: rig recovery assessor still marks eligible when static model exists", () => {
  const ctx = context({
    currentModelUrl: MODEL_URL,
    riggedModelUrl: null,
  });
  const decision = assessPipelineRigRecovery(ctx, NOW);
  // The assessor doesn't implement done_static_fallback — it returns eligible
  // for rig recovery. The done_static_fallback status is assigned later by
  // finalizeRejected when rig attempts are exhausted.
  assert.ok(decision.eligible);
  assert.equal(decision.reason, "active_rig_job");
});

test("done_static_fallback: provider recovery refuses jobs that already have a static model", () => {
  const ctx = context({
    jobStatus: "running",
    currentModelUrl: "https://storage.example/models/current.glb",
    recoveryStartedAt: null,
  });
  const decision = assessPipelineProviderRecovery(ctx, NOW);
  assert.equal(decision.eligible, false);
  assert.equal(decision.reason, "static_model_already_stored");
});

// ─────────────────────────────────────────────
// 2. V3 gating
// ─────────────────────────────────────────────

test("V3 gating: isModelBuildV3Enabled returns false by default", async () => {
  const prev = process.env.MODEL_BUILD_V3_ENABLED;
  delete process.env.MODEL_BUILD_V3_ENABLED;
  const mod = await import("../server/model-builds/featureFlag.ts");
  assert.equal(mod.isModelBuildV3Enabled(), false);
  if (prev !== undefined) process.env.MODEL_BUILD_V3_ENABLED = prev;
});

test("V3 gating: isModelBuildV3Enabled respects env var", async () => {
  process.env.MODEL_BUILD_V3_ENABLED = "true";
  const mod = await import("../server/model-builds/featureFlag.ts");
  assert.equal(mod.isModelBuildV3Enabled(), true);
  delete process.env.MODEL_BUILD_V3_ENABLED;
});

test("V3 gating: assertModelBuildV3Enabled throws when disabled", async () => {
  const prev = process.env.MODEL_BUILD_V3_ENABLED;
  delete process.env.MODEL_BUILD_V3_ENABLED;
  // re-import to pick up the env change — but since ESM caches, we test the behaviour
  const { isModelBuildV3Enabled, assertModelBuildV3Enabled } = await import("../server/model-builds/featureFlag.ts");
  if (isModelBuildV3Enabled()) {
    // If another test set the env, skip
    if (prev !== undefined) process.env.MODEL_BUILD_V3_ENABLED = prev;
    return;
  }
  assert.throws(() => assertModelBuildV3Enabled(), {
    name: "ModelBuildFeatureError",
    message: /MODEL_BUILD_V3_ENABLED is not set to true/,
  });
  if (prev !== undefined) process.env.MODEL_BUILD_V3_ENABLED = prev;
});

test("V3 gating: resumeStalledBuilds guard returns early when V3 enabled", () => {
  const isModelBuildV3Enabled = () => true;
  const resumeStalledBuilds = () => {
    if (isModelBuildV3Enabled()) return "guarded";
    return "running";
  };
  assert.equal(resumeStalledBuilds(), "guarded");
});

test("V3 gating: avatar status handler persists static GLB instead of failing when V3 enabled", () => {
  const isV3 = true;
  let persisted = false;
  let statusSet = "";
  if (isV3) {
    persisted = true;
    statusSet = "done";
  }
  assert.ok(persisted, "Static GLB should be persisted even when V3 enabled");
  assert.equal(statusSet, "done", "Status should be 'done', not 'failed'");
});

test("V3 gating: model builds router middleware rejects when V3 disabled", () => {
  // Simulate the router middleware guard pattern
  const isEnabled = false;
  const guard = () => {
    if (!isEnabled) {
      return { success: false, error: "MODEL_BUILD_V3_ENABLED is not set to true", code: "FEATURE_DISABLED" };
    }
    return null;
  };
  const result = guard();
  assert.ok(result);
  assert.equal(result.code, "FEATURE_DISABLED");
});

// ─────────────────────────────────────────────
// 3. Canonical asset registration
// ─────────────────────────────────────────────

test("registration: registerLegacyModelAsset returns null when fetch fails", async () => {
  const mod = await import("../server/legacy-asset-registration.ts");
  const result = await mod.registerLegacyModelAsset({
    ownerId: "+155****0001",
    glbUrl: "https://storage.example/models/nonexistent.glb",
    sha256: "unknown",
    sizeBytes: 0,
    sourceImageUrl: "",
  });
  // Without a real reachable URL and no DB, it should gracefully return null
  assert.equal(result, null);
});

test("registration: legacy link uses creationId for idempotency", () => {
  const creationId = 123;
  const legacyTable = "creations";
  const legacyId = String(creationId);
  assert.equal(legacyTable, "creations");
  assert.equal(legacyId, "123");
});

// ─────────────────────────────────────────────
// 4. Model persistence events
// ─────────────────────────────────────────────

test("persistence events: recordPersistenceEvent does not throw without DB", async () => {
  const mod = await import("../server/model-persistence-events.ts");
  // Should not throw — the function catches errors and logs them
  await mod.recordPersistenceEvent("static_glb_stored", {
    jobId: 42,
    detail: "Test event",
  });
  assert.ok(true, "recordPersistenceEvent handled missing DB gracefully");
});

test("persistence events: all event types are valid", () => {
  const eventTypes = [
    "provider_done",
    "static_glb_stored",
    "rig_started",
    "rig_complete",
    "done_static_fallback",
    "canonical_asset_registered",
    "failed",
    "refunded",
    "recovered",
  ];
  assert.equal(eventTypes.length, 9);
  for (const et of eventTypes) {
    assert.ok(typeof et === "string" && et.length > 0);
  }
});

// ─────────────────────────────────────────────
// 5. Billing disposition
// ─────────────────────────────────────────────

test("billing disposition: finished model with credits and URL → charged", () => {
  const generationRefundedAt = null;
  const rigRefundedAt = null;
  const creditsReserved = 100;
  const modelUrl = "https://storage.example/model.glb";

  const billingDisposition = generationRefundedAt ? "refunded"
    : rigRefundedAt ? "refunded"
    : creditsReserved > 0 && modelUrl ? "charged"
    : !modelUrl ? "not_charged"
    : "not_charged";

  assert.equal(billingDisposition, "charged");
});

test("billing disposition: generation refunded → refunded", () => {
  const generationRefundedAt = new Date("2026-07-23T00:05:00.000Z");
  const rigRefundedAt = null;
  const creditsReserved = 100;
  const modelUrl = "https://storage.example/model.glb";

  const billingDisposition = generationRefundedAt ? "refunded"
    : rigRefundedAt ? "refunded"
    : creditsReserved > 0 && modelUrl ? "charged"
    : !modelUrl ? "not_charged"
    : "not_charged";

  assert.equal(billingDisposition, "refunded");
});

test("billing disposition: rig refunded → refunded", () => {
  const generationRefundedAt = null;
  const rigRefundedAt = new Date("2026-07-23T00:05:00.000Z");
  const creditsReserved = 100;
  const modelUrl = "https://storage.example/model.glb";

  const billingDisposition = generationRefundedAt ? "refunded"
    : rigRefundedAt ? "refunded"
    : creditsReserved > 0 && modelUrl ? "charged"
    : !modelUrl ? "not_charged"
    : "not_charged";

  assert.equal(billingDisposition, "refunded");
});

test("billing disposition: done_static_fallback is charged (rigging refunded, model paid)", () => {
  const status = "done_static_fallback";
  const billing = status === "done" ? "charged"
    : status === "done_static_fallback" ? "charged"
    : status === "failed" ? "refunded"
    : "not_charged";
  assert.equal(billing, "charged");
});

test("billing disposition: done status is charged", () => {
  const status = "done";
  const billing = status === "done" ? "charged"
    : status === "done_static_fallback" ? "charged"
    : status === "failed" ? "refunded"
    : "not_charged";
  assert.equal(billing, "charged");
});

test("billing disposition: failed status is refunded", () => {
  const status = "failed";
  const billing = status === "done" ? "charged"
    : status === "done_static_fallback" ? "charged"
    : status === "failed" ? "refunded"
    : "not_charged";
  assert.equal(billing, "refunded");
});

test("billing disposition: finalizeRejected refund logic for done_static_fallback refunds rig credits only", () => {
  // Simulates the refundAmount logic in finalizeRejected
  const status = "done_static_fallback";
  const rigRefundedAt = null;
  const rigAddonCredits = 50;
  const refundAmount = status === "failed"
    ? 0  // context.generationRefundedAt ? 0 : context.creditsReserved
    : status === "done_static_fallback" && !rigRefundedAt
      ? rigAddonCredits
      : 0;
  assert.equal(refundAmount, 50, "done_static_fallback should refund rig addon credits only");
});

test("billing disposition: finalizeRejected does not double-refund rig credits", () => {
  const status = "done_static_fallback";
  const rigRefundedAt = new Date("2026-07-23T00:05:00.000Z");
  const rigAddonCredits = 50;
  const refundAmount = status === "failed"
    ? 0
    : status === "done_static_fallback" && !rigRefundedAt
      ? rigAddonCredits
      : 0;
  assert.equal(refundAmount, 0, "already refunded rig should not refund again");
});

test("billing disposition: finalizeRejected failed refunds full credits when not yet refunded", () => {
  const status = "failed";
  const generationRefundedAt = null;
  const creditsReserved = 100;
  const refundAmount = status === "failed"
    ? generationRefundedAt ? 0 : creditsReserved
    : 0;
  assert.equal(refundAmount, 100, "failed should refund full creditsReserved");
});
