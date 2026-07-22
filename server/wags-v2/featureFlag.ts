export function isWagsV2Enabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.WAGS_V2_ENABLED === "true";
}

export function assertWagsV2Enabled(env: NodeJS.ProcessEnv = process.env): void {
  if (!isWagsV2Enabled(env)) {
    throw new Error("Wags v2 is disabled.");
  }
}
