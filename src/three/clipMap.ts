import { BehaviorAction } from "../types";

/**
 * Ordered candidate name fragments for each behavior, matched
 * case-insensitively against the clip names present in a generated / rigged
 * GLB. First hit wins. This lets us author clips in Blender with reasonable
 * names without hard-coding an exact convention.
 */
const CLIP_CANDIDATES: Record<BehaviorAction, string[]> = {
  idle: ["idle", "breath", "stand"],
  walking: ["walk", "trot"],
  running: ["run", "gallop", "sprint"],
  sitting: ["sit"],
  sleeping: ["sleep", "liedown", "lie_down", "rest"],
  eating: ["eat", "chew", "feed"],
  drinking: ["drink", "lap"],
  playing: ["play", "jump", "bounce"],
  peeing: ["pee", "urinate", "leglift", "leg_lift"],
  pooping: ["poop", "squat", "defecate"],
  speaking: ["bark", "speak", "howl"],
  interacting: ["interact", "nuzzle", "sniff"],
  wagging: ["tail_wag", "wag"],
  stretching: ["stretch"],
  shaking: ["shake_off", "shake"],
  digging: ["dig_hole", "dig"],
};

const HUMAN_CLIP_CANDIDATES: Partial<Record<BehaviorAction, string[]>> = {
  idle: ["idle", "breath", "stand"],
  walking: ["walk"],
  running: ["run", "jog"],
  sitting: ["sit"],
  sleeping: ["sleep", "lie", "rest"],
  speaking: ["talk", "speak", "lip", "gesture"],
  interacting: ["wave", "greet", "nod", "interact"],
  stretching: ["stretch"],
};

/** Resolve the best-matching clip name in `available` for `action`, or null. */
export function resolveClipName(
  action: BehaviorAction,
  available: string[],
  avatarType?: 'dog' | 'human'
): string | null {
  if (!available.length) return null;
  const lower = available.map((n) => ({ raw: n, low: n.toLowerCase() }));
  const candidates = avatarType === "human" ? HUMAN_CLIP_CANDIDATES : CLIP_CANDIDATES;
  for (const frag of candidates[action] || []) {
    const hit = lower.find((c) => c.low.includes(frag));
    if (hit) return hit.raw;
  }
  return null;
}

/** Which behaviors loop vs. play once and hold. */
export const LOOPING: Record<BehaviorAction, boolean> = {
  idle: true,
  walking: true,
  running: true,
  sitting: true,
  sleeping: true,
  eating: true,
  drinking: true,
  playing: true,
  peeing: false,
  pooping: false,
  speaking: false,
  interacting: false,
  wagging: true,
  stretching: false,
  shaking: false,
  digging: true,
};
