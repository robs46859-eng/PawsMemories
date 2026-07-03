import React, { useState, useEffect, useCallback, useRef } from "react";
import { Avatar, PublicUser, UserProfile, AvatarAction } from "../types";
import { fetchAvatars, generate3DAvatar, retryAvatarGeneration, pollAvatarStatus, feedAvatarReq, waterAvatarReq, giveTreatReq } from "../api";
import CreateAvatarDialog from "./CreateAvatarDialog";
import Avatar3DPlaypen from "./Avatar3DPlaypen";
import {
  Plus, Utensils, Droplets, Bone, RefreshCw, Info,
  Play, Camera, Moon, Zap
} from "lucide-react";

interface AvatarDashboardProps {
  userProfile: UserProfile;
  onUpdateUser: (user: PublicUser) => void;
  isDarkMode: boolean;
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

export default function AvatarDashboard({ userProfile, onUpdateUser, isDarkMode }: AvatarDashboardProps) {
  const [avatars, setAvatars] = useState<Avatar[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);

  // Tracks active action animation for each avatar
  const [activeActions, setActiveActions] = useState<Record<number, AvatarAction | null>>({});

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

  const handleCreateAvatar = async (name: string, photos: string[]) => {
    setCreating(true);
    try {
      const result = await generate3DAvatar(name, photos);
      setShowCreate(false);
      // Reload to get the new avatar with 'pending' status
      await loadAvatars();
    } catch (err: any) {
      alert(err.message || "Failed to create avatar.");
    }
    setCreating(false);
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
    [],
  );

  // Retry a failed avatar generation
  const handleRetryGeneration = useCallback(async (avatarId: number) => {
    try {
      await retryAvatarGeneration(avatarId);
      // Reload avatars to pick up the reset status
      await loadAvatars();
    } catch (err: any) {
      alert(err.message || "Failed to retry generation.");
    }
  }, []);

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
    <div className="w-full max-w-5xl mx-auto px-4 py-6 pb-24 flex flex-col items-center">
      {/* Header */}
      <div className="w-full flex justify-between items-end mb-8">
        <div>
          <h2 className="text-3xl font-black tracking-tight text-on-surface">3D Avatars</h2>
          <p className="text-sm text-on-surface-variant font-medium mt-1">
            Upload a pet photo to generate animated 3D avatars!
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="bg-surface-container py-1.5 px-4 rounded-full border border-outline-variant/30 flex items-center gap-2 shadow-sm">
            <Bone size={14} className="text-amber-500" />
            <span className="text-xs font-bold text-on-surface">
              {userProfile.treats} Treats
            </span>
          </div>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 bg-primary text-white px-4 py-2 rounded-full text-xs font-black uppercase tracking-wider shadow-md hover:bg-primary/90 transition-all active:scale-95"
          >
            <Plus size={14} /> New 3D Avatar
          </button>
        </div>
      </div>

      {avatars.length === 0 ? (
        <div className="w-full flex flex-col items-center justify-center p-12 bg-surface-container rounded-3xl border border-dashed border-outline-variant/50">
          <span className="text-6xl mb-4 opacity-50">🐾</span>
          <h3 className="text-lg font-bold text-on-surface mb-2">No Avatars Yet</h3>
          <p className="text-sm text-on-surface-variant text-center max-w-sm mb-6">
            Upload a photo of your pet and our AI will create a fully animated 3D avatar!
          </p>
          <button
            onClick={() => setShowCreate(true)}
            className="bg-primary text-white px-6 py-3 rounded-xl font-bold hover:shadow-lg transition-all"
          >
            Create 3D Avatar
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
                className="bg-surface-container rounded-3xl overflow-hidden shadow-lg border border-outline-variant/20 flex flex-col transition-all hover:-translate-y-1 hover:shadow-xl"
              >
                {/* 3D Playpen */}
                <div className="relative aspect-square bg-slate-900/5 dark:bg-slate-100/5">
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
                  <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/60 to-transparent pointer-events-none z-10" />
                  <h3 className="absolute bottom-4 left-4 text-white text-2xl font-black drop-shadow-md z-20">
                    {avatar.name}
                  </h3>
                  {avatar.breed && (
                    <span className="absolute bottom-4 right-4 text-white/70 text-[10px] font-bold uppercase tracking-wider z-20 bg-white/10 backdrop-blur-sm px-2 py-0.5 rounded-full">
                      {avatar.breed}
                    </span>
                  )}
                  {(isHungry || isThirsty) && isReady && (
                    <div className="absolute top-4 right-4 bg-error text-white px-3 py-1 rounded-full text-xs font-bold flex items-center gap-1 shadow-lg animate-pulse z-20">
                      <Info size={12} /> Needs care!
                    </div>
                  )}
                </div>

                <div className="p-5 flex flex-col gap-4">
                  {isReady && (
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
                            className={`flex flex-col items-center justify-center gap-1 ${bgColor} ${color} disabled:opacity-40 py-2.5 rounded-xl transition-all cursor-pointer active:scale-95`}
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
                        className="flex items-center justify-center gap-2 bg-amber-500/10 text-amber-600 hover:bg-amber-500/20 disabled:opacity-40 py-2 rounded-xl transition-colors cursor-pointer active:scale-95"
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
    </div>
  );
}
