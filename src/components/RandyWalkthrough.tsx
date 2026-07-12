import React, { useEffect, useMemo, useState } from "react";
import { Volume2, VolumeX, X } from "lucide-react";
import { Screen } from "../types";
import { Tour, TourStep } from "../randy/tours";

interface RandyWalkthroughProps {
  tour: Tour;
  onClose: () => void;
  onNavigate?: (screen: Screen) => void;
}

function getTarget(step: TourStep): Element | null {
  const selector = step.waitFor || step.target;
  return document.querySelector(selector);
}

export default function RandyWalkthrough({ tour, onClose, onNavigate }: RandyWalkthroughProps) {
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [voiceOn, setVoiceOn] = useState(true);
  const [repeatTick, setRepeatTick] = useState(0);
  const step = tour.steps[index];
  const reduceMotion = useMemo(() => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false, []);

  useEffect(() => {
    onNavigate?.(tour.screen);
  }, [onNavigate, tour.screen]);

  useEffect(() => {
    let stopped = false;
    const findTarget = () => {
      if (stopped) return;
      const target = getTarget(step);
      if (target) {
        target.scrollIntoView({ block: "center", behavior: reduceMotion ? "auto" : "smooth" });
        setTimeout(() => {
          if (!stopped) setRect(target.getBoundingClientRect());
        }, reduceMotion ? 0 : 250);
      } else {
        setTimeout(findTarget, 250);
      }
    };
    findTarget();
    const onResize = () => {
      const target = getTarget(step);
      if (target) setRect(target.getBoundingClientRect());
    };
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onResize, true);
    return () => {
      stopped = true;
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onResize, true);
    };
  }, [step, reduceMotion]);

  useEffect(() => {
    if (!voiceOn || !("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(`${step.title}. ${step.body}`);
    utterance.rate = 0.88;
    window.speechSynthesis.speak(utterance);
    return () => window.speechSynthesis.cancel();
  }, [step, voiceOn, repeatTick]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowRight") setIndex((current) => Math.min(tour.steps.length - 1, current + 1));
      if (event.key === "ArrowLeft") setIndex((current) => Math.max(0, current - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, tour.steps.length]);

  useEffect(() => {
    if (step.action !== "click") return;
    const target = getTarget(step);
    if (!target) return;
    const onClick = () => setIndex((current) => Math.min(tour.steps.length - 1, current + 1));
    target.addEventListener("click", onClick, { once: true });
    return () => target.removeEventListener("click", onClick);
  }, [step, tour.steps.length]);

  const pad = 10;
  const spotlight = rect
    ? { left: rect.left - pad, top: rect.top - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 }
    : null;

  return (
    <div className="fixed inset-0 z-[85] pointer-events-none" aria-live="polite">
      <div className="absolute inset-0 bg-black/70" />
      {spotlight && (
        <div
          className="absolute rounded-2xl border-4 border-amber-300 shadow-[0_0_0_9999px_rgba(0,0,0,0.66),0_0_28px_rgba(251,191,36,0.9)] pointer-events-none"
          style={spotlight}
        />
      )}
      <section className="absolute left-4 right-4 bottom-5 md:left-auto md:right-8 md:bottom-8 md:w-[420px] bg-surface text-on-surface rounded-2xl border border-amber-300 shadow-2xl p-5 pointer-events-auto">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <div className="text-sm font-black text-primary">{tour.title}</div>
            <h2 className="text-2xl font-black leading-tight">{step.title}</h2>
          </div>
          <button type="button" onClick={onClose} className="w-12 h-12 rounded-full border border-outline-variant flex items-center justify-center" aria-label="Exit walkthrough">
            <X size={22} />
          </button>
        </div>
        <p className="text-lg leading-relaxed text-on-surface-variant mb-5">{step.body}</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setIndex((i) => Math.max(0, i - 1))} disabled={index === 0} className="min-h-12 px-4 rounded-xl border border-outline-variant text-base font-bold disabled:opacity-40">Back</button>
          <button type="button" onClick={() => setIndex((i) => Math.min(tour.steps.length - 1, i + 1))} disabled={index === tour.steps.length - 1} className="min-h-12 px-5 rounded-xl bg-primary text-on-primary text-base font-black disabled:opacity-40">Next</button>
          <button type="button" onClick={() => setRepeatTick((tick) => tick + 1)} className="min-h-12 px-4 rounded-xl border border-outline-variant text-base font-bold flex items-center gap-2">
            <Volume2 size={18} /> Repeat
          </button>
          <button type="button" onClick={() => setVoiceOn((v) => !v)} className="min-h-12 px-4 rounded-xl border border-outline-variant text-base font-bold flex items-center gap-2">
            {voiceOn ? <Volume2 size={18} /> : <VolumeX size={18} />} {voiceOn ? "Voice on" : "Voice off"}
          </button>
          <button type="button" onClick={onClose} className="min-h-12 px-4 rounded-xl border border-outline-variant text-base font-bold">Exit</button>
        </div>
      </section>
    </div>
  );
}
