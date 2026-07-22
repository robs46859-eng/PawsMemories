import fs from "node:fs";
import { CURRENT_SCHEMA_VERSION } from "./migrations/runner";
import { validateReleaseManifest } from "../scripts/release-manifest-lib.mjs";

export interface ReleaseManifest {
  commit: string;
  branch: string;
  builtAt: string;
  schemaVersion: number;
  nodeVersion: string;
  npmVersion: string;
  engineCompatible: true;
  dirty: boolean;
  checksums: Record<string, string>;
}

export function loadReleaseManifest(
  candidatePaths: string[],
  options: { production?: boolean } = {},
): ReleaseManifest | null {
  const errors: string[] = [];
  for (const candidate of candidatePaths) {
    if (!fs.existsSync(candidate)) continue;
    try {
      const parsed = JSON.parse(fs.readFileSync(candidate, "utf8"));
      const validation = validateReleaseManifest(parsed, {
        expectedSchemaVersion: CURRENT_SCHEMA_VERSION,
        requireClean: options.production === true,
      });
      if (!validation.valid) {
        errors.push(`${candidate}: ${validation.error}`);
        continue;
      }
      return parsed as ReleaseManifest;
    } catch (error) {
      errors.push(`${candidate}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (options.production) {
    const detail = errors.length ? errors.join("; ") : "no candidate manifest exists";
    throw new Error(`No valid production release manifest: ${detail}`);
  }
  return null;
}
