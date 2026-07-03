import { useEffect, useRef } from "react";
import { Avatar, AvatarNeeds, BehaviorAction } from "../types";
import { useAvatarScene, Vec2 } from "./store";
import {
  applyDecay,
  simulateOffline,
  criticalOverride,
  chooseAutonomous,
  objectFor,
  durationFor,
  speechFor,
} from "./needs";
import { fetchAvatarNeeds, patchAvatarNeeds } from "../api";

function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/**
 * The behavior brain. Runs a single requestAnimationFrame loop that:
 *  1. decays needs over real elapsed time (and recovers them during actions),
 *  2. picks the next behavior by priority — critical bodily need >
 *     user command > autonomous need > idle wander,
 *  3. walks the pet to a relevant placed object before acting (Phase 3),
 *  4. periodically syncs needs to the server (offline-aware via `lastSeen`).
 *
 * Everything is written into the zustand store; PetScene renders it.
 */
export function useAvatarBrain(avatar: Avatar, opts?: { enabled?: boolean }) {
  const enabled = opts?.enabled ?? true;
  const pendingRef = useRef<BehaviorAction | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const scene = useAvatarScene.getState();
    let cancelled = false;
    let raf = 0;
    let last = performance.now();
    let actionTimer = 0; // seconds locked in the current timed action
    let wanderCooldown = 2;
    let syncCooldown = 15;

    // ---- init needs: server state first, else simulate from local snapshot ----
    (async () => {
      const seed: AvatarNeeds = {
        food: avatar.food_level ?? 80,
        water: avatar.water_level ?? 80,
        energy: 90,
        bladder: 20,
        bowel: 15,
        happiness: 85,
        lastSeen: avatar.last_fed || new Date().toISOString(),
      };
      let needs = seed;
      const server = await fetchAvatarNeeds(avatar.id).catch(() => null);
      if (server) needs = simulateOffline(server);
      else needs = simulateOffline(seed);
      if (!cancelled) useAvatarScene.getState().replaceNeeds(needs);
    })();

    // ---- helpers ----
    const playNow = (action: BehaviorAction) => {
      const s = useAvatarScene.getState();
      s.setAction(action);
      s.say(speechFor(action));
      actionTimer = durationFor(action);
      wanderCooldown = 3 + Math.random() * 4;
    };

    const begin = (action: BehaviorAction) => {
      const s = useAvatarScene.getState();
      const obj = objectFor(action, s.placedObjects);
      if (obj) {
        const targetXZ: Vec2 = { x: obj.position[0], z: obj.position[2] };
        if (dist(s.position, targetXZ) > 0.3) {
          pendingRef.current = action;
          s.setTarget(targetXZ);
          s.setAction("walking");
          actionTimer = 0;
          return;
        }
      }
      playNow(action);
    };

    const startWander = () => {
      const s = useAvatarScene.getState();
      const r = 1.2 + Math.random() * 1.6;
      const a = Math.random() * Math.PI * 2;
      s.setTarget({ x: Math.cos(a) * r, z: Math.sin(a) * r });
      s.setAction("walking");
      s.say(null);
      wanderCooldown = 4 + Math.random() * 5;
      actionTimer = 0;
    };

    // ---- main loop ----
    const tick = () => {
      if (cancelled) return;
      const now = performance.now();
      const dt = Math.min(0.25, (now - last) / 1000); // clamp big gaps (backgrounded tab)
      last = now;
      const s = useAvatarScene.getState();

      // 1. needs
      const decayed = applyDecay(s.needs, s.action, dt / 3600);
      decayed.lastSeen = new Date().toISOString();
      s.replaceNeeds(decayed);

      actionTimer -= dt;
      wanderCooldown -= dt;
      syncCooldown -= dt;

      // 2. finish an in-progress walk before re-deciding
      if (s.action === "walking") {
        if (dist(s.position, s.target) > 0.15) {
          raf = requestAnimationFrame(tick);
          return;
        }
        s.setAction("idle");
        actionTimer = 0;
        if (pendingRef.current) {
          const p = pendingRef.current;
          pendingRef.current = null;
          playNow(p);
          raf = requestAnimationFrame(tick);
          return;
        }
      }

      // 3. still locked in a timed action?
      if (actionTimer > 0) {
        raf = requestAnimationFrame(tick);
        return;
      }
      // clear any lingering emote when a timed action ends
      if (s.speech) s.say(null);

      // 4. decide next behavior
      const critical = criticalOverride(decayed, s.action);
      if (critical) {
        begin(critical);
      } else {
        const cmd = s.commandQueue[0];
        if (cmd) {
          s.dequeueCommand();
          if (cmd.action === "walking") {
            // "Come" → walk to the user/center.
            s.setTarget({ x: 0, z: 0 });
            s.setAction("walking");
            pendingRef.current = null;
          } else {
            begin(cmd.action);
          }
        } else {
          const auto = chooseAutonomous(decayed, s.placedObjects);
          if (auto) begin(auto);
          else if (wanderCooldown <= 0) startWander();
          else if (s.action !== "walking") s.setAction("idle");
        }
      }

      // 5. periodic server sync
      if (syncCooldown <= 0) {
        syncCooldown = 15;
        patchAvatarNeeds(avatar.id, useAvatarScene.getState().needs).catch(() => {});
      }

      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      // best-effort final sync
      patchAvatarNeeds(avatar.id, useAvatarScene.getState().needs).catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [avatar.id, enabled]);
}
