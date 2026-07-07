import React, { Component, ReactNode, useEffect, useState } from "react";
import { Boxes, Scan } from "lucide-react";
import { Avatar, PetObjectKind } from "../types";
import PetScene from "../three/PetScene";
import ARPetStage from "../three/ar/ARPetStage";
import CommandBar from "./CommandBar";
import ObjectPalette from "./ObjectPalette";
import { useAvatarBrain } from "../three/useAvatarBrain";
import { useAvatarScene } from "../three/store";
import { addObjectForAvatar, removeObjectForAvatar } from "../three/objects/placement";
import { fetchPlacedObjects } from "../api";

/** Local scene guard — falls back to a poster instead of the app-wide error page. */
class SceneBoundary extends Component<
  { poster?: string | null; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(e: unknown) {
    console.error("[LivingAvatarView] scene error:", e);
  }
  render() {
    if (this.state.failed) {
      return (
        <div className="w-full h-full flex flex-col items-center justify-center gap-3 text-center p-6">
          {this.props.poster && (
            <img
              src={this.props.poster}
              alt=""
              className="w-32 h-32 object-cover rounded-2xl opacity-80"
            />
          )}
          <p className="text-sm opacity-70">
            Couldn't load the 3D scene on this device.
          </p>
        </div>
      );
    }
    return <>{this.props.children}</>;
  }
}

interface LivingAvatarViewProps {
  avatar: Avatar;
  isDarkMode?: boolean;
}

/**
 * Phase 1 + 2 living-avatar experience: the 3D scene plus the command bar,
 * driven by the autonomous behavior brain. Mounted behind a "Live 3D (beta)"
 * flag so the existing sprite playpen keeps working unchanged.
 */
export default function LivingAvatarView({ avatar }: LivingAvatarViewProps) {
  const ready = avatar.generation_status === "done" && !!avatar.model_url;
  useAvatarBrain(avatar, { enabled: ready });

  const setPlacedObjects = useAvatarScene((s) => s.setPlacedObjects);
  const [showObjects, setShowObjects] = useState(false);
  const [arMode, setArMode] = useState(false);

  // Load persisted objects for this avatar; clear on unmount / avatar change.
  useEffect(() => {
    let cancelled = false;
    fetchPlacedObjects(avatar.id).then((objs) => {
      if (!cancelled) setPlacedObjects(objs);
    });
    return () => {
      cancelled = true;
      setPlacedObjects([]);
    };
  }, [avatar.id, setPlacedObjects]);

  const handleAdd = (kind: PetObjectKind) => addObjectForAvatar(avatar.id, kind);
  const handleRemove = (id: string) => removeObjectForAvatar(avatar.id, id);

  return (
    <div className="w-full h-full flex flex-col">
      <div className="relative flex-1 min-h-[300px] bg-surface">
        {ready ? (
          <SceneBoundary poster={avatar.image_url}>
            {arMode ? (
              <ARPetStage avatar={avatar} />
            ) : (
              <PetScene avatar={avatar} onRemoveObject={handleRemove} className="absolute inset-0" />
            )}
          </SceneBoundary>
        ) : (
          <div className="w-full h-full flex items-center justify-center text-center p-6 opacity-70 text-sm">
            This avatar's 3D model isn't ready yet.
          </div>
        )}
        {ready && (
          <div className="absolute top-3 right-3 z-20 flex gap-2">
            <button
              onClick={() => setArMode((v) => !v)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-black/50 backdrop-blur-sm text-white text-xs font-bold hover:bg-black/70 active:scale-95"
            >
              <Scan size={14} /> {arMode ? "3D view" : "AR"}
            </button>
            {!arMode && (
              <button
                onClick={() => setShowObjects((v) => !v)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-black/50 backdrop-blur-sm text-white text-xs font-bold hover:bg-black/70 active:scale-95"
              >
                <Boxes size={14} /> {showObjects ? "Done" : "Add objects"}
              </button>
            )}
          </div>
        )}
      </div>
      <div className="p-4 border-t border-outline-variant/20 flex flex-col gap-3">
        {showObjects && (
          <div className="flex flex-col gap-1.5">
            <p className="text-[10px] uppercase tracking-wider font-bold opacity-50 text-center">
              Tap to add • tap an object in the scene to remove
            </p>
            <ObjectPalette onAdd={handleAdd} />
          </div>
        )}
        <CommandBar avatarId={avatar.id} petName={avatar.name} />
      </div>
    </div>
  );
}
