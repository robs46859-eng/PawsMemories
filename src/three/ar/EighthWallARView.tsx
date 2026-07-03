import React, { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { Avatar } from "../../types";
import { useAvatarScene } from "../store";
import { startEighthWallAR, EighthWallHandle } from "./eighthWallAR";

/**
 * iOS AR view powered by 8th Wall (XR8). Standalone vanilla-three.js session
 * (XR8's pipeline doesn't compose with react-three-fiber). Reads the current
 * behavior action + placed objects from the shared store; the behavior brain is
 * driven by the parent LivingAvatarView.
 *
 * Beta: validate on a real iOS device — cannot be tested in CI.
 */
export default function EighthWallARView({ avatar, onExit }: { avatar: Avatar; onExit?: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(true);

  useEffect(() => {
    let handle: EighthWallHandle | null = null;
    let cancelled = false;
    const url = avatar.rigged_model_url || avatar.model_url || "";
    if (!canvasRef.current || !url) {
      setError("This avatar has no 3D model to show in AR.");
      setStarting(false);
      return;
    }
    startEighthWallAR(canvasRef.current, {
      modelUrl: url,
      objects: useAvatarScene.getState().placedObjects,
      getAction: () => useAvatarScene.getState().action,
    })
      .then((h) => {
        if (cancelled) h.stop();
        else handle = h;
        setStarting(false);
      })
      .catch((e) => {
        setError(e?.message || "Failed to start AR.");
        setStarting(false);
      });
    return () => {
      cancelled = true;
      handle?.stop();
    };
  }, [avatar.id]);

  return (
    <div className="w-full h-full relative bg-black">
      <canvas ref={canvasRef} className="w-full h-full block" />
      {starting && (
        <div className="absolute inset-0 flex items-center justify-center text-white text-sm">
          Starting AR…
        </div>
      )}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center text-center p-6 text-white text-sm">
          {error}
        </div>
      )}
      <button
        onClick={onExit}
        className="absolute top-3 right-3 z-20 w-9 h-9 rounded-full bg-black/60 text-white flex items-center justify-center hover:bg-black/80"
        aria-label="Exit AR"
      >
        <X size={18} />
      </button>
      <p className="absolute bottom-3 left-1/2 -translate-x-1/2 text-white/80 text-xs bg-black/50 px-3 py-1 rounded-full">
        Move your phone to scan, then tap to place your pet
      </p>
    </div>
  );
}
