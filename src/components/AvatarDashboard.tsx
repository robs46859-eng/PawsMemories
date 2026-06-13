import React, { useState, useEffect } from "react";
import { Avatar, PublicUser, UserProfile } from "../types";
import { fetchAvatars, createNewAvatar, feedAvatarReq, waterAvatarReq, giveTreatReq } from "../api";
import CreateAvatarDialog from "./CreateAvatarDialog";
import AvatarPlaypen from "./AvatarPlaypen";
import { Plus, Coffee, Droplets, Bone, RefreshCw, Info } from "lucide-react";

interface AvatarDashboardProps {
  userProfile: UserProfile;
  onUpdateUser: (user: PublicUser) => void;
  isDarkMode: boolean;
}

export default function AvatarDashboard({ userProfile, onUpdateUser, isDarkMode }: AvatarDashboardProps) {
  const [avatars, setAvatars] = useState<Avatar[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);

  // Tracks active animation triggers for each avatar
  const [actionTriggers, setActionTriggers] = useState<Record<number, { type: "feed" | "water" | "treat"; timestamp: number } | null>>({});

  const loadAvatars = async () => {
    setIsLoading(true);
    const data = await fetchAvatars();
    setAvatars(data);
    setIsLoading(false);
  };

  useEffect(() => {
    loadAvatars();
  }, []);

  const handleCreateAvatar = async (name: string, python_script: string) => {
    setCreating(true);
    try {
      await createNewAvatar(name, python_script);
      setShowCreate(false);
      await loadAvatars();
    } catch (err: any) {
      alert(err.message || "Failed to create avatar.");
    }
    setCreating(false);
  };

  // 1. Triggers the local animation in the playpen
  const handleActionClick = (actionType: "feed" | "water" | "treat", id: number) => {
    if (actionTriggers[id]) return; // Action already playing

    setActionTriggers((prev) => ({
      ...prev,
      [id]: { type: actionType, timestamp: Date.now() },
    }));
  };

  // 2. Executes the API call once the pet eats the dropped item
  const handleActionComplete = async (actionType: "feed" | "water" | "treat", id: number) => {
    try {
      if (actionType === "feed") {
        await feedAvatarReq(id);
      } else if (actionType === "water") {
        await waterAvatarReq(id);
      } else if (actionType === "treat") {
        const res = await giveTreatReq(id);
        if (res.success && res.user) {
          onUpdateUser(res.user);
        }
      }
    } catch (err: any) {
      alert(err.message || "Action failed.");
    } finally {
      // Reset the trigger and reload avatar data from server
      setActionTriggers((prev) => ({
        ...prev,
        [id]: null,
      }));
      await loadAvatars();
    }
  };

  const calculateDecay = (timestamp: string, currentLevel: number) => {
    const lastTime = new Date(timestamp).getTime();
    const now = Date.now();
    const hoursElapsed = (now - lastTime) / (1000 * 60 * 60);
    // Lose 5 points per hour
    const newLevel = Math.max(0, currentLevel - Math.floor(hoursElapsed * 5));
    return newLevel;
  };

  if (isLoading) {
    return (
      <div className="flex-grow flex items-center justify-center">
        <RefreshCw className="animate-spin text-primary opacity-50" size={32} />
      </div>
    );
  }

  return (
    <div className="w-full max-w-4xl mx-auto px-4 py-6 pb-24 flex flex-col items-center">
      
      <div className="w-full flex justify-between items-end mb-8">
        <div>
          <h2 className="text-3xl font-black tracking-tight text-on-surface">Avatars</h2>
          <p className="text-sm text-on-surface-variant font-medium mt-1">
            Feed, water, and give treats to your digital pets!
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
            <Plus size={14} /> New Avatar
          </button>
        </div>
      </div>

      {avatars.length === 0 ? (
        <div className="w-full flex flex-col items-center justify-center p-12 bg-surface-container rounded-3xl border border-dashed border-outline-variant/50">
          <span className="text-6xl mb-4 opacity-50">🐾</span>
          <h3 className="text-lg font-bold text-on-surface mb-2">No Avatars Yet</h3>
          <p className="text-sm text-on-surface-variant text-center max-w-sm mb-6">
            Create your first avatar from an uploaded photo or pick a cute preset to get started!
          </p>
          <button
            onClick={() => setShowCreate(true)}
            className="bg-primary text-white px-6 py-3 rounded-xl font-bold hover:shadow-lg transition-all"
          >
            Create Avatar
          </button>
        </div>
      ) : (
        <div className="w-full grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {avatars.map(avatar => {
            const currentFood = calculateDecay(avatar.last_fed, avatar.food_level);
            const currentWater = calculateDecay(avatar.last_watered, avatar.water_level);
            
            const isHungry = currentFood < 30;
            const isThirsty = currentWater < 30;
            const isAnimating = !!actionTriggers[avatar.id];

            return (
              <div key={avatar.id} className="bg-surface-container rounded-3xl overflow-hidden shadow-lg border border-outline-variant/20 flex flex-col transition-all hover:-translate-y-1 hover:shadow-xl">
                {/* 3D Playpen Yard */}
                <div className="relative aspect-square bg-slate-900/5 dark:bg-slate-100/5">
                  <AvatarPlaypen
                    avatar={avatar}
                    actionTrigger={actionTriggers[avatar.id] || null}
                    onActionComplete={handleActionComplete}
                    isDarkMode={isDarkMode}
                  />
                  <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/60 to-transparent pointer-events-none z-10" />
                  <h3 className="absolute bottom-4 left-4 text-white text-2xl font-black drop-shadow-md z-20">
                    {avatar.name}
                  </h3>
                  {(isHungry || isThirsty) && (
                    <div className="absolute top-4 right-4 bg-error text-white px-3 py-1 rounded-full text-xs font-bold flex items-center gap-1 shadow-lg animate-pulse z-20">
                      <Info size={12} /> Needs care!
                    </div>
                  )}
                </div>

                <div className="p-5 flex flex-col gap-4">
                  
                  {/* Food Bar */}
                  <div className="flex flex-col gap-1">
                    <div className="flex justify-between text-xs font-bold text-on-surface">
                      <span className="flex items-center gap-1 opacity-80"><Coffee size={12}/> Food</span>
                      <span>{currentFood}%</span>
                    </div>
                    <div className="w-full h-2.5 bg-outline-variant/30 rounded-full overflow-hidden">
                      <div 
                        className={`h-full rounded-full transition-all duration-1000 ${currentFood > 50 ? 'bg-green-500' : currentFood > 20 ? 'bg-amber-500' : 'bg-error'}`} 
                        style={{ width: `${currentFood}%` }}
                      />
                    </div>
                  </div>

                  {/* Water Bar */}
                  <div className="flex flex-col gap-1">
                    <div className="flex justify-between text-xs font-bold text-on-surface">
                      <span className="flex items-center gap-1 opacity-80"><Droplets size={12}/> Water</span>
                      <span>{currentWater}%</span>
                    </div>
                    <div className="w-full h-2.5 bg-outline-variant/30 rounded-full overflow-hidden">
                      <div 
                        className={`h-full rounded-full transition-all duration-1000 ${currentWater > 50 ? 'bg-blue-500' : currentWater > 20 ? 'bg-amber-500' : 'bg-error'}`} 
                        style={{ width: `${currentWater}%` }}
                      />
                    </div>
                  </div>

                  {/* Action Buttons */}
                  <div className="grid grid-cols-3 gap-2 mt-2">
                    <button 
                      onClick={() => handleActionClick("feed", avatar.id)}
                      disabled={currentFood >= 100 || isAnimating}
                      className="flex flex-col items-center justify-center gap-1 bg-green-500/10 text-green-600 hover:bg-green-500/20 disabled:opacity-50 py-2 rounded-xl transition-colors cursor-pointer"
                    >
                      <Coffee size={16} />
                      <span className="text-[10px] font-black uppercase">Feed</span>
                    </button>
                    <button 
                      onClick={() => handleActionClick("water", avatar.id)}
                      disabled={currentWater >= 100 || isAnimating}
                      className="flex flex-col items-center justify-center gap-1 bg-blue-500/10 text-blue-600 hover:bg-blue-500/20 disabled:opacity-50 py-2 rounded-xl transition-colors cursor-pointer"
                    >
                      <Droplets size={16} />
                      <span className="text-[10px] font-black uppercase">Water</span>
                    </button>
                    <button 
                      onClick={() => handleActionClick("treat", avatar.id)}
                      disabled={userProfile.treats <= 0 || currentFood >= 100 || isAnimating}
                      className="flex flex-col items-center justify-center gap-1 bg-amber-500/10 text-amber-600 hover:bg-amber-500/20 disabled:opacity-50 py-2 rounded-xl transition-colors relative cursor-pointer"
                    >
                      <Bone size={16} />
                      <span className="text-[10px] font-black uppercase">Treat</span>
                    </button>
                  </div>

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
           <p className="font-bold">Creating avatar...</p>
         </div>
      )}

    </div>
  );
}
