import fs from "fs";
import path from "path";
import { z } from "zod";
import { resolveWithinWorkspace } from "./paths.ts";

export const EnvironmentPresetSchema = z.object({
  id: z.string(),
  tier: z.enum(["basic", "generic", "hdri"]),
  label: z.string(),
  backdrop: z.object({
    kind: z.enum(["hdri", "dome360", "image", "glb-scene", "procedural"]),
    url: z.string().optional(), // procedural doesn't need url
  }),
  ground: z.object({
    color: z.string().optional(),
    opacity: z.number().optional(),
  }).optional(),
  allowedWeather: z.array(z.enum(["clear", "rain", "snow", "fog", "overcast"])),
  ambientSound: z.string().optional(),
  defaultTimeOfDay: z.enum(["morning", "afternoon", "evening", "night"]),
  cameraStart: z.object({
    position: z.tuple([z.number(), z.number(), z.number()]),
    target: z.tuple([z.number(), z.number(), z.number()]),
  }).optional(),
  license: z.enum(["CC0", "owned", "generated"]),
  source: z.string(),
  sourceUrl: z.string().optional(),
});

export type EnvironmentPreset = z.infer<typeof EnvironmentPresetSchema>;

let _cachedEnvironments: EnvironmentPreset[] | null = null;

/**
 * Guaranteed-safe fallback so the studio toolbar is NEVER empty, even if the
 * preset directory can't be resolved at runtime (e.g. the Hostinger cwd differs
 * from the source root). `procedural` needs no asset, so it always renders.
 */
const DEFAULT_ENVIRONMENTS: EnvironmentPreset[] = [
  {
    id: "procedural-studio",
    tier: "basic",
    label: "Clean Studio",
    backdrop: { kind: "procedural" },
    allowedWeather: ["clear"],
    defaultTimeOfDay: "afternoon",
    license: "generated",
    source: "Built-in procedural fallback",
  },
];

/**
 * Candidate directories to search for the preset JSON. `process.cwd()` is the
 * primary (matches how the app is normally launched), with module-relative
 * fallbacks for deploys where the runtime cwd isn't the source root.
 */
function candidateEnvDirs(): string[] {
  const dirs = [path.join(process.cwd(), "server", "animator", "environments")];
  // `__dirname` exists in the esbuild CJS bundle; guard with typeof so the ESM
  // (tsx) dev path doesn't throw a ReferenceError.
  if (typeof __dirname !== "undefined") {
    dirs.push(path.join(__dirname, "environments"));
    dirs.push(path.join(__dirname, "server", "animator", "environments"));
  }
  return dirs;
}

export function loadEnvironments(): EnvironmentPreset[] {
  if (_cachedEnvironments) return _cachedEnvironments;

  const envDir = candidateEnvDirs().find(
    (d) => fs.existsSync(d) && fs.readdirSync(d).some((f) => f.endsWith(".json"))
  );

  if (!envDir) {
    console.warn(
      "[environments] No preset directory found; serving built-in defaults. Looked in:",
      candidateEnvDirs().join(", ")
    );
    _cachedEnvironments = DEFAULT_ENVIRONMENTS;
    return _cachedEnvironments;
  }

  const files = fs.readdirSync(envDir).filter((f) => f.endsWith(".json"));
  const presets: EnvironmentPreset[] = [];

  for (const f of files) {
    const p = path.join(envDir, f);
    try {
      const parsed = JSON.parse(fs.readFileSync(p, "utf8"));
      presets.push(EnvironmentPresetSchema.parse(parsed));
    } catch (err) {
      console.error(`Failed to parse environment preset ${f}:`, err);
    }
  }

  // Sort: basic first, then generic, then hdri
  const tierOrder = { basic: 1, generic: 2, hdri: 3 };
  presets.sort((a, b) => tierOrder[a.tier] - tierOrder[b.tier]);

  // If every file failed to parse, still return something usable.
  _cachedEnvironments = presets.length > 0 ? presets : DEFAULT_ENVIRONMENTS;
  console.log(`[environments] Loaded ${_cachedEnvironments.length} preset(s) from ${envDir}`);
  return _cachedEnvironments;
}
