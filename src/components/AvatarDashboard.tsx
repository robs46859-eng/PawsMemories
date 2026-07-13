import React, { useState, useEffect, useCallback, useRef } from "react";
import { Avatar, PublicUser, UserProfile, AvatarAction } from "../types";
import { fetchAvatars, generate3DAvatar, retryAvatarGeneration, pollAvatarStatus, feedAvatarReq, waterAvatarReq, giveTreatReq, deleteAvatar } from "../api";
import CreateAvatarDialog, { type CreateModelOptions } from "./CreateAvatarDialog";
import Avatar3DPlaypen from "./Avatar3DPlaypen";
import LivingAvatarView from "./LivingAvatarView";
import RefundReview from "./RefundReview";
import BimModelBuilder from "./BimModelBuilder";
import { buildUncannyRegenerationHint, uncannyPresets } from "../avatar/uncannyPresets";
import { avatarGenerationCost } from "../pricing";
import { resolveAvatarGlbUrl } from "../animator/utils/avatarUtils";
import {
  Plus, Utensils, Droplets, Bone, RefreshCw, Info,
  Play, Camera, Moon, Zap, X, Sparkles, Clapperboard, Trash2
} from "lucide-react";

interface AvatarDashboardProps {
  userProfile: UserProfile;
  onUpdateUser: (user: UserProfile) => void;
  isDarkMode: boolean;
  onOpenCreditStore?: () => void;
  onGoToAnimator?: (assetId: string) => void;
}

const ACTION_CONFIGS: {
  action: AvatarAction;
  icon: React.ReactNode;
  label: string;
  color: string;
  bgColor: string;
}[] = [
  { action: "eating",   icon: <Utensils size={16} />, label: "Eat",     color: "text-green-600",  bgColor: "bg-green-500/10 hover:bg-green-500/20" },
  { action: "drinking", icon: <Droplets size={16} />,  label: "Drink",   color: "text-blue-600",   bgColor: "bg-blue-500/10 hover:bg-blue-500/20" },
  { action: "running",  icon: <Zap size={16} />,       label: "Run",     color: "text-orange-600", bgColor: "bg-orange-500/10 hover:bg-orange-500/20" },
  { action: "playing",  icon: <Play size={16} />,      label: "Play",    color: "text-pink-600",   bgColor: "bg-pink-500/10 hover:bg-pink-500/20" },
  { action: "sleeping", icon: <Moon size={16} />,      label: "Sleep",   color: "text-indigo-600", bgColor: "bg-indigo-500/10 hover:bg-indigo-500/20" },
  { action: "photo",    icon: <Camera size={16} />,    label: "Photo",   color: "text-purple-600", bgColor: "bg-purple-500/10 hover:bg-purple-500/20" },
];

/** Feature flag — set to true to re-enable the Tamagotchi care system (food/water bars, action buttons, treats). */
const TAMAGOTCHI_ENABLED = false;

export default function AvatarDashboard({ userProfile, onUpdateUser, isDarkMode, onOpenCreditStore, onGoToAnimator }: AvatarDashboardProps) {
  const [avatars, setAvatars] = useState<Avatar[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [refundAvatarId, setRefundAvatarId] = useState<number | null>(null);
  const [presetByAvatar, setPresetByAvatar] = useState<Record<number, string>>({});
  const [vibeMessage, setVibeMessage] = useState("");
  const [showBimBuilder, setShowBimBuilder] = useState(false);
  const holdTimerRef = useRef<number | null>(null);

  // Tracks active action animation for each avatar
  const [activeActions, setActiveActions] = useState<Record<number, AvatarAction | null>>({});
  const [livingAvatar, setLivingAvatar] = useState<Avatar | null>(null);

  // Track avatars currently being generated (for polling)
  const pollingRef = useRef<Record<number, ReturnType<typeof setInterval>>>({});

  const loadAvatars = async () => {
    setIsLoading(true);
    const data = await fetchAvatars();
    setAvatars(data);
    setIsLoading(false);
  };

  useEffect(() => {
    loadAvatars();
    return () => {
      // Cleanup polling intervals
      Object.values(pollingRef.current).forEach(clearInterval);
    };
  }, []);

  // Start polling for avatars that are still generating
  useEffect(() => {
    avatars.forEach((avatar) => {
      const status = avatar.generation_status;
      if (
        status !== "done" &&
        status !== "failed" &&
        !pollingRef.current[avatar.id]
      ) {
        // Start polling this avatar
        pollingRef.current[avatar.id] = setInterval(async () => {
          try {
            const statusData = await pollAvatarStatus(avatar.id);
            if (statusData.status === "done" || statusData.status === "failed") {
              // Stop polling and reload avatars
              clearInterval(pollingRef.current[avatar.id]);
              delete pollingRef.current[avatar.id];
              await loadAvatars();
            } else {
              // Update local state with current status
              setAvatars((prev) =>
                prev.map((a) =>
                  a.id === avatar.id
                    ? { ...a, generation_status: statusData.status as Avatar["generation_status"] }
                    : a
                )
              );
            }
          } catch (err) {
            console.error("Polling error:", err);
          }
        }, 5000); // Poll every 5 seconds
      }
    });

    // Cleanup polls for avatars that are done
    Object.keys(pollingRef.current).forEach((idStr) => {
      const id = Number(idStr);
      const avatar = avatars.find((a) => a.id === id);
      if (avatar && (avatar.generation_status === "done" || avatar.generation_status === "failed")) {
        clearInterval(pollingRef.current[id]);
        delete pollingRef.current[id];
      }
    });
  }, [avatars]);

  const handleDeleteAvatar = async (id: number, name: string) => {
    if (!confirm(`Delete "${name}"? This removes it from your models. This can't be undone.`)) return;
    try {
      await deleteAvatar(id);
      await loadAvatars();
    } catch (err: any) {
      alert(err?.message || "Failed to delete model.");
    }
  };

  const handleCreateAvatar = async (options: CreateModelOptions) => {
    const generationCost = avatarGenerationCost(options.avatarType, options.inputMode);
    if (!userProfile.isAdmin && userProfile.credits < generationCost) {
      alert(`You need ${generationCost} credits to create this model.`);
      return;
    }
    setCreating(true);
    try {
      // Translate the dialog's camelCase options to the server's snake_case contract.
      const payload = {
        name: options.name,
        avatar_type: options.avatarType,
        input_mode: options.inputMode,
        photos: options.photos,
        face_photo: options.facePhoto ?? null,
        subject: options.subject,
        palette: options.palette ?? null,
        style: options.style,
        // NOTE: detail, texture, lighting intentionally omitted.
        // The server falls back to its high-quality Tripo defaults.
      };
      const result = await generate3DAvatar(payload);

      const updatedUser = userProfile.isAdmin
        ? userProfile
        : { ...userProfile, credits: userProfile.credits - generationCost };
      onUpdateUser(updatedUser);

      setShowCreate(false);
      // Auto-detection: if the server detected a different subject class than the
      // user picked, it soft-switched and returned a notice — let the user know.
      if (result.notice) {
        alert(result.notice);
      }
      // Reload to get the new avatar with 'pending' status
      await loadAvatars();
    } catch (err: any) {
      if (err?.code === "MODEL_CAP_REACHED") {
        // Hard model-cap hit (Phase 9). Use the server's exact message (it has the
        // current limit number) with a friendly fallback. No credits were charged.
        alert(err.message || "You've reached your model limit. Delete a model to make room for a new one.");
      } else {
        alert(err.message || "Failed to create model.");
      }
    } finally {
      setCreating(false);
    }
  };

  // Trigger an action animation
  const handleActionClick = (action: AvatarAction, avatarId: number) => {
    if (activeActions[avatarId]) return; // Already animating
    setActiveActions((prev) => ({ ...prev, [avatarId]: action }));
  };

  // Called when the sprite animation finishes
  const handleActionAnimationComplete = useCallback(
    async (action: AvatarAction, avatarId: number) => {
      // Execute the backend API call based on the action
      try {
        if (action === "eating") {
          await feedAvatarReq(avatarId);
        } else if (action === "drinking") {
          await waterAvatarReq(avatarId);
        } else if (action === "playing" || action === "running") {
          // Playing and running are visual-only, no backend state change
        } else if (action === "sleeping") {
          // Sleeping is visual-only
        } else if (action === "photo") {
          // Photo pose is visual-only
        }
      } catch (err: any) {
        console.error("Action backend call failed:", err);
      }

      // Reset action
      setActiveActions((prev) => ({ ...prev, [avatarId]: null }));
      // Reload avatar data to get updated food/water levels
      await loadAvatars();
    },
    [loadAvatars],
  );

  // Retry a failed avatar generation
  const handleRetryGeneration = useCallback(async (avatarId: number) => {
    try {
      const result = await retryAvatarGeneration(avatarId);
      if (result.user) onUpdateUser({ ...userProfile, credits: result.user.credits });
      // Reload avatars to pick up the reset status
      await loadAvatars();
    } catch (err: any) {
      alert(err.message || "Failed to retry generation.");
    }
  }, [loadAvatars, onUpdateUser, userProfile]);

  const applyVibePreset = (avatarId: number, presetId: string) => {
    setPresetByAvatar((prev) => ({ ...prev, [avatarId]: presetId }));
    const hint = buildUncannyRegenerationHint(presetId);
    setVibeMessage(hint || "Lighter styling hint saved for the next restyle.");
    window.setTimeout(() => setVibeMessage(""), 3500);
  };

  const startLighterHold = (avatarId: number) => {
    if (holdTimerRef.current) window.clearTimeout(holdTimerRef.current);
    holdTimerRef.current = window.setTimeout(async () => {
      applyVibePreset(avatarId, "pixar_soft");
      setVibeMessage("🐶 Lighter retry started.");
      try {
        const result = await retryAvatarGeneration(avatarId);
        if (result.user) onUpdateUser({ ...userProfile, credits: result.user.credits });
        await loadAvatars();
      } catch (err: any) {
        setVibeMessage(err.message || "Could not start the lighter retry.");
      }
    }, 4000);
  };

  const cancelLighterHold = () => {
    if (holdTimerRef.current) window.clearTimeout(holdTimerRef.current);
    holdTimerRef.current = null;
  };

  const calculateDecay = (timestamp: string, currentLevel: number) => {
    const lastTime = new Date(timestamp).getTime();
    const now = Date.now();
    const hoursElapsed = (now - lastTime) / (1000 * 60 * 60);
    return Math.max(0, currentLevel - Math.floor(hoursElapsed * 5));
  };

  if (isLoading) {
    return (
      <div className="flex-grow flex items-center justify-center">
        <RefreshCw className="animate-spin text-primary opacity-50" size={32} />
      </div>
    );
  }

  return (
    <div className="w-full max-w-5xl mx-auto px-4 py-8 pb-24 pt-24 flex flex-col items-center">
      {/* Header */}
      <div className="w-full flex justify-between items-end mb-8">
        <div>
          <h1 className="text-3xl font-extrabold text-on-surface mb-1 flex items-center gap-2 font-headline-xl">
            <Sparkles className="text-primary" size={26} /> My Models
          </h1>
          <p className="text-sm text-on-surface-variant max-w-md font-sans">
            Your generated 3D models and avatars.
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          {TAMAGOTCHI_ENABLED && (
            <div className="glass-panel py-1.5 px-4 rounded-full border border-outline-variant/30 flex items-center gap-2 shadow-sm">
              <Bone size={14} className="text-amber-500" />
              <span className="text-xs font-bold text-on-surface font-label-caps">
                {userProfile.treats} Treats
              </span>
            </div>
          )}
          <button
            data-tour="avatar-create"
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 bg-primary text-on-primary px-5 py-2.5 rounded-full text-xs font-black uppercase tracking-wider shadow-md hover:bg-primary/90 transition-all tactile-button"
          >
            <Plus size={16} /> Create Model
          </button>
          <button onClick={() => setShowBimBuilder(true)} className="rounded-full border border-primary/30 bg-surface px-5 py-2 text-xs font-black uppercase tracking-wider text-primary">Scaled BIM Builder</button>
        </div>
      </div>

      {avatars.length === 0 ? (
        <div className="flex flex-col items-center justify-center p-12 bg-surface-container/60 rounded-3xl border border-outline-variant/30 backdrop-blur-xl animate-fade-in text-center max-w-2xl mx-auto shadow-sm">
          <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center mb-4">
            <Sparkles size={32} className="text-primary" />
          </div>
          <h3 className="text-xl font-bold text-on-surface mb-2 font-headline-lg">No Models Yet</h3>
          <p className="text-sm text-on-surface-variant mb-6 max-w-sm font-sans">
            Generate your first 3D model! You can create fully animated humans and dogs, or generic objects.
          </p>
          <button
            data-tour="avatar-create-first"
            onClick={() => setShowCreate(true)}
            className="bg-primary text-white px-6 py-3 rounded-full text-sm font-black uppercase tracking-wider shadow-lg hover:shadow-xl hover:-translate-y-0.5 transition-all tactile-button"
          >
            Create Your First Model
          </button>
        </div>
      ) : (
        <div className="w-full grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {avatars.map((avatar) => {
            const currentFood = calculateDecay(avatar.last_fed, avatar.food_level);
            const currentWater = calculateDecay(avatar.last_watered, avatar.water_level);
            const isHungry = currentFood < 30;
            const isThirsty = currentWater < 30;
            const isAnimating = !!activeActions[avatar.id];
            const isReady = avatar.generation_status === "done";

            return (
              <div
                key={avatar.id}
                className="glass-panel rounded-3xl overflow-hidden shadow-lg border border-outline-variant/20 flex flex-col transition-all hover:-translate-y-1 hover:shadow-xl"
              >
                {/* 3D Playpen */}
                <div className="relative aspect-square bg-slate-900/5 dark:bg-slate-100/5">
                  <button
                    onClick={() => handleDeleteAvatar(avatar.id, avatar.name)}
                    className="absolute top-2 right-2 z-20 w-8 h-8 flex items-center justify-center rounded-full bg-black/40 hover:bg-error/80 text-white/80 hover:text-white backdrop-blur-sm transition-colors"
                    title="Delete this model"
                    aria-label={`Delete ${avatar.name}`}
                  >
                    <Trash2 size={15} />
                  </button>
                  <Avatar3DPlaypen
                    avatar={avatar}
                    activeAction={activeActions[avatar.id] || null}
                    onActionAnimationComplete={() => {
                      const action = activeActions[avatar.id];
                      if (action) handleActionAnimationComplete(action, avatar.id);
                    }}
                    isDarkMode={isDarkMode}
                    onRetry={handleRetryGeneration}
                  />
                  <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/70 to-transparent pointer-events-none z-10" />
                  {isReady && (
                    <>
                      <button
                        onClick={() => setLivingAvatar(avatar)}
                        className="absolute top-4 left-4 z-30 bg-primary text-on-primary px-3 py-1.5 rounded-full text-xs font-bold shadow-lg hover:bg-primary/90 flex items-center gap-1 tactile-button"
                      >
                        <Sparkles size={12} /> Live 3D
                      </button>
                      <button
                        onClick={() => {
                          const glbUrl = resolveAvatarGlbUrl({ ...avatar, id: String(avatar.id) });
                          if (glbUrl) onGoToAnimator?.(glbUrl);
                        }}
                        className="absolute top-4 right-4 z-30 bg-secondary text-on-secondary px-3 py-1.5 rounded-full text-xs font-bold shadow-lg hover:bg-secondary/90 flex items-center gap-1 tactile-button"
                      >
                        <Clapperboard size={12} /> Studio
                      </button>
                    </>
                  )}
                  <h3 className="absolute bottom-4 left-4 text-white text-2xl font-black drop-shadow-md z-20 font-headline-lg-mobile">
                    {avatar.name}
                  </h3>
                  {avatar.breed && (
                    <span className="absolute bottom-5 right-4 text-white text-[10px] font-bold uppercase tracking-wider z-20 bg-white/20 backdrop-blur-md px-2 py-0.5 rounded-full shadow-sm">
                      {avatar.breed}
                    </span>
                  )}
                  {TAMAGOTCHI_ENABLED && (isHungry || isThirsty) && isReady && (
                    <div className="absolute top-14 right-4 bg-error text-white px-3 py-1 rounded-full text-xs font-bold flex items-center gap-1 shadow-lg animate-pulse z-20">
                      <Info size={12} /> Needs care!
                    </div>
                  )}
                </div>

                <div className="p-5 flex flex-col gap-4">
                  <div className="rounded-2xl border border-outline-variant/30 bg-surface-container-low p-3">
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <div>
                        <h4 className="text-sm font-black text-on-surface">Fix the vibe</h4>
                        <p className="text-[11px] text-on-surface-variant">Realistic can feel a little uncanny. Try a softer look.</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          applyVibePreset(avatar.id, "pixar_soft");
                          setVibeMessage("😛 Lighter styling hint saved. Hold for 4 seconds to retry.");
                        }}
                        onPointerDown={() => startLighterHold(avatar.id)}
                        onPointerUp={cancelLighterHold}
                        onPointerLeave={cancelLighterHold}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") startLighterHold(avatar.id);
                        }}
                        onKeyUp={cancelLighterHold}
                        className="min-h-11 min-w-11 rounded-full bg-primary/10 text-primary text-xl font-black"
                        aria-label="Lighter styling. Hold for four seconds to retry."
                      >
                        {presetByAvatar[avatar.id] === "pixar_soft" ? "🐶" : "😛"}
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {uncannyPresets.slice(0, 4).map((preset) => (
                        <button
                          key={preset.id}
                          type="button"
                          onClick={() => applyVibePreset(avatar.id, preset.id)}
                          className={`min-h-10 rounded-xl text-[11px] font-black border ${presetByAvatar[avatar.id] === preset.id ? "bg-primary text-on-primary" : "border-outline-variant text-on-surface"}`}
                          title={preset.hint}
                        >
                          {preset.name}
                        </button>
                      ))}
                    </div>
                    <button type="button" onClick={() => setRefundAvatarId(avatar.id)} className="mt-3 w-full min-h-10 rounded-xl border border-primary/30 text-primary text-xs font-black">
                      Review for refund or retry
                    </button>
                  </div>

                  {isReady && TAMAGOTCHI_ENABLED && (
                    <>
                      {/* Food Bar */}
                      <div className="flex flex-col gap-1">
                        <div className="flex justify-between text-xs font-bold text-on-surface">
                          <span className="flex items-center gap-1 opacity-80">
                            <Utensils size={12} /> Food
                          </span>
                          <span>{currentFood}%</span>
                        </div>
                        <div className="w-full h-2.5 bg-outline-variant/30 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all duration-1000 ${
                              currentFood > 50
                                ? "bg-green-500"
                                : currentFood > 20
                                ? "bg-amber-500"
                                : "bg-error"
                            }`}
                            style={{ width: `${currentFood}%` }}
                          />
                        </div>
                      </div>

                      {/* Water Bar */}
                      <div className="flex flex-col gap-1">
                        <div className="flex justify-between text-xs font-bold text-on-surface">
                          <span className="flex items-center gap-1 opacity-80">
                            <Droplets size={12} /> Water
                          </span>
                          <span>{currentWater}%</span>
                        </div>
                        <div className="w-full h-2.5 bg-outline-variant/30 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all duration-1000 ${
                              currentWater > 50
                                ? "bg-blue-500"
                                : currentWater > 20
                                ? "bg-amber-500"
                                : "bg-error"
                            }`}
                            style={{ width: `${currentWater}%` }}
                          />
                        </div>
                      </div>

                      {/* 6 Action Buttons */}
                      <div className="grid grid-cols-3 gap-2 mt-1">
                        {ACTION_CONFIGS.map(({ action, icon, label, color, bgColor }) => (
                          <button
                            key={action}
                            onClick={() => handleActionClick(action, avatar.id)}
                            disabled={isAnimating || !isReady}
                            className={`flex flex-col items-center justify-center gap-1 ${bgColor} ${color} disabled:opacity-40 py-2.5 rounded-xl transition-all cursor-pointer tactile-button font-label-caps`}
                          >
                            {icon}
                            <span className="text-[10px] font-black uppercase">{label}</span>
                          </button>
                        ))}
                      </div>

                      {/* Treat Button (separate, full width) */}
                      <button
                        onClick={() => handleActionClick("eating", avatar.id)}
                        disabled={
                          userProfile.treats <= 0 || currentFood >= 100 || isAnimating
                        }
                        className="flex items-center justify-center gap-2 bg-amber-500/10 text-amber-600 hover:bg-amber-500/20 disabled:opacity-40 py-2 rounded-xl transition-colors cursor-pointer tactile-button font-label-caps"
                        title={`Give a treat (${userProfile.treats} available)`}
                      >
                        <Bone size={14} />
                        <span className="text-[10px] font-black uppercase">
                          Give Treat ({userProfile.treats})
                        </span>
                      </button>
                    </>
                  )}

                  {/* Generation in progress message */}
                  {!isReady && avatar.generation_status !== "failed" && (
                    <div className="flex items-center gap-3 py-2">
                      <RefreshCw size={14} className="animate-spin text-primary" />
                      <span className="text-xs font-bold text-on-surface-variant">
                        Generating 3D avatar...
                      </span>
                    </div>
                  )}

                  {/* Failed message */}
                  {avatar.generation_status === "failed" && (
                    <div className="bg-error/10 text-error rounded-xl px-4 py-3 text-xs font-bold">
                      ⚠️ Generation failed: {avatar.generation_error || "Unknown error"}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showCreate && (
        <CreateAvatarDialog
          isDarkMode={isDarkMode}
          onClose={() => setShowCreate(false)}
          onSubmit={handleCreateAvatar}
        />
      )}

      {creating && (
        <div className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm flex flex-col items-center justify-center text-white">
          <RefreshCw className="animate-spin mb-4" size={32} />
          <p className="font-bold">Creating hyper-realistic reference image & starting 3D generation...</p>
          <p className="text-sm opacity-60 mt-1">This will just take a moment</p>
        </div>
      )}

      {livingAvatar && (
        <div className="fixed inset-0 z-[70] bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="glass-panel bg-surface-container/80 backdrop-blur-md rounded-3xl w-full max-w-2xl h-[85vh] flex flex-col overflow-hidden shadow-2xl border border-outline-variant/20">
            <div className="flex justify-between items-center p-4 border-b border-outline-variant/20">
              <h2 className="font-extrabold text-on-surface flex items-center gap-2">
                <Sparkles size={16} className="text-primary" />
                {livingAvatar.name} — Live 3D
                <span className="text-[10px] uppercase opacity-50 tracking-wider">beta</span>
              </h2>
              <button
                onClick={() => setLivingAvatar(null)}
                className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-black/10 text-on-surface"
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>
            <div className="flex-1 min-h-0">
              <LivingAvatarView avatar={livingAvatar} isDarkMode={isDarkMode} />
            </div>
          </div>
        </div>
      )}
      {vibeMessage && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[80] rounded-2xl bg-primary text-on-primary px-5 py-3 text-sm font-black shadow-xl">
          {vibeMessage}
        </div>
      )}
      {refundAvatarId && <RefundReview avatarId={refundAvatarId} onClose={() => setRefundAvatarId(null)} />}
      {showBimBuilder && <BimModelBuilder onClose={() => setShowBimBuilder(false)} />}
    </div>
  );
}
