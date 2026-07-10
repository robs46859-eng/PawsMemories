/**
 * server/subjectProfiles.ts — turns the triage classification (avatarPrompts +
 * imageTriage) into concrete BUILD-STAGE decisions.
 *
 * The generator's "brain" now detects not just human|dog|object but, for objects,
 * WHICH kind (structure/prop/plant/food/part/blueprint) and, for humans, an
 * anatomy audit. This module is the single place that maps those facts to how
 * the pipeline should treat the mesh:
 *   - objectBuildProfile(): placement/orientation hints + whether the subject is
 *     even reconstructable (a blueprint is a 2D drawing, not a 3D thing).
 *   - humanRigHints(): whether the figure is anatomically canonical and safe to
 *     articulate (e.g. finger rigging), plus any anomalies to surface.
 *
 * Pure functions, no I/O — unit-tested in tests/subject_profiles.test.mjs.
 */

export type ObjectCategory =
  | "structure"
  | "prop"
  | "plant"
  | "food"
  | "part"
  | "blueprint"
  | "none";

/** How the build/placement layer should treat a static object. */
export interface ObjectProfile {
  category: ObjectCategory;
  label: string;
  /** False → the subject is not a real 3D object (blueprint); do not build it. */
  reconstructable: boolean;
  /** True → a character can go INSIDE it (habitable structure). */
  enterable: boolean;
  /** True → the mesh has a natural upright resting orientation to preserve. */
  keepUpright: boolean;
  /** Recommended default placement surface in the AR/3D scene. */
  placement: "ground" | "surface" | "wall" | "held";
  /** Objects are never skeletally rigged. */
  rig: "none";
  /** Why it can't be built, when reconstructable is false. */
  reason?: string;
}

const OBJECT_PROFILES: Record<ObjectCategory, ObjectProfile> = {
  structure: { category: "structure", label: "habitable structure", reconstructable: true, enterable: true, keepUpright: true, placement: "ground", rig: "none" },
  prop: { category: "prop", label: "usable prop", reconstructable: true, enterable: false, keepUpright: true, placement: "ground", rig: "none" },
  plant: { category: "plant", label: "plant", reconstructable: true, enterable: false, keepUpright: true, placement: "ground", rig: "none" },
  food: { category: "food", label: "food", reconstructable: true, enterable: false, keepUpright: true, placement: "surface", rig: "none" },
  part: { category: "part", label: "component part", reconstructable: true, enterable: false, keepUpright: false, placement: "surface", rig: "none" },
  blueprint: { category: "blueprint", label: "blueprint / plan", reconstructable: false, enterable: false, keepUpright: false, placement: "wall", rig: "none", reason: "This looks like a 2D blueprint or plan, not a physical object. Upload a photo of the actual object to build it in 3D." },
  none: { category: "none", label: "object", reconstructable: true, enterable: false, keepUpright: true, placement: "ground", rig: "none" },
};

/** Normalize any string (incl. unknown/legacy) to a known ObjectCategory. */
export function normalizeObjectCategory(raw: unknown): ObjectCategory {
  const c = String(raw ?? "").toLowerCase().trim();
  return (c in OBJECT_PROFILES ? c : "none") as ObjectCategory;
}

/** Build-stage profile for a static object, given its detected sub-category. */
export function objectBuildProfile(raw: unknown): ObjectProfile {
  return OBJECT_PROFILES[normalizeObjectCategory(raw)];
}

// ─── Humans ─────────────────────────────────────────────────────────────────

export interface HumanAnatomy {
  eyeCount: number;
  earCount: number;
  nostrilCount: number;
  limbCount: number;
  fingersPerHand: number;
  anomalies: string[];
}

/** Canonical adult human counts — the reference the audit compares against. */
export const CANONICAL_HUMAN: HumanAnatomy = {
  eyeCount: 2, earCount: 2, nostrilCount: 2, limbCount: 4, fingersPerHand: 5, anomalies: [],
};

export interface HumanRigHints {
  /** All counts match the canonical human and no anomalies were reported. */
  canonical: boolean;
  /** Safe to attempt finger articulation (exactly five fingers, no anomalies). */
  fingerRig: boolean;
  /** Human-readable deviations from the canonical figure. */
  anomalies: string[];
}

function num(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Audit a (possibly partial / missing) humanAnatomy record and decide how the
 * rig stage should treat it. Missing fields default to canonical so a subject
 * the vision model didn't fully measure is treated as normal, not broken.
 */
export function humanRigHints(a?: Partial<HumanAnatomy> | null): HumanRigHints {
  const eyeCount = num(a?.eyeCount, 2);
  const earCount = num(a?.earCount, 2);
  const nostrilCount = num(a?.nostrilCount, 2);
  const limbCount = num(a?.limbCount, 4);
  const fingersPerHand = num(a?.fingersPerHand, 5);
  const reported = Array.isArray(a?.anomalies) ? a!.anomalies!.filter(Boolean).map(String) : [];

  const anomalies = [...reported];
  if (eyeCount !== 2) anomalies.push(`eye count ${eyeCount} (expected 2)`);
  if (earCount !== 2) anomalies.push(`ear count ${earCount} (expected 2)`);
  if (nostrilCount !== 2) anomalies.push(`nostril count ${nostrilCount} (expected 2)`);
  if (limbCount !== 4) anomalies.push(`limb count ${limbCount} (expected 4)`);
  if (fingersPerHand !== 5) anomalies.push(`fingers-per-hand ${fingersPerHand} (expected 5)`);

  const canonical = anomalies.length === 0;
  return {
    canonical,
    fingerRig: fingersPerHand === 5 && reported.length === 0,
    anomalies,
  };
}
