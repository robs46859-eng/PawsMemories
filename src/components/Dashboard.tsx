import React, { useState } from "react";
import { Plus, Sparkles, Activity, Heart, ArrowRight } from "lucide-react";
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
}

export default function Dashboard({ userProfile, streak, dailyStreakClaimed, onClaimDailyStreak, onCreate }: DashboardProps) {
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

      {/* Bottom: Bento Stats & Tips */}
      <div className="w-full max-w-5xl grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6 z-10">
        
        {/* Happiness Card */}
        <div className="glass-card p-5 rounded-3xl flex items-center justify-between border-t border-white/20">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Heart size={16} className="text-secondary" fill="currentColor" />
              <span className="text-xs font-extrabold uppercase tracking-widest opacity-70">Happiness</span>
            </div>
            <h3 className="font-headline-lg text-2xl font-bold">98%</h3>
          </div>
          <div className="w-14 h-14 rounded-full border-4 border-secondary/20 border-t-secondary border-r-secondary flex items-center justify-center rotate-45 shadow-inner">
            <div className="w-10 h-10 bg-surface rounded-full flex items-center justify-center -rotate-45 font-bold text-secondary text-sm">:)</div>
          </div>
        </div>

        {/* Activity Card */}
        <div className="glass-card p-5 rounded-3xl flex items-center justify-between border-t border-white/20">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Activity size={16} className="text-primary" />
              <span className="text-xs font-extrabold uppercase tracking-widest opacity-70">Daily Steps</span>
            </div>
            <h3 className="font-headline-lg text-2xl font-bold">4,280</h3>
          </div>
          <div className="w-14 h-14 bg-primary-container rounded-2xl flex items-center justify-center text-primary-fixed font-bold shadow-inner">
             <span className="material-symbols-outlined">pets</span>
          </div>
        </div>

        {/* Tip Card */}
        <div className="glass-card p-5 rounded-3xl bg-gradient-to-br from-primary/10 to-transparent flex flex-col justify-center relative overflow-hidden group cursor-pointer border-t border-white/20">
          <div className="absolute -right-4 -top-4 opacity-10 group-hover:opacity-20 transition-opacity">
            <Sparkles size={80} />
          </div>
          <span className="text-xs font-extrabold uppercase tracking-widest text-primary mb-1">Pro Tip</span>
          <p className="font-medium text-sm text-on-surface-variant line-clamp-2">Capture {petName} in the backyard during golden hour for stunning lighting effects.</p>
          <div className="mt-2 flex items-center gap-1 text-primary text-xs font-bold group-hover:underline">
            Read more <ArrowRight size={12} />
          </div>
        </div>

      </div>
      
    </div>
  );
}
