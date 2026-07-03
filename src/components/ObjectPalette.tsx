import React from "react";
import { PetObjectKind } from "../types";
import { ALL_OBJECT_KINDS, OBJECT_CATALOG } from "../three/objects/catalog";

interface ObjectPaletteProps {
  onAdd: (kind: PetObjectKind) => void;
  disabled?: boolean;
}

/** A row of buttons to drop dog objects into the scene. */
export default function ObjectPalette({ onAdd, disabled }: ObjectPaletteProps) {
  return (
    <div className="flex flex-wrap justify-center gap-2">
      {ALL_OBJECT_KINDS.map((kind) => {
        const def = OBJECT_CATALOG[kind];
        return (
          <button
            key={kind}
            onClick={() => onAdd(kind)}
            disabled={disabled}
            title={`Add ${def.label}`}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-surface-container border border-outline-variant/30 text-on-surface text-xs font-bold hover:bg-primary/10 hover:border-primary/40 active:scale-95 transition-all disabled:opacity-40"
          >
            <span className="text-base leading-none">{def.emoji}</span>
            {def.label}
          </button>
        );
      })}
    </div>
  );
}
