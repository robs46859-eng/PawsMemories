import React from "react";
import { useAvatarScene } from "../three/store";
import { AVATAR_COMMANDS, issueAvatarCommand } from "./avatarCommands";

/** Lower is more urgent for bladder/bowel; higher is better for the rest. */
const NEED_BARS: { key: keyof NeedsView; label: string; invert?: boolean; color: string }[] = [
  { key: "food", label: "Food", color: "#f59e0b" },
  { key: "water", label: "Water", color: "#38bdf8" },
  { key: "energy", label: "Energy", color: "#22c55e" },
  { key: "happiness", label: "Happy", color: "#ec4899" },
  { key: "bladder", label: "Bladder", color: "#eab308", invert: true },
  { key: "bowel", label: "Bowel", color: "#a16207", invert: true },
];

type NeedsView = {
  food: number;
  water: number;
  energy: number;
  happiness: number;
  bladder: number;
  bowel: number;
};

export default function CommandBar({
  petName = "Your pet",
  avatarId,
}: {
  petName?: string;
  avatarId?: number;
}) {
  const needs = useAvatarScene((s) => s.needs);
  const action = useAvatarScene((s) => s.action);

  const issue = (a: (typeof AVATAR_COMMANDS)[number]["action"]) =>
    issueAvatarCommand(a, avatarId);

  return (
    <div className="w-full flex flex-col gap-3">
      {/* Needs bars */}
      <div className="grid grid-cols-3 gap-2">
        {NEED_BARS.map((b) => {
          const raw = (needs as unknown as NeedsView)[b.key] ?? 0;
          const pct = Math.round(raw);
          // For inverted needs (bladder/bowel) a HIGH value is bad → show fill as urgency.
          const good = b.invert ? 100 - pct : pct;
          const low = good < 25;
          return (
            <div key={b.key} className="flex flex-col gap-0.5">
              <div className="flex justify-between text-[10px] font-bold uppercase tracking-wider opacity-60">
                <span>{b.label}</span>
                <span className={low ? "text-red-500" : ""}>{pct}</span>
              </div>
              <div className="h-1.5 rounded-full bg-black/10 overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{ width: `${pct}%`, background: b.color }}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* Current state */}
      <p className="text-xs text-center opacity-60">
        {petName} is <span className="font-bold">{action}</span>
      </p>

      {/* Command buttons */}
      <div className="flex flex-wrap justify-center gap-2">
        {AVATAR_COMMANDS.map((c) => (
          <button
            key={c.label}
            onClick={() => issue(c.action)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-surface-container border border-outline-variant/30 text-on-surface text-sm font-bold hover:bg-primary/10 hover:border-primary/40 active:scale-95 transition-all"
          >
            {c.icon}
            {c.label}
          </button>
        ))}
      </div>
    </div>
  );
}
