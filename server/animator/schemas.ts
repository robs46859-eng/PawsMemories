/**
 * §12 data-contract zod schemas — version-checked, typed, never leaves `undefined` reads.
 *
 * Conventions:
 *  • Every schema is version-gated (`.extend({ version: z.literal("1") })`).
 *  • A parse helper returns `null` on unknown version so callers degrade gracefully.
 *  • Consumers must always use the `infer` type from the schema, never raw JSON.
 */
import { z } from "zod";

// ──────────────────────────────────────────────────────────────────
// BoneDefinitionProfile v1  (§4.1)
// ──────────────────────────────────────────────────────────────────

export const BoneDefinitionProfileV1 = z.object({
  id: z.string(),
  skeleton: z.enum(["quadruped", "biped", "winged"]),
  version: z.literal("1"),
  joints: z.record(z.tuple([z.number(), z.number(), z.number()])),
  twistBones: z.record(z.number()).optional(),                      // bone → count
  boneMask: z.array(z.string()).optional().default([] as const),
  rigidAttachments: z.array(z.string()).optional().default([] as const), // mesh-name globs
  physics: z
    .array(
      z.object({
        bones: z.array(z.string()),
        type: z.enum(["spring"]),
        stiffness: z.number(),
        damping: z.number(),
        gravity: z.number().optional().default(9.81),
      })
    )
    .optional()
    .default([]),
});

export type BoneDefinitionProfile = z.infer<typeof BoneDefinitionProfileV1>;

/**
 * Parse a BoneDefinitionProfile with version gate.
 * Returns `null` when `version` is missing or unrecognised — caller must degrade gracefully.
 */
export function parseBoneDefinitionProfile(raw: unknown): BoneDefinitionProfile | null {
  const obj = raw as Record<string, unknown>;
  if (!obj || typeof obj !== "object") return null;
  const version = obj.version;
  // Unknown version → reject per spec §12
  if (version === 1 || version === "1") {
    return BoneDefinitionProfileV1.parse(raw);
  }
  return null;
}

// ──────────────────────────────────────────────────────────────────
// VisemeTrack v1  (§5.3)
// ──────────────────────────────────────────────────────────────────

export const VisemeCueSchema = z.object({
  t: z.number(),   // seconds
  v: z.enum([
    "A", "B", "C", "D", "E", "F", "G", "H", "X",
  ]),
});

export const VisemeTrackV1 = z.object({
  version: z.literal("1"),
  fps: z.number(),
  source: z.enum(["rhubarb", "mfcc", "provider"]),
  audioUrl: z.string().optional(),
  durationSec: z.number(),
  cues: z.array(VisemeCueSchema),
  anticipationSec: z.number().optional().default(0.07),
});

export type VisemeTrack = z.infer<typeof VisemeTrackV1>;

/**
 * Parse a VisemeTrack with version gate. Returns `null` on unknown version.
 */
export function parseVisemeTrack(raw: unknown): VisemeTrack | null {
  const obj = raw as Record<string, unknown>;
  if (!obj || typeof obj !== "object") return null;
  const version = obj.version;
  if (version === 1 || version === "1") {
    return VisemeTrackV1.parse(raw);
  }
  return null;
}

// ──────────────────────────────────────────────────────────────────
// Rig Job Manifest  (§12 item 3)
// ──────────────────────────────────────────────────────────────────

export const RigValidationRuleSchema = z.object({
  rule: z.string(),  // e.g. "twist_bones_present"
  pass: z.boolean(),
  detail: z.string(),
});

export const RigManifestV1 = z.object({
  version: z.literal("1"),
  jobId: z.string(),
  state: z.enum(["pending", "running", "done", "failed", "needs_manual"]),
  profileId: z.string(),
  validation: z.array(RigValidationRuleSchema),
  stats: z.object({
    boneCount: z.number(),
    skinnedVerts: z.number(),
    rigidAttachments: z.number(),
  }),
});

export type RigManifest = z.infer<typeof RigManifestV1>;

export function parseRigManifest(raw: unknown): RigManifest | null {
  const obj = raw as Record<string, unknown>;
  if (!obj || typeof obj !== "object") return null;
  const version = obj.version;
  if (version === 1 || version === "1") {
    return RigManifestV1.parse(raw);
  }
  return null;
}

// ──────────────────────────────────────────────────────────────────
// LOD Manifest  (§12 item 4)
// ──────────────────────────────────────────────────────────────────

export const LodEntrySchema = z.object({
  level: z.number(),       // 0 = source, 1..3 = simplified
  triangles: z.number(),
  maxQuadricError: z.number(),
  sizeBytes: z.number(),
  url: z.string(),
});

export const LodManifestV1 = z.object({
  version: z.literal("1"),
  lods: z.array(LodEntrySchema),
});

export type LodManifest = z.infer<typeof LodManifestV1>;

export function parseLodManifest(raw: unknown): LodManifest | null {
  const obj = raw as Record<string, unknown>;
  if (!obj || typeof obj !== "object") return null;
  const version = obj.version;
  if (version === 1 || version === "1") {
    return LodManifestV1.parse(raw);
  }
  return null;
}

// ──────────────────────────────────────────────────────────────────
// AnimationSet v2  (§12 item 5, §6.6)
// ──────────────────────────────────────────────────────────────────

export const AnimationTransitionSchema = z.object({
  from: z.string(),
  to: z.string(),
  fadeSec: z.number(),
  condition: z.string().optional(),  // e.g. "speed > 0.5"
});

export const AnimationSetV2 = z.object({
  version: z.literal("1"),
  type: z.enum(["quadruped", "biped", "winged"]),
  expectedClips: z.array(z.string()),
  transitions: z.array(AnimationTransitionSchema).optional().default([] as const),
  layers: z.record(z.enum(["L0", "L1", "L2", "L3"])).optional().default(() => ({})),
  masks: z.record(z.array(z.string())).optional().default(() => ({})),
  phaseMarkers: z.record(z.array(z.number())).optional().default(() => ({})),
});

export type AnimationSetV2 = z.infer<typeof AnimationSetV2>;

export function parseAnimationSetV2(raw: unknown): AnimationSetV2 | null {
  const obj = raw as Record<string, unknown>;
  if (!obj || typeof obj !== "object") return null;
  const version = obj.version;
  if (version === 1 || version === "1") {
    return AnimationSetV2.parse(raw);
  }
  return null;
}
