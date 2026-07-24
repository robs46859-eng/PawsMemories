import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Store, RefreshCw, Upload, CheckCircle2, AlertTriangle, Archive, Send,
  Plus, ChevronUp, ChevronDown, ArrowLeft, Save, X, Image as ImageIcon,
  Box, History, Replace, Trash2, GripVertical, Tag, DollarSign, Ruler,
  FileText, Eye,
} from "lucide-react";
import { authedFetch } from "../api";
import { uploadMarketplaceAsset, type UploadStage } from "../lib/adminUpload";
import CustomizerAdminScreen from "./CustomizerAdminScreen";

/**
 * Phase 3 — admin catalog manager screen.
 *
 * Three views: listing table → listing editor → (inline) asset management.
 * Server infrastructure: server/marketplaceAdmin.ts (all logic),
 * server.ts L1983+ (route glue), src/lib/adminUpload.ts (upload pipeline).
 *
 * Follows WagsAdminPanel pattern: admin-gated, lazy-loaded, full-screen overlay.
 */

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

interface AdminListing {
  id: number;
  uuid: string;
  slug: string;
  name: string;
  breed: string | null;
  category: string;
  description: string | null;
  tags_json: string | null;
  dimensions_json: string | null;
  print_notes: string | null;
  status: "draft" | "published" | "archived";
  digital_price_cents: number | null;
  physical_enabled: 0 | 1;
  print_size_min_mm: number | null;
  print_size_max_mm: number | null;
  sort_order: number;
  glb_count: number;
  preview_count: number;
  stl_count: number;
  updated_at: string;
  created_at: string;
}

interface PreviewAsset {
  id: number;
  sort_order: number;
  url: string;
  expiresAt: string;
  size_bytes: number;
  mime_type: string;
}

interface GlbAsset {
  id: number;
  version: number;
  status: string;
  size_bytes: number;
  mime_type: string;
  created_at: string;
}

interface ListingFormData {
  name: string;
  slug: string;
  breed: string;
  category: string;
  description: string;
  tags: string;
  digital_price_cents: string;
  physical_enabled: boolean;
  print_size_min_mm: string;
  print_size_max_mm: string;
  print_notes: string;
  dimensions_x: string;
  dimensions_y: string;
  dimensions_z: string;
  sort_order: string;
}

const CATEGORIES = ["breed", "memorial", "accessories", "seasonal"] as const;
const STATUS_FILTERS = ["all", "draft", "published", "archived"] as const;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 140);
}

function formatPrice(cents: number | null): string {
  if (cents == null) return "—";
  return `$${(cents / 100).toFixed(2)}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

function validateForm(f: ListingFormData): string[] {
  const errors: string[] = [];
  if (!f.name.trim()) errors.push("Name is required.");
  if (!f.slug.trim()) errors.push("Slug is required.");
  else if (!SLUG_RE.test(f.slug)) errors.push("Slug must be lowercase words separated by single hyphens.");
  else if (f.slug.length < 3) errors.push("Slug must be at least 3 characters.");

  const price = f.digital_price_cents.trim();
  if (price && (isNaN(Number(price)) || Number(price) < 1)) {
    errors.push("Price must be at least $1.00.");
  }

  if (f.physical_enabled) {
    const min = Number(f.print_size_min_mm);
    const max = Number(f.print_size_max_mm);
    if (!f.print_size_min_mm.trim() || !f.print_size_max_mm.trim()) {
      errors.push("Physical printing requires both a minimum and maximum print size.");
    } else if (min > max) {
      errors.push("Min print size cannot exceed max print size.");
    }
  }

  if (f.dimensions_x || f.dimensions_y || f.dimensions_z) {
    const x = Number(f.dimensions_x); const y = Number(f.dimensions_y); const z = Number(f.dimensions_z);
    if (!f.dimensions_x || !f.dimensions_y || !f.dimensions_z) {
      errors.push("If any dimension is specified, all three (X, Y, Z) are required.");
    } else if (x <= 0 || y <= 0 || z <= 0) {
      errors.push("Dimensions must be positive numbers.");
    }
  }
  return errors;
}

function formToPayload(f: ListingFormData): Record<string, any> {
  const payload: Record<string, any> = {
    name: f.name.trim(),
    slug: f.slug.trim(),
    category: f.category,
    sort_order: Number(f.sort_order) || 0,
  };
  if (f.breed.trim()) payload.breed = f.breed.trim();
  if (f.description.trim()) payload.description = f.description.trim();
  if (f.tags.trim()) payload.tags = f.tags.split(",").map((t: string) => t.trim()).filter(Boolean);
  if (f.digital_price_cents.trim()) {
    payload.digital_price_cents = Math.round(Number(f.digital_price_cents) * 100);
  } else {
    payload.digital_price_cents = null;
  }
  payload.physical_enabled = f.physical_enabled;
  if (f.physical_enabled) {
    payload.print_size_min_mm = Number(f.print_size_min_mm);
    payload.print_size_max_mm = Number(f.print_size_max_mm);
  }
  if (f.print_notes.trim()) payload.print_notes = f.print_notes.trim();
  if (f.dimensions_x && f.dimensions_y && f.dimensions_z) {
    payload.dimensions = {
      x_mm: Number(f.dimensions_x),
      y_mm: Number(f.dimensions_y),
      z_mm: Number(f.dimensions_z),
    };
  }
  return payload;
}

function listingToForm(l: AdminListing): ListingFormData {
  let dims: any = null;
  try { dims = l.dimensions_json ? JSON.parse(l.dimensions_json) : null; } catch { /* skip */ }
  let tags: string[] = [];
  try { tags = l.tags_json ? JSON.parse(l.tags_json) : []; } catch { /* skip */ }

  return {
    name: l.name,
    slug: l.slug,
    breed: l.breed || "",
    category: l.category,
    description: l.description || "",
    tags: tags.join(", "),
    digital_price_cents: l.digital_price_cents != null ? (l.digital_price_cents / 100).toFixed(2) : "",
    physical_enabled: !!l.physical_enabled,
    print_size_min_mm: l.print_size_min_mm?.toString() || "",
    print_size_max_mm: l.print_size_max_mm?.toString() || "",
    print_notes: l.print_notes || "",
    dimensions_x: dims?.x_mm?.toString() || "",
    dimensions_y: dims?.y_mm?.toString() || "",
    dimensions_z: dims?.z_mm?.toString() || "",
    sort_order: l.sort_order?.toString() || "0",
  };
}

const emptyForm: ListingFormData = {
  name: "", slug: "", breed: "", category: "breed", description: "", tags: "",
  digital_price_cents: "", physical_enabled: false, print_size_min_mm: "",
  print_size_max_mm: "", print_notes: "", dimensions_x: "", dimensions_y: "",
  dimensions_z: "", sort_order: "0",
};

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

type View = "table" | "editor" | "customizer";

export default function MarketplaceAdminScreen({ onClose }: { onClose: () => void }) {
  // -- Global state --
  const [view, setView] = useState<View>("table");
  const [listings, setListings] = useState<AdminListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [statusFilter, setStatusFilter] = useState<(typeof STATUS_FILTERS)[number]>("all");
  const [actionMsg, setActionMsg] = useState("");

  // -- Editor state --
  const [editingListing, setEditingListing] = useState<AdminListing | null>(null); // null = create mode
  const [form, setForm] = useState<ListingFormData>(emptyForm);
  const [formErrors, setFormErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  // -- Assets state (for editor) --
  const [previews, setPreviews] = useState<PreviewAsset[]>([]);
  const [glbs, setGlbs] = useState<GlbAsset[]>([]);
  const [assetsLoading, setAssetsLoading] = useState(false);
  const [uploadState, setUploadState] = useState<Record<string, UploadStage>>({});

  /* ---------------------------------------------------------------- */
  /* Loaders                                                           */
  /* ---------------------------------------------------------------- */

  const loadListings = useCallback(async () => {
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

  useEffect(() => { void loadListings(); }, [loadListings]);

  const loadAssets = useCallback(async (listingId: number) => {
    setAssetsLoading(true);
    try {
      const res = await authedFetch(`/api/admin/marketplace/listings/${listingId}/assets`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Could not load assets.");
      setPreviews(data.previews ?? []);
      setGlbs(data.glbs ?? []);
    } catch {
      setPreviews([]);
      setGlbs([]);
    } finally {
      setAssetsLoading(false);
    }
  }, []);

  /* ---------------------------------------------------------------- */
  /* Actions                                                           */
  /* ---------------------------------------------------------------- */

  const setStatus = useCallback(async (listing: AdminListing, status: "published" | "archived" | "draft") => {
    setActionMsg("");
    try {
      const res = await authedFetch(`/api/admin/marketplace/listings/${listing.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const data = await res.json();
      if (!res.ok) {
        setActionMsg(data?.error || "Update failed.");
        return;
      }
      await loadListings();
    } catch (e: any) {
      setActionMsg(e?.message || "Update failed.");
    }
  }, [loadListings]);

  const handleReorder = useCallback(async (listingId: number, direction: "up" | "down") => {
    const idx = listings.findIndex((l) => l.id === listingId);
    if (idx < 0) return;
    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= listings.length) return;

    const order = listings.map((l, i) => ({
      id: l.id,
      sort_order: i === idx ? listings[swapIdx].sort_order
        : i === swapIdx ? listings[idx].sort_order
        : l.sort_order,
    }));
    // Only send the two that swapped
    const changed = [order[idx], order[swapIdx]];
    try {
      const res = await authedFetch(`/api/admin/marketplace/listings/${listingId}/reorder`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order: changed }),
      });
      if (!res.ok) {
        const d = await res.json();
        setActionMsg(d?.error || "Reorder failed.");
        return;
      }
      await loadListings();
    } catch (e: any) {
      setActionMsg(e?.message || "Reorder failed.");
    }
  }, [listings, loadListings]);

  const openEditor = useCallback((listing: AdminListing | null) => {
    setEditingListing(listing);
    setForm(listing ? listingToForm(listing) : { ...emptyForm });
    setFormErrors([]);
    setActionMsg("");
    setPreviews([]);
    setGlbs([]);
    setUploadState({});
    setView("editor");
    if (listing) void loadAssets(listing.id);
  }, [loadAssets]);

  const closeEditor = useCallback(() => {
    setView("table");
    setEditingListing(null);
    setFormErrors([]);
    void loadListings();
  }, [loadListings]);

  const handleSave = useCallback(async () => {
    const errors = validateForm(form);
    setFormErrors(errors);
    if (errors.length > 0) return;

    setSaving(true);
    try {
      const payload = formToPayload(form);
      const isCreate = !editingListing;
      const url = isCreate
        ? "/api/admin/marketplace/listings"
        : `/api/admin/marketplace/listings/${editingListing!.id}`;
      const method = isCreate ? "POST" : "PATCH";

      const res = await authedFetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setFormErrors([data?.error || "Save failed."]);
        return;
      }

      if (isCreate) {
        // Re-open editor with the created listing
        const listRes = await authedFetch(`/api/admin/marketplace/listings`);
        const listData = await listRes.json();
        const created = (listData.listings ?? []).find((l: any) => l.uuid === data.uuid);
        if (created) openEditor(created);
        else closeEditor();
      } else {
        // Reload listing data
        const listRes = await authedFetch(`/api/admin/marketplace/listings`);
        const listData = await listRes.json();
        const updated = (listData.listings ?? []).find((l: any) => l.id === editingListing!.id);
        if (updated) {
          setEditingListing(updated);
          setForm(listingToForm(updated));
        }
        setActionMsg("Saved.");
        setTimeout(() => setActionMsg(""), 2000);
      }
    } catch (e: any) {
      setFormErrors([e?.message || "Save failed."]);
    } finally {
      setSaving(false);
    }
  }, [form, editingListing, openEditor, closeEditor]);

  /* ---------------------------------------------------------------- */
  /* Upload                                                            */
  /* ---------------------------------------------------------------- */

  const uploadFor = useCallback(async (
    listing: AdminListing,
    kind: "source_glb" | "preview_image",
    file: File,
    replacesAssetId?: number,
  ) => {
    const key = `${kind}-${Date.now()}`;
    try {
      await uploadMarketplaceAsset({
        listingUuid: listing.uuid,
        kind,
        file,
        replacesAssetId,
        onProgress: (s) => setUploadState((prev) => ({ ...prev, [key]: s })),
      });
      // Reload assets after successful upload
      await loadAssets(listing.id);
      // Reload listing to update counts
      const listRes = await authedFetch(`/api/admin/marketplace/listings`);
      const listData = await listRes.json();
      const updated = (listData.listings ?? []).find((l: any) => l.id === listing.id);
      if (updated) {
        setEditingListing(updated);
        setForm(listingToForm(updated));
      }
    } catch {
      /* stage-level error is already in uploadState */
    }
  }, [loadAssets]);

  const reorderPreview = useCallback(async (previewId: number, newSortOrder: number) => {
    try {
      const res = await authedFetch(`/api/admin/marketplace/assets/${previewId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sort_order: newSortOrder }),
      });
      if (!res.ok) {
        const d = await res.json();
        setActionMsg(d?.error || "Reorder failed.");
        return;
      }
      if (editingListing) await loadAssets(editingListing.id);
    } catch (e: any) {
      setActionMsg(e?.message || "Reorder failed.");
    }
  }, [editingListing, loadAssets]);

  /* ---------------------------------------------------------------- */
  /* Helpers                                                           */
  /* ---------------------------------------------------------------- */

  const updateField = useCallback(<K extends keyof ListingFormData>(key: K, value: ListingFormData[K]) => {
    setForm((prev) => {
      const next = { ...prev, [key]: value };
      // Auto-slug from name when creating
      if (key === "name" && !editingListing) {
        next.slug = slugify(value as string);
      }
      return next;
    });
  }, [editingListing]);

  const activeGlb = useMemo(() => glbs.find((g) => g.status === "active"), [glbs]);
  const supersededGlbs = useMemo(() => glbs.filter((g) => g.status === "superseded"), [glbs]);

  // Active upload states for display
  const activeUploads = useMemo(() => {
    const entries = Object.entries(uploadState);
    return entries.filter(([, s]) => (s as UploadStage).stage !== "done");
  }, [uploadState]);

  /* ---------------------------------------------------------------- */
  /* Render: Input components                                          */
  /* ---------------------------------------------------------------- */

  const inputCls = "w-full rounded-xl border border-outline-variant/60 bg-surface px-3 py-2.5 text-sm text-on-surface placeholder:text-on-surface-variant/50 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/30 transition-colors";
  const labelCls = "block text-xs font-black text-on-surface-variant mb-1.5";

  const Input = ({ label, value, onChange, placeholder, type = "text", disabled = false }: {
    label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string; disabled?: boolean;
  }) => (
    <div>
      <label className={labelCls}>{label}</label>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder} disabled={disabled} className={inputCls} />
    </div>
  );

  /* ---------------------------------------------------------------- */
  /* Render: Table view                                                */
  /* ---------------------------------------------------------------- */

  if (view === "customizer") {
    return <CustomizerAdminScreen onBack={() => setView("table")} />;
  }

  if (view === "table") {
    return (
      <main className="mx-auto w-full max-w-6xl px-4 pb-28 pt-7 sm:px-6">
        {/* Header */}
        <div className="glass-hero rounded-[2rem] p-6 sm:p-8">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-primary">
                <Store size={18} />
                <span className="text-xs font-black uppercase tracking-[.18em]">Marketplace Admin</span>
              </div>
              <h1 className="mt-2 text-2xl font-black tracking-tight text-on-surface sm:text-3xl">Catalog manager</h1>
            </div>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => setView("customizer")}
                className="inline-flex items-center gap-1.5 rounded-xl border border-primary/40 bg-primary/10 px-4 py-2.5 text-xs font-black text-primary hover:bg-primary/20 transition-colors">
                <Store size={14} /> Printful Customizer
              </button>
              <button type="button" onClick={() => openEditor(null)}
                className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2.5 text-xs font-black text-on-primary hover:opacity-90 transition-opacity">
                <Plus size={14} /> New listing
              </button>
              <button type="button" onClick={onClose}
                className="rounded-xl border border-outline-variant px-4 py-2.5 text-xs font-black text-on-surface-variant hover:text-primary transition-colors">
                Close
              </button>
            </div>
          </div>

          {/* Status filters */}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {STATUS_FILTERS.map((f) => (
              <button key={f} type="button" onClick={() => setStatusFilter(f)}
                className={`rounded-full px-4 py-1.5 text-xs font-black capitalize transition-all ${
                  statusFilter === f
                    ? "bg-primary text-on-primary shadow-sm"
                    : "border border-outline-variant/50 text-on-surface-variant hover:border-primary/40"
                }`}>
                {f}
              </button>
            ))}
            <span className="ml-auto text-xs font-bold text-on-surface-variant">
              {listings.length} listing{listings.length !== 1 ? "s" : ""}
            </span>
          </div>

          {/* Action message */}
          {actionMsg && (
            <p className="mt-3 flex items-center gap-2 rounded-xl border border-amber-300/50 bg-amber-50 px-3 py-2 text-[12px] font-bold text-amber-800 dark:bg-amber-900/15 dark:text-amber-200">
              <AlertTriangle size={14} /> {actionMsg}
            </p>
          )}
        </div>

        {/* Listing rows */}
        <div className="mt-6 space-y-2">
          {loading && (
            <div className="py-16 text-center text-sm text-on-surface-variant">
              <RefreshCw size={16} className="mx-auto animate-spin" />
            </div>
          )}
          {!loading && error && (
            <div className="rounded-2xl border border-error/30 bg-error/5 p-5 text-center text-sm text-error">{error}</div>
          )}
          {!loading && !error && listings.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-on-surface-variant">
              <Store size={36} className="mb-3 opacity-30" />
              <p className="text-sm font-bold">No listings found.</p>
            </div>
          )}
          {!loading && !error && listings.map((listing, idx) => (
            <section key={listing.id}
              className="group rounded-[1.4rem] border border-outline-variant/40 bg-surface/80 p-4 hover:border-primary/30 transition-all">
              <div className="flex flex-wrap items-center gap-3">
                {/* Reorder */}
                <div className="flex flex-col gap-0.5">
                  <button type="button" onClick={() => handleReorder(listing.id, "up")} disabled={idx === 0}
                    className="rounded p-0.5 text-on-surface-variant/50 hover:text-primary disabled:opacity-20 transition-colors"
                    title="Move up">
                    <ChevronUp size={14} />
                  </button>
                  <button type="button" onClick={() => handleReorder(listing.id, "down")} disabled={idx === listings.length - 1}
                    className="rounded p-0.5 text-on-surface-variant/50 hover:text-primary disabled:opacity-20 transition-colors"
                    title="Move down">
                    <ChevronDown size={14} />
                  </button>
                </div>

                {/* Info — clickable to edit */}
                <div className="min-w-0 flex-1 cursor-pointer" onClick={() => openEditor(listing)}>
                  <p className="text-sm font-black text-on-surface group-hover:text-primary transition-colors">
                    {listing.name}
                  </p>
                  <p className="text-[11px] text-on-surface-variant">
                    {listing.slug} · {listing.category}
                    {listing.digital_price_cents != null && <> · {formatPrice(listing.digital_price_cents)}</>}
                    {listing.physical_enabled ? " · Print" : ""}
                    {" "}· {listing.glb_count} GLB · {listing.preview_count} preview{listing.preview_count !== 1 ? "s" : ""}
                  </p>
                </div>

                {/* Status badge */}
                <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase ${
                  listing.status === "published" ? "bg-green-500/10 text-green-600"
                  : listing.status === "archived" ? "bg-outline-variant/20 text-on-surface-variant"
                  : "bg-primary/10 text-primary"
                }`}>
                  {listing.status}
                </span>

                {/* Sort order */}
                <span className="hidden sm:inline-block text-[10px] font-mono text-on-surface-variant/60" title="Sort order">
                  #{listing.sort_order}
                </span>

                {/* Updated at */}
                <span className="hidden md:inline-block text-[10px] text-on-surface-variant/60">
                  {new Date(listing.updated_at || listing.created_at).toLocaleDateString()}
                </span>

                {/* Actions */}
                <button type="button" onClick={() => openEditor(listing)}
                  className="inline-flex items-center gap-1 rounded-xl border border-outline-variant px-3 py-1.5 text-[11px] font-black text-on-surface-variant hover:text-primary transition-colors">
                  <Eye size={12} /> Edit
                </button>

                {listing.status !== "published" && (
                  <button type="button" onClick={() => void setStatus(listing, "published")}
                    className="inline-flex items-center gap-1 rounded-xl bg-primary px-3 py-1.5 text-[11px] font-black text-on-primary">
                    <Send size={12} /> Publish
                  </button>
                )}
                {listing.status === "published" && (
                  <button type="button" onClick={() => void setStatus(listing, "archived")}
                    className="inline-flex items-center gap-1 rounded-xl border border-outline-variant px-3 py-1.5 text-[11px] font-black text-on-surface-variant hover:text-amber-600 transition-colors">
                    <Archive size={12} /> Archive
                  </button>
                )}
                {listing.status === "archived" && (
                  <button type="button" onClick={() => void setStatus(listing, "draft")}
                    className="inline-flex items-center gap-1 rounded-xl border border-outline-variant px-3 py-1.5 text-[11px] font-black text-on-surface-variant hover:text-primary transition-colors">
                    <RefreshCw size={12} /> Unarchive
                  </button>
                )}
              </div>
            </section>
          ))}
        </div>
      </main>
    );
  }

  /* ---------------------------------------------------------------- */
  /* Render: Editor view                                               */
  /* ---------------------------------------------------------------- */

  const isCreate = !editingListing;

  return (
    <main className="mx-auto w-full max-w-5xl px-4 pb-28 pt-7 sm:px-6">
      {/* Editor header */}
      <div className="glass-hero rounded-[2rem] p-6 sm:p-8">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <button type="button" onClick={closeEditor}
              className="rounded-xl border border-outline-variant p-2 text-on-surface-variant hover:text-primary transition-colors">
              <ArrowLeft size={16} />
            </button>
            <div>
              <div className="flex items-center gap-2 text-primary">
                <Store size={16} />
                <span className="text-xs font-black uppercase tracking-[.18em]">
                  {isCreate ? "New listing" : "Edit listing"}
                </span>
              </div>
              <h1 className="mt-1 text-xl font-black tracking-tight text-on-surface sm:text-2xl">
                {isCreate ? "Create listing" : form.name || "Untitled"}
              </h1>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {editingListing && (
              <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase ${
                editingListing.status === "published" ? "bg-green-500/10 text-green-600"
                : editingListing.status === "archived" ? "bg-outline-variant/20 text-on-surface-variant"
                : "bg-primary/10 text-primary"
              }`}>
                {editingListing.status}
              </span>
            )}
            <button type="button" onClick={handleSave} disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2.5 text-xs font-black text-on-primary hover:opacity-90 disabled:opacity-50 transition-opacity">
              {saving ? <RefreshCw size={14} className="animate-spin" /> : <Save size={14} />}
              {isCreate ? "Create" : "Save"}
            </button>
          </div>
        </div>

        {/* Errors / messages */}
        {formErrors.length > 0 && (
          <div className="mt-3 rounded-xl border border-red-300/50 bg-red-50 px-4 py-3 dark:bg-red-900/15">
            {formErrors.map((e, i) => (
              <p key={i} className="text-[12px] font-bold text-red-700 dark:text-red-300">{e}</p>
            ))}
          </div>
        )}
        {actionMsg && (
          <p className="mt-3 flex items-center gap-2 text-[12px] font-bold text-green-600">
            <CheckCircle2 size={14} /> {actionMsg}
          </p>
        )}
      </div>

      {/* Form fields */}
      <div className="mt-6 space-y-6">
        {/* Basic info */}
        <section className="rounded-[1.4rem] border border-outline-variant/40 bg-surface/80 p-5 space-y-4">
          <div className="flex items-center gap-2 text-primary mb-2">
            <FileText size={15} />
            <span className="text-xs font-black uppercase tracking-[.14em]">Basic info</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input label="Name *" value={form.name} onChange={(v) => updateField("name", v)} placeholder="e.g. Golden Retriever Memorial" />
            <Input label="Slug *" value={form.slug} onChange={(v) => updateField("slug", v)} placeholder="golden-retriever-memorial" />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Category *</label>
              <select value={form.category} onChange={(e) => updateField("category", e.target.value)} className={inputCls}>
                {CATEGORIES.map((c) => <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>)}
              </select>
            </div>
            <Input label="Breed" value={form.breed} onChange={(v) => updateField("breed", v)} placeholder="e.g. Golden Retriever" />
          </div>

          <div>
            <label className={labelCls}>Description</label>
            <textarea value={form.description} onChange={(e) => updateField("description", e.target.value)}
              placeholder="Describe this listing for the marketplace page…" rows={3} className={inputCls + " resize-none"} />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input label="Tags (comma-separated)" value={form.tags} onChange={(v) => updateField("tags", v)} placeholder="memorial, golden, pet" />
            <Input label="Sort order" value={form.sort_order} onChange={(v) => updateField("sort_order", v)} type="number" placeholder="0" />
          </div>
        </section>

        {/* Pricing & print */}
        <section className="rounded-[1.4rem] border border-outline-variant/40 bg-surface/80 p-5 space-y-4">
          <div className="flex items-center gap-2 text-primary mb-2">
            <DollarSign size={15} />
            <span className="text-xs font-black uppercase tracking-[.14em]">Pricing & printing</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input label="Digital price (USD, leave blank to disable)" value={form.digital_price_cents}
              onChange={(v) => updateField("digital_price_cents", v)} placeholder="9.99" type="number" />
            <div>
              <label className={labelCls}>Physical printing</label>
              <button type="button" onClick={() => updateField("physical_enabled", !form.physical_enabled)}
                className={`flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-black transition-all ${
                  form.physical_enabled
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-outline-variant/60 text-on-surface-variant"
                }`}>
                <div className={`h-4 w-8 rounded-full transition-colors ${form.physical_enabled ? "bg-primary" : "bg-outline-variant/40"}`}>
                  <div className={`h-4 w-4 rounded-full bg-white shadow transition-transform ${form.physical_enabled ? "translate-x-4" : ""}`} />
                </div>
                {form.physical_enabled ? "Enabled" : "Disabled"}
              </button>
            </div>
          </div>

          {form.physical_enabled && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pl-4 border-l-2 border-primary/20">
              <Input label="Min print size (mm)" value={form.print_size_min_mm}
                onChange={(v) => updateField("print_size_min_mm", v)} type="number" placeholder="40" />
              <Input label="Max print size (mm)" value={form.print_size_max_mm}
                onChange={(v) => updateField("print_size_max_mm", v)} type="number" placeholder="200" />
              <div className="sm:col-span-2">
                <label className={labelCls}>Print notes</label>
                <textarea value={form.print_notes} onChange={(e) => updateField("print_notes", e.target.value)}
                  placeholder="Special printing instructions…" rows={2} className={inputCls + " resize-none"} />
              </div>
            </div>
          )}
        </section>

        {/* Dimensions */}
        <section className="rounded-[1.4rem] border border-outline-variant/40 bg-surface/80 p-5 space-y-4">
          <div className="flex items-center gap-2 text-primary mb-2">
            <Ruler size={15} />
            <span className="text-xs font-black uppercase tracking-[.14em]">Dimensions (optional, mm)</span>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <Input label="X (width)" value={form.dimensions_x} onChange={(v) => updateField("dimensions_x", v)} type="number" placeholder="0" />
            <Input label="Y (height)" value={form.dimensions_y} onChange={(v) => updateField("dimensions_y", v)} type="number" placeholder="0" />
            <Input label="Z (depth)" value={form.dimensions_z} onChange={(v) => updateField("dimensions_z", v)} type="number" placeholder="0" />
          </div>
        </section>

        {/* Assets — only shown when editing an existing listing */}
        {editingListing && (
          <>
            {/* GLB source model */}
            <section className="rounded-[1.4rem] border border-outline-variant/40 bg-surface/80 p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-primary">
                  <Box size={15} />
                  <span className="text-xs font-black uppercase tracking-[.14em]">Source model (GLB)</span>
                </div>
                <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-outline-variant px-3 py-1.5 text-[11px] font-black text-on-surface hover:text-primary hover:border-primary/40 transition-colors">
                  <Upload size={13} /> {activeGlb ? "Replace" : "Upload"} GLB
                  <input type="file" accept=".glb,model/gltf-binary" className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void uploadFor(editingListing, "source_glb", f, activeGlb?.id);
                      e.target.value = "";
                    }} />
                </label>
              </div>

              {assetsLoading && (
                <div className="py-6 text-center"><RefreshCw size={14} className="mx-auto animate-spin text-on-surface-variant" /></div>
              )}

              {!assetsLoading && activeGlb && (
                <div className="flex items-center gap-3 rounded-xl border border-green-300/40 bg-green-50/50 px-4 py-3 dark:bg-green-900/10">
                  <CheckCircle2 size={16} className="text-green-600 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-black text-on-surface">v{activeGlb.version} — Active</p>
                    <p className="text-[11px] text-on-surface-variant">
                      {formatBytes(activeGlb.size_bytes)} · {activeGlb.mime_type} · {new Date(activeGlb.created_at).toLocaleDateString()}
                    </p>
                  </div>
                </div>
              )}

              {!assetsLoading && !activeGlb && glbs.length === 0 && (
                <div className="rounded-xl border border-dashed border-outline-variant/60 px-4 py-6 text-center">
                  <Box size={24} className="mx-auto mb-2 text-on-surface-variant/30" />
                  <p className="text-xs text-on-surface-variant">No source model uploaded yet.</p>
                </div>
              )}

              {/* Version history */}
              {supersededGlbs.length > 0 && (
                <div className="space-y-1">
                  <div className="flex items-center gap-1.5 text-on-surface-variant/60 mb-2">
                    <History size={12} />
                    <span className="text-[10px] font-black uppercase tracking-wider">Version history</span>
                  </div>
                  {supersededGlbs.map((g) => (
                    <div key={g.id} className="flex items-center gap-3 rounded-lg px-3 py-2 text-on-surface-variant/60">
                      <span className="text-[11px] font-mono">v{g.version}</span>
                      <span className="text-[10px]">{formatBytes(g.size_bytes)}</span>
                      <span className="text-[10px]">{new Date(g.created_at).toLocaleDateString()}</span>
                      <span className="rounded-full bg-outline-variant/20 px-2 py-0.5 text-[9px] font-black uppercase">superseded</span>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Preview images */}
            <section className="rounded-[1.4rem] border border-outline-variant/40 bg-surface/80 p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-primary">
                  <ImageIcon size={15} />
                  <span className="text-xs font-black uppercase tracking-[.14em]">
                    Preview images ({previews.length}/8)
                  </span>
                </div>
                <label className={`inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-outline-variant px-3 py-1.5 text-[11px] font-black text-on-surface hover:text-primary hover:border-primary/40 transition-colors ${previews.length >= 8 ? "opacity-40 pointer-events-none" : ""}`}>
                  <Upload size={13} /> Add image
                  <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" disabled={previews.length >= 8}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void uploadFor(editingListing, "preview_image", f);
                      e.target.value = "";
                    }} />
                </label>
              </div>

              {assetsLoading && (
                <div className="py-6 text-center"><RefreshCw size={14} className="mx-auto animate-spin text-on-surface-variant" /></div>
              )}

              {!assetsLoading && previews.length === 0 && (
                <div className="rounded-xl border border-dashed border-outline-variant/60 px-4 py-6 text-center">
                  <ImageIcon size={24} className="mx-auto mb-2 text-on-surface-variant/30" />
                  <p className="text-xs text-on-surface-variant">No preview images yet. Upload at least one before publishing.</p>
                </div>
              )}

              {!assetsLoading && previews.length > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                  {previews.map((p, idx) => (
                    <div key={p.id} className="group/img relative rounded-xl border border-outline-variant/40 overflow-hidden bg-surface-container">
                      <img src={p.url} alt={`Preview ${idx + 1}`} className="aspect-square w-full object-cover" loading="lazy" />
                      <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/60 to-transparent px-2 py-1.5">
                        <span className="text-[10px] font-bold text-white/80">#{p.sort_order}</span>
                        <div className="flex gap-0.5">
                          <button type="button" onClick={() => reorderPreview(p.id, Math.max(0, p.sort_order - 1))}
                            disabled={idx === 0}
                            className="rounded p-0.5 text-white/70 hover:text-white disabled:opacity-30 transition-colors">
                            <ChevronUp size={12} />
                          </button>
                          <button type="button" onClick={() => reorderPreview(p.id, p.sort_order + 1)}
                            disabled={idx === previews.length - 1}
                            className="rounded p-0.5 text-white/70 hover:text-white disabled:opacity-30 transition-colors">
                            <ChevronDown size={12} />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Active uploads */}
            {activeUploads.length > 0 && (
              <section className="rounded-[1.4rem] border border-outline-variant/40 bg-surface/80 p-5 space-y-2">
                <div className="flex items-center gap-2 text-on-surface-variant mb-2">
                  <Upload size={15} />
                  <span className="text-xs font-black uppercase tracking-[.14em]">Uploads in progress</span>
                </div>
                {activeUploads.map(([key, up]) => (
                  <div key={key} className="text-[11px] font-bold text-on-surface-variant">
                    {up.stage === "requesting-url" && "Preparing upload…"}
                    {up.stage === "uploading" && `Uploading… ${(up as any).percent}%`}
                    {up.stage === "hashing" && "Verifying file…"}
                    {up.stage === "confirming" && "Confirming with server…"}
                    {up.stage === "error" && (
                      <span className="text-red-500">
                        Failed at {(up as any).at}: {(up as any).message}
                      </span>
                    )}
                  </div>
                ))}
              </section>
            )}
          </>
        )}

        {/* Editor-level status actions */}
        {editingListing && (
          <section className="rounded-[1.4rem] border border-outline-variant/40 bg-surface/80 p-5">
            <div className="flex items-center gap-2 text-on-surface-variant mb-3">
              <Tag size={15} />
              <span className="text-xs font-black uppercase tracking-[.14em]">Status actions</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {editingListing.status !== "published" && (
                <button type="button" onClick={() => void setStatus(editingListing, "published")}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-green-600 px-4 py-2 text-xs font-black text-white hover:bg-green-700 transition-colors">
                  <Send size={13} /> Publish
                </button>
              )}
              {editingListing.status === "published" && (
                <button type="button" onClick={() => void setStatus(editingListing, "archived")}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-amber-400/50 px-4 py-2 text-xs font-black text-amber-700 hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-900/20 transition-colors">
                  <Archive size={13} /> Archive
                </button>
              )}
              {editingListing.status === "archived" && (
                <button type="button" onClick={() => void setStatus(editingListing, "draft")}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-outline-variant px-4 py-2 text-xs font-black text-on-surface-variant hover:text-primary transition-colors">
                  <RefreshCw size={13} /> Return to draft
                </button>
              )}
            </div>
            {actionMsg && !actionMsg.includes("Saved") && (
              <p className="mt-3 flex items-center gap-2 rounded-xl border border-amber-300/50 bg-amber-50 px-3 py-2 text-[12px] font-bold text-amber-800 dark:bg-amber-900/15 dark:text-amber-200">
                <AlertTriangle size={14} /> {actionMsg}
              </p>
            )}
          </section>
        )}
      </div>
    </main>
  );
}
