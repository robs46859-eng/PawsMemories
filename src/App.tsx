import React, { useState } from "react";
import { Screen, UserProfile, Creation, Album } from "./types";
import { DEFAULT_ALBUMS, DEFAULT_CREATIONS } from "./data";
import SignUp from "./components/SignUp";
import Welcome from "./components/Welcome";
import Tutorial from "./components/Tutorial";
import Dashboard from "./components/Dashboard";
import EditMemory from "./components/EditMemory";
import ShareMemory from "./components/ShareMemory";
import RandyChat from "./components/RandyChat";
import { Sparkles, HelpCircle, Navigation, Award, User, Layers, History, FolderOpen, Sun, Moon } from "lucide-react";

export default function App() {
  const [currentScreen, setCurrentScreen] = useState<Screen>(() => {
    const saved = localStorage.getItem("paws_current_screen");
    return saved ? (saved as Screen) : Screen.SIGN_UP;
  });
  const [userProfile, setUserProfile] = useState<UserProfile>(() => {
    const saved = localStorage.getItem("paws_user_profile");
    return saved ? JSON.parse(saved) : { fullName: "", phoneNumber: "", credits: 0 };
  });

  const [showOrderSuccessModal, setShowOrderSuccessModal] = useState(false);
  const [successOrderSessionId, setSuccessOrderSessionId] = useState("");

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

  React.useEffect(() => {
    localStorage.setItem("paws_current_screen", currentScreen);
  }, [currentScreen]);

  React.useEffect(() => {
    localStorage.setItem("paws_user_profile", JSON.stringify(userProfile));
  }, [userProfile]);

  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const orderSuccess = params.get("order_success");
    const sessionId = params.get("session_id");
    const orderCancelled = params.get("order_cancelled");

    if (orderSuccess === "true" && sessionId) {
      setSuccessOrderSessionId(sessionId);
      setShowOrderSuccessModal(true);

      // Clean up URL search params
      const newUrl = window.location.pathname;
      window.history.replaceState({}, document.title, newUrl);
    } else if (orderCancelled === "true") {
      alert("Order cancelled. Your payment was not processed and no credits were deducted.");
      const newUrl = window.location.pathname;
      window.history.replaceState({}, document.title, newUrl);
    }
  }, []);

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
    setUserProfile((prev) => ({
      ...prev,
      credits: prev.credits + amount,
    }));
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
      setUserProfile((prev) => ({
        ...prev,
        credits: prev.credits + 10,
      }));
      localStorage.setItem("paws_streak_claimed_today", "true");
    }
  };

  // Success sign up handler
  const handleSignUpSuccess = (profile: UserProfile) => {
    setUserProfile(profile);
    handleUnlockAchievement("pioneer");
    setCurrentScreen(Screen.WELCOME);
  };

  // Welcome next option
  const handleWelcomeNext = () => {
    setCurrentScreen(Screen.TUTORIAL);
  };

  // Onboard complete
  const handleTutorialComplete = () => {
    // Award the 50 free credits
    setUserProfile((prev) => ({
      ...prev,
      credits: prev.credits === 0 ? 50 : prev.credits, // Fallback safe
    }));
    setCurrentScreen(Screen.DASHBOARD);
  };

  // Claim daily bonus +5cr
  const handleClaimDailyBonus = () => {
    setUserProfile((prev) => ({
      ...prev,
      credits: prev.credits + 5,
    }));
  };

  // Claim share bonus +10cr
  const handleShareCompleted = (platform: string, rewardValue: number) => {
    setUserProfile((prev) => ({
      ...prev,
      credits: prev.credits + rewardValue,
    }));
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
    setUserProfile((prev) => ({
      ...prev,
      credits: prev.credits - amount,
    }));
  };

  return (
    <div className={`min-h-screen bg-surface flex flex-col selection:bg-primary-container selection:text-on-primary-container ${isDarkMode ? "dark" : ""}`}>
      
      {/* Dynamic Upper Header Bar */}
      <header className="sticky top-0 bg-surface/85 backdrop-blur-md border-b border-outline-variant/30 z-40 px-4 py-3.5 flex justify-between items-center max-w-7xl w-full mx-auto">
        <div className="flex items-center gap-2">
          <span className="text-xl">🐾</span>
          <div>
            <h1 className="text-sm font-extrabold text-on-surface tracking-tight font-sans">
              Paws & Memories
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

          {/* User Profile and Credits display */}
          {userProfile.fullName && (
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
          )}

          {/* Quick Screen Preview Switcher Drawer */}
          <div className="relative group">
            <button className="bg-primary/10 hover:bg-primary/20 hover:text-primary text-on-surface-variant font-bold text-[10px] uppercase tracking-wider py-1.5 px-2.5 rounded-lg border border-primary/20 transition-all cursor-pointer">
              Jump Screens
            </button>
            <div className="absolute right-0 top-full mt-1 bg-white rounded-xl shadow-lg border border-outline-variant/30 py-2 w-48 hidden group-hover:block hover:block z-50 animate-fade-in text-left">
              <p className="text-[9px] text-outline px-3.5 py-1 font-bold uppercase tracking-widest border-b border-outline-variant/20 mb-1">
                Select Mockup View
              </p>
              <button
                onClick={() => setCurrentScreen(Screen.SIGN_UP)}
                className={`w-full text-left px-3.5 py-1.5 text-xs font-semibold hover:bg-surface-container transition-colors flex items-center gap-2 ${
                  currentScreen === Screen.SIGN_UP ? "text-primary bg-primary/5" : "text-on-surface-variant"
                }`}
              >
                <User size={12} />
                1. Sign Up Screen
              </button>
              <button
                onClick={() => setCurrentScreen(Screen.WELCOME)}
                className={`w-full text-left px-3.5 py-1.5 text-xs font-semibold hover:bg-surface-container transition-colors flex items-center gap-2 ${
                  currentScreen === Screen.WELCOME ? "text-primary bg-primary/5" : "text-on-surface-variant"
                }`}
              >
                <HelpCircle size={12} />
                2. Welcome Randy
              </button>
              <button
                onClick={() => setCurrentScreen(Screen.TUTORIAL)}
                className={`w-full text-left px-3.5 py-1.5 text-xs font-semibold hover:bg-surface-container transition-colors flex items-center gap-2 ${
                  currentScreen === Screen.TUTORIAL ? "text-primary bg-primary/5" : "text-on-surface-variant"
                }`}
              >
                <Award size={12} />
                3. Tutorial Complete
              </button>
              <button
                onClick={() => {
                  if (!userProfile.fullName) {
                    setUserProfile({ fullName: "Sarah Connor", phoneNumber: "+1 (555) 789-1000", credits: 50 });
                  }
                  setCurrentScreen(Screen.DASHBOARD);
                }}
                className={`w-full text-left px-3.5 py-1.5 text-xs font-semibold hover:bg-surface-container transition-colors flex items-center gap-2 ${
                  currentScreen === Screen.DASHBOARD ? "text-primary bg-primary/5" : "text-on-surface-variant"
                }`}
              >
                <Layers size={12} />
                4. Dashboard Feed
              </button>
              <button
                onClick={() => {
                  if (!userProfile.fullName) {
                    setUserProfile({ fullName: "Sarah Connor", phoneNumber: "+1 (555) 789-1000", credits: 50 });
                  }
                  setCurrentScreen(Screen.EDIT_MEMORY);
                }}
                className={`w-full text-left px-3.5 py-1.5 text-xs font-semibold hover:bg-surface-container transition-colors flex items-center gap-2 ${
                  currentScreen === Screen.EDIT_MEMORY ? "text-primary bg-primary/5" : "text-on-surface-variant"
                }`}
              >
                <Sparkles size={12} />
                5. Design Editor
              </button>
              <button
                onClick={() => {
                  if (!userProfile.fullName) {
                    setUserProfile({ fullName: "Sarah Connor", phoneNumber: "+1 (555) 789-1000", credits: 50 });
                  }
                  setCurrentScreen(Screen.SHARE_MEMORY);
                }}
                className={`w-full text-left px-3.5 py-1.5 text-xs font-semibold hover:bg-surface-container transition-colors flex items-center gap-2 ${
                  currentScreen === Screen.SHARE_MEMORY ? "text-primary bg-primary/5" : "text-on-surface-variant"
                }`}
              >
                <Navigation size={12} />
                6. Share Masterpiece
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content Router viewport with smooth transitions */}
      <main className="flex-grow flex flex-col justify-center items-center">
        {currentScreen === Screen.SIGN_UP && (
          <SignUp
            onSignUpSuccess={handleSignUpSuccess}
            onNavigateToLogin={() => {
              setUserProfile({ fullName: "Sarah Connor", phoneNumber: "+1 (555) 789-1000", credits: 50 });
              setCurrentScreen(Screen.DASHBOARD);
            }}
          />
        )}

        {currentScreen === Screen.WELCOME && (
          <Welcome
            userName={userProfile.fullName}
            onNext={handleWelcomeNext}
            onBackToSignUp={() => setCurrentScreen(Screen.SIGN_UP)}
          />
        )}

        {currentScreen === Screen.TUTORIAL && (
          <Tutorial onComplete={handleTutorialComplete} />
        )}

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
            onBack={() => setCurrentScreen(Screen.DASHBOARD)}
          />
        )}
      </main>

      {/* Floating Bottom Navigator for Dashboard feed and main sections */}
      {userProfile.fullName && (
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

      {/* Randy AI-chat bubble companion */}
      <RandyChat onUnlockAchievement={handleUnlockAchievement} isDarkMode={isDarkMode} />

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
                // Deduct credits on UI success confirmation
                setUserProfile((prev) => {
                  const updatedCredits = Math.max(0, prev.credits - 800);
                  const updated = { ...prev, credits: updatedCredits };
                  localStorage.setItem("paws_user_profile", JSON.stringify(updated));
                  return updated;
                });
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
