import React from "react";
import { Award, Image as ImageIcon, MapPin, Sparkles, Navigation } from "lucide-react";

interface TutorialProps {
  onComplete: () => void;
}

export default function Tutorial({ onComplete }: TutorialProps) {
  return (
    <div className="w-full max-w-lg mx-auto flex flex-col px-6 py-6 relative z-10 min-h-[90vh]">
      {/* Progress Bar Section */}
      <div className="w-full mb-6">
        <div className="flex justify-between items-center mb-2">
          <span className="text-xs font-bold text-primary uppercase tracking-widest font-sans">
            Tutorial Complete
          </span>
          <span className="text-xs font-bold text-primary font-sans">100%</span>
        </div>
        <div className="h-2 w-full bg-surface-container rounded-full overflow-hidden">
          <div className="h-full bg-primary transition-all duration-1000 ease-out" style={{ width: "100%" }}></div>
        </div>
      </div>

      {/* Hero Showcase Frame of Randy at the Canyon */}
      <div className="relative w-full aspect-[4/3] rounded-3xl overflow-hidden soft-glow-shadow mb-6 border-4 border-white">
        <img
          alt="Randy in Grand Canyon"
          className="w-full h-full object-cover"
          src="https://lh3.googleusercontent.com/aida-public/AB6AXuDj5Us-dZdAkcczKfAslMb4dQtU-sBEPOmPWq3KBAYZhqzMhR_5bchzs8ccoIJ-DFcPeCgwy-6p-ZDYgd0ZT6SoR49PcnxP-6z_vGIK-Hd6dPza-CsKUdFEGSv9v8TR4IzUZbRZxlAzl8z_s0VIJvJvSDVKEwUDQ8x3_nYRbPNqbl9C3gobol7BPJ43JN2nbpy83wcPBSsdwkMJHj-0tFuA_HDW-JdIb3AmhvxeFMHfatIYBb6AaCwHpRw6zoQlaO5O6LrXsYHm17c"
          referrerPolicy="no-referrer"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent"></div>

        {/* Top Floating Badge */}
        <div className="absolute top-4 left-4 bg-white/90 backdrop-blur-md px-3.5 py-1.5 rounded-full flex items-center gap-2 border border-outline-variant/30 shadow-sm">
          <Sparkles size={14} className="text-secondary" fill="#964826" />
          <span className="text-xs font-bold text-on-surface font-sans">Sample Creation</span>
        </div>

        {/* Location Pin */}
        <div className="absolute bottom-4 left-4 flex items-center gap-1.5 text-white">
          <MapPin size={16} className="text-primary-container" />
          <span className="text-xs font-bold font-sans">Grand Canyon National Park</span>
        </div>
      </div>

      {/* Narrative Header */}
      <div className="flex flex-col gap-3 items-center text-center">
        <div className="w-14 h-14 rounded-full bg-primary-container flex items-center justify-center mb-1 floating text-white">
          <span className="text-2xl">🐾</span>
        </div>
        <h1 className="text-2xl font-bold text-on-surface tracking-tight">
          See how easy it is?
        </h1>
        <p className="text-sm text-on-surface-variant max-w-[95%] leading-relaxed">
          Upload your pet's photo and pick a location - like I did with the Grand Canyon! Our AI handles the magic of blending them together into a digital heirloom.
        </p>
      </div>

      {/* Instructional Steps cards */}
      <div className="grid grid-cols-2 gap-4 mt-6">
        <div className="bg-surface-container-low p-4 rounded-2xl border border-outline-variant/40 flex flex-col gap-1.5">
          <ImageIcon size={20} className="text-primary" />
          <h3 className="text-sm font-semibold text-on-surface">1. Upload</h3>
          <p className="text-[11px] text-on-surface-variant leading-normal">Pick a clear photo of your pet.</p>
        </div>
        <div className="bg-surface-container-low p-4 rounded-2xl border border-outline-variant/40 flex flex-col gap-1.5 mt-3">
          <Navigation size={20} className="text-secondary rotate-45" />
          <h3 className="text-sm font-semibold text-on-surface">2. Choose</h3>
          <p className="text-[11px] text-on-surface-variant leading-normal">Select a dream destination.</p>
        </div>
      </div>

      {/* Bottom Actions section */}
      <div className="mt-8 pt-4 flex flex-col gap-3">
        <button
          onClick={onComplete}
          className="premium-shimmer w-full h-15 text-white font-bold text-base rounded-2xl flex items-center justify-center gap-2 hover:scale-[1.02] active:scale-95 transition-all duration-300 shadow-md cursor-pointer"
        >
          <span>Finish & Claim 50 Credits</span>
          <div className="flex items-center gap-1 bg-white/20 px-2.5 py-1 rounded-lg">
            <span className="text-xs transition-transform">🪙</span>
          </div>
        </button>
        <button
          onClick={onComplete}
          className="w-full py-2.5 text-on-surface-variant text-xs font-semibold hover:text-primary transition-colors cursor-pointer"
        >
          Maybe later, skip tutorial
        </button>
      </div>
    </div>
  );
}
