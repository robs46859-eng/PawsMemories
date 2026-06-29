import React, { useState, useEffect } from "react";
import {
  X, RefreshCw, AlertCircle, CheckCircle2, XCircle, Clock,
  ImageIcon, Video, User, MessageSquare, Eye, ChevronDown,
  ChevronUp, Search, Filter, Sparkles
} from "lucide-react";
import { PhotoRequest, RequestType, Creation } from "../types";
import { fetchAdminRequests, fulfillRequest, rejectRequest, fetchCreations } from "../api";

interface AdminRequestPanelProps {
  onClose: () => void;
  onGenerateForRequest?: (photoUrl: string | null, comment: string) => void;
}

const TYPE_LABELS: Record<RequestType, string> = {
  photo_standard: "Standard Photo",
  photo_premium:  "Premium Photo",
  video_standard: "Standard Video",
  video_premium:  "Premium Video",
};

const TYPE_ICONS: Record<RequestType, React.ReactNode> = {
  photo_standard: <ImageIcon size={12} />,
  photo_premium:  <ImageIcon size={12} />,
  video_standard: <Video size={12} />,
  video_premium:  <Video size={12} />,
};

const STATUS_CONFIG: Record<
  string,
  { label: string; icon: React.ReactNode; color: string; bg: string; border: string }
> = {
  pending:   { label: "Pending",    icon: <Clock size={12} />,         color: "text-amber-700",   bg: "bg-amber-50",   border: "border-amber-200" },
  fulfilled: { label: "Fulfilled",  icon: <CheckCircle2 size={12} />,  color: "text-emerald-700", bg: "bg-emerald-50", border: "border-emerald-200" },
  rejected:  { label: "Rejected",   icon: <XCircle size={12} />,       color: "text-red-700",     bg: "bg-red-50",     border: "border-red-200" },
};

export default function AdminRequestPanel({ onClose, onGenerateForRequest }: AdminRequestPanelProps) {
  const [requests, setRequests] = useState<PhotoRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeFilter, setActiveFilter] = useState<"all" | "pending" | "fulfilled" | "rejected">("pending");
  const [selectedRequest, setSelectedRequest] = useState<PhotoRequest | null>(null);
  const [creations, setCreations] = useState<Creation[]>([]);
  const [selectedCreationId, setSelectedCreationId] = useState<number | null>(null);
  const [fulfillLoading, setFulfillLoading] = useState(false);
  const [rejectLoading, setRejectLoading] = useState(false);
  const [adminNotes, setAdminNotes] = useState("");
  const [showRejectForm, setShowRejectForm] = useState(false);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [expandedRequest, setExpandedRequest] = useState<number | null>(null);
  const [creationsLoading, setCreationsLoading] = useState(false);

  useEffect(() => {
    loadRequests();
  }, []);

  async function loadRequests() {
    setLoading(true);
    const reqs = await fetchAdminRequests();
    setRequests(reqs);
    setLoading(false);
  }

  async function loadCreations() {
    setCreationsLoading(true);
    const c = await fetchCreations();
    setCreations(c);
    setCreationsLoading(false);
  }

  function openDetail(req: PhotoRequest) {
    setSelectedRequest(req);
    setSelectedCreationId(null);
    setAdminNotes("");
    setShowRejectForm(false);
    setError("");
    setSuccessMsg("");
    loadCreations();
  }

  async function handleFulfill() {
    if (!selectedRequest || !selectedCreationId) {
      setError("Please select a creation to link to this request.");
      return;
    }
    setFulfillLoading(true);
    setError("");
    try {
      await fulfillRequest(selectedRequest.id, selectedCreationId);
      setSuccessMsg("✅ Request fulfilled! The creation has been sent to the user's gallery and they've been notified by SMS.");
      await loadRequests();
      setSelectedRequest(null);
    } catch (err: any) {
      setError(err.message || "Failed to fulfill request.");
    } finally {
      setFulfillLoading(false);
    }
  }

  async function handleReject() {
    if (!selectedRequest) return;
    setRejectLoading(true);
    setError("");
    try {
      await rejectRequest(selectedRequest.id, adminNotes || undefined);
      setSuccessMsg("Request rejected and user notified. Stripe refund initiated.");
      await loadRequests();
      setSelectedRequest(null);
    } catch (err: any) {
      setError(err.message || "Failed to reject request.");
    } finally {
      setRejectLoading(false);
    }
  }

  const filtered = requests.filter((r) => activeFilter === "all" || r.status === activeFilter);
  const pendingCount = requests.filter((r) => r.status === "pending").length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
      <div className="bg-white dark:bg-slate-900 rounded-3xl w-full max-w-2xl shadow-2xl border border-outline-variant/30 flex flex-col text-on-surface max-h-[92vh] overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-outline-variant/20 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-secondary/10 rounded-xl flex items-center justify-center">
              <Sparkles size={18} className="text-secondary" />
            </div>
            <div>
              <h2 className="text-sm font-black uppercase tracking-wider text-on-surface">Review Requests</h2>
              <p className="text-[10px] text-on-surface-variant font-medium">
                {pendingCount} pending · {requests.length} total
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full hover:bg-outline-variant/20 text-on-surface-variant hover:text-on-surface flex items-center justify-center transition-colors cursor-pointer"
          >
            <X size={16} />
          </button>
        </div>

        {/* Filter tabs */}
        <div className="flex gap-1 px-6 py-3 border-b border-outline-variant/10 flex-shrink-0 overflow-x-auto">
          {(["pending","all","fulfilled","rejected"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setActiveFilter(f)}
              className={`flex-shrink-0 px-3 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-wide transition-all cursor-pointer ${
                activeFilter === f
                  ? "bg-primary text-white"
                  : "bg-surface-container text-on-surface-variant hover:bg-outline-variant/20"
              }`}
            >
              {f === "pending" && pendingCount > 0 ? `Pending (${pendingCount})` : f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
          <button
            onClick={loadRequests}
            className="ml-auto flex items-center gap-1 text-[10px] text-primary hover:underline cursor-pointer flex-shrink-0"
          >
            <RefreshCw size={10} /> Refresh
          </button>
        </div>

        {successMsg && (
          <div className="mx-6 mt-3 p-3 bg-emerald-50 text-emerald-800 border border-emerald-200 rounded-xl text-xs font-medium flex-shrink-0">
            {successMsg}
          </div>
        )}

        {/* List / Detail split */}
        <div className="flex flex-1 min-h-0 overflow-hidden">

          {/* Request list */}
          <div className={`flex-1 overflow-y-auto p-4 space-y-2 ${selectedRequest ? "hidden md:block md:w-64 md:flex-none border-r border-outline-variant/20" : ""}`}>
            {loading ? (
              <div className="space-y-3">
                {[1,2,3].map(i => <div key={i} className="h-20 rounded-2xl bg-surface-container animate-pulse" />)}
              </div>
            ) : filtered.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-sm text-on-surface-variant font-medium">No {activeFilter !== "all" ? activeFilter : ""} requests.</p>
              </div>
            ) : (
              filtered.map((req) => {
                const cfg = STATUS_CONFIG[req.status];
                const isSelected = selectedRequest?.id === req.id;
                return (
                  <button
                    key={req.id}
                    onClick={() => openDetail(req)}
                    className={`w-full text-left rounded-2xl p-3.5 border transition-all cursor-pointer ${
                      isSelected
                        ? "border-primary bg-primary/5 shadow-sm"
                        : "border-outline-variant/30 bg-surface-container hover:border-primary/30 hover:bg-primary/3"
                    }`}
                  >
                    <div className="flex items-start gap-2.5">
                      {req.photo_url && (
                        <img
                          src={req.photo_url}
                          alt="Pet photo"
                          className="w-12 h-12 rounded-xl object-cover flex-shrink-0 border border-outline-variant/20"
                        />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-1 mb-1">
                          <span className="inline-flex items-center gap-1 text-[9px] font-bold uppercase text-primary bg-primary/10 px-1.5 py-0.5 rounded-full">
                            {TYPE_ICONS[req.request_type]} {TYPE_LABELS[req.request_type]}
                          </span>
                          <span className={`inline-flex items-center gap-1 text-[9px] font-bold border rounded-full px-1.5 py-0.5 ${cfg.bg} ${cfg.color} ${cfg.border}`}>
                            {cfg.icon} {cfg.label}
                          </span>
                        </div>
                        <p className="text-[11px] text-on-surface font-medium leading-snug line-clamp-2">{req.comment}</p>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-[9px] text-outline font-mono">{new Date(req.created_at).toLocaleDateString()}</span>
                          {req.user_full_name && (
                            <span className="text-[9px] text-on-surface-variant font-medium flex items-center gap-0.5">
                              <User size={8} /> {req.user_full_name}
                            </span>
                          )}
                          {req.amount_paid && (
                            <span className="text-[9px] text-primary font-mono">${Number(req.amount_paid).toFixed(2)}</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>

          {/* Detail panel */}
          {selectedRequest && (
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setSelectedRequest(null)}
                  className="text-[10px] text-on-surface-variant hover:text-on-surface underline cursor-pointer md:hidden"
                >
                  ← Back to list
                </button>
                <span className={`inline-flex items-center gap-1 text-[10px] font-bold border rounded-full px-2 py-0.5 ${STATUS_CONFIG[selectedRequest.status].bg} ${STATUS_CONFIG[selectedRequest.status].color} ${STATUS_CONFIG[selectedRequest.status].border}`}>
                  {STATUS_CONFIG[selectedRequest.status].icon} {STATUS_CONFIG[selectedRequest.status].label}
                </span>
              </div>

              {/* User info */}
              <div className="bg-surface-container rounded-2xl p-4 border border-outline-variant/20 space-y-1.5">
                <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Customer</p>
                {selectedRequest.user_full_name && (
                  <p className="text-sm font-bold text-on-surface">{selectedRequest.user_full_name}</p>
                )}
                {selectedRequest.user_email && (
                  <p className="text-xs text-on-surface-variant">{selectedRequest.user_email}</p>
                )}
                <p className="text-xs text-on-surface-variant flex items-center gap-1">
                  <span className="font-bold">{TYPE_LABELS[selectedRequest.request_type]}</span>
                  <span>·</span>
                  <span className="font-mono text-primary">${selectedRequest.amount_paid ? Number(selectedRequest.amount_paid).toFixed(2) : "—"}</span>
                  <span>·</span>
                  <span>{selectedRequest.paid ? "✅ Paid" : "⚠️ Unpaid"}</span>
                </p>
              </div>

              {/* Pet photo */}
              {selectedRequest.photo_url && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant mb-2">Pet Photo</p>
                  <img
                    src={selectedRequest.photo_url}
                    alt="Customer's pet"
                    className="w-full max-h-64 object-contain rounded-2xl border border-outline-variant/20 shadow-sm"
                  />
                </div>
              )}

              {/* Comment */}
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant mb-1.5">Customer's Request</p>
                <div className="bg-surface-container rounded-2xl p-4 border border-outline-variant/20">
                  <p className="text-sm text-on-surface leading-relaxed font-medium italic">"{selectedRequest.comment}"</p>
                </div>
              </div>

              {/* Action area (only for pending) */}
              {selectedRequest.status === "pending" && (
                <div className="space-y-4 pt-2 border-t border-outline-variant/20">
                  
                  {/* Generate button */}
                  {onGenerateForRequest && (
                    <button
                      onClick={() => {
                        onClose();
                        onGenerateForRequest(selectedRequest.photo_url, selectedRequest.comment);
                      }}
                      className="w-full py-3 bg-secondary text-white rounded-2xl font-bold text-sm shadow-md hover:bg-secondary/95 active:scale-[0.98] transition-all flex items-center justify-center gap-2 cursor-pointer"
                    >
                      <Sparkles size={15} />
                      Open Generator with This Request
                    </button>
                  )}

                  {/* Link existing creation */}
                  <div className="space-y-2">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Or Link an Existing Creation</p>
                    {creationsLoading ? (
                      <div className="h-10 bg-surface-container rounded-xl animate-pulse" />
                    ) : (
                      <select
                        value={selectedCreationId ?? ""}
                        onChange={(e) => setSelectedCreationId(e.target.value ? Number(e.target.value) : null)}
                        className="w-full bg-white border border-outline-variant rounded-xl py-2.5 px-3 text-xs text-slate-800 font-medium focus:outline-none focus:border-primary"
                      >
                        <option value="">— Select a creation you generated —</option>
                        {creations.map((c) => (
                          <option key={c.id} value={c.id}>
                            #{c.id} · {c.style} · {c.place_label || c.preset_name || "No backdrop"} · {c.media_type === "video" ? "🎬 Video" : "🖼️ Photo"}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>

                  {error && (
                    <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-xl text-xs flex gap-2">
                      <AlertCircle size={13} className="flex-shrink-0 mt-0.5" /> {error}
                    </div>
                  )}

                  <button
                    onClick={handleFulfill}
                    disabled={fulfillLoading || !selectedCreationId}
                    className="w-full py-3 bg-primary text-white rounded-2xl font-bold text-sm shadow-md hover:bg-primary/95 active:scale-[0.98] transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                  >
                    {fulfillLoading ? <><RefreshCw size={14} className="animate-spin" /> Fulfilling…</> : <>✅ Fulfill & Notify User</>}
                  </button>

                  {/* Reject section */}
                  {!showRejectForm ? (
                    <button
                      onClick={() => setShowRejectForm(true)}
                      className="w-full py-2.5 border border-red-300 text-red-600 rounded-2xl font-bold text-xs hover:bg-red-50 transition-all cursor-pointer"
                    >
                      ✕ Reject & Refund
                    </button>
                  ) : (
                    <div className="space-y-2 border border-red-200 rounded-2xl p-4 bg-red-50">
                      <p className="text-[10px] font-bold text-red-700 uppercase tracking-wide">Add a note for the customer (optional)</p>
                      <textarea
                        value={adminNotes}
                        onChange={(e) => setAdminNotes(e.target.value)}
                        rows={3}
                        placeholder="e.g. The image quality was too low to process. Please resubmit with a clearer photo."
                        className="w-full bg-white border border-red-200 rounded-xl py-2 px-3 text-xs text-slate-800 focus:outline-none focus:border-red-400 resize-none"
                      />
                      <div className="flex gap-2">
                        <button onClick={() => setShowRejectForm(false)} className="flex-1 py-2 border border-outline-variant rounded-xl text-xs font-bold cursor-pointer hover:bg-surface-container transition-all">
                          Cancel
                        </button>
                        <button
                          onClick={handleReject}
                          disabled={rejectLoading}
                          className="flex-1 py-2 bg-red-600 text-white rounded-xl text-xs font-bold cursor-pointer hover:bg-red-700 transition-all disabled:opacity-50"
                        >
                          {rejectLoading ? <RefreshCw size={12} className="animate-spin mx-auto" /> : "Confirm Reject & Refund"}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Fulfilled result */}
              {selectedRequest.status === "fulfilled" && selectedRequest.result_url && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant mb-2">Delivered Creation</p>
                  {selectedRequest.result_url.endsWith(".mp4") || selectedRequest.result_url.includes("video") ? (
                    <video src={selectedRequest.result_url} autoPlay loop muted playsInline className="w-full rounded-2xl aspect-square object-cover border border-outline-variant/20" />
                  ) : (
                    <img src={selectedRequest.result_url} alt="Fulfilled creation" className="w-full rounded-2xl aspect-square object-cover border border-outline-variant/20" />
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
