import React from "react";
import { ArrowRight, ShieldCheck, Sparkles } from "lucide-react";

interface WelcomeProps {
  userName: string;
  onNext: () => void;
  onBackToSignUp: () => void;
}

export default function Welcome({ userName, onNext, onBackToSignUp }: WelcomeProps) {
  return (
    <div className="w-full max-w-lg mx-auto flex flex-col justify-center px-6 py-8 relative overflow-hidden min-h-[90vh]">
      {/* Background ambient glows */}
      <div className="absolute top-0 right-0 w-64 h-64 bg-primary-container/20 rounded-full blur-3xl"></div>
      <div className="absolute bottom-0 left-0 w-80 h-80 bg-secondary-container/10 rounded-full blur-3xl"></div>

      {/* Onboarding welcome card */}
      <div className="w-full bg-surface-container-lowest rounded-3xl p-8 md:p-10 glowing-shadow-sage border border-outline-variant/30 relative z-10 flex flex-col items-center text-center">
        
        {/* Avatar Container */}
        <div className="relative w-48 h-48 md:w-52 md:h-52 mb-6 soft-float">
          {/* Background circle decor */}
          <div className="absolute inset-0 bg-primary-container rounded-full opacity-20 transform scale-110"></div>
          {/* Randy the clay pup portrait */}
          <div className="w-full h-full rounded-full overflow-hidden border-4 border-white shadow-lg">
            <img
              alt="Randy the Golden Retriever"
              className="w-full h-full object-cover"
              src="https://lh3.googleusercontent.com/aida-public/AB6AXuAEVFGuaT8d5D1jXsQOiCeLnjXauiTCSxQuL0DGotlJqj_TNi4EcbnVsaDA6TbB1o09-P29AkRw66KyUiKU2tt7-G-eps2tInDvWuCldU6epPF0jf2f-AKy16tEWZILw2GlEZ45byTibQtf4XjUN17Do7Fqjpus_xPSI0R_S4Byp8hvRELQrWfHFHdk_wHcAqyiIuMgoR7Z2wsp_RTh2UYd6lrHKUNBJsZBrCCgC_qNIJ6uhaprpHJjE4DCAPaiWxSSa1_3IhBqcKA"
              referrerPolicy="no-referrer"
            />
          </div>
          {/* AI Guide badge */}
          <div className="absolute bottom-2 right-2 bg-secondary text-white px-3 py-1 rounded-full text-[11px] font-bold flex items-center gap-1 shadow-md font-sans">
            <Sparkles size={11} fill="white" />
            <span>AI Guide</span>
          </div>
        </div>

        {/* Text descriptions */}
        <div className="space-y-3 mb-8">
          <h2 className="text-2xl md:text-3xl font-bold text-primary">
            Hi{userName ? `, ${userName.split(" ")[0]}` : ""}, I'm Randy.
          </h2>
          <p className="text-sm md:text-base text-on-surface-variant leading-relaxed opacity-90">
            I'll show you how to turn your pet photos into magic. We'll create digital heirlooms that celebrate every wag and purr.
          </p>
        </div>

        {/* Buttons actions */}
        <div className="w-full flex flex-col gap-3">
          <button
            onClick={onNext}
            className="shimmer-button w-full bg-primary text-white py-4 px-6 rounded-2xl font-bold text-sm transition-all hover:brightness-105 active:scale-95 glowing-shadow-sage flex items-center justify-center gap-2 cursor-pointer"
          >
            Get Started
            <ArrowRight size={16} />
          </button>
          
          <button
            onClick={onBackToSignUp}
            className="w-full bg-transparent text-on-surface-variant py-2.5 px-6 rounded-xl font-semibold text-xs hover:bg-surface-container transition-colors active:scale-95 cursor-pointer"
          >
            Sign in to another account
          </button>
        </div>

        {/* Progress pagination indicators */}
        <div className="flex gap-2.5 mt-8">
          <div className="w-8 h-2 bg-primary rounded-full transition-all"></div>
          <div className="w-2 h-2 bg-outline-variant/60 rounded-full"></div>
          <div className="w-2 h-2 bg-outline-variant/60 rounded-full"></div>
        </div>
      </div>

      {/* footnote decoration */}
      <div className="mt-6 text-center opacity-70">
        <p className="text-xs text-on-surface-variant flex items-center justify-center gap-1 font-medium font-sans">
          <ShieldCheck size={14} className="text-primary" />
          Your pet's privacy is our top priority
        </p>
      </div>
    </div>
  );
}
