import React, { useState } from "react";
import { Boxes } from "lucide-react";
import { PetObjectKind } from "../types";
import { ALL_OBJECT_KINDS, OBJECT_CATALOG } from "../three/objects/catalog";

/**
 * Compact object palette designed to float over a live AR view. Toggling it
 * reveals the object buttons; picking one calls `onAdd`. Used inside the WebXR
 * DOM overlay (Android) and on top of the 8th Wall canvas (iOS).
 */
export default function ARObjectOverlay({ onAdd }: { onAdd: (kind: PetObjectKind) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="absolute top-3 left-3 z-30 flex flex-col items-start gap-2" style={{ pointerEvents: "auto" }}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-black/50 backdrop-blur-md text-white text-xs font-bold hover:bg-black/70 active:scale-95"
      >
        <Boxes size={14} /> {open ? "Done" : "Add objects"}
      </button>
      {open && (
        <div className="flex flex-col gap-1 max-h-[60vh] overflow-y-auto p-2 rounded-2xl bg-black/40 backdrop-blur-md">
          {ALL_OBJECT_KINDS.map((kind) => {
            const def = OBJECT_CATALOG[kind];
            return (
              <button
                key={kind}
                onClick={() => onAdd(kind)}
                className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white/15 text-white text-xs font-bold hover:bg-white/25 active:scale-95 transition-all"
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
