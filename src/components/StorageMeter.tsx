import React, { useState, useEffect, useRef } from "react";
import { HardDrive, Zap, X } from "lucide-react";
import { authedFetch } from "../api";

interface StorageData {
  bytesHot: number;
  bytesCold: number;
  freeLimit: number;
  coldGbPurchased: number;
  coldLimit: number;
}

export async function fetchStorageUsage(): Promise<StorageData | null> {
  try {
    const res = await authedFetch("/api/storage/usage");
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function purchaseStorageGb(requestId: string): Promise<{ success: boolean; error?: string; usage?: StorageData }> {
  try {
    const res = await authedFetch("/api/storage/purchase-gb", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestId }),
    });
    const data = await res.json();
    return { success: data.success, error: data.error, usage: data.usage };
  } catch {
    return { success: false, error: "Network error" };
  }
}

function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

interface StorageMeterProps {
  compact?: boolean;
  /**
   * "health" renders a single-line status pill with a thin bar and an
   * "Add more" CTA — sized to sit inside a page header rather than occupy a
   * full-width panel. FurBin used the full panel, which pushed the actual
   * library content below the fold on a phone.
   */
  variant?: "panel" | "health";
  onRefresh?: () => void;
}

export default function StorageMeter({ compact, variant = "panel", onRefresh }: StorageMeterProps) {
  const [usage, setUsage] = useState<StorageData | null>(null);
  const [purchasing, setPurchasing] = useState(false);
  const [purchaseOpen, setPurchaseOpen] = useState(false);
  const [purchaseError, setPurchaseError] = useState("");
  const [purchaseSuccess, setPurchaseSuccess] = useState("");
  const purchaseRequestIdRef = useRef<string | null>(null);

  useEffect(() => {
    fetchStorageUsage().then(setUsage);
  }, []);

  if (!usage) return null;

  const hotPct = Math.min(100, Math.round((usage.bytesHot / usage.freeLimit) * 100));
  const coldPct = usage.coldLimit > 0 ? Math.min(100, Math.round((usage.bytesCold / usage.coldLimit) * 100)) : 0;
  const isHotFull = usage.bytesHot >= usage.freeLimit;
  const needsPurchase = isHotFull && usage.coldGbPurchased === 0;
  const handlePurchase = async () => {
    if (purchasing) return;
    purchaseRequestIdRef.current ??= `storage_${crypto.randomUUID()}`;
    setPurchasing(true);
    setPurchaseError("");
    const result = await purchaseStorageGb(purchaseRequestIdRef.current);
    if (result.success) {
      const fresh = result.usage || await fetchStorageUsage();
      if (fresh) setUsage(fresh);
      setPurchaseSuccess("1 GB of cold storage was added.");
      purchaseRequestIdRef.current = null;
      onRefresh?.();
    } else {
      setPurchaseError(result.error || "Purchase failed.");
    }
    setPurchasing(false);
  };

  const openPurchase = () => {
    setPurchaseError("");
    setPurchaseSuccess("");
    setPurchaseOpen(true);
  };

  const closePurchase = () => {
    if (purchasing) return;
    setPurchaseOpen(false);
    purchaseRequestIdRef.current = null;
  };

  const purchaseDialog = purchaseOpen ? (
    <div className="fixed inset-0 z-[120] grid place-items-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label="Purchase FurBin storage">
      <div className="w-full max-w-md rounded-3xl border border-white/30 bg-surface/95 p-6 shadow-2xl backdrop-blur-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-black text-on-surface">Purchase 1 GB</h2>
            <p className="mt-1 text-sm text-on-surface-variant">Add durable cold storage to your FurBin.</p>
          </div>
          <button type="button" onClick={closePurchase} disabled={purchasing} aria-label="Close storage purchase" className="grid h-9 w-9 place-items-center rounded-full border border-outline-variant/40"><X size={16} /></button>
        </div>
        <div className="mt-5 rounded-2xl bg-surface-container p-4 text-sm">
          <div className="flex justify-between"><span>Capacity</span><strong>+1 GB</strong></div>
          <div className="mt-2 flex justify-between"><span>Price</span><strong>4 PupCoins</strong></div>
          <div className="mt-2 flex justify-between"><span>After purchase</span><strong>{usage.coldGbPurchased + 1} GB cold storage</strong></div>
        </div>
        {purchaseError && <p className="mt-4 rounded-xl bg-error/10 p-3 text-sm font-bold text-error" role="alert">{purchaseError}</p>}
        {purchaseSuccess && <p className="mt-4 rounded-xl bg-emerald-600/10 p-3 text-sm font-bold text-emerald-700" role="status">{purchaseSuccess}</p>}
        <button type="button" onClick={handlePurchase} disabled={purchasing || !!purchaseSuccess} className="mt-5 w-full rounded-xl bg-primary px-4 py-3 text-sm font-black text-on-primary disabled:opacity-50">
          {purchasing ? "Purchasing…" : purchaseSuccess ? "Storage added" : "Confirm with 4 PupCoins"}
        </button>
      </div>
    </div>
  ) : null;

  if (compact) {
    return (<>
      <div className="text-xs text-on-surface-variant space-y-1">
        <div className="flex items-center justify-between">
          <span>Hot storage</span>
          <span className="font-mono">{fmtBytes(usage.bytesHot)} / {fmtBytes(usage.freeLimit)}</span>
        </div>
        <div className="h-1.5 w-full bg-surface-container rounded-full overflow-hidden">
          <div className={`h-full rounded-full transition-all ${hotPct > 90 ? "bg-error" : "bg-primary"}`} style={{ width: `${hotPct}%` }} />
        </div>
        {usage.coldGbPurchased > 0 && (
          <>
            <div className="flex items-center justify-between mt-1">
              <span>Cold storage</span>
              <span className="font-mono">{fmtBytes(usage.bytesCold)} / {fmtBytes(usage.coldLimit)}</span>
            </div>
            <div className="h-1.5 w-full bg-surface-container rounded-full overflow-hidden">
              <div className="h-full rounded-full bg-secondary transition-all" style={{ width: `${coldPct}%` }} />
            </div>
          </>
        )}
        {needsPurchase && (
          <button
            onClick={openPurchase}
            disabled={purchasing}
            className="mt-1 w-full py-1.5 bg-primary/10 text-primary border border-primary/20 rounded-lg text-[10px] font-black uppercase tracking-wide hover:bg-primary/20 active:scale-95 transition-all cursor-pointer disabled:opacity-40"
          >
            Add 1 GB (4 PupCoins)
          </button>
        )}
      </div>
      {purchaseDialog}
    </>);
  }

  if (variant === "health") {
    // Colour is the signal here: green under 75%, amber approaching the cap,
    // red at the cap. The number is secondary to "am I fine or not".
    const tone =
      hotPct >= 100 ? "error" : hotPct >= 75 ? "amber" : "ok";
    const barClass =
      tone === "error" ? "bg-error" : tone === "amber" ? "bg-amber-500" : "bg-emerald-500";
    const textClass =
      tone === "error" ? "text-error" : tone === "amber" ? "text-amber-600" : "text-emerald-600";

    return (<>
      <div className="flex w-full items-center gap-3 rounded-2xl border border-outline-variant/40 bg-surface-container-lowest/70 px-3.5 py-2.5 sm:w-auto sm:min-w-[15rem]">
        <HardDrive size={16} className={`shrink-0 ${textClass}`} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[10px] font-black uppercase tracking-[.14em] text-on-surface-variant">
              Storage
            </span>
            <span className={`font-mono text-[11px] font-bold ${textClass}`}>{hotPct}%</span>
          </div>
          <div
            className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-surface-container"
            role="progressbar"
            aria-valuenow={hotPct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="FurBin storage used"
          >
            <div className={`h-full rounded-full transition-all ${barClass}`} style={{ width: `${hotPct}%` }} />
          </div>
          <div className="mt-1 truncate text-[10px] text-on-surface-variant">
            {fmtBytes(usage.bytesHot)} of {fmtBytes(usage.freeLimit)}
            {usage.coldGbPurchased > 0 ? ` · +${fmtBytes(usage.coldLimit)} cold` : ""}
          </div>
        </div>
        <button
          type="button"
          onClick={openPurchase}
          disabled={purchasing}
          className="shrink-0 rounded-full bg-primary px-3 py-1.5 text-[11px] font-black text-on-primary transition hover:opacity-90 active:scale-95 disabled:opacity-40"
        >
          {purchasing ? "…" : "Add more"}
        </button>
      </div>
      {purchaseDialog}
    </>);
  }

  return (<>
    <div className="glass-panel border border-outline-variant/40 rounded-3xl p-6 mb-6">
      <div className="flex items-center gap-2 mb-4">
        <HardDrive size={16} className="text-primary" />
        <h3 className="text-sm font-extrabold text-on-surface uppercase tracking-wide">Storage</h3>
      </div>
      <div className="space-y-3">
        <div>
          <div className="flex items-center justify-between text-xs text-on-surface-variant mb-1">
            <span>Hot (pawsome3d.com)</span>
            <span className="font-mono font-bold">{fmtBytes(usage.bytesHot)} / {fmtBytes(usage.freeLimit)}</span>
          </div>
          <div className="h-2 w-full bg-surface-container rounded-full overflow-hidden">
            <div className={`h-full rounded-full transition-all ${hotPct > 90 ? "bg-error" : "bg-primary"}`} style={{ width: `${hotPct}%` }} />
          </div>
        </div>
        {usage.coldGbPurchased > 0 && (
          <div>
            <div className="flex items-center justify-between text-xs text-on-surface-variant mb-1">
              <span>Cold (mypets.cc)</span>
              <span className="font-mono font-bold">{fmtBytes(usage.bytesCold)} / {fmtBytes(usage.coldLimit)}</span>
            </div>
            <div className="h-2 w-full bg-surface-container rounded-full overflow-hidden">
              <div className="h-full rounded-full bg-secondary transition-all" style={{ width: `${coldPct}%` }} />
            </div>
          </div>
        )}
        {isHotFull && (
          <p className="text-xs text-error font-medium">
            Hot storage is full. Free up space or add cold storage.
          </p>
        )}
        <button
          onClick={openPurchase}
          disabled={purchasing}
          className="w-full py-2.5 bg-primary text-on-primary rounded-xl text-xs font-black uppercase tracking-wide hover:opacity-90 active:scale-95 transition-all cursor-pointer disabled:opacity-40 flex items-center justify-center gap-1.5"
        >
          {purchasing ? (
            "Purchasing..."
          ) : (
            <>
              <Zap size={14} className="fill-on-primary" /> Add 1 GB Cold Storage (4 PupCoins)
            </>
          )}
        </button>
      </div>
    </div>
    {purchaseDialog}
  </>);
}
