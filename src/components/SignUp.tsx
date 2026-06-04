import React, { useState } from "react";
import { User, Phone, CheckCircle, RefreshCw, Mail, ShieldCheck, ArrowLeft } from "lucide-react";
import { PublicUser } from "../types";
import { sendCode, verifyCode, completeProfile } from "../api";

interface SignUpProps {
  /** Called once the user is fully verified AND has a complete profile. */
  onAuthenticated: (user: PublicUser, isNew: boolean) => void;
}

type Step = "phone" | "code" | "profile";

export default function SignUp({ onAuthenticated }: SignUpProps) {
  const [step, setStep] = useState<Step>("phone");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [code, setCode] = useState("");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

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

  const handleCompleteProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullName.trim() || !email.trim()) {
      setError("Please enter both your name and email.");
      return;
    }
    setError("");
    setBusy(true);
    try {
      const user = await completeProfile(fullName.trim(), email.trim());
      onAuthenticated(user, true); // brand-new user
    } catch (err: any) {
      setError(err.message || "Could not save your profile.");
    } finally {
      setBusy(false);
    }
  };

  const inputClass =
    "w-full pl-12 pr-4 py-3.5 rounded-xl border border-outline-variant bg-surface-container-low text-on-surface focus:outline-none focus:border-primary transition-all placeholder:text-on-surface-variant/50";
  const labelClass = "text-xs font-semibold uppercase tracking-wider text-on-surface-variant px-1";
  const iconWrap =
    "absolute left-4 top-1/2 -translate-y-1/2 text-on-surface-variant opacity-50 group-focus-within:text-primary group-focus-within:opacity-100 transition-all";

  return (
    <div className="w-full max-w-md mx-auto px-6 py-8 relative overflow-hidden flex flex-col justify-center min-h-[90vh]">
      {/* Background Decor */}
      <div className="absolute -top-24 -right-24 w-64 h-64 bg-secondary-container opacity-20 rounded-full blur-3xl"></div>
      <div className="absolute -bottom-32 -left-32 w-80 h-80 bg-primary-container opacity-10 rounded-full blur-3xl"></div>

      <div className="z-10 w-full">
        {/* Header Section */}
        <div className="text-center mb-8">
          <div className="mb-4 flex justify-center">
            <div className="w-16 h-16 bg-surface-container rounded-3xl flex items-center justify-center soft-glow-shadow">
              <span className="text-primary text-3xl font-bold font-sans">🐾</span>
            </div>
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-on-surface mb-2">
            {step === "profile" ? "Set Up Your Profile" : "Create Your Account"}
          </h1>
          <p className="text-sm font-medium text-on-surface-variant opacity-80">
            {step === "phone" && "Verify your phone to get started. New here? You'll get 50 free credits."}
            {step === "code" && `Enter the 6-digit code we texted to ${phoneNumber}.`}
            {step === "profile" && "Just a couple details and you're in."}
          </p>
        </div>

        {/* Step indicator */}
        <div className="flex items-center justify-center gap-2 mb-6">
          {(["phone", "code", "profile"] as Step[]).map((s, i) => {
            const order = { phone: 0, code: 1, profile: 2 } as Record<Step, number>;
            const active = order[step] >= i;
            return (
              <div
                key={s}
                className={`h-1.5 rounded-full transition-all ${active ? "bg-primary w-8" : "bg-outline-variant/50 w-4"}`}
              />
            );
          })}
        </div>

        {/* Form Container */}
        <div className="bg-surface-container-lowest rounded-3xl p-6 soft-glow-shadow border border-surface-variant/30">
          {/* STEP 1 — Phone */}
          {step === "phone" && (
            <form className="space-y-4" onSubmit={handleSendCode}>
              <div className="space-y-1">
                <label htmlFor="phone-number" className={labelClass}>
                  Phone Number
                </label>
                <div className="relative group">
                  <span className={iconWrap}>
                    <Phone size={18} />
                  </span>
                  <input
                    id="phone-number"
                    type="tel"
                    required
                    autoComplete="tel"
                    placeholder="+1 (555) 000-0000"
                    value={phoneNumber}
                    onChange={(e) => setPhoneNumber(e.target.value)}
                    className={inputClass}
                  />
                </div>
                <p className="text-[11px] text-on-surface-variant/70 px-1 pt-1">
                  Include your country code (e.g. +1 for the US).
                </p>
              </div>

              {error && <p className="text-xs text-error font-medium px-1 pt-1">{error}</p>}

              <button
                type="submit"
                disabled={busy}
                className="w-full bg-primary text-white font-semibold text-sm py-4 rounded-xl soft-glow-shadow hover:bg-primary/95 transition-all active:scale-[0.98] duration-200 mt-2 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-70"
              >
                {busy ? (
                  <>
                    <RefreshCw className="animate-spin" size={16} />
                    Sending Code...
                  </>
                ) : (
                  <>
                    Send Verification Code
                    <span>→</span>
                  </>
                )}
              </button>
            </form>
          )}

          {/* STEP 2 — Code */}
          {step === "code" && (
            <form className="space-y-4" onSubmit={handleVerifyCode}>
              <div className="space-y-1">
                <label htmlFor="code" className={labelClass}>
                  Verification Code
                </label>
                <div className="relative group">
                  <span className={iconWrap}>
                    <ShieldCheck size={18} />
                  </span>
                  <input
                    id="code"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={8}
                    required
                    placeholder="123456"
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, ""))}
                    className={`${inputClass} tracking-[0.5em] font-mono`}
                  />
                </div>
              </div>

              {error && <p className="text-xs text-error font-medium px-1 pt-1">{error}</p>}

              <button
                type="submit"
                disabled={busy}
                className="w-full bg-primary text-white font-semibold text-sm py-4 rounded-xl soft-glow-shadow hover:bg-primary/95 transition-all active:scale-[0.98] duration-200 mt-2 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-70"
              >
                {busy ? (
                  <>
                    <RefreshCw className="animate-spin" size={16} />
                    Verifying...
                  </>
                ) : (
                  <>
                    <CheckCircle size={16} />
                    Verify &amp; Continue
                  </>
                )}
              </button>

              <div className="flex items-center justify-between pt-1">
                <button
                  type="button"
                  onClick={() => {
                    setStep("phone");
                    setCode("");
                    setError("");
                  }}
                  className="text-xs text-on-surface-variant font-semibold hover:text-primary flex items-center gap-1 cursor-pointer"
                >
                  <ArrowLeft size={12} /> Change number
                </button>
                <button
                  type="button"
                  onClick={handleResend}
                  disabled={busy}
                  className="text-xs text-primary font-bold hover:underline cursor-pointer disabled:opacity-50"
                >
                  Resend code
                </button>
              </div>
            </form>
          )}

          {/* STEP 3 — Profile */}
          {step === "profile" && (
            <form className="space-y-4" onSubmit={handleCompleteProfile}>
              <div className="space-y-1">
                <label htmlFor="full-name" className={labelClass}>
                  Full Name
                </label>
                <div className="relative group">
                  <span className={iconWrap}>
                    <User size={18} />
                  </span>
                  <input
                    id="full-name"
                    type="text"
                    required
                    autoComplete="name"
                    placeholder="Enter your name"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    className={inputClass}
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label htmlFor="email" className={labelClass}>
                  Email Address
                </label>
                <div className="relative group">
                  <span className={iconWrap}>
                    <Mail size={18} />
                  </span>
                  <input
                    id="email"
                    type="email"
                    required
                    autoComplete="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className={inputClass}
                  />
                </div>
              </div>

              <div className="bg-surface-container py-2.5 px-4 rounded-xl flex items-center justify-center gap-2 border border-secondary-container/20">
                <span className="text-secondary text-sm font-bold">🪙</span>
                <p className="text-xs text-on-secondary-container/90 font-medium font-sans">
                  Finish setup to claim your 50 free credits!
                </p>
              </div>

              {error && <p className="text-xs text-error font-medium px-1 pt-1">{error}</p>}

              <button
                type="submit"
                disabled={busy}
                className="w-full bg-primary text-white font-semibold text-sm py-4 rounded-xl soft-glow-shadow hover:bg-primary/95 transition-all active:scale-[0.98] duration-200 mt-2 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-70"
              >
                {busy ? (
                  <>
                    <RefreshCw className="animate-spin" size={16} />
                    Saving...
                  </>
                ) : (
                  <>
                    Complete Setup
                    <span>→</span>
                  </>
                )}
              </button>
            </form>
          )}
        </div>

        {/* Footer Help */}
        <p className="mt-8 text-center text-xs text-on-surface-variant font-medium">
          {step === "phone"
            ? "Already have an account? Just enter your number to log in."
            : "We use your phone number only to verify your identity."}
        </p>
      </div>
    </div>
  );
}
