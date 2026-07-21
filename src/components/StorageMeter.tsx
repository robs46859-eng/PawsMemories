import React, { useState, useEffect } from "react";
import { HardDrive, Zap } from "lucide-react";
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

export async function purchaseStorageGb(requestId: string): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await authedFetch("/api/storage/purchase-gb", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestId }),
    });
    const data = await res.json();
    return { success: data.success, error: data.error };
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

  useEffect(() => {
    fetchStorageUsage().then(setUsage);
  }, []);

  if (!usage) return null;

  const hotPct = Math.min(100, Math.round((usage.bytesHot / usage.freeLimit) * 100));
  const coldPct = usage.coldLimit > 0 ? Math.min(100, Math.round((usage.bytesCold / usage.coldLimit) * 100)) : 0;
  const isHotFull = usage.bytesHot >= usage.freeLimit;
  const needsPurchase = isHotFull && usage.coldGbPurchased === 0;
  const requestId = `purchase_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const handlePurchase = async () => {
    setPurchasing(true);
    const result = await purchaseStorageGb(requestId);
    if (result.success) {
      const fresh = await fetchStorageUsage();
      if (fresh) setUsage(fresh);
      onRefresh?.();
    } else {
      alert(result.error || "Purchase failed.");
    }
    setPurchasing(false);
  };

  if (compact) {
    return (
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
            onClick={handlePurchase}
            disabled={purchasing}
            className="mt-1 w-full py-1.5 bg-primary/10 text-primary border border-primary/20 rounded-lg text-[10px] font-black uppercase tracking-wide hover:bg-primary/20 active:scale-95 transition-all cursor-pointer disabled:opacity-40"
          >
            {purchasing ? "Purchasing..." : "Add 1 GB (4 cr)"}
          </button>
        )}
      </div>
    );
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

    return (
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
          onClick={handlePurchase}
          disabled={purchasing}
          className="shrink-0 rounded-full bg-primary px-3 py-1.5 text-[11px] font-black text-on-primary transition hover:opacity-90 active:scale-95 disabled:opacity-40"
        >
          {purchasing ? "…" : "Add more"}
        </button>
      </div>
    );
  }

  return (
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
          onClick={handlePurchase}
          disabled={purchasing}
          className="w-full py-2.5 bg-primary text-on-primary rounded-xl text-xs font-black uppercase tracking-wide hover:opacity-90 active:scale-95 transition-all cursor-pointer disabled:opacity-40 flex items-center justify-center gap-1.5"
        >
          {purchasing ? (
            "Purchasing..."
          ) : (
            <>
              <Zap size={14} className="fill-on-primary" /> Add 1 GB Cold Storage (4 cr)
            </>
          )}
        </button>
      </div>
    </div>
  );
}