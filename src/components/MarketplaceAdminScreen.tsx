import React, { useCallback, useEffect, useState } from "react";
import { Store, RefreshCw, Upload, CheckCircle2, AlertTriangle, Archive, Send } from "lucide-react";
import { authedFetch } from "../api";
import { uploadMarketplaceAsset, type UploadStage } from "../lib/adminUpload";

/**
 * Phase 3 — admin catalog manager screen (SKELETON).
 *
 * Working now: listing table with status filter, publish/archive actions, and
 * the full direct-to-Backblaze upload pipeline (src/lib/adminUpload.ts) with
 * staged progress.
 *
 * AGENT TODO (see AGENT_PROMPT_PHASE_3_MARKETPLACE.md):
 *   - Listing editor form covering every CreateListingSchema field, with
 *     client-side mirrors of the schema rules (physical ⇒ size range, etc.)
 *   - Preview image grid (GET /api/admin/marketplace/listings/:id/previews),
 *     reorder via PATCH /api/admin/marketplace/assets/:id
 *   - GLB slot with version history + replace (replacesAssetId)
 *   - Reorder listings via POST .../listings/:id/reorder
 */

interface AdminListing {
  id: number;
  uuid: string;
  slug: string;
  name: string;
  category: string;
  status: "draft" | "published" | "archived";
  digital_price_cents: number | null;
  physical_enabled: 0 | 1;
  glb_count: number;
  preview_count: number;
  updated_at: string;
}

const STATUS_FILTERS = ["all", "draft", "published", "archived"] as const;

export default function MarketplaceAdminScreen({ onClose }: { onClose: () => void }) {
  const [listings, setListings] = useState<AdminListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [statusFilter, setStatusFilter] = useState<(typeof STATUS_FILTERS)[number]>("all");
  const [uploadState, setUploadState] = useState<Record<number, UploadStage>>({});
  const [actionMsg, setActionMsg] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const qs = statusFilter === "all" ? "" : `?status=${statusFilter}`;
      const res = await authedFetch(`/api/admin/marketplace/listings${qs}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Could not load listings.");
      setListings(data.listings ?? []);
    } catch (e: any) {
      setError(e?.message || "Could not load listings.");
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => { void load(); }, [load]);

  const setStatus = useCallback(async (listing: AdminListing, status: "published" | "archived" | "draft") => {
    setActionMsg("");
    const res = await authedFetch(`/api/admin/marketplace/listings/${listing.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    const data = await res.json();
    if (!res.ok) {
      // Publish-gate failures (missing preview/GLB, licence) surface verbatim —
      // they tell the admin exactly what to fix.
      setActionMsg(data?.error || "Update failed.");
      return;
    }
    await load();
  }, [load]);

  const uploadFor = useCallback(async (listing: AdminListing, kind: "source_glb" | "preview_image", file: File) => {
    try {
      await uploadMarketplaceAsset({
        listingUuid: listing.uuid,
        kind,
        file,
        onProgress: (s) => setUploadState((prev) => ({ ...prev, [listing.id]: s })),
      });
      await load();
    } catch {
      /* stage-level error is already in uploadState */
    }
  }, [load]);

  return (
    <main className="mx-auto w-full max-w-6xl px-4 pb-28 pt-7 sm:px-6">
      <div className="glass-hero rounded-[2rem] p-6 sm:p-8">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-primary">
              <Store size={18} />
              <span className="text-xs font-black uppercase tracking-[.18em]">Marketplace Admin</span>
            </div>
            <h1 className="mt-2 text-2xl font-black tracking-tight text-on-surface sm:text-3xl">Catalog manager</h1>
          </div>
          <button type="button" onClick={onClose} className="rounded-xl border border-outline-variant px-4 py-2 text-xs font-black text-on-surface-variant hover:text-primary">Close</button>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setStatusFilter(f)}
              className={`rounded-full px-4 py-1.5 text-xs font-black capitalize ${statusFilter === f ? "bg-primary text-on-primary" : "border border-outline-variant/50 text-on-surface-variant"}`}
            >
              {f}
            </button>
          ))}
        </div>
        {actionMsg && (
          <p className="mt-3 flex items-center gap-2 rounded-xl border border-amber-300/50 bg-amber-50 px-3 py-2 text-[12px] font-bold text-amber-800 dark:bg-amber-900/15 dark:text-amber-200">
            <AlertTriangle size={14} /> {actionMsg}
          </p>
        )}
      </div>

      <div className="mt-6 space-y-3">
        {loading && <div className="py-16 text-center text-sm text-on-surface-variant"><RefreshCw size={16} className="mx-auto animate-spin" /></div>}
        {!loading && error && <div className="rounded-2xl border border-error/30 bg-error/5 p-5 text-center text-sm text-error">{error}</div>}
        {!loading && !error && listings.map((listing) => {
          const up = uploadState[listing.id];
          return (
            <section key={listing.id} className="rounded-[1.4rem] border border-outline-variant/40 bg-surface/80 p-4">
              <div className="flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-black text-on-surface">{listing.name}</p>
                  <p className="text-[11px] text-on-surface-variant">{listing.slug} · {listing.category} · {listing.glb_count} GLB · {listing.preview_count} previews</p>
                </div>
                <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase ${
                  listing.status === "published" ? "bg-green-500/10 text-green-600"
                  : listing.status === "archived" ? "bg-outline-variant/20 text-on-surface-variant"
                  : "bg-primary/10 text-primary"}`}>{listing.status}</span>

                {/* Upload buttons — full pipeline, staged progress below. */}
                <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-outline-variant px-3 py-1.5 text-[11px] font-black text-on-surface hover:text-primary">
                  <Upload size={13} /> GLB
                  <input type="file" accept=".glb,model/gltf-binary" className="hidden"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadFor(listing, "source_glb", f); e.target.value = ""; }} />
                </label>
                <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-outline-variant px-3 py-1.5 text-[11px] font-black text-on-surface hover:text-primary">
                  <Upload size={13} /> Preview
                  <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadFor(listing, "preview_image", f); e.target.value = ""; }} />
                </label>

                {listing.status !== "published" && (
                  <button type="button" onClick={() => void setStatus(listing, "published")} className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3 py-1.5 text-[11px] font-black text-on-primary"><Send size={12} /> Publish</button>
                )}
                {listing.status === "published" && (
                  <button type="button" onClick={() => void setStatus(listing, "archived")} className="inline-flex items-center gap-1.5 rounded-xl border border-outline-variant px-3 py-1.5 text-[11px] font-black text-on-surface-variant"><Archive size={12} /> Archive</button>
                )}
              </div>

              {up && up.stage !== "done" && (
                <p className="mt-2 text-[11px] font-bold text-on-surface-variant">
                  {up.stage === "requesting-url" && "Preparing upload…"}
                  {up.stage === "uploading" && `Uploading… ${up.percent}%`}
                  {up.stage === "hashing" && "Verifying file…"}
                  {up.stage === "confirming" && "Confirming with server…"}
                  {up.stage === "error" && <span className="text-red-500">Failed at {up.at}: {up.message}</span>}
                </p>
              )}
              {up?.stage === "done" && (
                <p className="mt-2 flex items-center gap-1.5 text-[11px] font-black text-green-600"><CheckCircle2 size={13} /> Uploaded (v{up.version})</p>
              )}
            </section>
          );
        })}
      </div>
    </main>
  );
}
