import React, { useState, useRef, useEffect } from "react";
import { User, Phone, CheckCircle, RefreshCw, Mail, ShieldCheck, ArrowLeft, Lock, Calendar, MapPin, LogIn } from "lucide-react";
import { PublicUser } from "../types";
import { sendCode, verifyCode, completeProfile, login } from "../api";
import { useJsApiLoader } from "@react-google-maps/api";

interface SignUpProps {
  /** Called once the user is fully verified AND has a complete profile. */
  onAuthenticated: (user: PublicUser, isNew: boolean) => void;
}

type Step = "login" | "phone" | "code" | "profile" | "pets";

export default function SignUp({ onAuthenticated }: SignUpProps) {
  const [step, setStep] = useState<Step>("login");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [code, setCode] = useState("");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [birthdate, setBirthdate] = useState("");
  const [city, setCity] = useState("");
  const [petCount, setPetCount] = useState(1);
  const [pets, setPets] = useState<{name: string, kind: string}[]>([{name: "", kind: "dog"}]);
  
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY_BROWSER;
  const { isLoaded } = useJsApiLoader({
    googleMapsApiKey: apiKey || "",
    libraries: ["places"],
  });

  const cityInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (step === "profile" && isLoaded && cityInputRef.current && window.google) {
      const autocomplete = new window.google.maps.places.Autocomplete(cityInputRef.current, {
        types: ['(cities)'],
      });
      autocomplete.addListener('place_changed', () => {
        const place = autocomplete.getPlace();
        if (place.formatted_address) {
          setCity(place.formatted_address);
        } else if (place.name) {
          setCity(place.name);
        }
      });
    }
  }, [step, isLoaded]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) {
      setError("Please enter your email and password.");
      return;
    }
    setError("");
    setBusy(true);
    try {
      const user = await login(email.trim(), password);
      onAuthenticated(user, false);
    } catch (err: any) {
      setError(err.message || "Login failed.");
    } finally {
      setBusy(false);
    }
  };

  const handleSendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!phoneNumber.trim()) {
      setError("Please enter your phone number.");
      return;
    }
    setError("");
    setBusy(true);
    try {
      await sendCode(phoneNumber.trim());
      setStep("code");
    } catch (err: any) {
      setError(err.message || "Could not send the code.");
    } finally {
      setBusy(false);
    }
  };

  const handleVerifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim()) {
      setError("Please enter the 6-digit code we texted you.");
      return;
    }
    setError("");
    setBusy(true);
    try {
      const user = await verifyCode(phoneNumber.trim(), code.trim());
      if (user.profileComplete) {
        onAuthenticated(user, false); // returning user — straight in
      } else {
        setStep("profile"); // new user — must set up profile
      }
    } catch (err: any) {
      setError(err.message || "Verification failed.");
    } finally {
      setBusy(false);
    }
  };

  const handleResend = async () => {
    setError("");
    setBusy(true);
    try {
      await sendCode(phoneNumber.trim());
    } catch (err: any) {
      setError(err.message || "Could not resend the code.");
    } finally {
      setBusy(false);
    }
  };

  const handleProfileNext = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullName.trim() || !email.trim() || !password || !confirmPassword || !birthdate || !city.trim()) {
      setError("Please fill out all fields.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    setError("");
    setStep("pets");
  };

  const handleCompleteProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const validPets = pets.slice(0, petCount).filter(p => p.name.trim() !== "");
      const user = await completeProfile(fullName.trim(), email.trim(), password, confirmPassword, birthdate, city.trim(), validPets);
      onAuthenticated(user, true); // brand-new user
    } catch (err: any) {
      setError(err.message || "Could not save your profile.");
    } finally {
      setBusy(false);
    }
  };

  const inputClass =
    "w-full pl-10 pr-3 py-3 rounded-xl border border-outline-variant bg-surface-container-low text-on-surface focus:outline-none focus:border-primary transition-all placeholder:text-on-surface-variant/50 text-sm";
  const labelClass = "text-[10px] font-semibold uppercase tracking-wider text-on-surface-variant px-1";
  const iconWrap =
    "absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant opacity-50 group-focus-within:text-primary group-focus-within:opacity-100 transition-all";

  return (
    <div className="w-full max-w-md mx-auto px-6 py-8 relative overflow-hidden flex flex-col justify-center min-h-[90vh]">
      {/* Background Decor */}
      <div className="absolute -top-24 -right-24 w-64 h-64 bg-secondary-container opacity-20 rounded-full blur-3xl"></div>
      <div className="absolute -bottom-32 -left-32 w-80 h-80 bg-primary-container opacity-10 rounded-full blur-3xl"></div>

      <div className="z-10 w-full">
        {/* Header Section */}
        <div className="text-center mb-6">
          <div className="mb-3 flex justify-center">
            <div className="w-14 h-14 bg-surface-container rounded-3xl flex items-center justify-center soft-glow-shadow">
              <span className="text-primary text-2xl font-bold font-sans">🐾</span>
            </div>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-on-surface mb-1">
            {step === "login" ? "Welcome Back" : step === "profile" ? "Set Up Your Profile" : step === "pets" ? "About Your Pets" : "Create Account"}
          </h1>
          <p className="text-xs font-medium text-on-surface-variant opacity-80">
            {step === "login" && "Log in with your email and password."}
            {step === "phone" && "Verify your phone to get started. New here? You'll get 50 free credits."}
            {step === "code" && `Enter the 6-digit code we texted to ${phoneNumber}.`}
            {step === "profile" && "Just a couple details and you're in."}
            {step === "pets" && "Tell us about your furry friends!"}
          </p>
        </div>

        {/* Step indicator (only for sign up) */}
        {step !== "login" && (
          <div className="flex items-center justify-center gap-2 mb-4">
            {(["phone", "code", "profile", "pets"] as Step[]).map((s, i) => {
              const order = { phone: 0, code: 1, profile: 2, pets: 3, login: -1 } as Record<Step, number>;
              const active = order[step] >= i;
              return (
                <div
                  key={s}
                  className={`h-1.5 rounded-full transition-all ${active ? "bg-primary w-8" : "bg-outline-variant/50 w-4"}`}
                />
              );
            })}
          </div>
        )}

        {/* Form Container */}
        <div className="bg-surface-container-lowest rounded-3xl p-5 soft-glow-shadow border border-surface-variant/30">
          
          {/* STEP: Login */}
          {step === "login" && (
            <form className="space-y-3" onSubmit={handleLogin}>
              <div className="space-y-1">
                <label htmlFor="login-email" className={labelClass}>Email</label>
                <div className="relative group">
                  <span className={iconWrap}><Mail size={16} /></span>
                  <input
                    id="login-email" type="email" required
                    placeholder="you@example.com"
                    value={email} onChange={(e) => setEmail(e.target.value)}
                    className={inputClass}
                  />
                </div>
              </div>
              <div className="space-y-1">
                <label htmlFor="login-password" className={labelClass}>Password</label>
                <div className="relative group">
                  <span className={iconWrap}><Lock size={16} /></span>
                  <input
                    id="login-password" type="password" required
                    placeholder="••••••••"
                    value={password} onChange={(e) => setPassword(e.target.value)}
                    className={inputClass}
                  />
                </div>
              </div>

              {error && <p className="text-[10px] text-error font-medium px-1">{error}</p>}

              <button
                type="submit" disabled={busy}
                className="w-full bg-primary text-white font-semibold text-xs py-3 rounded-xl soft-glow-shadow hover:bg-primary/95 transition-all mt-2 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-70"
              >
                {busy ? <RefreshCw className="animate-spin" size={14} /> : <LogIn size={14} />}
                Log In
              </button>
            </form>
          )}

          {/* STEP 1 — Phone */}
          {step === "phone" && (
            <form className="space-y-4" onSubmit={handleSendCode}>
              <div className="space-y-1">
                <label htmlFor="phone-number" className={labelClass}>Phone Number</label>
                <div className="relative group">
                  <span className={iconWrap}><Phone size={16} /></span>
                  <input
                    id="phone-number" type="tel" required
                    placeholder="+1 (555) 000-0000"
                    value={phoneNumber} onChange={(e) => setPhoneNumber(e.target.value)}
                    className={inputClass}
                  />
                </div>
                <p className="text-[10px] text-on-surface-variant/70 px-1 pt-1">
                  Include your country code (e.g. +1 for the US).
                </p>
              </div>

              {error && <p className="text-[10px] text-error font-medium px-1">{error}</p>}

              <button
                type="submit" disabled={busy}
                className="w-full bg-primary text-white font-semibold text-xs py-3 rounded-xl soft-glow-shadow hover:bg-primary/95 transition-all mt-2 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-70"
              >
                {busy ? <RefreshCw className="animate-spin" size={14} /> : <span>Send Code →</span>}
              </button>
            </form>
          )}

          {/* STEP 2 — Code */}
          {step === "code" && (
            <form className="space-y-4" onSubmit={handleVerifyCode}>
              <div className="space-y-1">
                <label htmlFor="code" className={labelClass}>Verification Code</label>
                <div className="relative group">
                  <span className={iconWrap}><ShieldCheck size={16} /></span>
                  <input
                    id="code" type="text" inputMode="numeric" maxLength={8} required
                    placeholder="123456"
                    value={code} onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, ""))}
                    className={`${inputClass} tracking-[0.5em] font-mono`}
                  />
                </div>
              </div>

              {error && <p className="text-[10px] text-error font-medium px-1">{error}</p>}

              <button
                type="submit" disabled={busy}
                className="w-full bg-primary text-white font-semibold text-xs py-3 rounded-xl soft-glow-shadow hover:bg-primary/95 transition-all mt-2 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-70"
              >
                {busy ? <RefreshCw className="animate-spin" size={14} /> : <><CheckCircle size={14} /> Verify & Continue</>}
              </button>

              <div className="flex items-center justify-between pt-1">
                <button
                  type="button" onClick={() => { setStep("phone"); setCode(""); setError(""); }}
                  className="text-[10px] text-on-surface-variant font-semibold hover:text-primary flex items-center gap-1 cursor-pointer"
                >
                  <ArrowLeft size={10} /> Change number
                </button>
                <button
                  type="button" onClick={handleResend} disabled={busy}
                  className="text-[10px] text-primary font-bold hover:underline cursor-pointer disabled:opacity-50"
                >
                  Resend code
                </button>
              </div>
            </form>
          )}

          {/* STEP 3 — Profile */}
          {step === "profile" && (
            <form className="space-y-3 max-h-[60vh] overflow-y-auto pr-2" onSubmit={handleProfileNext}>
              <div className="space-y-1">
                <label htmlFor="full-name" className={labelClass}>Full Name</label>
                <div className="relative group">
                  <span className={iconWrap}><User size={16} /></span>
                  <input
                    id="full-name" type="text" required
                    placeholder="Enter your name"
                    value={fullName} onChange={(e) => setFullName(e.target.value)}
                    className={inputClass}
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label htmlFor="email" className={labelClass}>Email Address</label>
                <div className="relative group">
                  <span className={iconWrap}><Mail size={16} /></span>
                  <input
                    id="email" type="email" required
                    placeholder="you@example.com"
                    value={email} onChange={(e) => setEmail(e.target.value)}
                    className={inputClass}
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label htmlFor="password" className={labelClass}>Password</label>
                <div className="relative group">
                  <span className={iconWrap}><Lock size={16} /></span>
                  <input
                    id="password" type="password" required minLength={6}
                    placeholder="••••••••"
                    value={password} onChange={(e) => setPassword(e.target.value)}
                    className={inputClass}
                  />
                </div>
              </div>
              <div className="space-y-1">
                <label htmlFor="confirm-password" className={labelClass}>Confirm Password</label>
                <div className="relative group">
                  <span className={iconWrap}><Lock size={16} /></span>
                  <input
                    id="confirm-password" type="password" required minLength={6}
                    placeholder="••••••••"
                    value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)}
                    className={inputClass}
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label htmlFor="birthdate" className={labelClass}>Date of Birth</label>
                <div className="relative group">
                  <span className={iconWrap}><Calendar size={16} /></span>
                  <input
                    id="birthdate" type="date" required
                    value={birthdate} onChange={(e) => setBirthdate(e.target.value)}
                    className={inputClass}
                  />
                </div>
                <p className="text-[9px] text-on-surface-variant/70 px-1 pt-0.5">You must be 13 or older.</p>
              </div>

              <div className="space-y-1">
                <label htmlFor="city" className={labelClass}>City</label>
                <div className="relative group">
                  <span className={iconWrap}><MapPin size={16} /></span>
                  <input
                    ref={cityInputRef}
                    id="city" type="text" required
                    placeholder="Nearest major city"
                    value={city} onChange={(e) => setCity(e.target.value)}
                    className={inputClass}
                  />
                </div>
              </div>

              {error && <p className="text-[10px] text-error font-medium px-1 pt-1">{error}</p>}

              <button
                type="submit"
                className="w-full bg-primary text-white font-semibold text-xs py-3 rounded-xl soft-glow-shadow hover:bg-primary/95 transition-all mt-2 flex items-center justify-center gap-2 cursor-pointer"
              >
                Continue →
              </button>
            </form>
          )}

          {/* STEP 4 — Pets */}
          {step === "pets" && (
            <form className="space-y-3 max-h-[60vh] overflow-y-auto pr-2" onSubmit={handleCompleteProfile}>
              <div className="space-y-1">
                <label className={labelClass}>How many pets do you have?</label>
                <select 
                  value={petCount} 
                  onChange={(e) => {
                    const c = Number(e.target.value);
                    setPetCount(c);
                    if (pets.length < c) {
                      setPets([...pets, ...Array(c - pets.length).fill({name: "", kind: "dog"})]);
                    }
                  }}
                  className={`${inputClass} pl-3`}
                >
                  <option value={1}>1 Pet</option>
                  <option value={2}>2 Pets</option>
                  <option value={3}>3 Pets</option>
                  <option value={4}>4+ Pets</option>
                </select>
              </div>

              {pets.slice(0, petCount).map((p, idx) => (
                <div key={idx} className="space-y-1 p-3 bg-surface-container-low rounded-xl border border-surface-variant/50">
                  <label className="text-[10px] font-semibold uppercase text-primary px-1">Pet {idx + 1}</label>
                  <input
                    type="text" required placeholder="Pet's Name"
                    value={p.name}
                    onChange={(e) => {
                      const newPets = [...pets];
                      newPets[idx] = { ...p, name: e.target.value };
                      setPets(newPets);
                    }}
                    className={`${inputClass} pl-3 mb-2 bg-surface-container-lowest`}
                  />
                  <div className="flex gap-2">
                    <label className="flex items-center gap-1 text-xs text-on-surface">
                      <input type="radio" checked={p.kind === "dog"} onChange={() => { const newPets = [...pets]; newPets[idx] = { ...p, kind: "dog" }; setPets(newPets); }} />
                      Dog
                    </label>
                    <label className="flex items-center gap-1 text-xs text-on-surface">
                      <input type="radio" checked={p.kind === "cat"} onChange={() => { const newPets = [...pets]; newPets[idx] = { ...p, kind: "cat" }; setPets(newPets); }} />
                      Cat
                    </label>
                    <label className="flex items-center gap-1 text-xs text-on-surface">
                      <input type="radio" checked={p.kind === "other"} onChange={() => { const newPets = [...pets]; newPets[idx] = { ...p, kind: "other" }; setPets(newPets); }} />
                      Other
                    </label>
                  </div>
                </div>
              ))}

              {error && <p className="text-[10px] text-error font-medium px-1 pt-1">{error}</p>}

              <button
                type="submit" disabled={busy}
                className="w-full bg-primary text-white font-semibold text-xs py-3 rounded-xl soft-glow-shadow hover:bg-primary/95 transition-all mt-4 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-70"
              >
                {busy ? <RefreshCw className="animate-spin" size={14} /> : <span>Complete Setup →</span>}
              </button>
            </form>
          )}
        </div>

        {/* Footer Help */}
        <p className="mt-6 text-center text-xs text-on-surface-variant font-medium">
          {step === "login" ? (
            <>
              Don't have an account or prefer phone?{" "}
              <button type="button" onClick={() => setStep("phone")} className="text-primary hover:underline font-bold cursor-pointer">
                Sign up / Verify with Phone
              </button>
            </>
          ) : step === "phone" ? (
            <>
              Already have a password?{" "}
              <button type="button" onClick={() => setStep("login")} className="text-primary hover:underline font-bold cursor-pointer">
                Log in with Email
              </button>
            </>
          ) : (
            "We use your data securely to set up your account."
          )}
        </p>
      </div>
    </div>
  );
}
