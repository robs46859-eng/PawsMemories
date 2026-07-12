import React, { useEffect, useRef, useState } from "react";
import { UserProfile, PublicUser } from "../types";
import { User, Zap, Flame, LogOut, Sun, Moon, Trophy, MapPin, History, Camera, ImagePlus, Trash2, Loader2, PawPrint, Gift, Shield, FileText, Mail, Phone, Download, AlertTriangle, Share2, ExternalLink } from "lucide-react";
import { getCreditHistory, CreditTxn, getUserPhotos, addUserPhoto, deleteUserPhoto, uploadProfilePhoto, UserPhoto, authedFetch, fetchStorageUsage, purchaseStorageGb, type StorageUsage } from "../api";
import StorageMeter from "./StorageMeter";

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

interface ProfileData {
  user: PublicUser & { pawprintTokens?: number; referralCode?: string; bio?: string | null; phoneVerified?: boolean; emailVerified?: boolean; zip?: string; profileBonusGranted?: boolean; acceptedTermsVersion?: string | null };
  storage: StorageUsage;
  creditHistory: CreditTxn[];
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
  const [profileData, setProfileData] = useState<ProfileData | null>(null);
  const [photos, setPhotos] = useState<UserPhoto[]>([]);
  const [thumbBusy, setThumbBusy] = useState(false);
  const [galleryBusy, setGalleryBusy] = useState(false);
  const thumbInputRef = useRef<HTMLInputElement | null>(null);
  const galleryInputRef = useRef<HTMLInputElement | null>(null);
  const galleryRef = useRef<HTMLDivElement | null>(null);

  // Editable fields
  const [editFullName, setEditFullName] = useState("");
  const [editBio, setEditBio] = useState("");
  const [editZip, setEditZip] = useState("");
  const [saving, setSaving] = useState(false);

  // Phone verify
  const [phoneInput, setPhoneInput] = useState("");
  const [verifyCode, setVerifyCode] = useState("");
  const [verifySent, setVerifySent] = useState(false);
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    getCreditHistory().then(setHistory).catch(() => {});
    getUserPhotos().then(setPhotos).catch(() => {});
    loadProfile();
  }, []);

  // Separate state for credit history display
  const [history, setHistory] = useState<CreditTxn[]>([]);

  const loadProfile = async () => {
    try {
      const res = await authedFetch("/api/profile");
      if (!res.ok) return;
      const data = await res.json();
      setProfileData(data);
      setEditFullName(data.user?.fullName || "");
      setEditBio(data.user?.bio || "");
      setEditZip(data.user?.zip || "");
      setHistory(data.creditHistory || []);
    } catch {}
  };

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

  const saveProfile = async () => {
    setSaving(true);
    try {
      const res = await authedFetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fullName: editFullName, bio: editBio, zip: editZip }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.user) onUserUpdate?.(data.user);
        loadProfile();
      }
    } catch {}
    setSaving(false);
  };

  const sendVerifyCode = async () => {
    if (!phoneInput || phoneInput.length < 10) return;
    setVerifying(true);
    try {
      const res = await authedFetch("/api/verify/phone/start", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: phoneInput }),
      });
      const data = await res.json();
      if (data.success) setVerifySent(true);
      else alert(data.error || "Could not send code.");
    } catch {}
    setVerifying(false);
  };

  const checkVerifyCode = async () => {
    if (!verifyCode) return;
    setVerifying(true);
    try {
      const res = await authedFetch("/api/verify/phone/check", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: phoneInput, code: verifyCode }),
      });
      const data = await res.json();
      if (data.success) {
        if (data.user) onUserUpdate?.(data.user);
        loadProfile();
        if (data.bonusGranted) alert("🎉 Profile complete! You earned 100 credits!");
        setVerifySent(false);
      } else {
        alert(data.error || "Invalid code.");
      }
    } catch {}
    setVerifying(false);
  };

  const requestDataExport = async () => {
    const res = await authedFetch("/api/profile/request-data", { method: "POST" });
    const data = await res.json();
    alert(data.message || "Request submitted.");
  };

  const requestDelete = async () => {
    if (!confirm("Are you sure you want to request account deletion? This cannot be undone.")) return;
    const res = await authedFetch("/api/profile/request-delete", { method: "POST" });
    const data = await res.json();
    alert(data.message || "Request submitted.");
  };

  const initials = userProfile.fullName.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase() || "U";
  const pData = profileData;

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
            {/* Editable name */}
            <input
              value={editFullName}
              onChange={(e) => setEditFullName(e.target.value)}
              className="text-lg font-extrabold text-on-surface tracking-tight bg-transparent border-b border-transparent focus:border-primary/40 focus:outline-none w-full"
              placeholder="Your name"
            />
            <p className="text-xs text-on-surface-variant truncate">{userProfile.email}
              {pData?.user?.emailVerified && <span className="ml-1 text-emerald-500 font-bold">✓</span>}
            </p>
            {pData?.user?.phoneVerified && (
              <p className="text-[10px] text-emerald-500 flex items-center gap-1 mt-0.5">
                <Phone size={10} /> Phone verified
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
          <button onClick={onToggleDarkMode} className="w-9 h-9 rounded-full glass-panel hover:bg-outline-variant/35 text-on-surface flex items-center justify-center border border-outline-variant/20 transition-all cursor-pointer" title={isDarkMode ? "Light mode" : "Dark mode"}>
            {isDarkMode ? <Sun size={15} /> : <Moon size={15} />}
          </button>
        </div>

        {/* Editable fields */}
        <div className="mt-4 space-y-3">
          <textarea
            value={editBio}
            onChange={(e) => setEditBio(e.target.value)}
            placeholder="Tell us about yourself and your pet..."
            className="w-full p-3 rounded-xl border border-outline-variant/30 bg-surface-container resize-none text-xs text-on-surface placeholder:text-on-surface-variant/50 focus:outline-none focus:ring-2 focus:ring-primary/40"
            rows={2}
          />
          <div className="flex items-center gap-2">
            <input
              value={editZip}
              onChange={(e) => setEditZip(e.target.value)}
              placeholder="ZIP code"
              className="flex-1 p-2.5 rounded-xl border border-outline-variant/30 bg-surface-container text-xs text-on-surface placeholder:text-on-surface-variant/50 focus:outline-none focus:ring-2 focus:ring-primary/40"
              maxLength={10}
            />
            <button
              onClick={saveProfile}
              disabled={saving}
              className="px-4 py-2.5 bg-primary text-on-primary rounded-xl text-xs font-black uppercase tracking-wide hover:opacity-90 active:scale-95 transition-all cursor-pointer disabled:opacity-40"
            >
              {saving ? <Loader2 size={12} className="animate-spin" /> : "Save"}
            </button>
          </div>
        </div>

        {/* Credits + pawprints + streak */}
        <div className="grid grid-cols-3 gap-3 mt-6">
          <div className="glass-panel rounded-2xl p-3">
            <div className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant mb-1">🪙 Credits</div>
            <div className="text-xl font-black text-primary font-mono">{userProfile.credits}</div>
            <button onClick={onOpenCreditStore} className="mt-1 w-full py-1.5 bg-primary text-on-primary rounded-lg text-[10px] font-black uppercase tracking-wide hover:opacity-90 active:scale-95 transition-all cursor-pointer">Buy</button>
          </div>
          <div className="glass-panel rounded-2xl p-3">
            <div className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant mb-1">🐾 Pawprints</div>
            <div className="text-xl font-black text-secondary font-mono">{pData?.user?.pawprintTokens || 0}</div>
            <div className="mt-1 text-[8px] text-on-surface-variant text-center">Earn by sharing & referring</div>
          </div>
          <div className="glass-panel rounded-2xl p-3">
            <div className="flex items-center gap-1 text-[10px] font-black uppercase tracking-widest text-on-surface-variant mb-1"><Flame size={11} /> Streak</div>
            <div className="text-xl font-black text-on-surface font-mono">{dailyStreak}d</div>
            <button onClick={onClaimDailyStreak} disabled={dailyStreakClaimed} className="mt-1 w-full py-1.5 bg-primary/10 text-primary border border-primary/20 rounded-lg text-[10px] font-black uppercase tracking-wide hover:bg-primary/20 active:scale-95 transition-all cursor-pointer disabled:opacity-40">
              {dailyStreakClaimed ? "Claimed" : "Claim"}
            </button>
          </div>
        </div>

        {/* Profile bonus status */}
        {pData?.user && !pData.user.profileBonusGranted && (
          <div className="mt-3 p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl">
            <p className="text-xs text-amber-700 dark:text-amber-300 font-medium flex items-center gap-1">
              <Gift size={14} /> Complete your profile: add ZIP, verify email & phone → earn 100 credits!
            </p>
          </div>
        )}

        {/* Phone verification */}
        {!pData?.user?.phoneVerified && (
          <div className="mt-3 p-3 bg-surface-container rounded-xl">
            <p className="text-[10px] font-bold text-on-surface-variant mb-2">Verify your phone number:</p>
            {!verifySent ? (
              <div className="flex gap-2">
                <input value={phoneInput} onChange={(e) => setPhoneInput(e.target.value)} placeholder="+1 (555) 123-4567" className="flex-1 p-2.5 rounded-xl border border-outline-variant/30 bg-surface text-xs focus:outline-none focus:ring-2 focus:ring-primary/40" />
                <button onClick={sendVerifyCode} disabled={verifying || phoneInput.length < 10} className="px-3 py-2 bg-primary text-on-primary rounded-xl text-[10px] font-black uppercase tracking-wide hover:opacity-90 disabled:opacity-40 cursor-pointer">
                  {verifying ? <Loader2 size={12} className="animate-spin" /> : "Send Code"}
                </button>
              </div>
            ) : (
              <div className="flex gap-2">
                <input value={verifyCode} onChange={(e) => setVerifyCode(e.target.value)} placeholder="Enter code" className="flex-1 p-2.5 rounded-xl border border-outline-variant/30 bg-surface text-xs focus:outline-none focus:ring-2 focus:ring-primary/40" />
                <button onClick={checkVerifyCode} disabled={verifying || !verifyCode} className="px-3 py-2 bg-primary text-on-primary rounded-xl text-[10px] font-black uppercase tracking-wide hover:opacity-90 disabled:opacity-40 cursor-pointer">
                  {verifying ? <Loader2 size={12} className="animate-spin" /> : "Verify"}
                </button>
              </div>
            )}
          </div>
        )}
      </section>

      {/* Referral code */}
      {pData?.user?.referralCode && (
        <section data-tour="profile-referral" className="glass-panel border border-outline-variant/40 rounded-3xl p-6 mb-6">
          <div className="flex items-center gap-2 mb-3">
            <Share2 size={16} className="text-primary" />
            <h3 className="text-sm font-extrabold text-on-surface uppercase tracking-wide">Referral</h3>
          </div>
          <p className="text-xs text-on-surface-variant mb-2">Share your code & earn 30 credits + 1 pawprint per referral!</p>
          <div className="flex items-center gap-2 bg-surface-container rounded-xl p-3">
            <code className="flex-1 text-sm font-bold text-primary font-mono">{pData.user.referralCode}</code>
            <button onClick={() => { navigator.clipboard.writeText(`https://pawsome3d.com/r/${pData.user!.referralCode}`); alert("Link copied!"); }} className="px-3 py-1.5 bg-primary/10 text-primary rounded-lg text-[10px] font-black uppercase tracking-wide hover:bg-primary/20 transition-all cursor-pointer">Copy</button>
          </div>
        </section>
      )}

      {/* Storage meter */}
      <StorageMeter />

      {/* Achievements */}
      <section className="glass-panel border border-outline-variant/40 rounded-3xl p-6 mb-6">
        <div className="flex items-center gap-2 mb-4">
          <Trophy size={16} className="text-primary" />
          <h3 className="text-sm font-extrabold text-on-surface uppercase tracking-wide">Achievements</h3>
        </div>
        <div className="space-y-3">
          {achievements.map((a) => (
            <div key={a.id} className={`flex items-center gap-3 p-3 rounded-2xl border ${a.isUnlocked ? "border-primary/30 bg-primary/5" : "border-outline-variant/30 glass-panel opacity-60"}`}>
              <span className="text-2xl">{a.icon}</span>
              <div className="flex-grow min-w-0">
                <div className="text-xs font-extrabold text-on-surface">{a.title}</div>
                <div className="text-[10px] text-on-surface-variant leading-snug">{a.desc}</div>
              </div>
              {a.isUnlocked && !a.isClaimed ? (
                <button onClick={() => onClaimReward(a.id, a.reward)} className="shrink-0 px-3 py-1.5 bg-primary text-on-primary rounded-lg text-[10px] font-black uppercase tracking-wide hover:opacity-90 active:scale-95 transition-all cursor-pointer">+{a.reward}cr</button>
              ) : (
                <span className="shrink-0 text-[10px] font-black uppercase tracking-wide text-on-surface-variant">{a.isClaimed ? "Claimed" : `+${a.reward}cr`}</span>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Your Photos */}
      <section ref={galleryRef} className="glass-panel border border-outline-variant/40 rounded-3xl p-6 mb-6 scroll-mt-24">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-extrabold text-on-surface uppercase tracking-wide flex items-center gap-2"><Camera size={16} className="text-primary" /> Your Photos</h3>
          <label className="shrink-0 flex items-center gap-1.5 bg-primary text-on-primary px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-wide hover:opacity-90 active:scale-95 transition-all cursor-pointer">
            {galleryBusy ? <Loader2 size={12} className="animate-spin" /> : <ImagePlus size={12} />}
            {galleryBusy ? "Adding…" : "Add photo"}
            <input ref={galleryInputRef} type="file" accept="image/*" className="hidden" onChange={onGalleryFile} disabled={galleryBusy} />
          </label>
        </div>
        {photos.length === 0 ? (
          <p className="text-xs text-on-surface-variant leading-relaxed">No photos yet.</p>
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
            {photos.map((p) => (
              <div key={p.id} className="relative aspect-square rounded-xl overflow-hidden group glass-panel border border-outline-variant/30">
                <img src={p.image_url} alt="" loading="lazy" className="w-full h-full object-cover" />
                <button onClick={() => removePhoto(p.id)} className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/50 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-error cursor-pointer"><Trash2 size={12} /></button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Credit history */}
      <section className="glass-panel border border-outline-variant/40 rounded-3xl p-6 mb-6">
        <div className="flex items-center gap-2 mb-4">
          <History size={16} className="text-primary" />
          <h3 className="text-sm font-extrabold text-on-surface uppercase tracking-wide">Credit History</h3>
        </div>
        {history.length === 0 ? (
          <p className="text-xs text-on-surface-variant leading-relaxed">No credit activity yet.</p>
        ) : (
          <div className="space-y-2">
            {history.slice(0, 10).map((t) => (
              <div key={t.id} className="flex items-center justify-between gap-3 p-2.5 rounded-xl glass-panel border border-outline-variant/20">
                <div className="min-w-0">
                  <div className="text-xs font-bold text-on-surface capitalize truncate">{t.reason.replace(/[_:]/g, " ")}</div>
                  <div className="text-[10px] text-on-surface-variant">{new Date(t.created_at).toLocaleString()}</div>
                </div>
                <div className={`shrink-0 text-sm font-black font-mono ${t.delta >= 0 ? "text-emerald-600" : "text-error"}`}>{t.delta >= 0 ? "+" : ""}{t.delta}</div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Legal links */}
      <section className="glass-panel border border-outline-variant/40 rounded-3xl p-6 mb-6">
        <div className="flex items-center gap-2 mb-4">
          <Shield size={16} className="text-primary" />
          <h3 className="text-sm font-extrabold text-on-surface uppercase tracking-wide">Legal & Data</h3>
        </div>
        <div className="space-y-2">
          <a href="/legal/privacy" target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 p-3 rounded-xl hover:bg-surface-variant/50 transition-all text-xs font-medium text-on-surface">
            <FileText size={14} /> Privacy Statement <ExternalLink size={10} className="ml-auto text-on-surface-variant" />
          </a>
          <a href="/legal/terms" target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 p-3 rounded-xl hover:bg-surface-variant/50 transition-all text-xs font-medium text-on-surface">
            <FileText size={14} /> Terms of Service <ExternalLink size={10} className="ml-auto text-on-surface-variant" />
          </a>
          <a href="/legal/licensing" target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 p-3 rounded-xl hover:bg-surface-variant/50 transition-all text-xs font-medium text-on-surface">
            <FileText size={14} /> IP & Licensing <ExternalLink size={10} className="ml-auto text-on-surface-variant" />
          </a>
          <div className="flex items-start gap-2 p-3 rounded-xl bg-surface-container text-xs text-on-surface-variant">
            <Shield size={14} className="mt-0.5 text-primary" />
            <div>
              <div className="font-bold text-on-surface">Accepted terms version</div>
              <div>{pData?.user?.acceptedTermsVersion || "Not recorded"}</div>
            </div>
          </div>
          <button onClick={requestDataExport} className="w-full flex items-center gap-2 p-3 rounded-xl hover:bg-surface-variant/50 transition-all text-xs font-medium text-on-surface text-left cursor-pointer">
            <Download size={14} /> Request Data Export
          </button>
          <button onClick={requestDelete} className="w-full flex items-center gap-2 p-3 rounded-xl hover:bg-error/10 transition-all text-xs font-medium text-error text-left cursor-pointer">
            <AlertTriangle size={14} /> Request Account Deletion
          </button>
        </div>
      </section>

      {/* Sign out */}
      <button onClick={onLogout} className="w-full py-3 flex items-center justify-center gap-2 glass-panel hover:bg-error/10 hover:text-error text-on-surface-variant border border-outline-variant/30 rounded-2xl text-xs font-black uppercase tracking-wide transition-all cursor-pointer">
        <LogOut size={14} /> Sign Out
      </button>
    </div>
  );
}
