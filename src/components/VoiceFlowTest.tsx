import React, { useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, Mic2, Play, ShieldCheck, Square } from "lucide-react";
import { createVoicePreview, fetchMe, type VoicePreviewResult } from "../api";
import { CREDIT_PRICES } from "../pricing";
import type { PublicUser, UserProfile } from "../types";
import { VISEME_OPENNESS, type VisemeShape } from "../animator/viseme/visemeRules";

interface VoiceFlowTestProps {
  userProfile: UserProfile;
  onUserUpdate: (user: PublicUser) => void;
}

const DEFAULT_SCRIPT = "Hello from Pawsome3D. This is a voice and lip-sync preview.";

function activeShape(result: VoicePreviewResult, time: number): VisemeShape {
  if (!result.track?.cues.length) return "X";
  let shape: VisemeShape = "X";
  for (const cue of result.track.cues) {
    if (cue.t > time) break;
    shape = cue.v;
  }
  return shape;
}

export default function VoiceFlowTest({ userProfile, onUserUpdate }: VoiceFlowTestProps) {
  const [script, setScript] = useState(DEFAULT_SCRIPT);
  const [result, setResult] = useState<VoicePreviewResult | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "playing" | "error">("idle");
  const [message, setMessage] = useState("Enter a short line, then generate a real voice and lip-sync test.");
  const [shape, setShape] = useState<VisemeShape>("X");
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => () => {
    audioRef.current?.pause();
  }, []);

  const generate = async () => {
    const text = script.trim();
    if (!text) return;
    audioRef.current?.pause();
    setResult(null);
    setShape("X");
    setStatus("loading");
    setMessage("Generating configured ElevenLabs audio and checking Rhubarb mouth cues...");
    try {
      const next = await createVoicePreview(text);
      setResult(next);
      setStatus("ready");
      setMessage(next.tier === "B" && next.track
        ? `Ready. Rhubarb returned ${next.track.cues.length} synchronized mouth cues.`
        : "Voice audio is ready, but lip-sync degraded to the audio-only fallback in this tester.");
      const user = await fetchMe();
      if (user) onUserUpdate(user);
    } catch (error: any) {
      setStatus("error");
      setMessage(error?.message || "Voice and lip-sync preview could not be generated.");
    }
  };

  const syncShape = () => {
    if (!result || !audioRef.current) return setShape("X");
    setShape(activeShape(result, audioRef.current.currentTime));
  };

  const stop = () => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    audio.currentTime = 0;
    setShape("X");
    setStatus("ready");
    setMessage(result?.tier === "B" ? "Preview stopped. Press play to test it again without another charge." : "Audio stopped.");
  };

  const cost = userProfile.isAdmin ? 0 : CREDIT_PRICES.AI_VOICE_30_SECONDS;
  const canAfford = userProfile.isAdmin || userProfile.credits >= cost;
  const audioSrc = result ? `data:${result.mimeType};base64,${result.audioBase64}` : undefined;
  const mouthHeight = 5 + Math.round(VISEME_OPENNESS[shape] * 34);

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6 md:py-12" aria-labelledby="voice-test-title">
      <div className="overflow-hidden rounded-[2rem] border border-outline-variant/25 bg-surface-container-low/90 shadow-xl">
        <header className="border-b border-outline-variant/20 bg-gradient-to-br from-primary/15 via-surface-container to-secondary/10 px-5 py-7 sm:px-8 sm:py-9">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <span className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-[11px] font-black uppercase tracking-[.16em] text-primary">
                <Mic2 size={13} aria-hidden="true" /> Live service test
              </span>
              <h1 id="voice-test-title" className="mt-3 text-2xl font-black tracking-tight text-on-surface sm:text-3xl">Test voice and lip-sync</h1>
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-on-surface-variant">
                This uses the configured ElevenLabs voice and the production Rhubarb cue pipeline. It does not clone, imitate, or substitute a fake local voice.
              </p>
            </div>
            <div className="shrink-0 rounded-2xl border border-primary/20 bg-surface/80 px-4 py-3 text-center">
              <p className="text-[10px] font-black uppercase tracking-wider text-on-surface-variant">Each new generation</p>
              <p className="mt-1 text-xl font-black text-primary">{cost === 0 ? "Admin: no charge" : `${cost} PupCoins`}</p>
            </div>
          </div>
        </header>

        <div className="grid gap-6 p-5 sm:p-8 lg:grid-cols-[1fr_280px]">
          <section>
            <label htmlFor="voice-test-script" className="text-sm font-black text-on-surface">Preview script</label>
            <textarea
              id="voice-test-script"
              value={script}
              onChange={(event) => setScript(event.target.value)}
              maxLength={500}
              disabled={status === "loading"}
              className="mt-2 min-h-32 w-full rounded-2xl border border-outline-variant/40 bg-surface px-4 py-3 text-base text-on-surface outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10 disabled:opacity-60"
            />
            <div className="mt-2 flex items-center justify-between gap-3 text-xs text-on-surface-variant">
              <span>Up to 30 seconds</span><span>{script.length}/500</span>
            </div>

            <button
              type="button"
              onClick={() => void generate()}
              disabled={status === "loading" || !script.trim() || !canAfford}
              className="mt-5 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 text-sm font-black text-on-primary shadow-md transition hover:brightness-105 focus:outline-none focus-visible:ring-4 focus-visible:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-45"
            >
              {status === "loading" ? <Loader2 className="animate-spin" size={18} aria-hidden="true" /> : <Mic2 size={18} aria-hidden="true" />}
              {status === "loading" ? "Generating and checking lip-sync..." : cost === 0 ? "Generate voice & lip-sync test" : `Generate test - ${cost} PupCoins`}
            </button>
            {!canAfford && <p className="mt-2 text-sm font-bold text-error" role="alert">You need {cost} PupCoins to run this production preview.</p>}

            <div
              role={status === "error" ? "alert" : "status"}
              aria-live="polite"
              className={`mt-5 flex gap-3 rounded-2xl border p-4 text-sm ${status === "error" ? "border-error/30 bg-error/10 text-error" : status === "ready" || status === "playing" ? "border-emerald-600/25 bg-emerald-600/10 text-on-surface" : "border-outline-variant/25 bg-surface-container text-on-surface-variant"}`}
            >
              {status === "error" ? <AlertTriangle className="mt-0.5 shrink-0" size={18} aria-hidden="true" /> : status === "ready" || status === "playing" ? <CheckCircle2 className="mt-0.5 shrink-0 text-emerald-700" size={18} aria-hidden="true" /> : <ShieldCheck className="mt-0.5 shrink-0" size={18} aria-hidden="true" />}
              <div><p className="font-bold">{message}</p></div>
            </div>

            {result && (
              <div className="mt-5 rounded-2xl border border-outline-variant/25 bg-surface p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-black text-on-surface">Generated preview</p>
                    <p className="text-xs text-on-surface-variant">{result.tier === "B" ? "Tier B - Rhubarb synchronized" : "Tier A - degraded audio-only result"}</p>
                  </div>
                  {status === "playing" && (
                    <button type="button" onClick={stop} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-outline-variant/30 px-4 text-xs font-black text-on-surface">
                      <Square size={13} fill="currentColor" aria-hidden="true" /> Stop
                    </button>
                  )}
                </div>
                <audio
                  ref={audioRef}
                  src={audioSrc}
                  controls
                  preload="metadata"
                  className="w-full"
                  aria-label="Generated production voice preview"
                  onPlay={() => { setStatus("playing"); setMessage("Playing configured voice with the returned mouth-cue timeline."); }}
                  onPause={() => { if (audioRef.current && !audioRef.current.ended && audioRef.current.currentTime > 0) setStatus("ready"); }}
                  onTimeUpdate={syncShape}
                  onSeeked={syncShape}
                  onEnded={() => { setShape("X"); setStatus("ready"); setMessage("Playback complete. The voice flow is ready for review."); }}
                />
                <p className="mt-2 flex items-center gap-2 text-xs text-on-surface-variant"><Play size={12} aria-hidden="true" /> Replaying this audio does not generate or charge again.</p>
              </div>
            )}
          </section>

          <aside className="flex min-h-72 flex-col items-center justify-center rounded-3xl border border-outline-variant/25 bg-gradient-to-b from-secondary-container/35 to-surface p-5 text-center" aria-label="Lip-sync cue monitor">
            <p className="text-[10px] font-black uppercase tracking-[.18em] text-on-surface-variant">Mouth-cue monitor</p>
            <div className="relative mt-5 h-44 w-44 rounded-full border-4 border-primary/20 bg-primary/10 shadow-inner" aria-hidden="true">
              <div className="absolute left-10 top-14 h-3 w-3 rounded-full bg-on-surface" />
              <div className="absolute right-10 top-14 h-3 w-3 rounded-full bg-on-surface" />
              <div
                className="absolute left-1/2 top-[105px] w-16 -translate-x-1/2 rounded-[50%] border-4 border-on-surface bg-primary/35 transition-[height] duration-75"
                style={{ height: `${mouthHeight}px` }}
              />
            </div>
            <p className="mt-4 text-sm font-black text-on-surface">Cue {shape}</p>
            <p className="mt-1 text-xs leading-relaxed text-on-surface-variant">
              {result?.track ? "This indicator follows the exact cue timestamps returned by Rhubarb." : "A synchronized cue track will appear here only when Rhubarb succeeds."}
            </p>
            <p className="mt-3 border-t border-outline-variant/20 pt-3 text-[11px] leading-relaxed text-on-surface-variant">
              This checks the voice service and cue timing. It does not certify an individual model's facial rig.
            </p>
          </aside>
        </div>
      </div>
    </main>
  );
}
