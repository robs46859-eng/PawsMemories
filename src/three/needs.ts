import { AvatarNeeds, BehaviorAction, PlacedObject, PetObjectKind } from "../types";

/**
 * Needs model for the "living pet". All values are 0..100.
 * Higher food/water/energy/happiness = better; higher bladder/bowel = more urgent.
 */

/** Passive change per HOUR while the pet is awake and idle. */
const DECAY_PER_HOUR = {
  food: -6,
  water: -8,
  energy: -5,
  bladder: +10,
  bowel: +5,
  happiness: -3,
};

/** Thresholds that force an autonomous behavior regardless of what else is going on. */
export const CRITICAL = {
  bladder: 90,
  bowel: 90,
  energyLow: 15,
  energyRested: 92, // wake up once this rested
  foodLow: 20,
  waterLow: 20,
  happyLow: 30,
};

function clamp(v: number): number {
  return Math.max(0, Math.min(100, v));
}

/** Apply passive decay for `hours`, plus any recovery from the current action. */
export function applyDecay(
  needs: AvatarNeeds,
  action: BehaviorAction,
  hours: number
): AvatarNeeds {
  const n: AvatarNeeds = { ...needs };
  n.food = clamp(n.food + DECAY_PER_HOUR.food * hours);
  n.water = clamp(n.water + DECAY_PER_HOUR.water * hours);
  n.bladder = clamp(n.bladder + DECAY_PER_HOUR.bladder * hours);
  n.bowel = clamp(n.bowel + DECAY_PER_HOUR.bowel * hours);
  n.happiness = clamp(n.happiness + DECAY_PER_HOUR.happiness * hours);

  // Energy: recover while sleeping, otherwise drain.
  n.energy = clamp(
    n.energy + (action === "sleeping" ? +25 : DECAY_PER_HOUR.energy) * hours
  );

  // Active-action effects (fast, per-hour rates scaled by the elapsed slice).
  switch (action) {
    case "eating":
      n.food = clamp(n.food + 240 * hours);
      break;
    case "drinking":
      n.water = clamp(n.water + 240 * hours);
      break;
    case "playing":
      n.happiness = clamp(n.happiness + 180 * hours);
      n.energy = clamp(n.energy - 40 * hours);
      break;
    case "peeing":
      n.bladder = clamp(n.bladder - 600 * hours);
      break;
    case "pooping":
      n.bowel = clamp(n.bowel - 600 * hours);
      break;
  }
  return n;
}

/** Recompute needs after the app was closed, based on `lastSeen`. */
export function simulateOffline(needs: AvatarNeeds, nowMs = Date.now()): AvatarNeeds {
  const last = new Date(needs.lastSeen).getTime();
  if (!isFinite(last)) return { ...needs, lastSeen: new Date(nowMs).toISOString() };
  const hours = Math.max(0, (nowMs - last) / 3_600_000);
  // Assume the pet was awake/idle while away (it "lived").
  const simulated = applyDecay(needs, "idle", Math.min(hours, 24)); // cap 24h of drift
  return { ...simulated, lastSeen: new Date(nowMs).toISOString() };
}

const OBJECT_FOR: Partial<Record<BehaviorAction, PetObjectKind[]>> = {
  eating: ["food_bowl"],
  drinking: ["water_bowl"],
  playing: ["ball", "chew_toy", "bone"],
  sleeping: ["bed", "dog_house"],
  peeing: ["hydrant"],
};

export function findObject(
  objects: PlacedObject[],
  kinds: PetObjectKind[]
): PlacedObject | undefined {
  return objects.find((o) => kinds.includes(o.kind));
}

/** The placed object (if any) a given action should walk to and use. */
export function objectFor(
  action: BehaviorAction,
  objects: PlacedObject[]
): PlacedObject | undefined {
  const kinds = OBJECT_FOR[action];
  if (!kinds) return undefined;
  return findObject(objects, kinds);
}

/**
 * Critical override: the pet MUST do this now (urgent bodily need), regardless of
 * commands or idle wandering. Returns null when nothing is urgent.
 */
export function criticalOverride(
  needs: AvatarNeeds,
  currentAction: BehaviorAction
): BehaviorAction | null {
  if (needs.bladder >= CRITICAL.bladder) return "peeing";
  if (needs.bowel >= CRITICAL.bowel) return "pooping";
  // Stay asleep until rested; start sleeping when exhausted.
  if (currentAction === "sleeping" && needs.energy < CRITICAL.energyRested) return "sleeping";
  if (needs.energy <= CRITICAL.energyLow) return "sleeping";
  return null;
}

/**
 * Autonomous, non-critical choice: address the most pressing ordinary need if we
 * have (or don't need) the relevant object; otherwise null → idle/wander.
 */
export function chooseAutonomous(
  needs: AvatarNeeds,
  objects: PlacedObject[]
): BehaviorAction | null {
  const wants: BehaviorAction[] = [];
  if (needs.food <= CRITICAL.foodLow) wants.push("eating");
  if (needs.water <= CRITICAL.waterLow) wants.push("drinking");
  if (needs.happiness <= CRITICAL.happyLow) wants.push("playing");
  for (const w of wants) {
    const need = OBJECT_FOR[w];
    // If the action needs an object, only do it when one is placed (Phase 3);
    // otherwise it can happen in place.
    if (!need || findObject(objects, need)) return w;
  }
  return null;
}

/** How long (seconds) a behavior locks before the brain re-decides. */
export function durationFor(action: BehaviorAction): number {
  switch (action) {
    case "peeing":
      return 3.5;
    case "pooping":
      return 4.5;
    case "eating":
    case "drinking":
      return 5;
    case "playing":
      return 6;
    case "speaking":
      return 2;
    case "sitting":
      return 4;
    case "sleeping":
      return 8; // re-evaluated each cycle; continues if still tired
    case "interacting":
      return 3;
    case "stretching":
      return 2;
    case "shaking":
      return 1.5;
    case "wagging":
      return 3;
    case "digging":
      return 4;
    default:
      return 0; // idle / walking are interruptible
  }
}

/** Optional speech-bubble text for flavor. */
export function speechFor(action: BehaviorAction, avatarType?: 'dog' | 'human'): string | null {
  if (avatarType === "human") {
    switch (action) {
      case "speaking":
        return "Hello!";
      case "interacting":
        return "👋 Hello!";
      case "sleeping":
        return "💤";
      case "walking":
        return "🚶";
      default:
        return null;
    }
  }
  switch (action) {
    case "peeing":
      return "💦";
    case "pooping":
      return "💩";
    case "eating":
      return "🍖 nom nom";
    case "drinking":
      return "💧 slurp";
    case "playing":
      return "🎾 !";
    case "sleeping":
      return "💤";
    case "speaking":
      return "Woof!";
    case "wagging":
      return "🐕 !";
    case "stretching":
      return "🧘";
    case "shaking":
      return "💦";
    case "digging":
      return "🦴 ?";
    default:
      return null;
  }
}
