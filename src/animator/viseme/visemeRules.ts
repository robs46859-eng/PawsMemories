/**
 * visemeRules.ts — Pure, dependency-free VisemeTrack rules.
 *
 * Used by: server-side Rhubarb normalizer, the client LipSyncPlayer, and
 * the node:test suite. Contains NO DOM, THREE, or Node imports so it can be
 * bundled into either side and unit-tested in isolation.
 *
 * Implements ANIM-LIP-02 (VisemeTrack post-processor + transition-rule linter)
 * and the §5.1 viseme standard.
 */

/** The nine Preston-Blair / Hanna-Barbera mouth shapes we normalize to. */
export const VISEME_SHAPES = ["A", "B", "C", "D", "E", "F", "G", "H", "X"] as const;
export type VisemeShape = (typeof VISEME_SHAPES)[number];

const SHAPE_SET = new Set<string>(VISEME_SHAPES);

/** Number of frames of anticipation applied to every cue onset (§5.1 rule 3). */
export const ANTICIPATION_FRAMES = 2;

/**
 * Mouth-openness metric (0 = closed, 1 = wide open). Used by the bone-only
 * fallback driver and by the linter's "E must not be wider than C" check.
 * Defined so that openness(E) < openness(C) always holds.
 */
export const VISEME_OPENNESS: Record<VisemeShape, number> = {
  X: 0.0, // relaxed closed, no lip pressure
  A: 0.0, // closed, firm lip pressure
  B: 0.15, // slightly open, teeth clenched
  G: 0.25, // upper teeth on lower lip
  F: 0.3, // puckered pinch (small opening)
  E: 0.35, // slightly rounded
  C: 0.55, // open neutral
  H: 0.65, // open w/ raised tongue
  D: 1.0, // wide open
};

/** A single raw or processed viseme cue. */
export interface VisemeCue {
  /** Onset time in seconds (>= 0). */
  t: number;
  /** Mouth shape. */
  v: VisemeShape;
}

/** A normalized VisemeTrack v1 (matches server/animator/schemas.ts). */
export interface VisemeTrack {
  version: 1;
  fps: number;
  source: "rhubarb" | "mfcc" | "provider";
  audioUrl?: string;
  durationSec: number;
  cues: VisemeCue[];
  anticipationSec: number;
}

/** Post-processor version — part of the cache key so rule changes bust cache. */
export const VISEME_POST_PROCESSOR_VERSION = "1.0.0";

// ──────────────────────────────────────────────────────────────────────
// Errors
// ──────────────────────────────────────────────────────────────────────

export class VisemeValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VisemeValidationError";
  }
}

export class VisemeRuleError extends Error {
  constructor(
    message: string,
    public readonly violations: VisemeViolation[],
  ) {
    super(message);
    this.name = "VisemeRuleError";
  }
}

export type VisemeViolationRule = "A_TO_D" | "C_TO_F" | "E_NO_C_NEIGHBOR" | "E_WIDER_THAN_C";

export interface VisemeViolation {
  rule: VisemeViolationRule;
  index: number;
  detail: string;
}

// ──────────────────────────────────────────────────────────────────────
// Input validation
// ──────────────────────────────────────────────────────────────────────

function assertShape(v: unknown, where: string): VisemeShape {
  if (typeof v !== "string" || !SHAPE_SET.has(v)) {
    throw new VisemeValidationError(`Unknown viseme shape ${JSON.stringify(v)} at ${where}`);
  }
  return v as VisemeShape;
}

function assertTime(t: unknown, where: string): number {
  if (typeof t !== "number" || !Number.isFinite(t)) {
    throw new VisemeValidationError(`Non-finite timestamp ${JSON.stringify(t)} at ${where}`);
  }
  if (t < 0) {
    throw new VisemeValidationError(`Negative timestamp ${t} at ${where}`);
  }
  return t;
}

// ──────────────────────────────────────────────────────────────────────
// Rhubarb JSON → raw cues
// ──────────────────────────────────────────────────────────────────────

/** Rhubarb's mouth-cue output shape. */
export interface RhubarbMouthCue {
  start: number;
  end: number;
  value: string;
}

export interface RhubarbJson {
  mouthCues?: RhubarbMouthCue[];
}

/** Convert Rhubarb JSON output into raw cue objects (one cue per mouthCue at its start). */
export function rhubarbJsonToRawCues(json: RhubarbJson): VisemeCue[] {
  if (!json || !Array.isArray(json.mouthCues)) {
    throw new VisemeValidationError("Rhubarb JSON missing 'mouthCues' array");
  }
  return json.mouthCues.map((cue, i) => ({
    t: assertTime(cue.start, `mouthCue[${i}].start`),
    v: assertShape(cue.value, `mouthCue[${i}].value`),
  }));
}

// ──────────────────────────────────────────────────────────────────────
// Post-processor (ANIM-LIP-02)
// ──────────────────────────────────────────────────────────────────────

export interface PostProcessOptions {
  fps: number;
  source?: VisemeTrack["source"];
  durationSec?: number;
  audioUrl?: string;
  /** Override anticipation (seconds). Defaults to ANTICIPATION_FRAMES / fps. */
  anticipationSec?: number;
  /** If false, skip the linter hard-fail at the end (used by tests). Default true. */
  enforceLint?: boolean;
}

/**
 * Normalize a set of raw cues into a validated VisemeTrack v1.
 *
 * Steps: validate → sort & dedupe → anticipation shift (clamp t>=0) →
 * sub-frame merge → transition bridges (A→D inserts C, C→F inserts E) →
 * linter gate.
 *
 * Never mutates caller-owned input (operates on a deep copy).
 */
export function postProcessVisemeTrack(
  rawCues: VisemeCue[],
  opts: PostProcessOptions,
): VisemeTrack {
  if (!Array.isArray(rawCues)) {
    throw new VisemeValidationError("cues must be an array");
  }
  const fps = opts.fps;
  if (!Number.isFinite(fps) || fps <= 0) {
    throw new VisemeValidationError(`Invalid fps ${fps}`);
  }
  const anticipationSec = opts.anticipationSec ?? ANTICIPATION_FRAMES / fps;
  const frameDur = 1 / fps;

  // 1. Validate + copy (preserve original input order via `i`).
  const working: { t: number; v: VisemeShape; i: number }[] = rawCues.map((c, i) => ({
    t: assertTime(c.t, `cue[${i}].t`),
    v: assertShape(c.v, `cue[${i}].v`),
    i,
  }));

  // 2. Sort by time, then by input order (stable, deterministic).
  working.sort((a, b) => (a.t !== b.t ? a.t - b.t : a.i - b.i));

  // 3. Resolve duplicate timestamps: keep the latest (highest input index).
  const deduped: { t: number; v: VisemeShape; i: number }[] = [];
  for (const cue of working) {
    const last = deduped[deduped.length - 1];
    if (last && last.t === cue.t) {
      deduped[deduped.length - 1] = cue; // keep the more-recent cue
    } else {
      deduped.push(cue);
    }
  }

  // 4. Anticipation shift: every cue ~2 frames earlier; clamp to t >= 0.
  let cues = deduped.map((c) => ({
    t: Math.max(0, c.t - anticipationSec),
    v: c.v,
  }));

  // 5. Merge sub-frame cues into neighbors.
  cues = mergeSubFrameCues(cues, frameDur);

  // 6. Transition bridges. Do not run the sub-frame merger after this step:
  // bridges intentionally live between two source cues and can therefore be
  // less than one frame wide. Re-merging here used to delete the C/E bridge
  // that the linter requires, degrading valid Rhubarb output to audio-only.
  cues = insertTransitionBridges(cues);
  cues = ensureStandaloneEHasCNeighbor(cues, frameDur);

  const durationSec =
    opts.durationSec !== undefined
      ? opts.durationSec
      : cues.length
        ? cues[cues.length - 1].t
        : 0;

  const track: VisemeTrack = {
    version: 1,
    fps,
    source: opts.source ?? "rhubarb",
    audioUrl: opts.audioUrl,
    durationSec: Math.max(0, durationSec),
    cues,
    anticipationSec,
  };

  // 8. Linter gate — any remaining violation is a hard fail.
  if (opts.enforceLint !== false) {
    const result = lintVisemeTrack(track);
    if (!result.pass) {
      throw new VisemeRuleError("VisemeTrack failed transition-rule linter", result.violations);
    }
  }

  return track;
}

/** Merge cues whose duration (until next cue) is shorter than one frame. */
function mergeSubFrameCues(
  cues: VisemeCue[],
  frameDur: number,
): VisemeCue[] {
  if (cues.length <= 1) return cues;
  let out = cues.slice();
  let changed = true;
  let guard = 0;
  while (changed && guard < 64) {
    changed = false;
    guard++;
    for (let i = 0; i < out.length; i++) {
      const next = out[i + 1];
      const dur = next ? next.t - out[i].t : Infinity;
      if (dur < frameDur) {
        // Drop this cue — the surrounding cues' coverage merges.
        out.splice(i, 1);
        changed = true;
        break;
      }
    }
  }
  return out;
}

/**
 * Insert transition bridges:
 *  - A → D  becomes A → C → D  (insert C at the midpoint)
 *  - C → F  becomes C → E → F  (insert E at the midpoint)
 */
function insertTransitionBridges(cues: VisemeCue[]): VisemeCue[] {
  const out: VisemeCue[] = [];
  for (let i = 0; i < cues.length; i++) {
    const prev = cues[i - 1];
    const cur = cues[i];
    if (prev && cur.v === "D" && prev.v === "A") {
      const midT = (prev.t + cur.t) / 2;
      out.push({ t: midT, v: "C" });
    } else if (prev && cur.v === "F" && prev.v === "C") {
      const midT = (prev.t + cur.t) / 2;
      out.push({ t: midT, v: "E" });
    }
    out.push(cur);
  }
  return out;
}

/**
 * Rhubarb can emit E as a source shape rather than only as our synthetic C→F
 * bridge. The player supports E, but the transition contract requires every E
 * to touch a C. Insert a short C lead-in without deleting or moving the source
 * cue. Equal timestamps are safe: sampling chooses the latest cue at a time.
 */
function ensureStandaloneEHasCNeighbor(
  cues: VisemeCue[],
  frameDur: number,
): VisemeCue[] {
  const out: VisemeCue[] = [];
  for (let i = 0; i < cues.length; i++) {
    const cue = cues[i];
    const previous = cues[i - 1];
    const next = cues[i + 1];
    if (cue.v === "E" && previous?.v !== "C" && next?.v !== "C") {
      const previousTime = out[out.length - 1]?.t ?? 0;
      const leadIn = Math.min(frameDur / 2, Math.max(0, cue.t - previousTime) / 2);
      out.push({ t: Math.max(previousTime, cue.t - leadIn), v: "C" });
    }
    out.push(cue);
  }
  return out;
}

// ──────────────────────────────────────────────────────────────────────
// Linter (ANIM-LIP-02)
// ──────────────────────────────────────────────────────────────────────

/**
 * Validate a (presumably already-post-processed) track against the §5.1
 * transition rules. Returns every violation; `pass` is true only when the
 * violation list is empty.
 */
export function lintVisemeTrack(track: VisemeTrack): {
  pass: boolean;
  violations: VisemeViolation[];
} {
  const violations: VisemeViolation[] = [];
  const cues = track.cues;
  for (let i = 0; i < cues.length; i++) {
    const prev = cues[i - 1];
    const cur = cues[i];
    const next = cues[i + 1];

    if (prev && prev.v === "A" && cur.v === "D") {
      violations.push({
        rule: "A_TO_D",
        index: i,
        detail: `Direct A→D transition at cue ${i} (t=${cur.t.toFixed(4)}); must bridge with C`,
      });
    }
    if (prev && prev.v === "C" && cur.v === "F") {
      violations.push({
        rule: "C_TO_F",
        index: i,
        detail: `Direct C→F transition at cue ${i} (t=${cur.t.toFixed(4)}); must pass through E`,
      });
    }
    if (cur.v === "E") {
      const hasCNeighbor = (prev && prev.v === "C") || (next && next.v === "C");
      if (!hasCNeighbor) {
        violations.push({
          rule: "E_NO_C_NEIGHBOR",
          index: i,
          detail: `E shape at cue ${i} is not adjacent to a C (pucker must be C→E→F)`,
        });
      }
      // E must not be wider than its adjacent C.
      const adjC = prev && prev.v === "C" ? prev : next && next.v === "C" ? next : null;
      if (adjC && VISEME_OPENNESS[cur.v] > VISEME_OPENNESS[adjC.v]) {
        violations.push({
          rule: "E_WIDER_THAN_C",
          index: i,
          detail: `E is wider than adjacent C at cue ${i}`,
        });
      }
    }
  }
  return { pass: violations.length === 0, violations };
}

// ──────────────────────────────────────────────────────────────────────
// Sampling (used by the player)
// ──────────────────────────────────────────────────────────────────────

/**
 * Return the active cue index + shape at playback time `t` (seconds).
 * The active cue is the latest cue whose onset <= t. Returns -1 / null when
 * the clock is before the first cue (caller should treat as silence/X).
 */
export function activeVisemeAt(
  track: VisemeTrack,
  t: number,
): { index: number; cue: VisemeCue | null } {
  const cues = track.cues;
  if (cues.length === 0) return { index: -1, cue: null };
  let lo = 0;
  let hi = cues.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cues[mid].t <= t) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (found < 0) return { index: -1, cue: null };
  return { index: found, cue: cues[found] };
}
