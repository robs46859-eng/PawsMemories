import React, { useState } from "react";
import { Plus, Sparkles, ArrowRight, Clapperboard, PawPrint, BookOpen, Shirt } from "lucide-react";
import { Album, Creation, UserProfile } from "../types";
import { Achievement } from "./AchievementsPanel";

interface DashboardProps {
  userProfile: UserProfile;
  albums: Album[];
  creations: Creation[];
  onAddMemory: () => void;
  onCreate: () => void;
  onClaimDailyBonus: () => void;
  onShareCompleted: (platform: string, reward: number) => void;
  onSelectCreation: (creation: Creation) => void;
  streak: number;
  achievements: Achievement[];
  onClaimReward: (id: string, amount: number) => void;
  onClaimDailyStreak: () => void;
  dailyStreakClaimed: boolean;
  onSelectAlbum: (album: Album) => void;
  onCreateAlbum: (name: string) => Promise<void>;
  onOpenAdminPanel?: () => void;
  /** Navigate to the animation studio. */
  onOpenAnimator?: () => void;
  /** Navigate to the Furball3D avatar builder. */
  onOpenFurball?: () => void;
  /** Navigate to Pawprints. */
  onOpenPawprints?: () => void;
  /** Navigate to Fido's Styles. */
  onOpenFidos?: () => void;
}

export default function Dashboard({ userProfile, streak, dailyStreakClaimed, onClaimDailyStreak, onCreate, onOpenAnimator, onOpenFurball, onOpenPawprints, onOpenFidos }: DashboardProps) {
  const [isHoveringAR, setIsHoveringAR] = useState(false);
  const petName = userProfile.fullName.split(" ")[0] + "'s Pet"; // Defaulting to something nice

  return (
    <div className="w-full h-full min-h-[calc(100dvh-64px)] flex flex-col items-center justify-between pt-12 pb-24 md:pb-12 px-6 relative overflow-hidden">
      
      {/* Top Section: Daily Streak & Welcome */}
      <div className="w-full max-w-5xl flex justify-between items-start z-10 pt-4 md:pt-0">
        <div>
          <h1 className="text-2xl md:text-4xl font-extrabold text-on-surface drop-shadow-md">
            Welcome back, <br className="md:hidden" /><span className="text-primary">{userProfile.fullName.split(" ")[0]}!</span>
          </h1>
          <p className="text-on-surface-variant text-sm md:text-base mt-1.5 font-medium">Ready for another adventure?</p>
        </div>
        
        {/* Streak Badge */}
        <button 
          onClick={() => !dailyStreakClaimed && onClaimDailyStreak()}
          className={`flex flex-col items-center justify-center p-3 rounded-2xl backdrop-blur-xl border transition-all ${dailyStreakClaimed ? 'bg-primary/20 border-primary/30' : 'bg-surface/50 border-white/20 hover:scale-105 cursor-pointer shadow-lg'}`}
        >
          <div className="flex items-center gap-1.5">
            <Sparkles className={dailyStreakClaimed ? "text-primary" : "text-amber-400"} size={18} />
            <span className="font-bold text-xl leading-none">{streak}</span>
          </div>
          <span className="text-[10px] font-extrabold uppercase tracking-wider mt-1 opacity-80">Day Streak</span>
        </button>
      </div>

      {/* Center: Floating Active Avatar */}
      <div className="flex-1 w-full flex flex-col items-center justify-center relative z-10 my-8">
        {/* Soft glowing aura */}
        <div className="absolute w-[210px] h-[210px] bg-primary/20 rounded-full blur-[70px] animate-pulse"></div>

        {/* Create Button — solid/opaque, navigates to the avatar builder */}
        <button
          data-tour="dashboard-create"
          onClick={onCreate}
          onMouseEnter={() => setIsHoveringAR(true)}
          onMouseLeave={() => setIsHoveringAR(false)}
          className="mt-6 group relative flex items-center gap-2.5 bg-primary text-on-primary px-6 py-3 rounded-2xl shadow-xl shadow-primary/30 focus:outline-none focus:ring-4 focus:ring-primary/40 transition-transform hover:scale-105 active:scale-95 cursor-pointer"
        >
          <span className={`w-8 h-8 rounded-full bg-on-primary/20 flex items-center justify-center transition-transform duration-300 ${isHoveringAR ? 'scale-110' : ''}`}>
            <Plus size={18} strokeWidth={3} />
          </span>
          <span className="font-extrabold text-base tracking-wide">Create</span>
        </button>
      </div>

      {/* Bottom: Quick-access action cards */}
      <div className="w-full max-w-6xl grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 md:gap-6 z-10">

        {/* Animation Card → Animation Studio */}
        <button
          type="button"
          onClick={() => onOpenAnimator?.()}
          className="glass-card p-5 rounded-3xl flex items-center justify-between border-t border-white/20 group cursor-pointer text-left hover:scale-[1.02] active:scale-95 transition-transform"
        >
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Clapperboard size={16} className="text-primary" />
              <span className="text-xs font-extrabold uppercase tracking-widest opacity-70">Animation</span>
            </div>
            <h3 className="font-headline-lg text-lg font-bold">Open Studio</h3>
            <div className="mt-1 flex items-center gap-1 text-primary text-xs font-bold group-hover:underline">
              Animate {petName} <ArrowRight size={12} />
            </div>
          </div>
          <span className="w-14 h-14 bg-primary-container rounded-2xl flex items-center justify-center text-primary-fixed shadow-inner group-hover:scale-110 transition-transform">
            <Clapperboard size={22} />
          </span>
        </button>

        <button
          type="button"
          onClick={() => onOpenFidos?.()}
          className="glass-card p-5 rounded-3xl flex items-center justify-between border-t border-white/20 group cursor-pointer text-left hover:scale-[1.02] active:scale-95 transition-transform"
        >
          <div>
            <div className="flex items-center gap-2 mb-1"><Shirt size={16} className="text-primary" /><span className="text-xs font-extrabold uppercase tracking-widest opacity-70">Fido's Styles</span></div>
            <h3 className="font-headline-lg text-lg font-bold">Style & Wardrobe</h3>
            <div className="mt-1 flex items-center gap-1 text-primary text-xs font-bold group-hover:underline">Open control panel <ArrowRight size={12} /></div>
          </div>
          <span className="w-14 h-14 bg-primary-container rounded-2xl flex items-center justify-center text-primary-fixed shadow-inner group-hover:scale-110 transition-transform"><Shirt size={22} /></span>
        </button>

        {/* Furball Card → Avatar builder */}
        <button
          type="button"
          onClick={() => (onOpenFurball ? onOpenFurball() : onCreate())}
          className="glass-card p-5 rounded-3xl flex items-center justify-between border-t border-white/20 group cursor-pointer text-left hover:scale-[1.02] active:scale-95 transition-transform"
        >
          <div>
            <div className="flex items-center gap-2 mb-1">
              <PawPrint size={16} className="text-primary" />
              <span className="text-xs font-extrabold uppercase tracking-widest opacity-70">Furball3D</span>
            </div>
            <h3 className="font-headline-lg text-lg font-bold">Build Avatar</h3>
            <div className="mt-1 flex items-center gap-1 text-primary text-xs font-bold group-hover:underline">
              Create a 3D pet <ArrowRight size={12} />
            </div>
          </div>
          <span className="w-14 h-14 bg-primary-container rounded-2xl flex items-center justify-center text-primary-fixed shadow-inner group-hover:scale-110 transition-transform">
            <PawPrint size={22} />
          </span>
        </button>

        {/* Pawprints Card */}
        <button
          type="button"
          onClick={() => onOpenPawprints?.()}
          className="glass-card p-5 rounded-3xl flex items-center justify-between border-t border-white/20 group cursor-pointer text-left hover:scale-[1.02] active:scale-95 transition-transform"
        >
          <div>
            <div className="flex items-center gap-2 mb-1">
              <BookOpen size={16} className="text-primary" />
              <span className="text-xs font-extrabold uppercase tracking-widest opacity-70">Pawprints</span>
            </div>
            <h3 className="font-headline-lg text-lg font-bold">Storybooks</h3>
            <div className="mt-1 flex items-center gap-1 text-primary text-xs font-bold group-hover:underline">
              Open Pawprints <ArrowRight size={12} />
            </div>
          </div>
          <span className="w-14 h-14 bg-primary-container rounded-2xl flex items-center justify-center text-primary-fixed shadow-inner group-hover:scale-110 transition-transform">
            <BookOpen size={22} />
          </span>
        </button>

      </div>
      
    </div>
  );
}
