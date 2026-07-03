import React from "react";
import { AVATAR_COMMANDS, issueAvatarCommand } from "./avatarCommands";

/**
 * Compact, horizontally-scrollable command strip designed to float over a live
 * AR view. Used both inside the WebXR DOM overlay (Android) and on top of the
 * 8th Wall canvas (iOS). Issues commands into the same shared behavior store.
 */
export default function ARCommandOverlay({ avatarId }: { avatarId?: number }) {
  return (
    <div
      style={{ pointerEvents: "auto" }}
      className="absolute bottom-4 left-1/2 -translate-x-1/2 z-30 flex gap-2 max-w-[95vw] overflow-x-auto px-2 py-2 rounded-2xl bg-black/40 backdrop-blur-md"
    >
      {AVATAR_COMMANDS.map((c) => (
        <button
          key={c.label}
          onClick={() => issueAvatarCommand(c.action, avatarId)}
          className="flex flex-col items-center justify-center gap-0.5 min-w-[52px] px-2 py-1.5 rounded-xl bg-white/15 text-white text-[10px] font-bold hover:bg-white/25 active:scale-95 transition-all"
        >
          {c.icon}
          {c.label}
        </button>
      ))}
    </div>
  );
}
