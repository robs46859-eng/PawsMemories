// Durable jobs replace the existing BIM v2 execution path; they do not create a third product lane.
export const DURABLE_BIM_V2_FEATURE_FLAG = "BIM_V2_ENABLED";

export function isDurableBimV2Enabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env[DURABLE_BIM_V2_FEATURE_FLAG]?.trim().toLowerCase();
  return value === "true";
}
