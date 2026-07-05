import React, { useState } from "react";
import { Play, Sparkles, Activity, Heart, ArrowRight } from "lucide-react";
import { Album, Creation, UserProfile } from "../types";
import { Achievement } from "./AchievementsPanel";

interface DashboardProps {
  userProfile: UserProfile;
  albums: Album[];
  creations: Creation[];
  onAddMemory: () => void;
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

export default function Dashboard({ userProfile, streak, dailyStreakClaimed, onClaimDailyStreak }: DashboardProps) {
  const [isHoveringAR, setIsHoveringAR] = useState(false);
  const petName = userProfile.fullName.split(" ")[0] + "'s Pet"; // Defaulting to something nice

  return (
    <div className="w-full h-full min-h-[calc(100dvh-64px)] flex flex-col items-center justify-between pt-12 pb-24 md:pb-12 px-6 relative overflow-hidden">
      
      {/* Top Section: Daily Streak & Welcome */}
      <div className="w-full max-w-5xl flex justify-between items-start z-10 pt-4 md:pt-0">
        <div>
          <h1 className="text-3xl md:text-5xl font-extrabold text-on-surface drop-shadow-md">
            Welcome back, <br className="md:hidden" /><span className="text-primary">{userProfile.fullName.split(" ")[0]}!</span>
          </h1>
          <p className="text-on-surface-variant text-lg mt-2 font-medium">Ready for another adventure?</p>
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
        {/* Soft glowing aura behind avatar */}
        <div className="absolute w-[300px] h-[300px] bg-primary/20 rounded-full blur-[80px] animate-pulse"></div>
        
        {/* Avatar Image (placeholder for 3D model) */}
        <div className="relative w-64 h-64 md:w-80 md:h-80 flex items-center justify-center animate-[float_6s_ease-in-out_infinite]">
          <img 
            src="https://lh3.googleusercontent.com/aida-public/AB6AXuDIPw_dS7Lk9ZnzJytp5OIFSvYe-o3-dmnRDceXgTN8b5eU7dMNngow29JGkVgP55WqV83FwgTDzYmQN5QN-FHWzUnX1Da1nGaxLlYjpCeeWo-IvkxT6_Gvpaky_tH_CXtidU-3Aub5SbhC38mhHjAjYCN27qeXFzuS0sEBRNRvZZMazrGdbPIgzpwS6HLqnWfh1iQilRGEFIy8g5jIvCMeR-xzEDZwwpMIZ0ESk_acTP8-47Vj4pDLlKzuYHTiRHTCUBH1K4Y9JHvX" 
            alt="Active Avatar" 
            className="w-full h-full object-contain drop-shadow-[0_20px_50px_rgba(0,0,0,0.5)] z-10"
          />
        </div>

        {/* Launch AR Button */}
        <button 
          onMouseEnter={() => setIsHoveringAR(true)}
          onMouseLeave={() => setIsHoveringAR(false)}
          className="mt-8 group relative overflow-hidden rounded-[2rem] p-[3px] focus:outline-none focus:ring-4 focus:ring-primary/50 shadow-2xl transition-transform hover:scale-105 active:scale-95"
        >
          <span className="absolute inset-0 bg-gradient-to-r from-primary via-secondary to-primary-fixed bg-[length:200%_auto] animate-gradient"></span>
          <div className="relative bg-surface dark:bg-surface-dim px-8 py-4 rounded-[1.8rem] flex items-center gap-3">
            <div className={`w-10 h-10 rounded-full bg-primary flex items-center justify-center text-on-primary transition-transform duration-300 ${isHoveringAR ? 'scale-110' : ''}`}>
              <Play size={20} className="ml-1" fill="currentColor" />
            </div>
            <span className="font-extrabold text-xl tracking-wide bg-gradient-to-r from-primary to-secondary bg-clip-text text-transparent">LAUNCH AR</span>
          </div>
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
