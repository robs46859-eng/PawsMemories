// ─── Phase 4 Feature Flag ───────────────────────────────────────────────────
// Server-authoritative, default-off. Controls rig pipeline, facial inventory,
// and accessory fitting endpoints. Independent of MODEL_BUILD_V3_ENABLED.

export function isRigPipelineV4Enabled(): boolean {
  return process.env.RIG_PIPELINE_V4_ENABLED === "true";
}

export function assertRigPipelineV4Enabled(): void {
  if (!isRigPipelineV4Enabled()) {
    throw Object.assign(new Error("Rig pipeline is not enabled"), { code: "FEATURE_DISABLED" });
  }
}
