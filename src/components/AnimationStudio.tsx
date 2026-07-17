import React, { useState, useMemo } from "react";
import { Film, Sparkles, Download, RefreshCw, Wand2, Music, Music2, X, Wrench } from "lucide-react";
import { Creation, PublicUser } from "../types";
import { createVideo, pollJob } from "../api";
import { MOTION_PRESETS, DEFAULT_MOTION_PRESET } from "../motionPresets";
import { CREDIT_PRICES } from "../pricing";

interface AnimationStudioProps {
  creations: Creation[];
  userProfile: PublicUser;
  onOpenPro: () => void;
  onOpenCreditStore: () => void;
  onClose: () => void;
}

/**
 * Animate landing screen: pick one of your generated images + a motion prompt
 * to make a video, or open the contained advanced 3D Animation Builder.
 */
export default function AnimationStudio({ creations, userProfile, onOpenPro, onOpenCreditStore, onClose }: AnimationStudioProps) {
  const images = useMemo(() => creations.filter((c) => c.image_url), [creations]);
  const [selectedId, setSelectedId] = useState<number | null>(images[0]?.id ?? null);
  const [presetValue, setPresetValue] = useState<string>(DEFAULT_MOTION_PRESET.value);
  const [customPrompt, setCustomPrompt] = useState("");
  const [addSound, setAddSound] = useState(true);
  const [aspect, setAspect] = useState<"16:9" | "9:16">("16:9");
  const [status, setStatus] = useState<"idle" | "generating" | "done" | "error">("idle");
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cost = CREDIT_PRICES.ANIMATED_VIDEO;
  const canAfford = userProfile.isAdmin || userProfile.isTester || (userProfile.credits ?? 0) >= cost;
  const selected = images.find((c) => c.id === selectedId) || null;

  const generate = async () => {
    if (!selected) { setError("Pick an image to animate first."); return; }
    if (!canAfford) { onOpenCreditStore(); return; }
    setError(null);
    setResultUrl(null);
    setStatus("generating");
    const motionPrompt = customPrompt.trim() || MOTION_PRESETS.find((p) => p.value === presetValue)?.prompt || DEFAULT_MOTION_PRESET.prompt;
    try {
      const { jobId } = await createVideo(selected.id, motionPrompt, addSound, aspect);
      // Poll for completion.
      for (let i = 0; i < 150; i++) {
        await new Promise((r) => setTimeout(r, 4000));
        try {
          const job = await pollJob(jobId);
          if (job.status === "done" && job.video_url) { setResultUrl(job.video_url); setStatus("done"); return; }
          if (job.status === "failed") { throw new Error(job.error || "Video generation failed."); }
        } catch (pollErr: any) {
          if (pollErr?.message && /failed/i.test(pollErr.message)) throw pollErr;
          // else transient — keep polling
        }
      }
      throw new Error("This is taking longer than expected. Check your creations shortly — it may still finish.");
    } catch (err: any) {
      setError(err?.message || "Could not create the animation.");
      setStatus("error");
    }
  };

  return (
    <div className="w-full max-w-3xl mx-auto px-4 pt-6 pb-28 animate-fade-in">
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <Film size={22} className="text-primary" />
          <h1 className="text-xl font-extrabold text-on-surface">Video Creator</h1>
        </div>
        <button onClick={onClose} className="text-on-surface-variant hover:text-primary p-2 rounded-full" aria-label="Close"><X size={20} /></button>
      </div>
      <p className="text-sm text-on-surface-variant mb-5">
        Create a generated video from one image and a motion prompt. Need a full scene, cast, and timeline? Open the 3D Animation Builder below. <strong>{cost} credits</strong> per video.
      </p>

      {/* Result */}
      {status === "done" && resultUrl && (
        <div className="mb-6 rounded-2xl overflow-hidden border border-outline-variant/40 bg-black/40">
          <video src={resultUrl} controls autoPlay loop className="w-full max-h-[420px] bg-black" />
          <div className="flex gap-2 p-3">
            <a href={resultUrl} download className="flex-1 text-center py-2.5 rounded-full bg-primary text-on-primary font-bold text-sm flex items-center justify-center gap-2"><Download size={16} /> Download</a>
            <button onClick={() => { setStatus("idle"); setResultUrl(null); }} className="flex-1 py-2.5 rounded-full bg-surface-container-high text-on-surface font-bold text-sm">Make another</button>
          </div>
        </div>
      )}

      {status === "generating" ? (
        <div className="flex flex-col items-center justify-center py-16 gap-4 text-on-surface-variant">
          <RefreshCw className="animate-spin text-primary" size={30} />
          <p className="text-sm font-medium">Animating with AI… this can take a minute or two.</p>
          <p className="text-xs">You can leave this page — your video will appear in your creations when it's ready.</p>
        </div>
      ) : (
        <>
          {/* 1. Pick an image */}
          <h2 className="text-sm font-bold text-on-surface mb-2">1. Choose an image</h2>
          {images.length === 0 ? (
            <div className="rounded-xl border border-outline-variant/40 p-6 text-center text-sm text-on-surface-variant mb-6">
              You don't have any images yet. Create an avatar or memory first, then come back to animate it.
            </div>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2.5 mb-6">
              {images.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setSelectedId(c.id)}
                  className={`relative aspect-square rounded-xl overflow-hidden border-2 transition-all ${selectedId === c.id ? "border-primary ring-2 ring-primary/30" : "border-transparent hover:border-primary/40"}`}
                >
                  <img src={c.image_url as string} alt={c.name || c.place_label || "Creation"} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                </button>
              ))}
            </div>
          )}

          {/* 2. Motion */}
          <h2 className="text-sm font-bold text-on-surface mb-2">2. How should it move?</h2>
          <div className="flex flex-wrap gap-2 mb-3">
            {MOTION_PRESETS.map((p) => (
              <button
                key={p.value}
                onClick={() => { setPresetValue(p.value); setCustomPrompt(""); }}
                className={`px-3 py-1.5 rounded-full text-xs font-bold border transition-all ${presetValue === p.value && !customPrompt ? "bg-primary text-on-primary border-primary" : "bg-surface-container-high text-on-surface border-outline-variant/40 hover:border-primary/50"}`}
              >
                {p.emoji} {p.label}
              </button>
            ))}
          </div>
          <textarea
            value={customPrompt}
            onChange={(e) => setCustomPrompt(e.target.value)}
            placeholder="…or describe it yourself: 'running across a sunny beach, tail wagging'"
            rows={2}
            className="w-full px-4 py-3 rounded-xl bg-surface border border-outline-variant/50 text-on-surface text-sm mb-4"
          />

          {/* 3. Options */}
          <div className="flex flex-wrap items-center gap-3 mb-6">
            <button onClick={() => setAddSound((s) => !s)} className={`flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium border ${addSound ? "bg-primary/10 border-primary/40 text-primary" : "bg-surface-container-high border-outline-variant/40 text-on-surface-variant"}`}>
              {addSound ? <Music size={16} /> : <Music2 size={16} />} {addSound ? "Sound on" : "Sound off"}
            </button>
            <div className="flex rounded-xl overflow-hidden border border-outline-variant/40">
              <button onClick={() => setAspect("16:9")} className={`px-3 py-2 text-sm font-medium ${aspect === "16:9" ? "bg-primary text-on-primary" : "bg-surface-container-high text-on-surface-variant"}`}>Landscape</button>
              <button onClick={() => setAspect("9:16")} className={`px-3 py-2 text-sm font-medium ${aspect === "9:16" ? "bg-primary text-on-primary" : "bg-surface-container-high text-on-surface-variant"}`}>Portrait</button>
            </div>
          </div>

          {error && <p className="text-sm text-red-500 mb-3">{error}</p>}

          <button
            onClick={generate}
            disabled={!selected}
            className="w-full py-4 rounded-full bg-primary text-on-primary font-extrabold flex items-center justify-center gap-2 active:scale-95 transition-all disabled:opacity-50"
          >
            <Wand2 size={18} /> {canAfford ? `Create Animation · ${cost} cr` : `Get credits to animate (${cost} cr)`}
          </button>

          {/* Advanced workspace contained under the Video Creator entry point. */}
          <button onClick={onOpenPro} className="w-full mt-3 py-2.5 rounded-full text-sm text-on-surface-variant hover:text-primary flex items-center justify-center gap-2">
            <Wrench size={15} /> Open 3D Animation Builder
          </button>
          <p className="text-[11px] text-center text-on-surface-variant mt-1 flex items-center justify-center gap-1">
            <Sparkles size={11} /> Pose rigged models, add scenes, lights &amp; multiple pets
          </p>
        </>
      )}
    </div>
  );
}
