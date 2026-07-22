export function isBimV2Enabled(): boolean {
  return String(process.env.BIM_V2_ENABLED || "").toLowerCase() === "true";
}
