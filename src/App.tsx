import React, { useState } from "react";
import { Screen, UserProfile, Creation, Album, PublicUser } from "./types";
import { DEFAULT_ALBUMS, DEFAULT_CREATIONS } from "./data";
import SignUp from "./components/SignUp";
import Welcome from "./components/Welcome";
import Tutorial from "./components/Tutorial";
import Dashboard from "./components/Dashboard";
import EditMemory from "./components/EditMemory";
import ShareMemory from "./components/ShareMemory";
import RandyChat from "./components/RandyChat";
import { fetchMe, clearToken, fetchCreations } from "./api";
import { Sparkles, User, History, FolderOpen, Sun, Moon, LogOut, RefreshCw, Zap } from "lucide-react";
import CreditStore from "./components/CreditStore";

const EMPTY_PROFILE: UserProfile = { fullName: "", phoneNumber: "", email: "", credits: 0, isAdmin: false };

export default function App() {
  // Auth gating state
  const [isAuthed, setIsAuthed] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);

  const [currentScreen, setCurrentScreen] = useState<Screen>(Screen.SIGN_UP);
  const [userProfile, setUserProfile] = useState<UserProfile>(EMPTY_PROFILE);

  const [showOrderSuccessModal, setShowOrderSuccessModal] = useState(false);
  const [successOrderSessionId, setSuccessOrderSessionId] = useState("");
  const [showCreditStore, setShowCreditStore] = useState(false);
  const [creditSuccessMsg, setCreditSuccessMsg] = useState("");

  const [albums, setAlbums] = useState<Album[]>(DEFAULT_ALBUMS);
  const [creations, setCreations] = useState<Creation[]>(DEFAULT_CREATIONS);
  const [selectedCreationForShare, setSelectedCreationForShare] = useState<Creation | null>(null);

  // Dynamic Theme state
  const [isDarkMode, setIsDarkMode] = useState<boolean>(() => {
    return localStorage.getItem("paws_dark_mode") === "true";
  });

  // Daily Streak and achievement tracker persistence states
  const [dailyStreak, setDailyStreak] = useState<number>(() => {
    const saved = localStorage.getItem("paws_streak");
    return saved ? parseInt(saved, 10) : 4; // defaults to elegant 4-day streak
  });
  const [dailyStreakClaimed, setDailyStreakClaimed] = useState<boolean>(() => {
    return localStorage.getItem("paws_streak_claimed_today") === "true";
  });
  const [achievements, setAchievements] = useState<any[]>(() => {
    const saved = localStorage.getItem("paws_achievements_state");
    if (saved) return JSON.parse(saved);
    return [
      { id: "pioneer", title: "Pioneer Parent", desc: "Successfully completed user profile registration", reward: 25, icon: "🎉", isUnlocked: false, isClaimed: false },
      { id: "camera_use", title: "Shutter Pup", desc: "Snapped a direct real-time photo with your camera viewfinder", reward: 15, icon: "📸", isUnlocked: false, isClaimed: false },
      { id: "voice_use", title: "Voice Whisperer", desc: "Dictated a details description using your microphone hardware", reward: 15, icon: "🎙️", isUnlocked: false, isClaimed: false },
      { id: "randy_chat", title: "Golden Buddy", desc: "Chatted with Randy the retriever AI pet companion", reward: 10, icon: "🦮", isUnlocked: false, isClaimed: false },
      { id: "creation", title: "Art Keepsake", desc: "Created your first styled AI animal masterpiece memory", reward: 20, icon: "🎨", isUnlocked: false, isClaimed: false },
    ];
  });

  // Restore an existing session on load (validates the token against the server).
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      const user = await fetchMe();
      if (cancelled) return;
      if (user && user.profileComplete) {
        applyUser(user);
        setIsAuthed(true);
        setCurrentScreen(Screen.DASHBOARD);
        // Phase 1.7: Fetch persistent creations from backend
        const fetchedCreations = await fetchCreations();
        if (fetchedCreations.length > 0) {
          setCreations(fetchedCreations as any); // Cast to handle legacy local fields temporarily
        }
      } else {
        clearToken();
        setIsAuthed(false);
      }
      setAuthChecked(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Handle Stripe order success/cancel redirects.
  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const orderSuccess = params.get("order_success");
    const sessionId = params.get("session_id");
    const orderCancelled = params.get("order_cancelled");

    if (orderSuccess === "true" && sessionId) {
      setSuccessOrderSessionId(sessionId);
      setShowOrderSuccessModal(true);
      const newUrl = window.location.pathname;
      window.history.replaceState({}, document.title, newUrl);
    } else if (orderCancelled === "true") {
      alert("Order cancelled. Your payment was not processed and no credits were deducted.");
      const newUrl = window.location.pathname;
      window.history.replaceState({}, document.title, newUrl);
    } else if (params.get("credits_success") === "true") {
      const added = params.get("added") || "?";
      setCreditSuccessMsg(`🎉 ${added} credits added to your account!`);
      // Re-fetch the user from the server so the displayed balance is accurate
      fetchMe().then((user) => { if (user) applyUser(user); });
      window.history.replaceState({}, document.title, window.location.pathname);
      setTimeout(() => setCreditSuccessMsg(""), 5000);
    } else if (params.get("credits_cancelled") === "true") {
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, []);

  const applyUser = (user: PublicUser) => {
    setUserProfile({
      fullName: user.fullName,
      phoneNumber: user.phone,
      email: user.email,
      credits: user.credits,
      isAdmin: user.isAdmin,
    });
  };

  const toggleDarkMode = () => {
    const newVal = !isDarkMode;
    setIsDarkMode(newVal);
    localStorage.setItem("paws_dark_mode", String(newVal));
  };

  const handleUnlockAchievement = (id: string) => {
    setAchievements((prev) => {
      const idx = prev.findIndex((a) => a.id === id);
      if (idx !== -1 && !prev[idx].isUnlocked) {
        const updated = [...prev];
        updated[idx] = { ...updated[idx], isUnlocked: true };
        localStorage.setItem("paws_achievements_state", JSON.stringify(updated));
        return updated;
      }
      return prev;
    });
  };

  const handleClaimReward = (id: string, amount: number) => {
    setUserProfile((prev) => ({ ...prev, credits: prev.credits + amount }));
    setAchievements((prev) => {
      const idx = prev.findIndex((a) => a.id === id);
      if (idx !== -1) {
        const updated = [...prev];
        updated[idx] = { ...updated[idx], isClaimed: true };
        localStorage.setItem("paws_achievements_state", JSON.stringify(updated));
        return updated;
      }
      return prev;
    });
  };

  const handleClaimDailyStreak = () => {
    if (!dailyStreakClaimed) {
      setDailyStreakClaimed(true);
      setDailyStreak((prev) => {
        const newVal = prev + 1;
        localStorage.setItem("paws_streak", String(newVal));
        return newVal;
      });
      setUserProfile((prev) => ({ ...prev, credits: prev.credits + 10 }));
      localStorage.setItem("paws_streak_claimed_today", "true");
    }
  };

  // Called by SignUp once the user is verified AND has a complete profile.
  const handleAuthenticated = (user: PublicUser, isNew: boolean) => {
    applyUser(user);
    setIsAuthed(true);
    if (isNew) {
      handleUnlockAchievement("pioneer");
      setCurrentScreen(Screen.WELCOME);
    } else {
      setCurrentScreen(Screen.DASHBOARD);
    }
  };

  const handleLogout = () => {
    clearToken();
    setIsAuthed(false);
    setUserProfile(EMPTY_PROFILE);
    setCurrentScreen(Screen.SIGN_UP);
  };

  const handleWelcomeNext = () => setCurrentScreen(Screen.TUTORIAL);

  const handleTutorialComplete = () => setCurrentScreen(Screen.DASHBOARD);

  const handleClaimDailyBonus = () => {
    setUserProfile((prev) => ({ ...prev, credits: prev.credits + 5 }));
  };

  const handleShareCompleted = (platform: string, rewardValue: number) => {
    setUserProfile((prev) => ({ ...prev, credits: prev.credits + rewardValue }));
    alert(`Success! Thanks for sharing to ${platform}! You've been rewarded +${rewardValue} free credits!`);
  };

  const handleCreationSaved = (newCreation: Creation) => {
    setCreations((prev) => [newCreation, ...prev]);
    setSelectedCreationForShare(newCreation);
    handleUnlockAchievement("creation");
    setCurrentScreen(Screen.SHARE_MEMORY);
  };

  const handleSelectCreation = (creation: Creation) => {
    setSelectedCreationForShare(creation);
    setCurrentScreen(Screen.SHARE_MEMORY);
  };

  const handleDeductCredits = (amount: number) => {
    setUserProfile((prev) => ({ ...prev, credits: prev.credits - amount }));
  };

  // While we check for an existing session, show a lightweight loader.
  if (!authChecked) {
    return (
      <div className={`min-h-screen bg-surface flex items-center justify-center ${isDarkMode ? "dark" : ""}`}>
        <div className="flex flex-col items-center gap-3 text-on-surface-variant">
          <span className="text-3xl">🐾</span>
          <RefreshCw className="animate-spin" size={20} />
        </div>
      </div>
    );
  }

  return (
    <div className={`min-h-screen bg-surface flex flex-col selection:bg-primary-container selection:text-on-primary-container ${isDarkMode ? "dark" : ""}`}>

      {/* Dynamic Upper Header Bar */}
      <header className="sticky top-0 bg-surface/85 backdrop-blur-md border-b border-outline-variant/30 z-40 px-4 py-3.5 flex justify-between items-center max-w-7xl w-full mx-auto">
        <div className="flex items-center gap-2">
          <span className="text-xl">🐾</span>
          <div>
            <h1 className="text-sm font-extrabold text-on-surface tracking-tight font-sans">
              Paws &amp; Memories
            </h1>
            <p className="text-[9px] text-on-surface-variant uppercase font-bold tracking-widest leading-none">
              AI Legacy Studio
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 md:gap-3">
          {/* Theme Mode trigger button */}
          <button
            onClick={toggleDarkMode}
            className="w-8 h-8 rounded-full bg-surface-container hover:bg-outline-variant/35 text-on-surface flex items-center justify-center border border-outline-variant/20 transition-all cursor-pointer shadow-sm"
            title={isDarkMode ? "Turn on Light Mode" : "Turn on Dark Mode"}
          >
            {isDarkMode ? <Sun size={14} className="text-amber-400" /> : <Moon size={14} className="text-slate-600" />}
          </button>

          {/* User Profile and Credits display (only when signed in) */}
          {isAuthed && userProfile.fullName && (
            <>
              <div className="flex items-center gap-2.5 bg-surface-container-high py-1.5 px-3 rounded-full border border-outline-variant/40 shadow-sm">
                <div className="w-5 h-5 rounded-full bg-primary/20 text-primary flex items-center justify-center">
                  <User size={12} />
                </div>
                <span className="text-xs font-bold text-on-surface leading-none font-sans max-w-[80px] truncate md:max-w-none">
                  {userProfile.fullName.split(" ")[0]}
                </span>
                <div className="h-3 w-px bg-outline-variant"></div>
                <div className="flex items-center gap-1">
                  <span className="text-xs">🪙</span>
                  <span className="text-xs font-bold text-secondary font-mono leading-none">
                    {userProfile.credits}cr
                  </span>
                </div>
              </div>
              {/* Buy Credits button */}
              <button
                onClick={() => setShowCreditStore(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary/10 hover:bg-primary/20 text-primary border border-primary/20 text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer shadow-sm"
                title="Buy more credits"
              >
                <Zap size={11} className="fill-primary" />
                <span className="hidden sm:inline">Buy</span> Credits
              </button>
              <button
                onClick={handleLogout}
                className="w-8 h-8 rounded-full bg-surface-container hover:bg-error/10 hover:text-error text-on-surface-variant flex items-center justify-center border border-outline-variant/20 transition-all cursor-pointer shadow-sm"
                title="Log out"
              >
                <LogOut size={14} />
              </button>
            </>
          )}
        </div>
      </header>

      {/* Main Content Router viewport */}
      <main className="flex-grow flex flex-col justify-center items-center">
        {/* When not authenticated, the only reachable screen is sign-up. */}
        {!isAuthed ? (
          <SignUp onAuthenticated={handleAuthenticated} />
        ) : (
          <>
            {currentScreen === Screen.WELCOME && (
              <Welcome
                userName={userProfile.fullName}
                onNext={handleWelcomeNext}
                onBackToSignUp={handleLogout}
              />
            )}

            {currentScreen === Screen.TUTORIAL && <Tutorial onComplete={handleTutorialComplete} />}

            {currentScreen === Screen.DASHBOARD && (
              <Dashboard
                userProfile={userProfile}
                albums={albums}
                creations={creations}
                onAddMemory={() => setCurrentScreen(Screen.EDIT_MEMORY)}
                onClaimDailyBonus={handleClaimDailyBonus}
                onShareCompleted={handleShareCompleted}
                onSelectCreation={handleSelectCreation}
                streak={dailyStreak}
                achievements={achievements}
                onClaimReward={handleClaimReward}
                onClaimDailyStreak={handleClaimDailyStreak}
                dailyStreakClaimed={dailyStreakClaimed}
              />
            )}

            {currentScreen === Screen.EDIT_MEMORY && (
              <EditMemory
                credits={userProfile.credits}
                isAdmin={userProfile.isAdmin}
                onCreationSaved={handleCreationSaved}
                onDeductCredits={handleDeductCredits}
                onNavigateBack={() => setCurrentScreen(Screen.DASHBOARD)}
                onUnlockAchievement={handleUnlockAchievement}
              />
            )}

            {currentScreen === Screen.SHARE_MEMORY && (
              <ShareMemory
                creation={selectedCreationForShare || creations[0]}
                userCredits={userProfile.credits}
                isAdmin={userProfile.isAdmin}
                onBack={() => setCurrentScreen(Screen.DASHBOARD)}
              />
            )}

            {/* Safety net: if somehow on SIGN_UP while authed, send to dashboard */}
            {currentScreen === Screen.SIGN_UP && (
              <Dashboard
                userProfile={userProfile}
                albums={albums}
                creations={creations}
                onAddMemory={() => setCurrentScreen(Screen.EDIT_MEMORY)}
                onClaimDailyBonus={handleClaimDailyBonus}
                onShareCompleted={handleShareCompleted}
                onSelectCreation={handleSelectCreation}
                streak={dailyStreak}
                achievements={achievements}
                onClaimReward={handleClaimReward}
                onClaimDailyStreak={handleClaimDailyStreak}
                dailyStreakClaimed={dailyStreakClaimed}
              />
            )}
          </>
        )}
      </main>

      {/* Floating Bottom Navigator (only when signed in and past onboarding) */}
      {isAuthed && (currentScreen === Screen.DASHBOARD || currentScreen === Screen.EDIT_MEMORY || currentScreen === Screen.SHARE_MEMORY) && (
        <div className="fixed bottom-0 left-0 right-0 bg-surface-container-lowest/90 backdrop-blur-md border-t border-outline-variant/30 py-2 px-6 flex justify-around items-center max-w-md mx-auto z-40 rounded-t-3xl soft-glow-shadow">
          <button
            onClick={() => setCurrentScreen(Screen.DASHBOARD)}
            className={`flex flex-col items-center gap-1 py-1.5 px-3 rounded-xl transition-all cursor-pointer ${
              currentScreen === Screen.DASHBOARD ? "text-primary scale-103 font-bold" : "text-on-surface-variant opacity-75"
            }`}
          >
            <History size={20} />
            <span className="text-[9px] uppercase tracking-wider font-extrabold">Feed</span>
          </button>

          <button
            onClick={() => setCurrentScreen(Screen.EDIT_MEMORY)}
            className={`flex flex-col items-center gap-1 py-1.5 px-3 rounded-xl transition-all cursor-pointer ${
              currentScreen === Screen.EDIT_MEMORY ? "text-primary scale-103 font-bold" : "text-on-surface-variant opacity-75"
            }`}
          >
            <Sparkles size={20} />
            <span className="text-[9px] uppercase tracking-wider font-extrabold">Create</span>
          </button>

          <button
            onClick={() => alert("Browse your albums directly inside the home 'My Albums' section.")}
            className="flex flex-col items-center gap-1 py-1.5 px-3 rounded-xl text-on-surface-variant opacity-75 cursor-pointer"
          >
            <FolderOpen size={20} />
            <span className="text-[9px] uppercase tracking-wider font-extrabold">Albums</span>
          </button>
        </div>
      )}

      {/* Randy AI-chat bubble companion (only for signed-in users) */}
      {isAuthed && <RandyChat onUnlockAchievement={handleUnlockAchievement} isDarkMode={isDarkMode} />}

      {/* Credit success toast */}
      {creditSuccessMsg && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 bg-primary text-white px-5 py-3 rounded-2xl shadow-xl text-sm font-bold animate-fade-in flex items-center gap-2">
          <Zap size={16} className="fill-white" />
          {creditSuccessMsg}
        </div>
      )}

      {/* Credit Store Modal */}
      {showCreditStore && (
        <CreditStore
          currentCredits={userProfile.credits}
          onClose={() => setShowCreditStore(false)}
        />
      )}

      {/* Order Success Modal */}
      {showOrderSuccessModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
          <div className="bg-white dark:bg-slate-900 rounded-3xl p-6 max-w-sm w-full text-center shadow-2xl border border-outline-variant/30 text-on-surface">
            <span className="text-5xl animate-bounce mb-4 inline-block">🎉</span>
            <h3 className="text-lg font-extrabold text-primary mb-2">Order Confirmed!</h3>
            <p className="text-xs text-on-surface-variant leading-relaxed mb-4">
              Your payment of **$12.00 USD** succeeded, and **800 credits** have been deducted.
              Randy is sending your custom physical pet album to print!
            </p>
            <div className="bg-surface-container rounded-xl p-3 text-[10px] text-on-surface-variant font-mono mb-6 text-left break-all">
              <strong>Session ID:</strong> {successOrderSessionId}
            </div>
            <button
              onClick={() => {
                setShowOrderSuccessModal(false);
                setUserProfile((prev) => ({ ...prev, credits: Math.max(0, prev.credits - 800) }));
              }}
              className="w-full py-3 bg-primary text-white rounded-xl text-xs font-black uppercase shadow-md hover:bg-primary/95 active:scale-95 duration-100 transition-all cursor-pointer"
            >
              Back to Studio
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
