import React, { useState } from "react";
import { User, Phone, CheckCircle, RefreshCw } from "lucide-react";
import { UserProfile } from "../types";

interface SignUpProps {
  onSignUpSuccess: (profile: UserProfile) => void;
  onNavigateToLogin: () => void;
}

export default function SignUp({ onSignUpSuccess, onNavigateToLogin }: SignUpProps) {
  const [fullName, setFullName] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "success">("idle");
  const [error, setError] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullName.trim() || !phoneNumber.trim()) {
      setError("Please fill in all fields.");
      return;
    }
    setError("");
    setStatus("sending");

    setTimeout(() => {
      setStatus("success");
      setTimeout(() => {
        // Complete onboarding profile
        onSignUpSuccess({
          fullName,
          phoneNumber,
          credits: 50, // Starts with 50 credits bonus!
        });
      }, 1200);
    }, 1500);
  };

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
            Create Your Account
          </h1>
          <p className="text-sm font-medium text-on-surface-variant opacity-80">
            Join thousands of pet owners preserving their best moments.
          </p>
        </div>

        {/* Brand Image Visual anchor */}
        <div className="mb-8">
          <div className="rounded-2xl overflow-hidden soft-glow-shadow bg-surface-container h-48 relative">
            <img
              alt="Warm memory"
              className="w-full h-full object-cover"
              src="https://lh3.googleusercontent.com/aida-public/AB6AXuBUGbgL9dsGLPEFfoCDKIkS-ehx4aHPq73SNZBpgtC8_FsyiQwQE8VHBd9ZPEQoB6LenVk4T1LYf3WtSkb-Ght5oSDhkzS0YepLnuDJcpuahVWxRckLHOyl7evJIkxIzJzBZy00b0NGaffKJhmuxQil_SV-ViXWr1HVcazqpxZKIXnzhoaaTV--YAxYrWuru1X7P7YFs3tIibqAcTtgqG1DRnqUBKpePBN7c4D6Ng63f8l5VQ4nA0LhCBzfD2cw3TJXvi8tswhOUYs"
              referrerPolicy="no-referrer"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-surface-dim/40 to-transparent"></div>
          </div>
        </div>

        {/* Form Container */}
        <div className="bg-surface-container-lowest rounded-3xl p-6 soft-glow-shadow border border-surface-variant/30">
          <form className="space-y-4" onSubmit={handleSubmit}>
            {/* Name Input */}
            <div className="space-y-1">
              <label htmlFor="full-name" className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant px-1">
                Full Name
              </label>
              <div className="relative group">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-on-surface-variant opacity-50 group-focus-within:text-primary group-focus-within:opacity-100 transition-all">
                  <User size={18} />
                </span>
                <input
                  id="full-name"
                  type="text"
                  required
                  placeholder="Enter your name"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="w-full pl-12 pr-4 py-3.5 rounded-xl border border-outline-variant bg-surface-container-low text-on-surface focus:outline-none focus:border-primary transition-all placeholder:text-on-surface-variant/50"
                />
              </div>
            </div>

            {/* Phone Input */}
            <div className="space-y-1">
              <label htmlFor="phone-number" className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant px-1">
                Phone Number
              </label>
              <div className="relative group">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-on-surface-variant opacity-50 group-focus-within:text-primary group-focus-within:opacity-100 transition-all">
                  <Phone size={18} />
                </span>
                <input
                  id="phone-number"
                  type="tel"
                  required
                  placeholder="+1 (555) 000-0000"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                  className="w-full pl-12 pr-4 py-3.5 rounded-xl border border-outline-variant bg-surface-container-low text-on-surface focus:outline-none focus:border-primary transition-all placeholder:text-on-surface-variant/50"
                />
              </div>
            </div>

            {error && (
              <p className="text-xs text-error font-medium px-1 pt-1">{error}</p>
            )}

            {/* Credit Reward Badge */}
            <div className="bg-surface-container py-2.5 px-4 rounded-xl flex items-center justify-center gap-2 border border-secondary-container/20">
              <span className="text-secondary text-sm font-bold">🪙</span>
              <p className="text-xs text-on-secondary-container/90 font-medium font-sans">
                Sign up to get your first 50 credits free!
              </p>
            </div>

            {/* CTA Button */}
            <button
              type="submit"
              disabled={status !== "idle"}
              className="w-full bg-primary text-white font-semibold text-sm py-4 rounded-xl soft-glow-shadow hover:bg-primary/95 transition-all active:scale-[0.98] duration-200 mt-4 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-80"
            >
              {status === "sending" ? (
                <>
                  <RefreshCw className="animate-spin" size={16} />
                  Sending Verification...
                </>
              ) : status === "success" ? (
                <>
                  <CheckCircle size={16} />
                  Code Verified! Saving...
                </>
              ) : (
                <>
                  Verify Phone
                  <span>→</span>
                </>
              )}
            </button>
          </form>

          {/* Alternative Methods */}
          <div className="mt-6 flex flex-col items-center gap-4">
            <div className="flex items-center w-full gap-2">
              <div className="h-px flex-grow bg-outline-variant/50"></div>
              <span className="text-xs text-on-surface-variant uppercase tracking-widest font-bold">or</span>
              <div className="h-px flex-grow bg-outline-variant/50"></div>
            </div>

            <div className="flex gap-4">
              <button
                onClick={() => onSignUpSuccess({ fullName: "Sarah Connor", phoneNumber: "+1 (555) 789-1000", credits: 50 })}
                className="w-14 h-14 rounded-full border border-outline-variant flex items-center justify-center hover:bg-surface-container transition-colors active:scale-95 duration-200 cursor-pointer text-xl"
                title="Sign up with Google"
              >
                G
              </button>
              <button
                onClick={() => onSignUpSuccess({ fullName: "Sarah Connor", phoneNumber: "+1 (555) 789-1000", credits: 50 })}
                className="w-14 h-14 rounded-full border border-outline-variant flex items-center justify-center hover:bg-surface-container transition-colors active:scale-95 duration-200 cursor-pointer text-xl"
                title="Sign up with Apple"
              >
                
              </button>
            </div>
          </div>
        </div>

        {/* Footer Help */}
        <p className="mt-8 text-center text-xs text-on-surface-variant font-medium">
          Already have an account?{" "}
          <button onClick={onNavigateToLogin} className="text-primary font-bold hover:underline cursor-pointer">
            Log in
          </button>
        </p>
      </div>
    </div>
  );
}
