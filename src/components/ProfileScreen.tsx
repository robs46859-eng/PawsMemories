import React from "react";
import { UserProfile } from "../types";
import { User, Zap, Flame, LogOut, Sun, Moon, Trophy, MapPin } from "lucide-react";

interface ProfileScreenProps {
  userProfile: UserProfile;
  achievements: any[];
  onClaimReward: (id: string, amount: number) => void;
  dailyStreak: number;
  dailyStreakClaimed: boolean;
  onClaimDailyStreak: () => void;
  onOpenCreditStore: () => void;
  onLogout: () => void;
  isDarkMode: boolean;
  onToggleDarkMode: () => void;
}

export default function ProfileScreen({
  userProfile,
  achievements,
  onClaimReward,
  dailyStreak,
  dailyStreakClaimed,
  onClaimDailyStreak,
  onOpenCreditStore,
  onLogout,
  isDarkMode,
  onToggleDarkMode,
}: ProfileScreenProps) {
  return (
    <div className="w-full max-w-2xl mx-auto px-4 pt-6 pb-28 animate-fade-in">
      {/* Identity card */}
      <section className="glass-panel border border-outline-variant/40 rounded-3xl p-6 mb-6 soft-glow-shadow">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-full bg-primary/15 text-primary flex items-center justify-center">
            <User size={26} />
          </div>
          <div className="flex-grow min-w-0">
            <h2 className="text-lg font-extrabold text-on-surface tracking-tight truncate">{userProfile.fullName}</h2>
            <p className="text-xs text-on-surface-variant truncate">{userProfile.email}</p>
            {userProfile.city && (
              <p className="text-[10px] text-on-surface-variant flex items-center gap-1 mt-0.5">
                <MapPin size={10} /> {userProfile.city}
              </p>
            )}
          </div>
          <button
            onClick={onToggleDarkMode}
            className="w-9 h-9 rounded-full glass-panel hover:bg-outline-variant/35 text-on-surface flex items-center justify-center border border-outline-variant/20 transition-all cursor-pointer"
            title={isDarkMode ? "Light mode" : "Dark mode"}
          >
            {isDarkMode ? <Sun size={15} /> : <Moon size={15} />}
          </button>
        </div>

        {/* Credits + streak row */}
        <div className="grid grid-cols-2 gap-3 mt-6">
          <div className="glass-panel rounded-2xl p-4">
            <div className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-on-surface-variant mb-1">
              <Zap size={11} className="text-primary" /> Credits
            </div>
            <div className="text-xl font-black text-primary font-mono">{userProfile.credits}</div>
            <button
              onClick={onOpenCreditStore}
              className="mt-2 w-full py-2 bg-primary text-on-primary rounded-xl text-[10px] font-black uppercase tracking-wide hover:opacity-90 active:scale-95 transition-all cursor-pointer"
            >
              Buy Credits
            </button>
          </div>
          <div className="glass-panel rounded-2xl p-4">
            <div className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-on-surface-variant mb-1">
              <Flame size={11} className="text-primary" /> Daily Streak
            </div>
            <div className="text-xl font-black text-on-surface font-mono">{dailyStreak} days</div>
            <button
              onClick={onClaimDailyStreak}
              disabled={dailyStreakClaimed}
              className="mt-2 w-full py-2 bg-primary/10 text-primary border border-primary/20 rounded-xl text-[10px] font-black uppercase tracking-wide hover:bg-primary/20 active:scale-95 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {dailyStreakClaimed ? "Claimed Today" : "Claim Bonus"}
            </button>
          </div>
        </div>
      </section>

      {/* Achievements */}
      <section className="glass-panel border border-outline-variant/40 rounded-3xl p-6 mb-6">
        <div className="flex items-center gap-2 mb-4">
          <Trophy size={16} className="text-primary" />
          <h3 className="text-sm font-extrabold text-on-surface uppercase tracking-wide">Achievements</h3>
        </div>
        <div className="space-y-3">
          {achievements.map((a) => (
            <div
              key={a.id}
              className={`flex items-center gap-3 p-3 rounded-2xl border ${
                a.isUnlocked ? "border-primary/30 bg-primary/5" : "border-outline-variant/30 glass-panel opacity-60"
              }`}
            >
              <span className="text-2xl">{a.icon}</span>
              <div className="flex-grow min-w-0">
                <div className="text-xs font-extrabold text-on-surface">{a.title}</div>
                <div className="text-[10px] text-on-surface-variant leading-snug">{a.desc}</div>
              </div>
              {a.isUnlocked && !a.isClaimed ? (
                <button
                  onClick={() => onClaimReward(a.id, a.reward)}
                  className="shrink-0 px-3 py-1.5 bg-primary text-on-primary rounded-lg text-[10px] font-black uppercase tracking-wide hover:opacity-90 active:scale-95 transition-all cursor-pointer"
                >
                  +{a.reward}cr
                </button>
              ) : (
                <span className="shrink-0 text-[10px] font-black uppercase tracking-wide text-on-surface-variant">
                  {a.isClaimed ? "Claimed" : `+${a.reward}cr`}
                </span>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Sign out */}
      <button
        onClick={onLogout}
        className="w-full py-3 flex items-center justify-center gap-2 glass-panel hover:bg-error/10 hover:text-error text-on-surface-variant border border-outline-variant/30 rounded-2xl text-xs font-black uppercase tracking-wide transition-all cursor-pointer"
      >
        <LogOut size={14} /> Sign Out
      </button>
    </div>
  );
}
