import React from "react";
import { Sparkles, ArrowRight, Clapperboard, PawPrint, BookOpen, Shirt } from "lucide-react";
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

      {/* Center: primary creation choices */}
      <div className="flex-1 w-full flex flex-col items-center justify-center relative z-10 my-8">
        <div className="absolute h-64 w-64 rounded-full bg-primary/20 blur-[90px]" />
        <div className="relative grid w-full max-w-4xl grid-cols-1 gap-5 md:grid-cols-2">
          <button data-tour="dashboard-create" type="button" onClick={() => (onOpenFurball ? onOpenFurball() : onCreate())} className="group overflow-hidden rounded-[2rem] border border-white/30 bg-gradient-to-br from-primary/25 via-surface/80 to-secondary/20 p-7 text-left shadow-2xl backdrop-blur-2xl transition hover:-translate-y-1 hover:border-primary/60 hover:shadow-primary/20 active:scale-[.98]">
            <div className="mb-8 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-on-primary shadow-lg"><PawPrint size={27} /></div>
            <p className="text-xs font-black uppercase tracking-[.18em] text-primary">Furball3D</p>
            <h2 className="mt-2 text-3xl font-black tracking-tight text-on-surface">Build a 3D model</h2>
            <p className="mt-3 max-w-sm text-sm leading-6 text-on-surface-variant">Turn photos or a prompt into a clean, style-controlled 3D model.</p>
            <span className="mt-6 inline-flex items-center gap-2 text-sm font-black text-primary">Open Furball3D <ArrowRight size={16} className="transition group-hover:translate-x-1" /></span>
          </button>
          <button type="button" onClick={() => onOpenFidos?.()} className="group overflow-hidden rounded-[2rem] border border-white/30 bg-gradient-to-br from-secondary/25 via-surface/80 to-primary/15 p-7 text-left shadow-2xl backdrop-blur-2xl transition hover:-translate-y-1 hover:border-secondary/60 hover:shadow-secondary/20 active:scale-[.98]">
            <div className="mb-8 flex h-14 w-14 items-center justify-center rounded-2xl bg-secondary text-on-secondary shadow-lg"><Shirt size={27} /></div>
            <p className="text-xs font-black uppercase tracking-[.18em] text-secondary">Fido's Styles</p>
            <h2 className="mt-2 text-3xl font-black tracking-tight text-on-surface">Create the look</h2>
            <p className="mt-3 max-w-sm text-sm leading-6 text-on-surface-variant">Build wardrobe looks and style variations for your selected model.</p>
            <span className="mt-6 inline-flex items-center gap-2 text-sm font-black text-secondary">Open Fido's Styles <ArrowRight size={16} className="transition group-hover:translate-x-1" /></span>
          </button>
        </div>
      </div>

      {/* Bottom: Quick-access action cards */}
      <div className="w-full max-w-4xl grid grid-cols-1 sm:grid-cols-2 gap-4 md:gap-6 z-10">

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
