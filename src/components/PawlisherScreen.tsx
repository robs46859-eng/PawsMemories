import React from "react";
import { UserProfile } from "../types";
import { Brush, Lock, Film, Sparkles } from "lucide-react";

interface PawlisherScreenProps {
  userProfile: UserProfile;
}

export default function PawlisherScreen({ userProfile }: PawlisherScreenProps) {
  return (
    <div className="w-full max-w-4xl mx-auto px-4 pt-6 pb-28 animate-fade-in">
      <div className="flex items-center gap-3 mb-6">
        <Brush size={22} className="text-primary" />
        <h1 className="text-xl font-extrabold text-on-surface">Pawlisher Studio</h1>
      </div>
      <p className="text-xs text-on-surface-variant mb-6">
        Pro 3D model workspace. Select a model below to edit lighting, posture, voice, and more.
      </p>

      {/* Hub cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        {/* Wardrobe — locked */}
        <div className="glass-panel border border-outline-variant/40 rounded-3xl p-6 text-center relative opacity-60">
          <div className="absolute top-3 right-3 bg-surface-container rounded-full px-2 py-0.5 text-[10px] font-bold text-on-surface-variant flex items-center gap-1">
            <Lock size={10} /> Coming Soon
          </div>
          <span className="text-4xl block mb-2">👕</span>
          <h3 className="text-sm font-extrabold text-on-surface">Wardrobe</h3>
          <p className="text-[10px] text-on-surface-variant mt-1">Dress up your models</p>
        </div>

        {/* Animation Creator — links to Animator */}
        <div
          onClick={() => window.location.href = "/animator"}
          className="glass-panel border border-outline-variant/40 rounded-3xl p-6 text-center hover:border-primary/50 transition-all cursor-pointer"
        >
          <span className="text-4xl block mb-2">🎬</span>
          <div className="flex items-center justify-center gap-2">
            <Film size={14} className="text-primary" />
            <h3 className="text-sm font-extrabold text-on-surface">Animation Creator</h3>
          </div>
          <p className="text-[10px] text-on-surface-variant mt-1">Animate your pet models</p>
        </div>

        {/* Pawprints — links to Pawprints page */}
        <div
          onClick={() => {/* navigated via App router but displayed for visual continuity */}}
          className="glass-panel border border-outline-variant/40 rounded-3xl p-6 text-center hover:border-primary/50 transition-all cursor-pointer"
        >
          <span className="text-4xl block mb-2">🐾</span>
          <div className="flex items-center justify-center gap-2">
            <Sparkles size={14} className="text-primary" />
            <h3 className="text-sm font-extrabold text-on-surface">Pawprints</h3>
          </div>
          <p className="text-[10px] text-on-surface-variant mt-1">Create digital stationery</p>
        </div>
      </div>

      {/* Editor placeholder */}
      <div className="glass-panel border border-outline-variant/40 rounded-3xl p-8 mb-6 text-center">
        <span className="text-5xl block mb-4">🎨</span>
        <h3 className="text-base font-extrabold text-on-surface mb-2">3D Model Editor</h3>
        <p className="text-xs text-on-surface-variant max-w-md mx-auto leading-relaxed">
          Load a model to use the Edison-bulb light (3 settings), magnifier zoom, 
          360° turntable, rigging controls, motion libraries, voice clone + lip-sync, 
          micro-mesh overlay, and the ✂️/💾/⬆️/🗑️ toolbar.
        </p>
      </div>
    </div>
  );
}