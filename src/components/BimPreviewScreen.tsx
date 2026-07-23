import React from "react";
import { ArrowRight, Building2, CheckCircle2, FileBox, LockKeyhole, Ruler } from "lucide-react";

export default function BimPreviewScreen({ onGoToCreate }: { onGoToCreate: () => void }) {
  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 md:py-12" aria-labelledby="bim-preview-title">
      <section className="overflow-hidden rounded-[2rem] border border-outline-variant/25 bg-surface-container-low/90 shadow-xl">
        <header className="bg-gradient-to-br from-secondary/15 via-surface-container to-primary/10 px-5 py-8 sm:px-8 sm:py-10">
          <span className="inline-flex items-center gap-2 rounded-full border border-outline-variant/30 bg-surface/80 px-3 py-1 text-[11px] font-black uppercase tracking-[.16em] text-on-surface-variant">
            <LockKeyhole size={13} aria-hidden="true" /> Preview only - unavailable
          </span>
          <div className="mt-5 flex flex-col gap-5 sm:flex-row sm:items-center">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-secondary text-on-secondary shadow-lg">
              <Building2 size={30} aria-hidden="true" />
            </div>
            <div>
              <h1 id="bim-preview-title" className="text-2xl font-black tracking-tight text-on-surface sm:text-3xl">Scaled BIM Builder</h1>
              <p className="mt-2 max-w-3xl text-sm leading-relaxed text-on-surface-variant sm:text-base">
                The building workspace is preserved in this release, but BIM V2 is disabled while its durable build router, worker, and acceptance checks are completed.
              </p>
            </div>
          </div>
        </header>

        <div className="grid gap-5 p-5 sm:p-8 lg:grid-cols-3">
          <article className="rounded-2xl border border-outline-variant/25 bg-surface p-5">
            <Ruler className="text-primary" size={24} aria-hidden="true" />
            <h2 className="mt-4 text-base font-black text-on-surface">Scaled visual shell</h2>
            <p className="mt-2 text-sm leading-relaxed text-on-surface-variant">A dimensioned GLB shell without IFC element semantics. This lower-cost option is not enabled yet.</p>
          </article>
          <article className="rounded-2xl border border-outline-variant/25 bg-surface p-5">
            <FileBox className="text-secondary" size={24} aria-hidden="true" />
            <h2 className="mt-4 text-base font-black text-on-surface">IFC information model</h2>
            <p className="mt-2 text-sm leading-relaxed text-on-surface-variant">A higher-cost IFC workflow with elements, properties, hierarchy, quantities, and semantic verification.</p>
          </article>
          <article className="rounded-2xl border border-outline-variant/25 bg-surface p-5">
            <CheckCircle2 className="text-emerald-700" size={24} aria-hidden="true" />
            <h2 className="mt-4 text-base font-black text-on-surface">Verification on both sides</h2>
            <p className="mt-2 text-sm leading-relaxed text-on-surface-variant">The planned release checks dimensions and assumptions before building, then validates the delivered artifact afterward.</p>
          </article>
        </div>

        <div className="mx-5 mb-6 rounded-2xl border border-amber-700/25 bg-amber-500/10 p-5 sm:mx-8 sm:mb-8 sm:p-6" role="status">
          <h2 className="font-black text-on-surface">What this status means</h2>
          <p className="mt-2 text-sm leading-relaxed text-on-surface-variant">
            No image or IFC uploads, credit charges, proposals, or model builds start from this page. The existing <strong>BimModelBuilder</strong> source has not been deleted or silently enabled.
          </p>
          <button type="button" onClick={onGoToCreate} className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-xl bg-primary px-5 text-sm font-black text-on-primary shadow-md transition hover:brightness-105 focus:outline-none focus-visible:ring-4 focus-visible:ring-primary/30">
            Create a pet model instead <ArrowRight size={15} aria-hidden="true" />
          </button>
        </div>
      </section>
    </main>
  );
}
