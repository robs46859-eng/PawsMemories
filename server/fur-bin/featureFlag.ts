// ─── Phase 5 Feature Flag ───────────────────────────────────────────────────
// Server-authoritative, default-off. Controls Fur Bin V5 canonical library & showcase.

export function isFurBinV5Enabled(): boolean {
  return process.env.FUR_BIN_V5_ENABLED === "true";
}

export function assertFurBinV5Enabled(): void {
  if (!isFurBinV5Enabled()) {
    throw Object.assign(new Error("Fur Bin V5 showcase is not enabled"), { code: "FEATURE_DISABLED" });
  }
}
