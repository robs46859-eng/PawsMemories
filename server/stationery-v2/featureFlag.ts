export const STATIONERY_V2_FEATURE_FLAG = "STATIONERY_V2_ENABLED";

export function isStationeryV2Enabled(environment: NodeJS.ProcessEnv = process.env): boolean {
  return environment[STATIONERY_V2_FEATURE_FLAG]?.trim().toLowerCase() === "true";
}

export function assertStationeryV2Enabled(environment: NodeJS.ProcessEnv = process.env): void {
  if (!isStationeryV2Enabled(environment)) {
    throw new StationeryFeatureDisabledError();
  }
}

export class StationeryFeatureDisabledError extends Error {
  readonly code = "FEATURE_DISABLED";

  constructor() {
    super("Stationery v2 is not enabled.");
    this.name = "StationeryFeatureDisabledError";
  }
}
