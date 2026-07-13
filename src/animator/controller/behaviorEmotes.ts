import type { AvatarNeeds, BehaviorAction } from "../../types.ts";
import type { LayeredAnimationController } from "./createAnimationController.ts";
import { EmoteQueue } from "./emoteQueue.ts";

interface BehaviorEmote {
  clip: string;
  priority: number;
  holdSec: number;
  cooldownSec: number;
}

function resolveBehaviorEmote(
  action: BehaviorAction,
  needs: AvatarNeeds,
): BehaviorEmote | null {
  if (action === "speaking") return { clip: "bark_speak", priority: 8, holdSec: 1.2, cooldownSec: 1 };
  if (action === "interacting" || action === "playing") {
    return { clip: "head_tilt", priority: 5, holdSec: 1.4, cooldownSec: 3 };
  }
  if (action === "wagging") return { clip: "tail_wave", priority: 6, holdSec: 1.8, cooldownSec: 2 };
  if (action === "shaking") return { clip: "ear_flick", priority: 6, holdSec: 1, cooldownSec: 2 };
  if (action === "idle" && needs.happiness >= 70 && needs.energy >= 30) {
    return { clip: "tail_wave", priority: 0, holdSec: 1.5, cooldownSec: 8 };
  }
  return null;
}

/** Connects the live behavior/needs signal to non-blocking L1 emotes. */
export class BehaviorEmoteBridge {
  private readonly queue: EmoteQueue;
  private readonly availableClips: Set<string>;
  private lastSignal: string | null = null;

  constructor(controller: LayeredAnimationController) {
    this.queue = new EmoteQueue(controller);
    this.availableClips = new Set(controller.listClips().map(({ name }) => name));
  }

  sync(action: BehaviorAction, needs: AvatarNeeds): boolean {
    const needsBand = `${needs.happiness >= 70}:${needs.energy >= 30}`;
    const signal = `${action}:${needsBand}`;
    if (signal === this.lastSignal) return false;
    this.lastSignal = signal;

    const emote = resolveBehaviorEmote(action, needs);
    if (!emote || !this.availableClips.has(emote.clip)) return false;
    return this.queue.enqueue({ ...emote, layer: "L1" });
  }

  update(delta: number): void {
    this.queue.tick(delta);
  }

  dispose(): void {
    this.queue.clear();
  }

  getPlayingClip(): string | null {
    return this.queue.getPlaying()?.clip ?? null;
  }
}
