import React, { useEffect, useRef, useState } from "react";
import { UserProfile, PublicUser } from "../types";
import { User, Zap, Flame, LogOut, Sun, Moon, Trophy, MapPin, History, Camera, ImagePlus, Trash2, Loader2 } from "lucide-react";
import { getCreditHistory, CreditTxn, getUserPhotos, addUserPhoto, deleteUserPhoto, uploadProfilePhoto, UserPhoto } from "../api";

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
  onUserUpdate?: (user: PublicUser) => void;
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
  onUserUpdate,
}: ProfileScreenProps) {
  const [history, setHistory] = useState<CreditTxn[]>([]);
  const [photos, setPhotos] = useState<UserPhoto[]>([]);
  const [thumbBusy, setThumbBusy] = useState(false);
  const [galleryBusy, setGalleryBusy] = useState(false);
  const thumbInputRef = useRef<HTMLInputElement | null>(null);
  const galleryInputRef = useRef<HTMLInputElement | null>(null);
  const galleryRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    getCreditHistory().then(setHistory).catch(() => {});
    getUserPhotos().then(setPhotos).catch(() => {});
  }, []);

  const readFile = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result as string);
      r.onerror = reject;
      r.readAsDataURL(file);
    });

  const onThumbFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setThumbBusy(true);
    try {
      const user = await uploadProfilePhoto(await readFile(file));
      onUserUpdate?.(user);
      getUserPhotos().then(setPhotos).catch(() => {});
    } catch (err: any) {
      alert(err.message || "Could not update photo.");
    } finally {
      setThumbBusy(false);
      if (thumbInputRef.current) thumbInputRef.current.value = "";
    }
  };

  const onGalleryFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setGalleryBusy(true);
    try {
      const photo = await addUserPhoto(await readFile(file));
      setPhotos((prev) => [photo, ...prev]);
    } catch (err: any) {
      alert(err.message || "Could not add photo.");
    } finally {
      setGalleryBusy(false);
      if (galleryInputRef.current) galleryInputRef.current.value = "";
    }
  };

  const removePhoto = async (id: number) => {
    const ok = await deleteUserPhoto(id);
    if (ok) setPhotos((prev) => prev.filter((p) => p.id !== id));
  };

  const initials = userProfile.fullName.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase() || "U";

  return (
    <div className="w-full max-w-2xl mx-auto px-4 pt-6 pb-28 animate-fade-in">
      {/* Identity card */}
      <section className="glass-panel border border-outline-variant/40 rounded-3xl p-6 mb-6 soft-glow-shadow">
        <div className="flex items-center gap-4">
          <button
            onClick={() => thumbInputRef.current?.click()}
            title="Change profile photo"
            className="relative w-14 h-14 rounded-full overflow-hidden shrink-0 group cursor-pointer"
          >
            {userProfile.profilePhotoUrl ? (
              <img src={userProfile.profilePhotoUrl} alt="Profile" className="w-full h-full object-cover" />
            ) : (
              <span className="w-full h-full bg-primary text-on-primary flex items-center justify-center text-lg font-black">{initials}</span>
            )}
            <span className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white">
              {thumbBusy ? <Loader2 size={16} className="animate-spin" /> : <Camera size={16} />}
            </span>
            <input ref={thumbInputRef} type="file" accept="image/*" className="hidden" onChange={onThumbFile} disabled={thumbBusy} />
          </button>
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
            onClick={() => galleryRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
            className="w-9 h-9 rounded-full glass-panel hover:bg-primary/15 text-primary flex items-center justify-center border border-outline-variant/20 transition-all cursor-pointer"
            title="Your photos"
          >
            <Camera size={15} />
          </button>
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

      {/* Your Photos — add/remove; also holds photos fed in from the avatar builder */}
      <section ref={galleryRef} className="glass-panel border border-outline-variant/40 rounded-3xl p-6 mb-6 scroll-mt-24">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-extrabold text-on-surface uppercase tracking-wide flex items-center gap-2">
            <Camera size={16} className="text-primary" /> Your Photos
          </h3>
          <label className="shrink-0 flex items-center gap-1.5 bg-primary text-on-primary px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-wide hover:opacity-90 active:scale-95 transition-all cursor-pointer">
            {galleryBusy ? <Loader2 size={12} className="animate-spin" /> : <ImagePlus size={12} />}
            {galleryBusy ? "Adding…" : "Add photo"}
            <input ref={galleryInputRef} type="file" accept="image/*" className="hidden" onChange={onGalleryFile} disabled={galleryBusy} />
          </label>
        </div>
        {photos.length === 0 ? (
          <p className="text-xs text-on-surface-variant leading-relaxed">
            No photos yet. Add some here, or upload pet photos in the avatar builder — they'll be saved to your library automatically.
          </p>
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
            {photos.map((p) => (
              <div key={p.id} className="relative aspect-square rounded-xl overflow-hidden group glass-panel border border-outline-variant/30">
                <img src={p.image_url} alt="User" loading="lazy" className="w-full h-full object-cover" />
                {p.source === "avatar_builder" && (
                  <span className="absolute top-1 left-1 bg-primary/80 text-on-primary text-[7px] font-black uppercase px-1 py-0.5 rounded">Builder</span>
                )}
                <button
                  onClick={() => removePhoto(p.id)}
                  title="Remove photo"
                  className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/50 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-error cursor-pointer"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Credit history — spend & earn tracking */}
      <section className="glass-panel border border-outline-variant/40 rounded-3xl p-6 mb-6">
        <div className="flex items-center gap-2 mb-4">
          <History size={16} className="text-primary" />
          <h3 className="text-sm font-extrabold text-on-surface uppercase tracking-wide">Credit History</h3>
        </div>
        {history.length === 0 ? (
          <p className="text-xs text-on-surface-variant leading-relaxed">
            No credit activity yet. Daily bonuses, shares, and achievements add credits; generating memories spends them — it all shows up here.
          </p>
        ) : (
          <div className="space-y-2">
            {history.map((t) => (
              <div key={t.id} className="flex items-center justify-between gap-3 p-2.5 rounded-xl glass-panel border border-outline-variant/20">
                <div className="min-w-0">
                  <div className="text-xs font-bold text-on-surface capitalize truncate">{t.reason.replace(/[_:]/g, " ")}</div>
                  <div className="text-[10px] text-on-surface-variant">{new Date(t.created_at).toLocaleString()}</div>
                </div>
                <div className={`shrink-0 text-sm font-black font-mono ${t.delta >= 0 ? "text-emerald-600" : "text-error"}`}>
                  {t.delta >= 0 ? "+" : ""}{t.delta}
                </div>
              </div>
            ))}
          </div>
        )}
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
