import React, { useRef, useState } from "react";
import { UserProfile } from "../types";
import { Brush, Lock, Film, Sparkles, Mic, Upload, CheckCircle2, X } from "lucide-react";
import { createVoiceCloneAsset } from "../api";

interface PawlisherScreenProps {
  userProfile: UserProfile;
}

export default function PawlisherScreen({ userProfile }: PawlisherScreenProps) {
  const [showVoiceConsent, setShowVoiceConsent] = useState(false);
  const [voiceConsent, setVoiceConsent] = useState(false);
  const [voiceName, setVoiceName] = useState(`${userProfile.fullName || "My pet"} voice`);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [voiceMessage, setVoiceMessage] = useState("");
  const voiceInputRef = useRef<HTMLInputElement | null>(null);

  const readFile = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

  const onVoiceFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setVoiceBusy(true);
    setVoiceMessage("");
    try {
      const asset = await createVoiceCloneAsset({
        name: voiceName.trim() || "Voice clone",
        audioBase64: await readFile(file),
        mimeType: file.type || "audio/webm",
        bytes: file.size,
        voiceConsent: true,
      });
      setVoiceMessage(`${asset.name} saved with consent recorded.`);
      setShowVoiceConsent(false);
      setVoiceConsent(false);
    } catch (err: any) {
      setVoiceMessage(err.message || "Could not save the voice.");
    } finally {
      setVoiceBusy(false);
      if (voiceInputRef.current) voiceInputRef.current.value = "";
    }
  };

  return (
    <div className="w-full max-w-4xl mx-auto px-4 pt-6 pb-28 animate-fade-in">
      <div data-tour="pawlisher-title" className="flex items-center gap-3 mb-6">
        <Brush size={22} className="text-primary" />
        <h1 className="text-xl font-extrabold text-on-surface">Pawlisher Studio</h1>
        <button
          type="button"
          onClick={() => window.dispatchEvent(new CustomEvent("randy:start-tour", { detail: { tourId: "use_pawlisher" } }))}
          className="ml-auto min-h-11 rounded-xl border border-primary/30 px-3 text-sm font-black text-primary"
        >
          Show me how
        </button>
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

      <section data-tour="pawlisher-voice" className="glass-panel border border-outline-variant/40 rounded-3xl p-6 mb-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-on-surface">
              <Mic size={18} className="text-primary" />
              <h3 className="text-base font-extrabold">Voice clone</h3>
            </div>
            <p className="text-sm text-on-surface-variant mt-1 leading-relaxed">
              Add a voice only when you own it or have permission. We will save that consent with the file.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowVoiceConsent(true)}
            className="min-h-12 rounded-xl bg-primary text-on-primary px-5 text-base font-black flex items-center justify-center gap-2"
          >
            <Upload size={18} /> Add voice
          </button>
        </div>
        {voiceMessage && (
          <p className="mt-4 text-sm font-bold text-primary">{voiceMessage}</p>
        )}
      </section>

      {showVoiceConsent && (
        <div className="fixed inset-0 z-[80] bg-black/70 flex items-center justify-center p-4">
          <section className="w-full max-w-lg rounded-2xl bg-surface text-on-surface border border-outline-variant shadow-2xl p-6">
            <div className="flex items-start justify-between gap-4 mb-4">
              <div>
                <h2 className="text-2xl font-black">Voice permission</h2>
                <p className="text-lg leading-relaxed text-on-surface-variant mt-2">
                  Please confirm you own this voice or have documented permission to clone it.
                </p>
              </div>
              <button type="button" onClick={() => setShowVoiceConsent(false)} className="w-11 h-11 rounded-full border border-outline-variant flex items-center justify-center">
                <X size={20} />
              </button>
            </div>
            <label className="block text-sm font-bold text-on-surface mb-2" htmlFor="voice-name">Voice name</label>
            <input
              id="voice-name"
              value={voiceName}
              onChange={(e) => setVoiceName(e.target.value)}
              className="w-full min-h-12 rounded-xl border border-outline-variant bg-surface-container px-4 text-base mb-4"
            />
            <label className="flex items-start gap-3 rounded-xl border border-outline-variant/50 bg-surface-container p-4 text-base leading-relaxed cursor-pointer mb-5">
              <input
                type="checkbox"
                checked={voiceConsent}
                onChange={(e) => setVoiceConsent(e.target.checked)}
                className="mt-1 h-6 w-6 accent-primary"
              />
              <span>I confirm I own this voice or have documented permission to clone it.</span>
            </label>
            <button
              type="button"
              disabled={!voiceConsent || voiceBusy}
              onClick={() => voiceInputRef.current?.click()}
              className="w-full min-h-14 rounded-xl bg-primary text-on-primary text-lg font-black disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {voiceBusy ? "Saving..." : <><CheckCircle2 size={20} /> Choose audio file</>}
            </button>
            <input ref={voiceInputRef} type="file" accept="audio/*" className="hidden" onChange={onVoiceFile} />
          </section>
        </div>
      )}
    </div>
  );
}
