import React, { useState, lazy, Suspense } from "react";
import { Screen, UserProfile, Creation, Album, PublicUser } from "./types";
import SignUp from "./components/SignUp";
import ResetPassword from "./components/ResetPassword";
import AnimationStudio from "./components/AnimationStudio";
import Welcome from "./components/Welcome";
import Tutorial from "./components/Tutorial";
import HomePage from "./components/HomePage";
import CreateScreen from "./components/CreateScreen";
import CreateReferenceScreen from "./components/create-flow/CreateReferenceScreen";
import CreateCustomizeScreen from "./components/create-flow/CreateCustomizeScreen";
import CreateValidateScreen from "./components/create-flow/CreateValidateScreen";
import CreateCheckoutScreen from "./components/create-flow/CreateCheckoutScreen";
import { CreateFlowProvider } from "./components/create-flow/CreateFlowContext";
import MarketplaceScreen from "./components/MarketplaceScreen";
import UnderConstructionLock from "./components/UnderConstructionLock";
import EditMemory from "./components/EditMemory";
import RequestMemory from "./components/RequestMemory";
import AdminRequestPanel from "./components/AdminRequestPanel";
import ShareMemory from "./components/ShareMemory";
// Lazy-loaded: these are the only screens/widgets that pull the three.js + R3F
// runtime. Loading them on demand keeps three.js OUT of the initial bundle so the
// landing/dashboard don't download the whole 3D stack.
const RandyChat = lazy(() => import("./components/RandyChat"));
import AlbumView from "./components/AlbumView";
import AlbumsPage from "./components/AlbumsPage";
import { fetchMe, fetchCreations, fetchAlbums, createAlbum, clearToken, claimAchievement, claimDailyStreak, claimShareReward, confirmCreditsSession, acceptCurrentTerms } from "./api";
import { Sun, Moon, LogOut, RefreshCw, Zap, Bell, ShoppingCart, Users, HelpCircle, PackageCheck, ShoppingBag } from "lucide-react";
import CreditStore from "./components/CreditStore";
const AvatarDashboard = lazy(() => import("./components/AvatarDashboard"));
import Store from "./components/Store";
import ProfileScreen from "./components/ProfileScreen";
import Community from "./components/Community";
import HelpModal from "./components/HelpModal";
const PawprintsScreen = lazy(() => import("./components/PawprintsScreen"));
const FidosStylesScreen = lazy(() => import("./components/FidosStylesScreen"));
const FurBinScreen = lazy(() => import("./components/FurBinScreen"));
const WagsAdminPanel = lazy(() => import("./components/WagsAdminPanel"));
const WagsInboxScreen = lazy(() => import("./components/WagsInboxScreen"));
const MarketplaceAdminScreen = lazy(() => import("./components/MarketplaceAdminScreen"));
const AnimatorScreen = lazy(() => import("./animator/components/AnimatorScreen"));
import WarehouseMode from "./components/WarehouseMode";
import { MOBILE_NAV, SIDEBAR_NAV, TOP_PRIMARY_NAV } from "./shellNavigation";
import { syncSeoMetadata } from "./seo";

const EMPTY_PROFILE: UserProfile = { fullName: "", email: "", credits: 0, treats: 0, isAdmin: false, city: "", ageVerified: false, acceptedTermsVersion: null, currentTermsVersion: undefined, requiresTermsAcceptance: false };

const SCREEN_PATHS: Partial<Record<Screen, string>> = {
  [Screen.DASHBOARD]: "/",
  [Screen.SIGN_UP]: "/sign-up",
  [Screen.MODELS]: "/furball3d",
  [Screen.ANIMATOR]: "/animator",
  [Screen.PAWPRINTS]: "/pawprints",
  [Screen.PAWLISHER]: "/fidos-styles",
  [Screen.FURBIN]: "/fur-bin",
  [Screen.STORE]: "/store",
  [Screen.COMMUNITY]: "/community",
  [Screen.PROFILE]: "/profile",
  [Screen.ALBUMS]: "/albums",
  [Screen.REQUEST_MEMORY]: "/request-memory",
  [Screen.CREATE]: "/create",
  [Screen.CREATE_REFERENCE]: "/create/reference",
  [Screen.CREATE_CUSTOMIZE]: "/create/customize",
  [Screen.CREATE_VALIDATE]: "/create/validate",
  [Screen.CREATE_CHECKOUT]: "/create/checkout",
  [Screen.MARKETPLACE]: "/marketplace",
  [Screen.LANDING_MODELS]: "/3d-pet-models",
  [Screen.LANDING_DOGS]: "/custom-dog-figurines",
  [Screen.LANDING_MEMORIALS]: "/pet-memorial-models",
  [Screen.HOW_IT_WORKS]: "/how-it-works",
  [Screen.PRICING]: "/pricing",
  [Screen.ADMIN_WAGS]: "/admin/wags",
  [Screen.WAGS_INBOX]: "/wags",
  [Screen.ADMIN_MARKETPLACE]: "/admin/marketplace",
};

function screenFromPath(pathname: string): Screen | null {
  const normalized = pathname.replace(/\/+$/, "") || "/";
  if (normalized === "/creations") return Screen.FURBIN;
  if (normalized === "/home" || normalized === "/") return Screen.DASHBOARD;
  const entry = Object.entries(SCREEN_PATHS).find(([, path]) => path === normalized);
  return entry ? entry[0] as Screen : null;
}

const getBackgroundImage = (screen: Screen) => {
  switch (screen) {
    case Screen.SIGN_UP:
      return {
        url: "/MAIN4.jpg",
        className: "opacity-40"
      };
    case Screen.WELCOME:
    case Screen.TUTORIAL:
      return {
        url: "/MAIN.jpg",
        className: "opacity-35 grayscale brightness-110"
      };
    case Screen.MODELS:
    case Screen.STORE:
    case Screen.PAWPRINTS:
    case Screen.PAWLISHER:
    case Screen.FURBIN:
    case Screen.CREATE:
    case Screen.CREATE_REFERENCE:
    case Screen.CREATE_CUSTOMIZE:
    case Screen.CREATE_VALIDATE:
    case Screen.CREATE_CHECKOUT:
    case Screen.MARKETPLACE:
      return {
        url: "/MAIN2.jpg",
        className: "opacity-45 blur-[1px]"
      };
    case Screen.PROFILE:
    case Screen.ALBUMS:
    case Screen.ALBUM_VIEW:
    case Screen.SHARE_MEMORY:
    case Screen.REQUEST_MEMORY:
    case Screen.EDIT_MEMORY:
      return {
        url: "/MAIN.jpg",
        className: "opacity-55"
      };
    case Screen.DASHBOARD:
    default:
      return {
        url: "/MAIN2.jpg",
        className: "opacity-55 blur-[1px] brightness-110"
      };
  }
};

export default function App() {
  // Auth gating state
  const [isAuthed, setIsAuthed] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);

  const [currentScreen, setCurrentScreen] = useState<Screen>(Screen.DASHBOARD);
  const [animatorAssetId, setAnimatorAssetId] = useState<string | null>(null);
  // Video Creator is the Animate landing screen; the full 3D builder is its
  // advanced workspace, opened from within that parent module.
  const [animatorMode, setAnimatorMode] = useState<"simple" | "pro">("simple");
  const [userProfile, setUserProfile] = useState<UserProfile>(EMPTY_PROFILE);

  const [showOrderSuccessModal, setShowOrderSuccessModal] = useState(false);
  const [successOrderSessionId, setSuccessOrderSessionId] = useState("");
  const [showCreditStore, setShowCreditStore] = useState(false);
  const [creditSuccessMsg, setCreditSuccessMsg] = useState("");
  const [showAdminPanel, setShowAdminPanel] = useState(false);
  const [requestSuccessMsg, setRequestSuccessMsg] = useState("");
  const [showHelpModal, setShowHelpModal] = useState(false);

  const [albums, setAlbums] = useState<Album[]>([]);
  const [creations, setCreations] = useState<Creation[]>([]);
  const [activeAlbum, setActiveAlbum] = useState<Album | null>(null);
  const [selectedCreationForShare, setSelectedCreationForShare] = useState<Creation | null>(null);

  const refreshCreations = async () => {
    const serverCreations = await fetchCreations();
    setCreations(serverCreations);
  };

  const openAnimationStudio = () => {
    setAnimatorAssetId(null);
    setAnimatorMode("simple");
    setCurrentScreen(Screen.ANIMATOR);
  };

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
        setCurrentScreen(screenFromPath(window.location.pathname) || Screen.DASHBOARD);
        // Login/check-in rewards are server-side and idempotent per calendar day.
        try {
          const checkedIn = await claimDailyStreak();
          applyUser(checkedIn);
        } catch {
          // A reward outage must never block a returning user from entering the app.
        }
        // Phase 1.7: Fetch persistent creations from backend
        await refreshCreations();
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

  // Keep state-driven navigation addressable and make browser back/forward work.
  React.useEffect(() => {
    if (!authChecked || !isAuthed) return;
    const path = SCREEN_PATHS[currentScreen];
    if (path && window.location.pathname !== path) window.history.pushState({ screen: currentScreen }, "", path);
  }, [authChecked, isAuthed, currentScreen]);

  React.useEffect(() => {
    const onPopState = () => {
      const screen = screenFromPath(window.location.pathname);
      if (screen) setCurrentScreen(screen);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  // Public entry is indexable; every account-specific studio route stays out of
  // search results even though this is a client-routed application.
  React.useEffect(() => {
    syncSeoMetadata(currentScreen, isAuthed);
  }, [currentScreen, isAuthed]);

  // Per-site mode: "main" (pawsome3d.com) vs "warehouse" (mypets.cc). Read from
  // the public /api/config endpoint (driven by the DEPLOY_TARGET env var).
  const [deployTarget, setDeployTarget] = useState<string>("main");
  React.useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((d) => { if (d && typeof d.deployTarget === "string") setDeployTarget(d.deployTarget); })
      .catch(() => {});
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
      alert("Order cancelled. Your payment was not processed and no PupCoins were deducted.");
      const newUrl = window.location.pathname;
      window.history.replaceState({}, document.title, newUrl);
    } else if (params.get("credits_success") === "true") {
      const added = params.get("added") || "?";
      const sessionId = params.get("session_id");
      setCreditSuccessMsg(`🎉 ${added} PupCoins added to your account!`);
      // Confirm the purchase server-side (credits it if the webhook hasn't yet),
      // then re-fetch so the displayed balance is accurate even if the webhook failed.
      (async () => {
        if (sessionId) { try { await confirmCreditsSession(sessionId); } catch { /* ignore */ } }
        const user = await fetchMe();
        if (user) applyUser(user);
      })();
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
      profilePhotoUrl: user.profilePhotoUrl ?? null,
      referralCode: user.referralCode ?? null,
      phoneVerified: user.phoneVerified ?? false,
      emailVerified: user.emailVerified ?? false,
      zip: user.zip,
      bio: user.bio ?? null,
      profileBonusGranted: user.profileBonusGranted ?? false,
      acceptedTermsVersion: user.acceptedTermsVersion ?? null,
      acceptedTermsAt: user.acceptedTermsAt ?? null,
      currentTermsVersion: user.currentTermsVersion,
      requiresTermsAcceptance: user.requiresTermsAcceptance ?? false,
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
      refreshCreations().catch(() => {});
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

  const handleClaimDailyBonus = async () => {
    // Persist server-side (reuses the daily-streak grant: +5 PupCoins & a treat).
    try {
      const updatedUser = await claimDailyStreak();
      applyUser(updatedUser);
    } catch (err: any) {
      alert(err.message || "Daily bonus already claimed today.");
    }
  };

  const handleShareCompleted = async (platform: string) => {
    // Server-persisted, per-day capped reward — no more client-only credits.
    try {
      const { reward, user } = await claimShareReward(platform);
      applyUser(user);
      alert(`Thanks for sharing to ${platform}! +${reward} PupCoins added.`);
    } catch (err: any) {
      alert(err.message || "Couldn't grant the share reward right now.");
    }
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

  const handleDeductCredits = async (amount: number) => {
    // Optimistic UI, then reconcile with the server (the real spend is persisted
    // server-side during generation, and logged to the credit ledger).
    setUserProfile((prev) => ({ ...prev, credits: Math.max(0, prev.credits - amount) }));
    try {
      const me = await fetchMe();
      if (me) applyUser(me);
    } catch {
      /* keep optimistic value if the refresh fails */
    }
  };

  const handleAcceptTerms = async () => {
    try {
      const updatedUser = await acceptCurrentTerms();
      applyUser(updatedUser);
    } catch (err: any) {
      alert(err.message || "Could not save your acceptance. Please try again.");
    }
  };

  // Standalone password-reset page (opened from the emailed link) — render it
  // before auth/warehouse so a logged-out user can reset from any deploy target.
  if (typeof window !== "undefined" && window.location.pathname === "/reset-password") {
    return <ResetPassword />;
  }

  // While we check for an existing session, show a lightweight loader.
  // mypets.cc runs the same build but serves the cold-storage warehouse identity.
  if (deployTarget === "warehouse") {
    return <WarehouseMode isDarkMode={isDarkMode} />;
  }

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
        {/* Readability scrim: keeps foreground text from washing into the photo background */}
        <div className="absolute inset-0 bg-gradient-to-b from-background/70 via-background/50 to-background/80"></div>
        {/* Mud splatters */}
        <div className="mud-splatter" style={{ width: "120px", height: "90px", top: "-20px", left: "-10%", "--rot": "15deg" } as React.CSSProperties}></div>
        <div className="mud-splatter" style={{ width: "180px", height: "140px", top: "40%", right: "-15%", "--rot": "-25deg", animationDelay: "0.2s" } as React.CSSProperties}></div>
        <div className="mud-splatter" style={{ width: "90px", height: "70px", bottom: "-30px", left: "20%", "--rot": "45deg", animationDelay: "0.5s" } as React.CSSProperties}></div>
        <div className="mud-splatter" style={{ width: "150px", height: "100px", top: "10%", right: "10%", "--rot": "10deg", animationDelay: "0.8s" } as React.CSSProperties}></div>
        {/* Gradient overlay to ensure text remains readable */}
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-background/25 to-background/60 dark:from-transparent dark:via-[#17120f]/40 dark:to-[#17120f]/80"></div>
      </div>

      {/* Dynamic Upper Header Bar */}
      <header className="fixed inset-x-0 top-0 z-50 h-16 bg-surface/85 backdrop-blur-xl shadow-[0_8px_32px_0_rgba(68,42,34,0.08)]">
        <nav className="mx-auto grid h-16 w-full max-w-[96rem] grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 px-3 sm:px-5 lg:px-8">
          <div className="flex min-w-0 items-center gap-2">
            <img src="/brand/pawsome-logo.png" alt="Pawsome3D" className="h-9 w-9 shrink-0 rounded-lg object-contain" />
          </div>

          <div className="min-w-0">
            <div className="hidden items-center justify-center gap-1 whitespace-nowrap lg:flex xl:gap-3">
              {isAuthed && (
                <>
              {TOP_PRIMARY_NAV.map((item) => (
                <button
                  key={item.id}
                  data-tour={item.screen === Screen.CREATE ? "nav-create" : undefined}
                  onClick={() => item.screen === Screen.ANIMATOR ? openAnimationStudio() : setCurrentScreen(item.screen)}
                  className={`min-h-10 px-2.5 text-sm font-medium transition-colors xl:px-3 ${[item.screen, Screen.CREATE_REFERENCE, Screen.CREATE_CUSTOMIZE, Screen.CREATE_VALIDATE, Screen.CREATE_CHECKOUT].includes(currentScreen) && item.screen === Screen.CREATE ? "border-b-2 border-primary font-bold text-primary" : currentScreen === item.screen ? "border-b-2 border-primary font-bold text-primary" : "text-on-surface-variant hover:text-primary"}`}
                >
                  {item.imageSrc ? <img src={item.imageSrc} alt={item.label} className="h-8 w-8 rounded-lg object-cover" /> : item.label}
                  <span className={item.imageSrc ? "sr-only" : undefined}>{item.label}</span>
                </button>
              ))}
                </>
              )}
            </div>
          </div>

          <div className="flex min-w-0 items-center justify-end gap-1 sm:gap-2">
            {isAuthed && (
              <>
                <button
                  onClick={() => setCurrentScreen(Screen.STORE)}
                  className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full border transition-colors ${currentScreen === Screen.STORE ? "border-primary bg-primary text-on-primary" : "border-outline-variant/30 bg-surface-container text-on-surface-variant hover:text-primary"}`}
                  title="Shop"
                  aria-label="Open shop"
                >
                  <ShoppingCart size={18} />
                </button>
                <button
                  onClick={() => setCurrentScreen(Screen.COMMUNITY)}
                  className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full border transition-colors ${currentScreen === Screen.COMMUNITY ? "border-primary bg-primary text-on-primary" : "border-outline-variant/30 bg-surface-container text-on-surface-variant hover:text-primary"}`}
                  title="Community"
                  aria-label="Open community"
                >
                  <Users size={18} />
                </button>
              </>
            )}
            <button
              onClick={toggleDarkMode}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-outline-variant/30 bg-surface-container text-on-surface hover:bg-outline-variant/35"
              title={isDarkMode ? "Turn on Light Mode" : "Turn on Dark Mode"}
              aria-label={isDarkMode ? "Turn on light mode" : "Turn on dark mode"}
            >
              {isDarkMode ? <Sun size={14} className="text-amber-400" /> : <Moon size={14} className="text-slate-600" />}
            </button>

            {isAuthed && userProfile.fullName && (
              <>
                <button
                  onClick={() => setCurrentScreen(Screen.PROFILE)}
                  title="View profile"
                  className={`hidden h-10 min-w-10 shrink-0 items-center justify-center gap-2 rounded-full border bg-surface-container-high px-2.5 shadow-sm transition-all hover:bg-surface-container-highest md:flex ${currentScreen === Screen.PROFILE ? "border-primary" : "border-outline-variant/40"}`}
                >
                  {userProfile.profilePhotoUrl ? (
                    <img src={userProfile.profilePhotoUrl} alt="" className="h-5 w-5 rounded-full object-cover" />
                  ) : (
                    <div className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[9px] font-black text-on-primary">
                      {userProfile.fullName.split(" ").map((name) => name[0]).join("").slice(0, 2).toUpperCase() || "U"}
                    </div>
                  )}
                  <span className="hidden max-w-[72px] truncate text-xs font-bold text-on-surface xl:block">{userProfile.fullName.split(" ")[0]}</span>
                  <span className="hidden text-xs font-bold text-secondary xl:block">{userProfile.credits} PupCoins</span>
                </button>
                <button
                  data-tour="buy-credits"
                  onClick={() => setShowCreditStore(true)}
                  className="hidden h-10 shrink-0 items-center gap-1.5 rounded-full border border-primary/20 bg-primary/10 px-2.5 text-[10px] font-black uppercase text-primary hover:bg-primary/20 xl:flex"
                  title="Buy more PupCoins"
                >
                  <Zap size={11} className="fill-primary" /> PupCoins
                </button>
                <button onClick={() => setShowHelpModal(true)} className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-full border border-outline-variant/30 bg-surface-container text-on-surface-variant hover:text-primary sm:flex" title="Help & Support" aria-label="Help and support">
                  <HelpCircle size={18} />
                </button>
                {userProfile.isAdmin && (
                  <button
                    onClick={() => setCurrentScreen(Screen.ADMIN_WAGS)}
                    className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-full border border-outline-variant/30 bg-surface-container text-on-surface-variant hover:text-primary sm:flex"
                    title="Wags admin review"
                    aria-label="Wardrobe Wags admin review"
                  >
                    <PackageCheck size={18} />
                  </button>
                )}
                {userProfile.isAdmin && (
                  <button
                    onClick={() => setCurrentScreen(Screen.ADMIN_MARKETPLACE)}
                    className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-full border border-outline-variant/30 bg-surface-container text-on-surface-variant hover:text-primary sm:flex"
                    title="Marketplace admin"
                    aria-label="Marketplace catalog manager"
                  >
                    <ShoppingBag size={18} />
                  </button>
                )}
                <button onClick={handleLogout} className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-full border border-outline-variant/30 bg-surface-container text-on-surface-variant hover:bg-error/10 hover:text-error sm:flex" title="Log out" aria-label="Log out">
                  <LogOut size={18} />
                </button>
              </>
            )}
          </div>
        </nav>
      </header>

      <div className="flex-grow flex w-full relative">
        {/* Desktop Sidebar */}
        {isAuthed && [Screen.DASHBOARD, Screen.ALBUMS, Screen.EDIT_MEMORY, Screen.REQUEST_MEMORY, Screen.SHARE_MEMORY, Screen.ALBUM_VIEW, Screen.MODELS, Screen.STORE, Screen.PROFILE, Screen.COMMUNITY, Screen.ANIMATOR, Screen.PAWPRINTS, Screen.PAWLISHER, Screen.FURBIN, Screen.CREATE, Screen.CREATE_REFERENCE, Screen.CREATE_CUSTOMIZE, Screen.CREATE_VALIDATE, Screen.CREATE_CHECKOUT, Screen.MARKETPLACE, Screen.ADMIN_WAGS, Screen.ADMIN_MARKETPLACE, Screen.WAGS_INBOX].includes(currentScreen) && (
          <aside className="fixed bottom-0 left-0 top-16 z-40 hidden w-64 shrink-0 flex-col overflow-x-hidden overflow-y-auto border-r border-outline-variant/20 bg-surface/85 py-5 shadow-xl backdrop-blur-xl dark:bg-surface-dim/85 md:flex">
            <nav className="mt-4 flex-1 space-y-2 px-4">
              {SIDEBAR_NAV.map((item) => (
                <button
                  key={item.id}
                  onClick={() => item.screen === Screen.ANIMATOR ? openAnimationStudio() : setCurrentScreen(item.screen)}
                  className={`flex min-h-12 w-full items-center gap-4 rounded-lg px-4 py-3 text-left transition-all ${currentScreen === item.screen ? "bg-primary text-on-primary shadow-sm" : "text-on-surface-variant hover:bg-secondary-container/50 dark:hover:bg-surface-variant/30"}`}
                >
                  <span className="material-symbols-outlined shrink-0 font-sans" style={{ fontVariationSettings: currentScreen === item.screen ? "'FILL' 1" : "'FILL' 0" }}>{item.materialIcon}</span>
                  <span className="min-w-0 truncate font-medium">{item.label}</span>
                </button>
              ))}
            </nav>
            <div className="mx-4 mt-auto space-y-2 border-t border-outline-variant/20 px-4 py-6">
              <button onClick={() => setCurrentScreen(Screen.PROFILE)} className={`flex w-full items-center gap-4 rounded-lg px-4 py-2 transition-all ${currentScreen === Screen.PROFILE ? "bg-primary text-on-primary" : "text-on-surface-variant hover:bg-secondary-container/30"}`}>
                <span className="material-symbols-outlined shrink-0 font-sans">person</span>
                <span className="text-body-sm">Profile</span>
              </button>
              <button onClick={() => setShowHelpModal(true)} className="flex w-full items-center gap-4 rounded-lg px-4 py-2 text-on-surface-variant transition-all hover:bg-secondary-container/30">
                <span className="material-symbols-outlined shrink-0 font-sans">help</span>
                <span className="text-body-sm">Help / Support</span>
              </button>
            </div>
          </aside>
        )}

      {/* Main Content Router viewport */}
      <CreateFlowProvider>
      <main className={`flex min-w-0 flex-grow flex-col items-center justify-center pt-16 pb-24 md:pb-0 ${isAuthed ? 'relative w-full md:ml-64 md:w-[calc(100%-16rem)]' : 'w-full'}`}>
        {/* Render public screens regardless of auth state */}
        {[Screen.DASHBOARD, Screen.LANDING_MODELS, Screen.LANDING_DOGS, Screen.LANDING_MEMORIALS, Screen.HOW_IT_WORKS, Screen.PRICING].includes(currentScreen) && (
          <HomePage
            userProfile={userProfile}
            onOpenCreate={() => !isAuthed ? setCurrentScreen(Screen.SIGN_UP) : setCurrentScreen(Screen.CREATE)}
            onOpenMarketplace={() => setCurrentScreen(Screen.MARKETPLACE)}
            onOpenPawprints={() => setCurrentScreen(Screen.PAWPRINTS)}
            onOpenFurball={() => setCurrentScreen(Screen.CREATE)} /* RD-6: Furball3D gated; route to Create */
            onOpenFidos={() => setCurrentScreen(Screen.PAWLISHER)}
          />
        )}

        {currentScreen === Screen.CREATE && (
          <CreateScreen onNavigate={setCurrentScreen} />
        )}
        {currentScreen === Screen.CREATE_REFERENCE && (
          <CreateReferenceScreen onNavigate={setCurrentScreen} />
        )}
        {currentScreen === Screen.CREATE_CUSTOMIZE && (
          <CreateCustomizeScreen onNavigate={setCurrentScreen} />
        )}
        {currentScreen === Screen.CREATE_VALIDATE && (
          <CreateValidateScreen onNavigate={setCurrentScreen} />
        )}
        {currentScreen === Screen.CREATE_CHECKOUT && (
          <CreateCheckoutScreen onNavigate={setCurrentScreen} userProfile={userProfile} />
        )}

        {currentScreen === Screen.MARKETPLACE && (
          <MarketplaceScreen onOpenCreate={() => !isAuthed ? setCurrentScreen(Screen.SIGN_UP) : setCurrentScreen(Screen.CREATE)} />
        )}

        {currentScreen === Screen.PAWPRINTS && (
          <Suspense fallback={<div className="flex-1 flex items-center justify-center py-24 text-on-surface-variant"><RefreshCw className="animate-spin" size={22} /></div>}>
            <PawprintsScreen userProfile={userProfile} creations={creations} onOpenCreditStore={() => setShowCreditStore(true)} onUserUpdate={applyUser} onCreationSaved={refreshCreations} />
          </Suspense>
        )}

        {/* When not authenticated and screen is not public, render sign-up. */}
        {!isAuthed && ![Screen.DASHBOARD, Screen.CREATE, Screen.CREATE_REFERENCE, Screen.CREATE_CUSTOMIZE, Screen.CREATE_VALIDATE, Screen.CREATE_CHECKOUT, Screen.MARKETPLACE, Screen.PAWPRINTS, Screen.LANDING_MODELS, Screen.LANDING_DOGS, Screen.LANDING_MEMORIALS, Screen.HOW_IT_WORKS, Screen.PRICING].includes(currentScreen) ? (
          <SignUp onAuthenticated={handleAuthenticated} />
        ) : (
          isAuthed && (
            <>
              {currentScreen === Screen.WELCOME && (
                <Welcome
                  userName={userProfile.fullName}
                  onNext={handleWelcomeNext}
                  onBackToSignUp={handleLogout}
                />
              )}

              {currentScreen === Screen.TUTORIAL && <Tutorial onComplete={handleTutorialComplete} />}

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
                creations={creations.filter(c => c.album_id?.toString() === activeAlbum.id)}
                onBack={() => setCurrentScreen(Screen.ALBUMS)}
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

            {currentScreen === Screen.MODELS && (
                <UnderConstructionLock
                  featureName="Furball3D"
                  featureDescription="The legacy Furball3D builder is offline while we migrate to the new create-to-print workflow."
                  onGoToCreate={() => setCurrentScreen(Screen.CREATE)}
                />
              )}

            {currentScreen === Screen.STORE && (
              <Store
                userProfile={userProfile}
                onOpenCreditStore={() => setShowCreditStore(true)}
                onGoToAvatars={() => setCurrentScreen(Screen.CREATE)} /* RD-6: avatars gated; route to Create */
                albums={albums}
                creations={creations}
                onSelectCreation={handleSelectCreation}
                onNavigate={setCurrentScreen}
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
                onUserUpdate={applyUser}
              />
            )}

            {currentScreen === Screen.COMMUNITY && (
              <Community userProfile={userProfile} />
            )}

            {currentScreen === Screen.PAWLISHER && (
              <Suspense fallback={<div className="flex-1 flex items-center justify-center py-24 text-on-surface-variant"><RefreshCw className="animate-spin" size={22} /></div>}>
                <FidosStylesScreen
                  userProfile={userProfile}
                  onGoToPawprints={() => setCurrentScreen(Screen.PAWPRINTS)}
                  onUserUpdate={applyUser}
                />
              </Suspense>
            )}

            {currentScreen === Screen.ADMIN_MARKETPLACE && (
              userProfile.isAdmin ? (
                <Suspense fallback={<div className="flex-1 flex items-center justify-center py-24 text-on-surface-variant"><RefreshCw className="animate-spin" size={22} /></div>}>
                  <MarketplaceAdminScreen onClose={() => setCurrentScreen(Screen.DASHBOARD)} />
                </Suspense>
              ) : (
                <HomePage
                  userProfile={userProfile}
                  onOpenCreate={() => setCurrentScreen(Screen.CREATE)}
                  onOpenMarketplace={() => setCurrentScreen(Screen.MARKETPLACE)}
                  onOpenPawprints={() => setCurrentScreen(Screen.PAWPRINTS)}
                  onOpenFurball={() => setCurrentScreen(Screen.CREATE)}
                  onOpenFidos={() => setCurrentScreen(Screen.PAWLISHER)}
                />
              )
            )}

            {currentScreen === Screen.WAGS_INBOX && (
              <Suspense fallback={<div className="flex-1 flex items-center justify-center py-24 text-on-surface-variant"><RefreshCw className="animate-spin" size={22} /></div>}>
                <WagsInboxScreen onGoToFidos={() => setCurrentScreen(Screen.PAWLISHER)} />
              </Suspense>
            )}

            {/* Server-guarded too: every /api/admin/wags/* route checks isUserAdmin.
                This client gate is cosmetic; non-admins landing here are bounced. */}
            {currentScreen === Screen.ADMIN_WAGS && (
              userProfile.isAdmin ? (
                <Suspense fallback={<div className="flex-1 flex items-center justify-center py-24 text-on-surface-variant"><RefreshCw className="animate-spin" size={22} /></div>}>
                  <WagsAdminPanel onClose={() => setCurrentScreen(Screen.DASHBOARD)} />
                </Suspense>
              ) : (
                <HomePage
                  userProfile={userProfile}
                  onOpenCreate={() => setCurrentScreen(Screen.CREATE)}
                  onOpenMarketplace={() => setCurrentScreen(Screen.MARKETPLACE)}
                  onOpenPawprints={() => setCurrentScreen(Screen.PAWPRINTS)}
                  onOpenFurball={() => setCurrentScreen(Screen.CREATE)}
                  onOpenFidos={() => setCurrentScreen(Screen.PAWLISHER)}
                />
              )
            )}

            {currentScreen === Screen.FURBIN && (
              <Suspense fallback={<div className="flex-1 flex items-center justify-center py-24 text-on-surface-variant"><RefreshCw className="animate-spin" size={22} /></div>}>
                <FurBinScreen userProfile={userProfile} creations={creations} onOpenCreditStore={() => setShowCreditStore(true)} />
              </Suspense>
            )}

            {currentScreen === Screen.ANIMATOR && (
              <UnderConstructionLock
                featureName="Animation Studio"
                featureDescription="Bring your 3D pet model to life with motion, video, and cinematic scenes — coming soon."
                onGoToCreate={() => setCurrentScreen(Screen.CREATE)}
              />
            )}


            {/* Safety net: if somehow on SIGN_UP while authed, send to dashboard */}
            {currentScreen === Screen.SIGN_UP && (
              <HomePage
                userProfile={userProfile}
                onOpenCreate={() => setCurrentScreen(Screen.CREATE)}
                onOpenMarketplace={() => setCurrentScreen(Screen.MARKETPLACE)}
                onOpenPawprints={() => setCurrentScreen(Screen.PAWPRINTS)}
                onOpenFurball={() => setCurrentScreen(Screen.CREATE)} /* RD-6: Furball3D gated; route to Create */
                onOpenFidos={() => setCurrentScreen(Screen.PAWLISHER)}
              />
            )}
          </>
        )
      )}
      </main>
      </CreateFlowProvider>

      {isAuthed && userProfile.requiresTermsAcceptance && (
        <div className="fixed inset-0 z-[90] bg-black/70 flex items-center justify-center p-4">
          <section className="w-full max-w-lg rounded-2xl bg-surface text-on-surface border border-outline-variant shadow-2xl p-6">
            <h2 className="text-2xl font-black mb-3">Please review our terms</h2>
            <p className="text-lg leading-relaxed text-on-surface-variant mb-5">
              We updated our Terms and Privacy Policy. Please accept the current version to keep using Pawsome3D.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 mb-5">
              <a href="/legal/terms" target="_blank" rel="noopener noreferrer" className="min-h-12 flex items-center justify-center rounded-xl border border-outline-variant px-4 text-base font-bold text-primary">
                Read Terms
              </a>
              <a href="/legal/privacy" target="_blank" rel="noopener noreferrer" className="min-h-12 flex items-center justify-center rounded-xl border border-outline-variant px-4 text-base font-bold text-primary">
                Read Privacy Policy
              </a>
            </div>
            <button
              type="button"
              onClick={handleAcceptTerms}
              className="w-full min-h-14 rounded-xl bg-primary text-on-primary text-lg font-black"
            >
              I Agree
            </button>
          </section>
        </div>
      )}

      {/* Floating Bottom Navigator (only when signed in and past onboarding) */}
      {isAuthed && [Screen.DASHBOARD, Screen.ALBUMS, Screen.EDIT_MEMORY, Screen.REQUEST_MEMORY, Screen.SHARE_MEMORY, Screen.ALBUM_VIEW, Screen.MODELS, Screen.STORE, Screen.PROFILE, Screen.COMMUNITY, Screen.ANIMATOR, Screen.PAWPRINTS, Screen.PAWLISHER, Screen.FURBIN, Screen.CREATE, Screen.MARKETPLACE, Screen.WAGS_INBOX].includes(currentScreen) && (
        <div className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 gap-1 rounded-t-2xl border-t border-outline-variant/30 bg-surface-container-lowest/90 px-1 py-2 shadow-[0_-8px_32px_0_rgba(68,42,34,0.08)] backdrop-blur-xl dark:bg-surface-dim/90 md:hidden">
          {MOBILE_NAV.map((item) => (
            <button
              key={item.id}
              onClick={() => item.screen === Screen.ANIMATOR ? openAnimationStudio() : setCurrentScreen(item.screen)}
              className={`flex min-w-0 flex-col items-center justify-center gap-1 rounded-xl px-1 py-2 transition-colors ${currentScreen === item.screen ? "bg-primary text-on-primary" : "text-on-surface-variant hover:bg-surface-variant/50"}`}
            >
              <span className="material-symbols-outlined shrink-0 font-sans" style={{ fontVariationSettings: currentScreen === item.screen ? "'FILL' 1" : "'FILL' 0" }}>{item.materialIcon}</span>
              <span className="w-full truncate text-center text-[9px] font-bold">{item.label}</span>
            </button>
          ))}
          <button onClick={() => setShowHelpModal(true)} className="flex min-w-0 flex-col items-center justify-center gap-1 rounded-xl px-1 py-2 text-on-surface-variant hover:bg-surface-variant/50">
            <span className="material-symbols-outlined shrink-0 font-sans">help</span>
            <span className="w-full truncate text-center text-[9px] font-bold">Help</span>
          </button>
        </div>
      )}

      </div>

      {/* Randy AI-chat bubble companion (only for signed-in users) */}
      {isAuthed && (
        <Suspense fallback={null}>
          <RandyChat
            onUnlockAchievement={handleUnlockAchievement}
            isDarkMode={isDarkMode}
            onNavigate={setCurrentScreen}
            onOpenCreditStore={() => setShowCreditStore(true)}
            onLaunchAR={() => setCurrentScreen(Screen.CREATE)} /* RD-6: AR entry gated; route to Create */
          />
        </Suspense>
      )}

      {/* Request success toast */}
      {requestSuccessMsg && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 bg-emerald-600 text-white px-5 py-3 rounded-2xl shadow-xl text-sm font-bold animate-fade-in flex items-center gap-2 max-w-sm text-center">
          <Bell size={16} />
          {requestSuccessMsg}
        </div>
      )}

      {/* PupCoins success toast */}
      {creditSuccessMsg && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 bg-primary text-white px-5 py-3 rounded-2xl shadow-xl text-sm font-bold animate-fade-in flex items-center gap-2">
          <Zap size={16} className="fill-white" />
          {creditSuccessMsg}
        </div>
      )}

      {/* Help & Support Modal */}
      {showHelpModal && <HelpModal userEmail={userProfile.email || ""} onClose={() => setShowHelpModal(false)} />}

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
              Your payment of **$12.00 USD** succeeded, and **800 PupCoins** have been deducted.
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
