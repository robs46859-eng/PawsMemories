import React, { useState } from "react";
import { Boxes } from "lucide-react";
import { ALL_OBJECT_KINDS, OBJECT_CATALOG } from "../three/objects/catalog";
import { useAvatarScene } from "../three/store";

/**
 * Object palette for AR. Picking an object "arms" it (tap-to-place): the next
 * tap on a real surface drops it there. The AR scenes read `pendingObjectKind`
 * from the store and perform the actual placement at the hit location.
 */
export default function ARObjectOverlay() {
  const [open, setOpen] = useState(false);
  const pending = useAvatarScene((s) => s.pendingObjectKind);
  const setPending = useAvatarScene((s) => s.setPendingObjectKind);

  return (
    <div className="absolute top-3 left-3 z-30 flex flex-col items-start gap-2" style={{ pointerEvents: "auto" }}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-black/50 backdrop-blur-md text-white text-xs font-bold hover:bg-black/70 active:scale-95"
      >
        <Boxes size={14} /> {open ? "Done" : "Add objects"}
      </button>

      {pending && (
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/80 backdrop-blur-md text-white text-[11px] font-bold">
          Tap a surface to place {OBJECT_CATALOG[pending].label}
          <button onClick={() => setPending(null)} className="underline opacity-80">
            cancel
          </button>
        </div>
      )}

      {open && (
        <div className="flex flex-col gap-1 max-h-[55vh] overflow-y-auto p-2 rounded-2xl bg-black/40 backdrop-blur-md">
          {ALL_OBJECT_KINDS.map((kind) => {
            const def = OBJECT_CATALOG[kind];
            const armed = pending === kind;
            return (
              <button
                key={kind}
                onClick={() => setPending(armed ? null : kind)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-white text-xs font-bold active:scale-95 transition-all ${
                  armed ? "bg-primary" : "bg-white/15 hover:bg-white/25"
                }`}
              >
                <span className="text-base leading-none">{def.emoji}</span>
                {def.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
