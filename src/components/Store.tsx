import React from "react";
import { ArrowRight, Building2, Mic2, PackageOpen, Printer, Sparkles } from "lucide-react";
import { Screen } from "../types";

interface StoreProps {
  onNavigate: (screen: Screen) => void;
}

/** User-facing Shop landing page. Legacy order intake is intentionally absent. */
export default function Store({ onNavigate }: StoreProps) {
  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 md:py-12" aria-labelledby="shop-title">
      <section className="overflow-hidden rounded-[2rem] border border-outline-variant/25 bg-surface-container-low/90 shadow-xl">
        <header className="bg-gradient-to-br from-primary/15 via-surface-container to-secondary/10 px-5 py-8 text-center sm:px-8 sm:py-10">
          <span className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-[11px] font-black uppercase tracking-[.16em] text-primary">
            <PackageOpen size={13} aria-hidden="true" /> Shop refresh
          </span>
          <h1 id="shop-title" className="mt-3 text-3xl font-black tracking-tight text-on-surface">Pawsome3D Shop</h1>
          <p className="mx-auto mt-3 max-w-2xl text-sm leading-relaxed text-on-surface-variant sm:text-base">
            The legacy print-request and marketplace forms have been retired. Physical checkout now starts from a model that passes automatic repair and manufacturing validation in Create.
          </p>
        </header>

        <div className="grid gap-5 p-5 sm:p-8 md:grid-cols-2">
          <button type="button" onClick={() => onNavigate(Screen.CREATE)} className="group rounded-2xl border border-emerald-700/25 bg-emerald-600/10 p-5 text-left transition hover:bg-emerald-600/15 focus:outline-none focus-visible:ring-4 focus-visible:ring-emerald-600/25 sm:p-6">
            <Printer className="text-emerald-800 dark:text-emerald-300" size={25} aria-hidden="true" />
            <h2 className="mt-4 text-lg font-black text-on-surface">Physical manufacturing</h2>
            <p className="mt-2 text-sm leading-relaxed text-on-surface-variant">
              Create or select a model first. Checkout attempts conservative mesh repair, verifies the exported STL, and stops before payment if the result is not printable.
            </p>
            <span className="mt-5 inline-flex items-center gap-2 text-sm font-black text-emerald-800 dark:text-emerald-300">Create a print-ready model <ArrowRight size={15} className="transition-transform group-hover:translate-x-1" aria-hidden="true" /></span>
          </button>

          <article className="rounded-2xl border border-outline-variant/25 bg-surface p-5 sm:p-6">
            <Sparkles className="text-primary" size={25} aria-hidden="true" />
            <h2 className="mt-4 text-lg font-black text-on-surface">Digital accessories</h2>
            <p className="mt-2 text-sm leading-relaxed text-on-surface-variant">Verified model accessories and monthly digital packs are being prepared for the replacement catalog.</p>
            <span className="mt-5 inline-flex rounded-full bg-primary/10 px-3 py-1 text-xs font-black text-primary">Coming later</span>
          </article>

          <button type="button" onClick={() => onNavigate(Screen.VOICE_TEST)} className="group rounded-2xl border border-primary/30 bg-primary/5 p-5 text-left transition hover:bg-primary/10 focus:outline-none focus-visible:ring-4 focus-visible:ring-primary/25 sm:p-6">
            <Mic2 className="text-primary" size={25} aria-hidden="true" />
            <h2 className="mt-4 text-lg font-black text-on-surface">Test voice and lip-sync</h2>
            <p className="mt-2 text-sm leading-relaxed text-on-surface-variant">Use the configured production voice and see whether Rhubarb returns synchronized mouth cues.</p>
            <span className="mt-5 inline-flex items-center gap-2 text-sm font-black text-primary">Open voice test <ArrowRight size={15} className="transition-transform group-hover:translate-x-1" aria-hidden="true" /></span>
          </button>

          <button type="button" onClick={() => onNavigate(Screen.BIM)} className="group rounded-2xl border border-secondary/30 bg-secondary/5 p-5 text-left transition hover:bg-secondary/10 focus:outline-none focus-visible:ring-4 focus-visible:ring-secondary/25 sm:p-6">
            <Building2 className="text-secondary" size={25} aria-hidden="true" />
            <h2 className="mt-4 text-lg font-black text-on-surface">Scaled BIM status</h2>
            <p className="mt-2 text-sm leading-relaxed text-on-surface-variant">Review what the shell and IFC options will provide. Building remains honestly disabled.</p>
            <span className="mt-5 inline-flex items-center gap-2 text-sm font-black text-secondary">View BIM preview <ArrowRight size={15} className="transition-transform group-hover:translate-x-1" aria-hidden="true" /></span>
          </button>
        </div>
      </section>
    </main>
  );
}
