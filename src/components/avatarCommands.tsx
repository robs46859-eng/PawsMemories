import React from "react";
import { Armchair, Dog, Volume2, Gamepad2, Drumstick, Droplet, Moon, Heart, StretchHorizontal, Waves, Shovel } from "lucide-react";
import { BehaviorAction } from "../types";
import { useAvatarScene } from "../three/store";
import { sendAvatarCommand } from "../api";

export interface AvatarCommandDef {
  label: string;
  action: BehaviorAction;
  icon: React.ReactNode;
}

/** Single source of truth for the user-issuable commands (used by the panel bar and the AR overlay). */
export const AVATAR_COMMANDS: AvatarCommandDef[] = [
  { label: "Sit", action: "sitting", icon: <Armchair size={18} /> },
  { label: "Come", action: "walking", icon: <Dog size={18} /> },
  { label: "Speak", action: "speaking", icon: <Volume2 size={18} /> },
  { label: "Play", action: "playing", icon: <Gamepad2 size={18} /> },
  { label: "Eat", action: "eating", icon: <Drumstick size={18} /> },
  { label: "Drink", action: "drinking", icon: <Droplet size={18} /> },
  { label: "Sleep", action: "sleeping", icon: <Moon size={18} /> },
  // New abilities (skeletal-clip overhaul)
  { label: "Wag", action: "wagging", icon: <Heart size={18} /> },
  { label: "Stretch", action: "stretching", icon: <StretchHorizontal size={18} /> },
  { label: "Shake", action: "shaking", icon: <Waves size={18} /> },
  { label: "Dig", action: "digging", icon: <Shovel size={18} /> },
];

/** Enqueue a command into the shared behavior store + log it server-side (best-effort). */
export function issueAvatarCommand(action: BehaviorAction, avatarId?: number): void {
  useAvatarScene.getState().enqueueCommand({ action, issuedAt: Date.now() });
  if (avatarId != null) sendAvatarCommand(avatarId, action).catch(() => {});
}
