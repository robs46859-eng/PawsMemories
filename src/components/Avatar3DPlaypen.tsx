import React, { useState, useEffect, useRef, useCallback } from "react";
import { motion, useMotionValue, useTransform, AnimatePresence } from "motion/react";
import { Avatar, AvatarAction, AnimationMetadata } from "../types";
import PetModelViewer from "./PetModelViewer";

interface Avatar3DPlaypenProps {
  avatar: Avatar;
  activeAction: AvatarAction | null;
  onActionAnimationComplete: () => void;
  isDarkMode: boolean;
  /** Called when the user clicks "Retry" after a generation failure. */
  onRetry?: (avatarId: number) => void;
}

interface FloatingEmoji {
  id: number;
  char: string;
  x: number;
  y: number;
}

const ACTION_EMOJIS: Record<AvatarAction, string[]> = {
  eating: ["🍖", "😋", "❤️"],
  drinking: ["💧", "💦", "😊"],
  running: ["💨", "🏃", "⚡"],
  playing: ["🎾", "⭐", "🎉"],
  sleeping: ["💤", "😴", "🌙"],
  photo: ["📸", "✨", "📷"],
};

/**
 * 3D-aware Avatar Playpen using sprite sheet animations.
 * Renders the pet in a grassy 3D-parallax yard and cycles through
 * sprite sheet frames when an action is triggered.
 */
export default function Avatar3DPlaypen({
  avatar,
  activeAction,
  onActionAnimationComplete,
  isDarkMode,
  onRetry,
}: Avatar3DPlaypenProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const spriteImgRef = useRef<HTMLImageElement | null>(null);
  const [spriteLoaded, setSpriteLoaded] = useState(false);
  const [spriteLoadFailed, setSpriteLoadFailed] = useState(false);
  const [currentFrame, setCurrentFrame] = useState(0);
  const [emojis, setEmojis] = useState<FloatingEmoji[]>([]);
  const animFrameRef = useRef<number>(0);
  const lastFrameTimeRef = useRef<number>(0);

  // 3D Parallax Hover Effect
  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);
  const rotateX = useTransform(mouseY, [-0.5, 0.5], [12, -12]);
  const rotateY = useTransform(mouseX, [-0.5, 0.5], [-12, 12]);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    mouseX.set((e.clientX - rect.left - rect.width / 2) / rect.width);
    mouseY.set((e.clientY - rect.top - rect.height / 2) / rect.height);
  };

  const handleMouseLeave = () => {
    mouseX.set(0);
    mouseY.set(0);
  };

  // Load sprite sheet image
  useEffect(() => {
    spriteImgRef.current = null;
    setSpriteLoaded(false);
    setSpriteLoadFailed(false);

    if (!avatar.sprite_sheet_url) return;

    const img = new Image();
    // Do not set crossOrigin here. Backblaze/public object storage may not send
    // Access-Control-Allow-Origin, and `crossOrigin = "anonymous"` turns that
    // into an image load failure. We only draw the sprite into the canvas; we do
    // not read pixels back from it, so a tainted canvas is acceptable.
    img.onload = () => {
      spriteImgRef.current = img;
      setSpriteLoaded(true);
      setSpriteLoadFailed(false);
    };
    img.onerror = () => {
      console.warn("Failed to load sprite sheet for avatar:", avatar.name, avatar.sprite_sheet_url);
      setSpriteLoaded(false);
      setSpriteLoadFailed(true);
    };
    img.src = avatar.sprite_sheet_url;
  }, [avatar.sprite_sheet_url]);

  // Get animation metadata with defaults
  const getAnimMeta = useCallback((): AnimationMetadata => {
    const defaults: AnimationMetadata = {
      frameWidth: 128,
      frameHeight: 128,
      animations: {
        eating: { row: 0, frames: 8, fps: 12 },
        drinking: { row: 1, frames: 8, fps: 12 },
        running: { row: 2, frames: 8, fps: 12 },
        playing: { row: 3, frames: 8, fps: 12 },
        sleeping: { row: 4, frames: 8, fps: 6 },
        photo: { row: 5, frames: 6, fps: 6 },
      },
    };

    if (avatar.animation_data) {
      const data = avatar.animation_data as AnimationMetadata;
      // Guard: if the server data is missing the animations map or individual
      // actions, merge with defaults so downstream code never indexes into
      // undefined (which caused the "Cannot read properties of undefined
      // (reading 'photo')" crash).
      return {
        frameWidth: data.frameWidth || defaults.frameWidth,
        frameHeight: data.frameHeight || defaults.frameHeight,
        animations: {
          ...defaults.animations,
          ...(data.animations || {}),
        },
      };
    }

    return defaults;
  }, [avatar.animation_data]);

  // Spawn floating emojis
  const spawnEmoji = useCallback((action: AvatarAction) => {
    const chars = ACTION_EMOJIS[action];
    const char = chars[Math.floor(Math.random() * chars.length)];
    const id = Date.now() + Math.random();
    const x = 40 + Math.random() * 20;
    const y = 35 + Math.random() * 15;

    setEmojis((prev) => [...prev, { id, char, x, y }]);
    setTimeout(() => {
      setEmojis((prev) => prev.filter((e) => e.id !== id));
    }, 2000);
  }, []);

  // Render sprite frame to canvas
  const renderFrame = useCallback(
    (action: AvatarAction, frame: number) => {
      const canvas = canvasRef.current;
      const img = spriteImgRef.current;
      if (!canvas || !img || !spriteLoaded) return;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const meta = getAnimMeta();
      const anim = meta.animations[action];
      if (!anim) return;

      const fw = meta.frameWidth;
      const fh = meta.frameHeight;
      const sx = frame * fw;
      const sy = anim.row * fh;

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Only draw if source coords are within image bounds
      if (sx + fw <= img.width && sy + fh <= img.height) {
        ctx.drawImage(img, sx, sy, fw, fh, 0, 0, canvas.width, canvas.height);
      }
    },
    [spriteLoaded, getAnimMeta]
  );

  // Animation loop when an action is active
  useEffect(() => {
    if (!activeAction || !spriteLoaded) return;

    const meta = getAnimMeta();
    const anim = meta.animations[activeAction];
    if (!anim) {
      onActionAnimationComplete();
      return;
    }

    let frame = 0;
    let loopCount = 0;
    const maxLoops = activeAction === "sleeping" ? 3 : 2; // How many times to play the animation
    const interval = 1000 / anim.fps;
    let lastTime = performance.now();

    // Spawn initial emoji
    spawnEmoji(activeAction);

    const tick = (time: number) => {
      if (time - lastTime >= interval) {
        lastTime = time;
        frame++;

        if (frame >= anim.frames) {
          loopCount++;
          if (loopCount >= maxLoops) {
            // Animation complete
            setCurrentFrame(0);
            renderFrame(activeAction, 0);
            spawnEmoji(activeAction);
            onActionAnimationComplete();
            return;
          }
          frame = 0;
          spawnEmoji(activeAction);
        }

        setCurrentFrame(frame);
        renderFrame(activeAction, frame);
      }

      animFrameRef.current = requestAnimationFrame(tick);
    };

    animFrameRef.current = requestAnimationFrame(tick);

    return () => {
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
      }
    };
  }, [activeAction, spriteLoaded, getAnimMeta, renderFrame, spawnEmoji, onActionAnimationComplete]);

  // Idle animation: gentle bob when no action is playing
  useEffect(() => {
    if (activeAction || !spriteLoaded) return;

    // Show idle frame (first frame of "photo" action as idle pose)
    renderFrame("photo", 0);
  }, [activeAction, spriteLoaded, renderFrame]);

  // Determine display mode
  const hasSpriteSheet = !!avatar.sprite_sheet_url && spriteLoaded;
  const isGenerating = avatar.generation_status !== "done" && avatar.generation_status !== "failed";
  const showSpriteError = avatar.generation_status === "done" && !hasSpriteSheet && !isGenerating;
  const showFallbackImage = (spriteLoadFailed || (!avatar.sprite_sheet_url && avatar.generation_status === "done")) && !!avatar.image_url;

  return (
    <div
      className="relative w-full aspect-square overflow-hidden rounded-t-3xl select-none"
      style={{ perspective: 1000 }}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      {/* 3D Tilting Yard */}
      <motion.div
        style={{
          rotateX,
          rotateY,
          transformStyle: "preserve-3d",
        }}
        className="w-full h-full bg-gradient-to-b from-emerald-100 to-emerald-200 dark:from-emerald-950/40 dark:to-emerald-900/30 flex flex-col justify-end relative transition-all duration-300 ease-out border-b border-outline-variant/10"
      >
        {/* Backyard fence */}
        <div className="absolute inset-x-0 top-0 h-10 border-b-2 border-emerald-900/10 dark:border-emerald-100/5 bg-emerald-800/10 dark:bg-emerald-950/20 flex justify-between px-6 items-center">
          <span className="text-[10px] opacity-40 font-bold tracking-widest text-emerald-900 dark:text-emerald-300">
            3D PLAYPEN
          </span>
          <div className="flex gap-1">
            <span className="text-xs">🪵</span>
            <span className="text-xs">🪵</span>
            <span className="text-xs">🪵</span>
          </div>
        </div>

        {/* Scattered grass/flowers */}
        <div className="absolute top-[40%] left-[20%] text-[10px] opacity-30">🌼</div>
        <div className="absolute top-[65%] left-[80%] text-[10px] opacity-35">🌸</div>
        <div className="absolute top-[55%] left-[45%] text-[10px] opacity-20">🌱</div>
        <div className="absolute top-[75%] left-[15%] text-[10px] opacity-25">🌼</div>

        {/* Generation Progress Overlay */}
        {isGenerating && (
          <div className="absolute inset-0 z-30 bg-black/40 backdrop-blur-sm flex flex-col items-center justify-center text-white">
            <div className="w-8 h-8 border-2 border-white/30 border-t-white rounded-full animate-spin mb-3" />
            <p className="text-xs font-bold mb-1">
              {avatar.generation_status === "pending" && "⏳ Analyzing photo..."}
              {avatar.generation_status === "generating_mesh" && "🧊 Generating 3D mesh..."}
              {avatar.generation_status === "rigging" && "🦴 Rigging skeleton..."}
              {avatar.generation_status === "baking_sprites" && "🎬 Baking animations..."}
            </p>
            <div className="flex gap-1 mt-2">
              {["pending", "generating_mesh", "rigging", "baking_sprites"].map((step, i) => (
                <div
                  key={step}
                  className={`w-2 h-2 rounded-full transition-all ${
                    getStepIndex(avatar.generation_status) >= i
                      ? "bg-green-400 scale-110"
                      : "bg-white/30"
                  }`}
                />
              ))}
            </div>
          </div>
        )}

        {/* Failed Overlay */}
        {avatar.generation_status === "failed" && (
          <div className="absolute inset-0 z-30 bg-red-900/40 backdrop-blur-sm flex flex-col items-center justify-center text-white px-4">
            <span className="text-2xl mb-2">⚠️</span>
            <p className="text-xs font-bold text-center">Generation Failed</p>
            <p className="text-[10px] opacity-70 text-center mt-1 max-w-[80%] mb-3">
              {avatar.generation_error || "Unknown error occurred during 3D generation."}
            </p>
            {onRetry && (
              <button
                onClick={() => onRetry(avatar.id)}
                className="px-4 py-2 bg-white/20 backdrop-blur-sm text-white text-[11px] font-bold rounded-full hover:bg-white/30 transition-all active:scale-95"
              >
                🔄 Retry Generation
              </button>
            )}
          </div>
        )}

        {/* Pet Avatar — GLB or Sprite fallback or Error state */}
        <div className="absolute inset-0 flex items-center justify-center">
          {avatar.model_url && !isGenerating ? (
            <div className="absolute inset-0 pb-10">
              <PetModelViewer
                src={avatar.model_url}
                animationName={activeAction || "photo"}
                autoRotate={false}
              />
            </div>
          ) : hasSpriteSheet ? (
            <motion.div
              animate={{
                y: activeAction ? [0, -8, 0] : [0, -3, 0],
                scale: activeAction === "playing" ? [1, 1.1, 1] : 1,
              }}
              transition={{
                y: {
                  repeat: activeAction ? 0 : Infinity,
                  duration: activeAction ? 0.3 : 2,
                  ease: "easeInOut",
                },
              }}
              className="relative"
            >
              <canvas
                ref={canvasRef}
                width={192}
                height={192}
                className="w-32 h-32 sm:w-40 sm:h-40 drop-shadow-xl"
                style={{ imageRendering: "auto" }}
              />
              {/* Shadow under pet */}
              <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 w-20 h-3 bg-black/15 dark:bg-black/30 rounded-full blur-[2px]" />
            </motion.div>
          ) : showSpriteError ? (
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="flex flex-col items-center text-center px-6"
            >
              {showFallbackImage ? (
                <img
                  src={avatar.image_url}
                  alt={avatar.name}
                  className="w-32 h-32 sm:w-40 sm:h-40 rounded-full object-cover drop-shadow-xl mb-3"
                />
              ) : (
                <span className="text-3xl mb-3">🔧</span>
              )}
              <p className="text-xs font-bold text-on-surface mb-1">Avatar Render Issue</p>
              <p className="text-[10px] text-on-surface-variant opacity-70 mb-3 max-w-[80%]">
                {spriteLoadFailed
                  ? "The avatar graphics failed to load. The avatar may need to be regenerated."
                  : "No graphics were generated for this avatar."}
              </p>
              {onRetry && (
                <button
                  onClick={() => onRetry(avatar.id)}
                  className="px-4 py-2 bg-primary text-white text-[11px] font-bold rounded-full hover:bg-primary/90 transition-all active:scale-95 shadow-md"
                >
                  🔄 Regenerate Avatar
                </button>
              )}
            </motion.div>
          ) : null}
        </div>

        {/* Floating Emojis */}
        <AnimatePresence>
          {emojis.map((e) => (
            <motion.div
              key={e.id}
              initial={{ opacity: 0, y: 0, scale: 0.5 }}
              animate={{ opacity: 1, y: -50, scale: 1.3 }}
              exit={{ opacity: 0, scale: 0.8 }}
              transition={{ duration: 1.8, ease: "easeOut" }}
              className="absolute text-xl font-bold select-none z-30 pointer-events-none drop-shadow-sm"
              style={{ left: `${e.x}%`, top: `${e.y}%` }}
            >
              {e.char}
            </motion.div>
          ))}
        </AnimatePresence>

        {/* Action indicator badge */}
        <AnimatePresence>
          {activeAction && (
            <motion.div
              initial={{ opacity: 0, scale: 0.5, y: -10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.5 }}
              className="absolute top-14 left-1/2 -translate-x-1/2 bg-black/60 text-white px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider z-30 backdrop-blur-sm"
            >
              {activeAction === "eating" && "🍖 Eating"}
              {activeAction === "drinking" && "💧 Drinking"}
              {activeAction === "running" && "🏃 Running"}
              {activeAction === "playing" && "🎾 Playing"}
              {activeAction === "sleeping" && "😴 Sleeping"}
              {activeAction === "photo" && "📸 Say Cheese!"}
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}

function getStepIndex(status: string): number {
  const steps = ["pending", "generating_mesh", "rigging", "baking_sprites"];
  return steps.indexOf(status);
}
