import React, { useState } from "react";
import { Screen, UserProfile, Creation, Album, PublicUser } from "./types";
import SignUp from "./components/SignUp";
import Welcome from "./components/Welcome";
import Tutorial from "./components/Tutorial";
import Dashboard from "./components/Dashboard";
import EditMemory from "./components/EditMemory";
import RequestMemory from "./components/RequestMemory";
import AdminRequestPanel from "./components/AdminRequestPanel";
import ShareMemory from "./components/ShareMemory";
import RandyChat from "./components/RandyChat";
import AlbumView from "./components/AlbumView";
import AlbumsPage from "./components/AlbumsPage";
import { fetchMe, fetchCreations, fetchAlbums, createAlbum, clearToken, claimAchievement, claimDailyStreak } from "./api";
import { Sparkles, User, History, FolderOpen, Sun, Moon, LogOut, RefreshCw, Zap, Dog, ClipboardList, Bell, ShoppingBag, Users, Home } from "lucide-react";
import CreditStore from "./components/CreditStore";
import AvatarDashboard from "./components/AvatarDashboard";
import Store from "./components/Store";
import ProfileScreen from "./components/ProfileScreen";

const EMPTY_PROFILE: UserProfile = { fullName: "", email: "", credits: 0, treats: 0, isAdmin: false, city: "", ageVerified: false };

const getBackgroundImage = (screen: Screen) => {
  switch (screen) {
    case Screen.SIGN_UP:
    case Screen.WELCOME:
    case Screen.TUTORIAL:
      return {
        url: "https://lh3.googleusercontent.com/aida-public/AB6AXuDhAPCOn9lJeAvcUcl3BdoLP4KgyEMtnj3DMytEM-aCeBC_Jdpc8WW-UZL57l3Qr5OTa-jgsrex2CjGTUWuxGmgSkMlcgq8O_oOt40zJn_RN3amGsf2AUvegr9mKKbNgEtBxhhbTVHvlEE9NxddCCh0JEfzxnFnyN9C6I7k2BKyjpDcu7JPXvlFQKQIxtvg9O9c7Eau9ZP-jGV8C3uT8CmB6Dk6jXb3kphtYYtNQg5c63h0iWvkb77VVgecwIiLCoBNdCsQjg2S5LLu",
        className: "opacity-35 grayscale brightness-110"
      };
    case Screen.AVATAR_DASHBOARD:
    case Screen.STORE:
      return {
        url: "https://lh3.googleusercontent.com/aida/AP1WRLvt8lFxJgHJ9uP3j6iyhqJUtsv1lxYplq8f-d6xh9dMKZt8nDB1YMz45La6Y2Nasn42O8MypImZtJWIX0to6wkpFZGfOR_zfUBzjMH_HO4zzbwtfIuqq8l14CtfbEF5orZj6ZeJcNw7oNmkMlMNZgo3hPGaP0FR1kcMPFoy1LqbahDJf1vo6dH3v8oGnFTp4BOenijUglfJb97YY6Pq7-5eZGCmaDOFUMkg8sjqGrkpFLK05dGpeNaU5Emr",
        className: "opacity-45 blur-[1px]"
      };
    case Screen.PROFILE:
    case Screen.ALBUMS:
    case Screen.ALBUM_VIEW:
    case Screen.SHARE_MEMORY:
    case Screen.REQUEST_MEMORY:
    case Screen.EDIT_MEMORY:
      return {
        url: "https://lh3.googleusercontent.com/aida-public/AB6AXuCgPgSPbugIw7F_e3S1ovxk0kXUcFRdPskoy_9PfWa9WhHYuW2cIC31iOs3emo4xn_LchV70fYyBJyZjGcv-NqNLC2LUFBSsVkVQbql0-tUGkqrb7gyqk4b9S9MT9R907oQt79H06ENI2Yg9GuyCW1jGRdXzTPNcMgPQ_4l0wtcGzp_PUW9yIrcj5iLfNy1f_FvOPou2R8Q9Hs74deUI9WpFfY_O2hBsKYlwPjlxU0YEtRiCWZTKWa0miFhM7ElBCe2V1_al1DgDeqS",
        className: "opacity-55"
      };
    case Screen.DASHBOARD:
    default:
      return {
        url: "https://lh3.googleusercontent.com/aida-public/AB6AXuD-HqwxMcpwPXgGyLghKDmX1u4tjL6sbJHj3zw_AbJ1n32bwAVThwTiezURkzCyyAvH75EDBKWrxIg4Aldt4eydUzY9PGxKyItSMwZsW75Y1WMzSRPHBGiCaRgg_7gSWhPSFYZma1nG4WalFWLZ88F036cdW-XgrLUwReVKHR1hgNJNqxD0ZHA0h8JglbXKZQj7cA2G6BAV1fAYz6mLN1mholInPBy3eKZUKEOY5syjXm1UAYoiyOboLuHxiO387h74a5kfxcUUGFnP",
        className: "opacity-55 blur-[1px] brightness-110"
      };
  }
};

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
  const [showAdminPanel, setShowAdminPanel] = useState(false);
  const [requestSuccessMsg, setRequestSuccessMsg] = useState("");

  const [albums, setAlbums] = useState<Album[]>([]);
  const [creations, setCreations] = useState<Creation[]>([]);
  const [activeAlbum, setActiveAlbum] = useState<Album | null>(null);
  const [selectedCreationForShare, setSelectedCreationForShare] = useState<Creation | null>(null);

  // Dynamic Theme state
  const [isDarkMode, setIsDarkMode] = useState<boolean>(() => {
    return localStorage.getItem("paws_dark_mode") === "true";
  });

  // Daily Streak and achievement tracker persistence states (from server)
  const [dailyStreak, setDailyStreak] = useState<number>(0);
  const [dailyStreakClaimed, setDailyStreakClaimed] = useState<boolean>(false);
  const [achievements, setAchievements] = useState<any[]>([
      { id: "pioneer", title: "Pioneer Parent", desc: "Successfully completed user profile registration", reward: 25, icon: "🎉", isUnlocked: false, isClaimed: false },
      { id: "camera_use", title: "Shutter Pup", desc: "Snapped a direct real-time photo with your camera viewfinder", reward: 15, icon: "📸", isUnlocked: false, isClaimed: false },
      { id: "voice_use", title: "Voice Whisperer", desc: "Dictated a details description using your microphone hardware", reward: 15, icon: "🎙️", isUnlocked: false, isClaimed: false },
      { id: "randy_chat", title: "Golden Buddy", desc: "Chatted with Randy the retriever AI pet companion", reward: 10, icon: "🦮", isUnlocked: false, isClaimed: false },
      { id: "creation", title: "Art Keepsake", desc: "Created your first styled AI animal masterpiece memory", reward: 20, icon: "🎨", isUnlocked: false, isClaimed: false },
  ]);

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
        const serverCreations = await fetchCreations();
        setCreations(serverCreations);
        const serverAlbums = await fetchAlbums();
        setAlbums(serverAlbums);
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

  // Handle photo request success/cancel redirects
  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("request_success") === "true") {
      setRequestSuccessMsg("✅ Your memory request has been submitted and payment received! We'll notify you by SMS when it's ready.");
      window.history.replaceState({}, document.title, window.location.pathname);
      setTimeout(() => setRequestSuccessMsg(""), 8000);
    } else if (params.get("request_cancelled") === "true") {
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, []);

  const applyUser = (user: PublicUser) => {
    setUserProfile({
      fullName: user.fullName,
      email: user.email,
      credits: user.credits,
      treats: user.treats,
      isAdmin: user.isAdmin,
      city: user.city,
    });
    setDailyStreak(user.dailyStreak || 0);
    const today = new Date().toISOString().split('T')[0];
    setDailyStreakClaimed(user.lastStreakClaim?.startsWith(today) || false);
    if (user.achievements && user.achievements.length > 0) {
      setAchievements(user.achievements);
    }
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
        // We still keep a tiny bit of local state for instant UI unlock before claim
        return updated;
      }
      return prev;
    });
  };

  const handleClaimReward = async (id: string, amount: number) => {
    try {
      const updatedUser = await claimAchievement(id);
      applyUser(updatedUser);
    } catch(err: any) {
      alert(err.message || "Could not claim achievement.");
    }
  };

  const handleClaimDailyStreak = async () => {
    try {
      const updatedUser = await claimDailyStreak();
      applyUser(updatedUser);
    } catch(err: any) {
      alert(err.message || "Could not claim daily streak.");
    }
  };

  const handleCreateAlbum = async (name: string) => {
    const newAlbum = await createAlbum(name);
    if (newAlbum) {
      setAlbums((prev) => [newAlbum, ...prev]);
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
      fetchCreations().then(setCreations);
      fetchAlbums().then(setAlbums);
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
    setCreations((prev) => {
      const exists = prev.some((c) => c.id === newCreation.id);
      if (exists) {
        return prev.map((c) => (c.id === newCreation.id ? newCreation : c));
      }
      return [newCreation, ...prev];
    });
    setSelectedCreationForShare(newCreation);
    handleUnlockAchievement("creation");
    setCurrentScreen(Screen.SHARE_MEMORY);
  };

  const handleCreationGenerated = (newCreation: Creation) => {
    setCreations((prev) => {
      const exists = prev.some((c) => c.id === newCreation.id);
      if (exists) return prev;
      return [newCreation, ...prev];
    });
    handleUnlockAchievement("creation");
  };

  const handleCreationUpdated = (updatedCreation: Creation) => {
    setCreations((prev) =>
      prev.map((c) => (c.id === updatedCreation.id ? updatedCreation : c))
    );
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
    <div className={`min-h-screen flex flex-col selection:bg-primary-container selection:text-on-primary-container ${isDarkMode ? "dark" : ""}`}>

      {/* Global Background Layer */}
      <div className="fixed inset-0 z-[-10] pointer-events-none overflow-hidden bg-background">
        <div 
          className={`absolute inset-0 bg-cover bg-center bg-transition ${getBackgroundImage(currentScreen).className}`} 
          style={{ backgroundImage: `url('${getBackgroundImage(currentScreen).url}')` }}
        ></div>
        {/* Mud splatters */}
        <div className="mud-splatter" style={{ width: "120px", height: "90px", top: "-20px", left: "-10%", "--rot": "15deg" } as React.CSSProperties}></div>
        <div className="mud-splatter" style={{ width: "180px", height: "140px", top: "40%", right: "-15%", "--rot": "-25deg", animationDelay: "0.2s" } as React.CSSProperties}></div>
        <div className="mud-splatter" style={{ width: "90px", height: "70px", bottom: "-30px", left: "20%", "--rot": "45deg", animationDelay: "0.5s" } as React.CSSProperties}></div>
        <div className="mud-splatter" style={{ width: "150px", height: "100px", top: "10%", right: "10%", "--rot": "10deg", animationDelay: "0.8s" } as React.CSSProperties}></div>
        {/* Gradient overlay to ensure text remains readable */}
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-background/25 to-background/60 dark:from-transparent dark:via-[#17120f]/40 dark:to-[#17120f]/80"></div>
      </div>

      {/* Dynamic Upper Header Bar */}
      <header className="fixed top-0 w-full z-50 bg-surface/40 backdrop-blur-xl shadow-[0_8px_32px_0_rgba(68,42,34,0.08)]">
        <nav className="flex justify-between items-center px-6 md:px-16 py-4 w-full max-w-7xl mx-auto">
          <div className="flex items-center gap-2">
            <span className="text-headline-lg font-headline-xl font-extrabold text-primary tracking-tight">Pawsome3D</span>
          </div>

          <div className="hidden md:flex items-center gap-8">
            <button onClick={() => setCurrentScreen(Screen.DASHBOARD)} className={`font-medium transition-colors px-3 py-1 rounded-lg ${currentScreen === Screen.DASHBOARD ? 'text-primary font-bold border-b-2 border-primary' : 'text-on-surface-variant hover:bg-primary/5'}`}>Home</button>
            <button onClick={() => setCurrentScreen(Screen.ALBUMS)} className={`font-medium transition-colors px-3 py-1 rounded-lg ${currentScreen === Screen.ALBUMS ? 'text-primary font-bold border-b-2 border-primary' : 'text-on-surface-variant hover:bg-primary/5'}`}>Albums</button>
            <button onClick={() => setCurrentScreen(Screen.AVATAR_DASHBOARD)} className={`font-medium transition-colors px-3 py-1 rounded-lg ${currentScreen === Screen.AVATAR_DASHBOARD ? 'text-primary font-bold border-b-2 border-primary' : 'text-on-surface-variant hover:bg-primary/5'}`}>Avatars</button>
            <button onClick={() => setCurrentScreen(Screen.DASHBOARD)} className={`font-medium transition-colors px-3 py-1 rounded-lg ${[Screen.EDIT_MEMORY, Screen.REQUEST_MEMORY, Screen.SHARE_MEMORY, Screen.ALBUM_VIEW].includes(currentScreen) && currentScreen !== Screen.DASHBOARD ? 'text-primary font-bold border-b-2 border-primary' : 'text-on-surface-variant hover:bg-primary/5'}`}>Community</button>
          </div>

          <div className="flex items-center gap-2 md:gap-4">
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
                className="w-10 h-10 rounded-full bg-surface-container hover:bg-error/10 hover:text-error text-on-surface-variant flex items-center justify-center border border-outline-variant/20 transition-all cursor-pointer shadow-sm"
                title="Log out"
              >
                <LogOut size={18} />
              </button>
            </>
          )}
        </div>
        </nav>
      </header>

      <div className="flex-grow flex w-full relative">
        {/* Desktop Sidebar */}
        {isAuthed && [Screen.DASHBOARD, Screen.ALBUMS, Screen.EDIT_MEMORY, Screen.REQUEST_MEMORY, Screen.SHARE_MEMORY, Screen.ALBUM_VIEW, Screen.AVATAR_DASHBOARD, Screen.STORE, Screen.PROFILE].includes(currentScreen) && (
          <aside className="fixed left-0 top-0 h-full z-40 hidden md:flex flex-col py-8 w-64 bg-surface/80 dark:bg-surface-dim/80 backdrop-blur-xl shadow-xl border-r border-outline-variant/20 pt-24">
            <div className="px-6 mb-8">
              <div className="flex flex-col items-center p-4 bg-primary-container rounded-xl gap-2 text-center shadow-inner">
                <div className="w-16 h-16 rounded-full border-4 border-primary-fixed-dim overflow-hidden bg-white">
                  <img className="w-full h-full object-cover" src="https://lh3.googleusercontent.com/aida-public/AB6AXuDrxNE61jqvdNR8-rsWm6lutkR14a7_f4GeW2AgJ4ZEoT44fgEPune7E5tPMNfXu-fE_kIMxesgB5HCVV8pUedW56xAVKF3LdDPjH_d0ZlzdXYGldYx8YJ5oUgES1TPfgQPsUds_3RPmxk-iDqk_P-UeLPxPTf4jXksgPEjjzXbo3yRXluhSD9LFCYezyVKW61ZsoctFb3GGIoCtiN0JCooH7jGcrNy5X_-UnZ2TSXRLolc5SmHFftZMMpP1Rwwszm7b-pBg5FoJvGr" alt="Avatar Profile" />
                </div>
                <div>
                  <h3 className="font-headline-lg text-[18px] leading-tight text-on-primary-container font-bold">{userProfile.fullName.split(" ")[0]}'s Pet</h3>
                </div>
              </div>
            </div>
            
            <nav className="flex-1 space-y-2">
              <button onClick={() => setCurrentScreen(Screen.DASHBOARD)} className={`w-full flex items-center gap-4 px-4 py-3 mx-4 rounded-lg transition-all duration-300 ${currentScreen === Screen.DASHBOARD ? 'bg-primary text-on-primary shadow-[0_0_20px_rgba(68,42,34,0.15)]' : 'text-on-surface-variant hover:bg-secondary-container/50 dark:hover:bg-surface-variant/30'}`}>
                <span className="material-symbols-outlined font-sans" style={{ fontVariationSettings: currentScreen === Screen.DASHBOARD ? "'FILL' 1" : "'FILL' 0" }}>home</span>
                <span className="font-medium">Home</span>
              </button>
              <button onClick={() => setCurrentScreen(Screen.ALBUMS)} className={`w-full flex items-center gap-4 px-4 py-3 mx-4 rounded-lg transition-all duration-300 ${currentScreen === Screen.ALBUMS ? 'bg-primary text-on-primary shadow-[0_0_20px_rgba(68,42,34,0.15)]' : 'text-on-surface-variant hover:bg-secondary-container/50 dark:hover:bg-surface-variant/30'}`}>
                <span className="material-symbols-outlined font-sans" style={{ fontVariationSettings: currentScreen === Screen.ALBUMS ? "'FILL' 1" : "'FILL' 0" }}>pets</span>
                <span className="font-medium">Albums</span>
              </button>
              <button onClick={() => setCurrentScreen(Screen.AVATAR_DASHBOARD)} className={`w-full flex items-center gap-4 px-4 py-3 mx-4 rounded-lg transition-all duration-300 ${currentScreen === Screen.AVATAR_DASHBOARD ? 'bg-primary text-on-primary shadow-[0_0_20px_rgba(68,42,34,0.15)]' : 'text-on-surface-variant hover:bg-secondary-container/50 dark:hover:bg-surface-variant/30'}`}>
                <span className="material-symbols-outlined font-sans" style={{ fontVariationSettings: currentScreen === Screen.AVATAR_DASHBOARD ? "'FILL' 1" : "'FILL' 0" }}>pets</span>
                <span className="font-medium">Avatars</span>
              </button>
              <button className="w-full flex items-center gap-4 px-4 py-3 mx-4 rounded-lg transition-all duration-300 text-on-surface-variant hover:bg-secondary-container/50 dark:hover:bg-surface-variant/30">
                <span className="material-symbols-outlined font-sans">view_in_ar</span>
                <span className="font-medium">AR Mode</span>
              </button>
              <button onClick={() => setCurrentScreen(Screen.DASHBOARD)} className={`w-full flex items-center gap-4 px-4 py-3 mx-4 rounded-lg transition-all duration-300 ${[Screen.EDIT_MEMORY, Screen.REQUEST_MEMORY, Screen.SHARE_MEMORY, Screen.ALBUM_VIEW].includes(currentScreen) && currentScreen !== Screen.DASHBOARD ? 'bg-primary text-on-primary shadow-[0_0_20px_rgba(68,42,34,0.15)]' : 'text-on-surface-variant hover:bg-secondary-container/50 dark:hover:bg-surface-variant/30'}`}>
                <span className="material-symbols-outlined font-sans" style={{ fontVariationSettings: [Screen.EDIT_MEMORY, Screen.REQUEST_MEMORY, Screen.SHARE_MEMORY, Screen.ALBUM_VIEW].includes(currentScreen) && currentScreen !== Screen.DASHBOARD ? "'FILL' 1" : "'FILL' 0" }}>group</span>
                <span className="font-medium">Community</span>
              </button>
            </nav>
            
            <div className="px-4 py-6 mt-auto border-t border-outline-variant/20 mx-4">
              <button onClick={() => setCurrentScreen(Screen.AVATAR_DASHBOARD)} className="w-full bg-primary text-on-primary py-3 rounded-lg font-bold hover:scale-[1.02] transition-transform active:scale-95 shadow-lg shadow-primary/20">
                Generate Avatar
              </button>
              <div className="mt-6 space-y-2">
                <button className="w-full flex items-center gap-4 text-on-surface-variant hover:bg-secondary-container/30 rounded-lg px-4 py-2 transition-all">
                  <span className="material-symbols-outlined font-sans">help</span>
                  <span className="text-body-sm">Support</span>
                </button>
                <button onClick={handleLogout} className="w-full flex items-center gap-4 text-on-surface-variant hover:bg-secondary-container/30 rounded-lg px-4 py-2 transition-all">
                  <span className="material-symbols-outlined font-sans">logout</span>
                  <span className="text-body-sm">Logout</span>
                </button>
              </div>
            </div>
          </aside>
        )}

      {/* Main Content Router viewport */}
      <main className={`flex-grow flex flex-col justify-center items-center ${isAuthed ? 'md:ml-64 w-full relative' : 'w-full'}`}>
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
                onAddMemory={() => setCurrentScreen(userProfile.isAdmin ? Screen.EDIT_MEMORY : Screen.REQUEST_MEMORY)}
                onClaimDailyBonus={handleClaimDailyBonus}
                onShareCompleted={handleShareCompleted}
                onSelectCreation={handleSelectCreation}
                streak={dailyStreak}
                achievements={achievements}
                onClaimReward={handleClaimReward}
                onClaimDailyStreak={handleClaimDailyStreak}
                dailyStreakClaimed={dailyStreakClaimed}
                onSelectAlbum={(album) => {
                  setActiveAlbum(album);
                  setCurrentScreen(Screen.ALBUM_VIEW);
                }}
                onCreateAlbum={handleCreateAlbum}
                onOpenAdminPanel={userProfile.isAdmin ? () => setShowAdminPanel(true) : undefined}
              />
            )}

            {currentScreen === Screen.EDIT_MEMORY && userProfile.isAdmin && (
              <EditMemory
                credits={userProfile.credits}
                isAdmin={userProfile.isAdmin}
                onCreationSaved={handleCreationSaved}
                onCreationGenerated={handleCreationGenerated}
                onCreationUpdated={handleCreationUpdated}
                onDeductCredits={handleDeductCredits}
                onNavigateBack={() => setCurrentScreen(Screen.DASHBOARD)}
                onUnlockAchievement={handleUnlockAchievement}
                userCity={userProfile.city}
              />
            )}

            {/* Non-admin users who somehow reach EDIT_MEMORY are bounced to REQUEST_MEMORY */}
            {currentScreen === Screen.EDIT_MEMORY && !userProfile.isAdmin && (
              <RequestMemory
                onNavigateBack={() => setCurrentScreen(Screen.DASHBOARD)}
                onUnlockAchievement={handleUnlockAchievement}
              />
            )}

            {currentScreen === Screen.REQUEST_MEMORY && (
              <RequestMemory
                onNavigateBack={() => setCurrentScreen(Screen.DASHBOARD)}
                onUnlockAchievement={handleUnlockAchievement}
              />
            )}

            {currentScreen === Screen.ALBUMS && (
              <AlbumsPage
                userProfile={userProfile}
                creations={creations}
                albums={albums}
                onSelectCreation={handleSelectCreation}
                onNavigate={setCurrentScreen}
              />
            )}

            {currentScreen === Screen.ALBUM_VIEW && activeAlbum && (
              <AlbumView
                album={activeAlbum}
                creations={creations}
                onBack={() => setCurrentScreen(Screen.DASHBOARD)}
                onSelectCreation={(c) => setSelectedCreationForShare(c)}
                onPlayVideo={() => {}}
                animatingJobs={{}}
              />
            )}

            {currentScreen === Screen.SHARE_MEMORY && selectedCreationForShare && (
              <ShareMemory
                creation={selectedCreationForShare || creations[0]}
                userCredits={userProfile.credits}
                isAdmin={userProfile.isAdmin}
                onBack={() => setCurrentScreen(Screen.DASHBOARD)}
              />
            )}

            {currentScreen === Screen.AVATAR_DASHBOARD && (
              <AvatarDashboard
                userProfile={userProfile}
                onUpdateUser={(updatedUser) => {
                  applyUser(updatedUser);
                }}
                isDarkMode={isDarkMode}
              />
            )}

            {currentScreen === Screen.STORE && (
              <Store
                userProfile={userProfile}
                onOpenCreditStore={() => setShowCreditStore(true)}
                onGoToAvatars={() => setCurrentScreen(Screen.AVATAR_DASHBOARD)}
              />
            )}

            {currentScreen === Screen.PROFILE && (
              <ProfileScreen
                userProfile={userProfile}
                achievements={achievements}
                onClaimReward={handleClaimReward}
                dailyStreak={dailyStreak}
                dailyStreakClaimed={dailyStreakClaimed}
                onClaimDailyStreak={handleClaimDailyStreak}
                onOpenCreditStore={() => setShowCreditStore(true)}
                onLogout={handleLogout}
                isDarkMode={isDarkMode}
                onToggleDarkMode={toggleDarkMode}
              />
            )}

            {/* Safety net: if somehow on SIGN_UP while authed, send to dashboard */}
            {currentScreen === Screen.SIGN_UP && (
              <Dashboard
                userProfile={userProfile as PublicUser}
                albums={albums}
                creations={creations}
                onAddMemory={() => setCurrentScreen(userProfile.isAdmin ? Screen.EDIT_MEMORY : Screen.REQUEST_MEMORY)}
                onClaimDailyBonus={handleClaimDailyBonus}
                onShareCompleted={handleShareCompleted}
                onSelectCreation={handleSelectCreation}
                streak={dailyStreak}
                achievements={achievements}
                onClaimReward={handleClaimReward}
                onClaimDailyStreak={handleClaimDailyStreak}
                dailyStreakClaimed={dailyStreakClaimed}
                onSelectAlbum={(album) => {
                  setActiveAlbum(album);
                  setCurrentScreen(Screen.ALBUM_VIEW);
                }}
                onCreateAlbum={handleCreateAlbum}
                onOpenAdminPanel={userProfile.isAdmin ? () => setShowAdminPanel(true) : undefined}
              />
            )}
          </>
        )}
      </main>

      {/* Floating Bottom Navigator (only when signed in and past onboarding) */}
      {isAuthed && [Screen.DASHBOARD, Screen.ALBUMS, Screen.EDIT_MEMORY, Screen.REQUEST_MEMORY, Screen.SHARE_MEMORY, Screen.ALBUM_VIEW, Screen.AVATAR_DASHBOARD, Screen.STORE, Screen.PROFILE].includes(currentScreen) && (
        <div className="fixed md:hidden bottom-0 left-0 right-0 bg-surface-container-lowest/90 dark:bg-surface-dim/90 backdrop-blur-xl border-t border-outline-variant/30 py-2 px-4 flex justify-around items-center z-40 rounded-t-2xl shadow-[0_-8px_32px_0_rgba(68,42,34,0.08)]">
          <button
            onClick={() => setCurrentScreen(Screen.DASHBOARD)}
            className={`flex flex-col items-center justify-center gap-1 py-2 px-4 rounded-xl transition-all duration-300 ${
              currentScreen === Screen.DASHBOARD ? "bg-primary text-on-primary scale-105" : "text-on-surface-variant hover:bg-surface-variant/50"
            }`}
          >
            <span className="material-symbols-outlined font-sans" style={{ fontVariationSettings: currentScreen === Screen.DASHBOARD ? "'FILL' 1" : "'FILL' 0" }}>home</span>
            <span className="text-[10px] font-bold">Home</span>
          </button>

          <button
            onClick={() => setCurrentScreen(Screen.ALBUMS)}
            className={`flex flex-col items-center justify-center gap-1 py-2 px-4 rounded-xl transition-all duration-300 ${
              currentScreen === Screen.ALBUMS ? "bg-primary text-on-primary scale-105" : "text-on-surface-variant hover:bg-surface-variant/50"
            }`}
          >
            <span className="material-symbols-outlined font-sans" style={{ fontVariationSettings: currentScreen === Screen.ALBUMS ? "'FILL' 1" : "'FILL' 0" }}>pets</span>
            <span className="text-[10px] font-bold">Albums</span>
          </button>

          <button
            onClick={() => setCurrentScreen(Screen.AVATAR_DASHBOARD)}
            className={`flex flex-col items-center justify-center gap-1 py-2 px-4 rounded-xl transition-all duration-300 ${
              currentScreen === Screen.AVATAR_DASHBOARD ? "bg-primary text-on-primary scale-105" : "text-on-surface-variant hover:bg-surface-variant/50"
            }`}
          >
            <span className="material-symbols-outlined font-sans" style={{ fontVariationSettings: currentScreen === Screen.AVATAR_DASHBOARD ? "'FILL' 1" : "'FILL' 0" }}>pets</span>
            <span className="text-[10px] font-bold">Avatars</span>
          </button>

          <button
            onClick={() => setCurrentScreen(Screen.DASHBOARD)}
            className={`flex flex-col items-center justify-center gap-1 py-2 px-4 rounded-xl transition-all duration-300 ${
              [Screen.EDIT_MEMORY, Screen.REQUEST_MEMORY, Screen.SHARE_MEMORY, Screen.ALBUM_VIEW].includes(currentScreen) && currentScreen !== Screen.DASHBOARD
                ? "bg-primary text-on-primary scale-105"
                : "text-on-surface-variant hover:bg-surface-variant/50"
            }`}
          >
            <span className="material-symbols-outlined font-sans" style={{ fontVariationSettings: [Screen.EDIT_MEMORY, Screen.REQUEST_MEMORY, Screen.SHARE_MEMORY, Screen.ALBUM_VIEW].includes(currentScreen) && currentScreen !== Screen.DASHBOARD ? "'FILL' 1" : "'FILL' 0" }}>groups</span>
            <span className="text-[10px] font-bold">Community</span>
          </button>
        </div>
      )}

      </div>

      {/* Randy AI-chat bubble companion (only for signed-in users) */}
      {isAuthed && <RandyChat onUnlockAchievement={handleUnlockAchievement} isDarkMode={isDarkMode} />}

      {/* Request success toast */}
      {requestSuccessMsg && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 bg-emerald-600 text-white px-5 py-3 rounded-2xl shadow-xl text-sm font-bold animate-fade-in flex items-center gap-2 max-w-sm text-center">
          <Bell size={16} />
          {requestSuccessMsg}
        </div>
      )}

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

      {/* Admin Request Panel */}
      {showAdminPanel && userProfile.isAdmin && (
        <AdminRequestPanel
          onClose={() => setShowAdminPanel(false)}
          onGenerateForRequest={(photoUrl, comment) => {
            setCurrentScreen(Screen.EDIT_MEMORY);
          }}
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
