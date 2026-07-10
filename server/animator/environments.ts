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

export function loadEnvironments(): EnvironmentPreset[] {
  if (_cachedEnvironments) return _cachedEnvironments;
  
  const envDir = path.join(process.cwd(), "server", "animator", "environments");
  if (!fs.existsSync(envDir)) {
    fs.mkdirSync(envDir, { recursive: true });
    return [];
  }
  
  const files = fs.readdirSync(envDir).filter(f => f.endsWith(".json"));
  const presets: EnvironmentPreset[] = [];
  
  for (const f of files) {
    const p = path.join(envDir, f);
    const content = fs.readFileSync(p, "utf8");
    try {
      const parsed = JSON.parse(content);
      const preset = EnvironmentPresetSchema.parse(parsed);
      presets.push(preset);
    } catch (err) {
      console.error(`Failed to parse environment preset ${f}:`, err);
    }
  }
  
  // Sort: basic first, then generic, then hdri
  const tierOrder = { basic: 1, generic: 2, hdri: 3 };
  presets.sort((a, b) => tierOrder[a.tier] - tierOrder[b.tier]);
  
  _cachedEnvironments = presets;
  return presets;
}
