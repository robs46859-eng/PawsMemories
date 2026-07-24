/**
 * WagsAdminPanel — Wardrobe Wags box review screen (W2)
 *
 * Admin-only. Lists pending/approved/rejected boxes, shows the Gemini-generated
 * plan, and lets the admin approve, reject, or re-plan each box.
 *
 * Route: Screen.ADMIN_WAGS  (/admin/wags)
 */

import React, { useEffect, useRef, useState } from "react";
import {
  CheckCircle2, XCircle, RefreshCw, ChevronDown, ChevronUp,
  Package, Sparkles, AlertCircle, Clock, X, Filter, PawPrint,
  Shirt, Star, Gift, Zap, Video, Palette, Calendar as CalendarIcon
} from "lucide-react";
import { authedFetch } from "../api";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface WagsPlanItem {
  slot: string;
  title: string;
  description: string;
  category: string;
  colors: string[];
  tags: string[];
  size_note?: string;
}

interface WagsPlan {
  schema_version: string;
  box_month: string;
  tier: "basic" | "plus";
  season: string;
  theme: string;
  theme_rationale: string;
  items: WagsPlanItem[];
}

interface WagsBox {
  id: number;
  subscription_id: number;
  user_phone: string;
  box_month: string;
  status: "pending_review" | "approved" | "rejected" | "delivered" | "delivered_flagged" | "reviewed_ok" | "reviewed_issue";
  plan_json: WagsPlan | null;
  admin_notes: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  delivered_at: string | null;
  created_at: string;
  tier: "basic" | "plus";
  billing_period: "monthly" | "annual";
  species: "dog" | "cat";
  pet_id: number;
  current_period_start: string;
  current_period_end: string;
}

type StatusFilter = "all" | "pending_review" | "approved" | "rejected" | "delivered";

// ---------------------------------------------------------------------------
// Slot icon map
// ---------------------------------------------------------------------------

const SLOT_ICONS: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  accessory: Shirt,
  accessory_2: Shirt,
  accessory_3: Shirt,
  seasonal: Star,
  minimodel: Package,
  pawprint: PawPrint,
  sticker_1: Sparkles, sticker_2: Sparkles, sticker_3: Sparkles, sticker_4: Sparkles, sticker_5: Sparkles,
  credit_pack: Zap,
  video_gen: Video,
  restyle: Palette,
  calendar: CalendarIcon,
};

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  pending_review:   { label: "Pending",   color: "text-amber-600 bg-amber-50 border-amber-200"     },
  approved:         { label: "Approved",  color: "text-emerald-700 bg-emerald-50 border-emerald-200" },
  rejected:         { label: "Rejected",  color: "text-red-600 bg-red-50 border-red-200"           },
  delivered:        { label: "Delivered", color: "text-sky-600 bg-sky-50 border-sky-200"           },
  delivered_flagged:{ label: "Flagged",   color: "text-orange-600 bg-orange-50 border-orange-200"  },
  reviewed_ok:      { label: "OK",        color: "text-emerald-700 bg-emerald-50 border-emerald-200"},
  reviewed_issue:   { label: "Issue",     color: "text-red-600 bg-red-50 border-red-200"           },
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface Props {
  onClose: () => void;
}

export default function WagsAdminPanel({ onClose }: Props) {
  const [boxes, setBoxes] = useState<WagsBox[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("pending_review");
  const [expandedId, setExpandedId] = useState<number | null>(null);

  // Per-box review state
  const [reviewNotes, setReviewNotes] = useState<Record<number, string>>({});
  const [reviewBusy, setReviewBusy] = useState<Record<number, boolean>>({});
  const [reviewMsg, setReviewMsg] = useState<Record<number, string>>({});

  // Plan-box state
  const [planBusy, setPlanBusy] = useState<Record<number, boolean>>({});
  const [planSubId, setPlanSubId] = useState<number | null>(null);
  const [planMonth, setPlanMonth] = useState(new Date().toISOString().slice(0, 7));
  const [planMsg, setPlanMsg] = useState("");
  const [showPlanForm, setShowPlanForm] = useState(false);

  const fetchBoxes = async (filter: StatusFilter) => {
    setLoading(true);
    setError("");
    try {
      const qs = filter === "all" ? "" : `?status=${filter}`;
      const r = await authedFetch(`/api/admin/wags/boxes${qs}`);
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Failed to load boxes.");
      setBoxes(data.boxes ?? []);
    } catch (err: any) {
      setError(err.message || "Could not load boxes.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchBoxes(statusFilter); }, [statusFilter]);

  const handleReview = async (box: WagsBox, action: "approve" | "reject") => {
    setReviewBusy((prev) => ({ ...prev, [box.id]: true }));
    setReviewMsg((prev) => ({ ...prev, [box.id]: "" }));
    try {
      const r = await authedFetch(`/api/admin/wags/boxes/${box.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, admin_notes: reviewNotes[box.id] ?? "" }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Update failed.");
      setReviewMsg((prev) => ({
        ...prev,
        [box.id]: action === "approve"
          ? (data.status === "materializing" ? "✓ Approved — generating slot assets…" : "✓ Approved")
          : "✗ Rejected",
      }));
      // "materializing" is transient server work; the box row remains approved
      // until every generative slot has a stored asset, then flips delivered.
      setBoxes((prev) => prev.map((b) => b.id === box.id
        ? { ...b, status: data.status === "materializing" ? "approved" : data.status }
        : b));
    } catch (err: any) {
      setReviewMsg((prev) => ({ ...prev, [box.id]: err.message }));
    } finally {
      setReviewBusy((prev) => ({ ...prev, [box.id]: false }));
    }
  };

  // BO-3: regenerate failed/pending slot assets for an approved box. Idempotent
  // server-side — slots already generated are skipped; success flips delivered.
  const handleMaterialize = async (box: WagsBox) => {
    setReviewBusy((prev) => ({ ...prev, [box.id]: true }));
    setReviewMsg((prev) => ({ ...prev, [box.id]: "Generating slot assets…" }));
    try {
      const r = await authedFetch(`/api/admin/wags/boxes/${box.id}/materialize`, { method: "POST" });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Materialization failed.");
      setReviewMsg((prev) => ({
        ...prev,
        [box.id]: `Assets: ${data.generated} generated, ${data.failed} failed, ${data.skipped} skipped${data.delivered ? " — box delivered" : ""}`,
      }));
      if (data.delivered) {
        setBoxes((prev) => prev.map((b) => b.id === box.id ? { ...b, status: "delivered" } : b));
      }
    } catch (err: any) {
      setReviewMsg((prev) => ({ ...prev, [box.id]: err.message }));
    } finally {
      setReviewBusy((prev) => ({ ...prev, [box.id]: false }));
    }
  };

  const handleRePlan = async (box: WagsBox) => {
    setPlanBusy((prev) => ({ ...prev, [box.id]: true }));
    setReviewMsg((prev) => ({ ...prev, [box.id]: "Re-planning…" }));
    try {
      const r = await authedFetch(`/api/admin/wags/boxes/${box.subscription_id}/plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ box_month: box.box_month }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Planning failed.");
      setBoxes((prev) => prev.map((b) =>
        b.id === box.id ? { ...b, plan_json: data.plan, status: "pending_review" } : b
      ));
      setReviewMsg((prev) => ({ ...prev, [box.id]: "✓ Re-planned — review the new plan below" }));
    } catch (err: any) {
      setReviewMsg((prev) => ({ ...prev, [box.id]: err.message }));
    } finally {
      setPlanBusy((prev) => ({ ...prev, [box.id]: false }));
    }
  };

  const handleNewPlan = async () => {
    if (!planSubId) return;
    setPlanMsg("Planning…");
    try {
      const r = await authedFetch(`/api/admin/wags/boxes/${planSubId}/plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ box_month: planMonth }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Planning failed.");
      setPlanMsg(`✓ Box planned (id ${data.box_id}). Refresh to see it.`);
      fetchBoxes(statusFilter);
    } catch (err: any) {
      setPlanMsg(err.message);
    }
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const FILTERS: { id: StatusFilter; label: string }[] = [
    { id: "pending_review", label: "Pending" },
    { id: "approved",       label: "Approved" },
    { id: "rejected",       label: "Rejected" },
    { id: "delivered",      label: "Delivered" },
    { id: "all",            label: "All" },
  ];

  return (
    <div className="fixed inset-0 z-[90] bg-black/70 backdrop-blur-sm flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 bg-surface border-b border-outline-variant/40 px-6 py-4 shrink-0">
        <div className="flex items-center gap-3">
          <Gift size={22} className="text-primary" />
          <h1 className="text-xl font-black text-on-surface">Wardrobe Wags — Admin Review</h1>
          <span className="text-xs font-bold text-on-surface-variant">W2</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowPlanForm((v) => !v)}
            className="flex items-center gap-2 rounded-xl border border-primary/30 px-3 py-2 text-sm font-black text-primary hover:bg-primary/10"
          >
            <Sparkles size={15} /> Plan Box
          </button>
          <button
            type="button"
            onClick={() => fetchBoxes(statusFilter)}
            className="flex items-center gap-2 rounded-xl border border-outline-variant/50 px-3 py-2 text-sm font-black text-on-surface hover:bg-surface-container"
          >
            <RefreshCw size={15} /> Refresh
          </button>
          <button
            type="button"
            onClick={onClose}
            className="w-10 h-10 rounded-full border border-outline-variant flex items-center justify-center text-on-surface hover:bg-surface-container"
          >
            <X size={18} />
          </button>
        </div>
      </div>

      {/* Plan-box form (slide down) */}
      {showPlanForm && (
        <div className="bg-surface-container border-b border-outline-variant/40 px-6 py-4 flex flex-wrap items-end gap-4 shrink-0">
          <div>
            <label className="text-xs font-black text-on-surface block mb-1">Subscription ID</label>
            <input
              type="number"
              value={planSubId ?? ""}
              onChange={(e) => setPlanSubId(Number(e.target.value) || null)}
              placeholder="123"
              className="min-h-11 w-40 rounded-xl border border-outline-variant bg-surface px-3 text-sm"
            />
          </div>
          <div>
            <label className="text-xs font-black text-on-surface block mb-1">Box month</label>
            <input
              type="month"
              value={planMonth}
              onChange={(e) => setPlanMonth(e.target.value)}
              className="min-h-11 rounded-xl border border-outline-variant bg-surface px-3 text-sm"
            />
          </div>
          <button
            type="button"
            disabled={!planSubId}
            onClick={handleNewPlan}
            className="min-h-11 rounded-xl bg-primary text-on-primary px-4 font-black text-sm flex items-center gap-2 disabled:opacity-50"
          >
            <Sparkles size={15} /> Generate plan
          </button>
          {planMsg && <span className={`text-sm font-bold ${planMsg.startsWith("✓") ? "text-emerald-600" : "text-red-500"}`}>{planMsg}</span>}
        </div>
      )}

      {/* Filter tabs */}
      <div className="flex gap-1 px-6 py-3 bg-surface border-b border-outline-variant/40 shrink-0 overflow-x-auto">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setStatusFilter(f.id)}
            className={`shrink-0 rounded-lg px-4 py-1.5 text-sm font-black border transition-all ${
              statusFilter === f.id
                ? "bg-primary text-on-primary border-primary"
                : "border-outline-variant text-on-surface-variant hover:border-primary/40"
            }`}
          >
            {f.label}
          </button>
        ))}
        <div className="ml-auto text-xs font-bold text-on-surface-variant self-center">
          {boxes.length} box{boxes.length !== 1 ? "es" : ""}
        </div>
      </div>

      {/* Box list */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
        {loading && (
          <div className="flex items-center justify-center py-16 text-on-surface-variant">
            <RefreshCw className="animate-spin mr-2" size={20} />
            <span className="text-sm">Loading boxes…</span>
          </div>
        )}
        {!loading && error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-600 flex items-center gap-2">
            <AlertCircle size={16} /> {error}
          </div>
        )}
        {!loading && !error && boxes.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-on-surface-variant">
            <Package size={36} className="mb-3 opacity-30" />
            <p className="text-sm font-bold">No boxes found.</p>
          </div>
        )}

        {boxes.map((box) => {
          const isExpanded = expandedId === box.id;
          const statusCfg = STATUS_CONFIG[box.status] ?? { label: box.status, color: "text-on-surface-variant bg-surface-container border-outline-variant" };
          const plan = box.plan_json;

          return (
            <div key={box.id} className="glass-panel border border-outline-variant/40 rounded-2xl overflow-hidden">
              {/* Box header */}
              <div
                className="flex items-center gap-4 px-5 py-4 cursor-pointer hover:bg-surface-container/50 transition-colors"
                onClick={() => setExpandedId(isExpanded ? null : box.id)}
              >
                {/* Month + tier */}
                <div className="shrink-0">
                  <div className="text-lg font-black text-on-surface">{box.box_month}</div>
                  <div className="text-[11px] font-bold text-on-surface-variant capitalize">{box.tier} · {box.species}</div>
                </div>

                {/* Plan summary */}
                <div className="flex-1 min-w-0">
                  {plan ? (
                    <>
                      <p className="text-sm font-black text-on-surface truncate">{plan.theme}</p>
                      <p className="text-[11px] text-on-surface-variant truncate">{plan.season} · {plan.items.length} items</p>
                    </>
                  ) : (
                    <p className="text-sm text-on-surface-variant italic">Planning in progress…</p>
                  )}
                </div>

                {/* User phone (masked) */}
                <div className="hidden md:block text-xs font-mono text-on-surface-variant shrink-0">
                  …{box.user_phone.slice(-5)}
                </div>

                {/* Status badge */}
                <span className={`shrink-0 rounded-full border px-2.5 py-0.5 text-[11px] font-black ${statusCfg.color}`}>
                  {statusCfg.label}
                </span>

                {/* Expand chevron */}
                {isExpanded ? <ChevronUp size={16} className="text-on-surface-variant shrink-0" /> : <ChevronDown size={16} className="text-on-surface-variant shrink-0" />}
              </div>

              {/* Expanded content */}
              {isExpanded && (
                <div className="border-t border-outline-variant/40 px-5 py-4 space-y-5">
                  {/* Subscription metadata */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                    {[
                      { label: "Sub ID", value: box.subscription_id },
                      { label: "Box ID", value: box.id },
                      { label: "Billing", value: `${box.billing_period}` },
                      { label: "Period", value: `${box.current_period_start} → ${box.current_period_end}` },
                    ].map(({ label, value }) => (
                      <div key={label} className="rounded-xl bg-surface-container px-3 py-2">
                        <div className="font-black text-on-surface-variant mb-0.5">{label}</div>
                        <div className="font-bold text-on-surface">{String(value)}</div>
                      </div>
                    ))}
                  </div>

                  {/* Plan details */}
                  {plan ? (
                    <div>
                      <div className="flex items-baseline gap-2 mb-3">
                        <h3 className="text-base font-black text-on-surface">{plan.theme}</h3>
                        <span className="text-xs text-on-surface-variant capitalize">{plan.season}</span>
                      </div>
                      <p className="text-xs text-on-surface-variant mb-4 italic">{plan.theme_rationale}</p>

                      {/* Items grid */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                        {plan.items.map((item) => {
                          const SlotIcon = SLOT_ICONS[item.slot] ?? Package;
                          return (
                            <div key={item.slot} className="rounded-xl border border-outline-variant bg-surface-container p-3">
                              <div className="flex items-center gap-2 mb-1.5">
                                <SlotIcon size={14} className="text-primary shrink-0" />
                                <span className="text-[11px] font-black uppercase tracking-wide text-on-surface-variant">{item.slot}</span>
                              </div>
                              <p className="text-sm font-black text-on-surface">{item.title}</p>
                              <p className="text-[11px] text-on-surface-variant mt-1 leading-snug">{item.description}</p>
                              {item.colors.length > 0 && (
                                <div className="mt-2 flex flex-wrap gap-1">
                                  {item.colors.map((c) => (
                                    <span key={c} className="rounded-full border border-outline-variant px-1.5 py-0.5 text-[10px] text-on-surface-variant">{c}</span>
                                  ))}
                                </div>
                              )}
                              {item.size_note && (
                                <p className="mt-1 text-[10px] text-primary font-bold">{item.size_note}</p>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 flex items-center gap-2">
                      <Clock size={16} className="text-amber-500 shrink-0" />
                      <p className="text-sm text-amber-700 font-bold">Plan not yet generated. Use "Re-plan" to generate it now.</p>
                    </div>
                  )}

                  {/* Admin notes + actions */}
                  {["pending_review", "approved", "rejected"].includes(box.status) && (
                    <div className="space-y-3">
                      <label className="text-xs font-black text-on-surface block">Admin notes</label>
                      <textarea
                        value={reviewNotes[box.id] ?? box.admin_notes ?? ""}
                        onChange={(e) => setReviewNotes((prev) => ({ ...prev, [box.id]: e.target.value }))}
                        rows={2}
                        placeholder="Optional notes for the record…"
                        className="w-full rounded-xl border border-outline-variant bg-surface-container px-3 py-2 text-sm resize-none"
                      />
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          disabled={reviewBusy[box.id]}
                          onClick={() => handleReview(box, "approve")}
                          className="flex items-center gap-2 rounded-xl bg-emerald-600 text-white px-4 py-2 text-sm font-black disabled:opacity-50 hover:bg-emerald-700"
                        >
                          {reviewBusy[box.id] ? <RefreshCw size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                          Approve
                        </button>
                        <button
                          type="button"
                          disabled={reviewBusy[box.id]}
                          onClick={() => handleReview(box, "reject")}
                          className="flex items-center gap-2 rounded-xl bg-red-600 text-white px-4 py-2 text-sm font-black disabled:opacity-50 hover:bg-red-700"
                        >
                          {reviewBusy[box.id] ? <RefreshCw size={14} className="animate-spin" /> : <XCircle size={14} />}
                          Reject
                        </button>
                        {box.status === "approved" && (
                          <button
                            type="button"
                            disabled={reviewBusy[box.id]}
                            onClick={() => handleMaterialize(box)}
                            className="flex items-center gap-2 rounded-xl border border-emerald-600/40 px-4 py-2 text-sm font-black text-emerald-700 disabled:opacity-50 hover:bg-emerald-50"
                          >
                            {reviewBusy[box.id] ? <RefreshCw size={14} className="animate-spin" /> : <Sparkles size={14} />}
                            Generate assets
                          </button>
                        )}
                        <button
                          type="button"
                          disabled={planBusy[box.id]}
                          onClick={() => handleRePlan(box)}
                          className="flex items-center gap-2 rounded-xl border border-primary/30 px-4 py-2 text-sm font-black text-primary disabled:opacity-50 hover:bg-primary/10"
                        >
                          {planBusy[box.id] ? <RefreshCw size={14} className="animate-spin" /> : <Sparkles size={14} />}
                          Re-plan
                        </button>
                        {reviewMsg[box.id] && (
                          <span className={`text-sm font-bold ${reviewMsg[box.id].startsWith("✓") ? "text-emerald-600" : "text-red-500"}`}>
                            {reviewMsg[box.id]}
                          </span>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Already reviewed / delivered */}
                  {box.reviewed_by && (
                    <p className="text-[11px] text-on-surface-variant">
                      Reviewed by {box.reviewed_by} on {new Date(box.reviewed_at!).toLocaleDateString()}
                      {box.admin_notes ? ` — "${box.admin_notes}"` : ""}
                    </p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
