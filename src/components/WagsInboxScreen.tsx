import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Gift, Sparkles, Shirt, Zap, Star, PawPrint, Package, Clock, ChevronDown } from "lucide-react";
import { authedFetch } from "../api";
import { FULL_WARDROBE_CATALOG } from "../wardrobe/catalog";

/**
 * Wardrobe Wags Inbox — where a subscriber receives their monthly box (W3).
 *
 * Boxes arrive "wrapped": a delivered-but-unopened box renders as a gift card
 * with a single Open action. Opening records opened_at server-side (the reveal
 * plays once, ever) and staggers the item cards in. Boxes still in curation
 * render as teasers with no contents.
 */

interface WagsBoxItem {
  slot: string;
  wardrobe_item_id: string | null;
  entitlement_type: string | null;
  credit_amount: number | null;
  title: string | null;
  description: string | null;
  personalization_note: string | null;
  asset_url?: string | null;
  asset_status?: string | null;
}

interface WagsBox {
  id: number;
  box_month: string;
  status: "delivered" | "curating";
  delivered_at: string | null;
  opened_at: string | null;
  tier: string;
  species: string;
  items: WagsBoxItem[];
}

const SLOT_ICONS: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  accessory: Shirt, accessory_2: Shirt, accessory_3: Shirt,
  seasonal: Star, minimodel: Package, pawprint: PawPrint,
  sticker_1: Sparkles, sticker_2: Sparkles, sticker_3: Sparkles, sticker_4: Sparkles, sticker_5: Sparkles,
  credit_pack: Zap, video_gen: Sparkles, restyle: Sparkles, calendar: Clock,
};

function monthLabel(boxMonth: string): string {
  const [y, m] = boxMonth.split("-").map(Number);
  if (!y || !m) return boxMonth;
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

function wardrobeColor(itemId: string | null): string | null {
  if (!itemId) return null;
  return FULL_WARDROBE_CATALOG.find((w) => w.id === itemId)?.color ?? null;
}

function ItemCard({ item, index, revealed }: { item: WagsBoxItem; index: number; revealed: boolean }) {
  const Icon = SLOT_ICONS[item.slot] ?? Package;
  const swatch = wardrobeColor(item.wardrobe_item_id);
  return (
    <div
      className="rounded-2xl border border-outline-variant/50 bg-surface-container p-4 transition-all duration-500"
      style={{
        opacity: revealed ? 1 : 0,
        transform: revealed ? "translateY(0) scale(1)" : "translateY(14px) scale(0.96)",
        transitionDelay: `${index * 110}ms`,
      }}
    >
      <div className="flex items-center gap-2 mb-2">
        {swatch ? (
          <span className="h-4 w-4 rounded-full border border-black/10 shrink-0" style={{ backgroundColor: swatch }} />
        ) : (
          <Icon size={15} className="text-primary shrink-0" />
        )}
        <span className="text-[10px] font-black uppercase tracking-[.14em] text-on-surface-variant">
          {item.slot.replace(/_/g, " ")}
        </span>
        {item.entitlement_type === "wardrobe_item" && (
          <span className="ml-auto rounded-full bg-primary/10 px-2 py-0.5 text-[9px] font-black uppercase text-primary">Unlocked</span>
        )}
        {item.entitlement_type === "credits" && item.credit_amount ? (
          <span className="ml-auto rounded-full bg-primary/10 px-2 py-0.5 text-[9px] font-black uppercase text-primary">+{item.credit_amount} credits</span>
        ) : null}
      </div>
      {/* BO-3: generated slot assets render as the real deliverable —
          stickers/seasonal/pawprint art with a download affordance. */}
      {item.asset_url && item.asset_status === "generated" && (
        <a href={item.asset_url} target="_blank" rel="noreferrer" download
          className="mb-2 block overflow-hidden rounded-xl border border-outline-variant/40 bg-[repeating-conic-gradient(#e8e8e8_0%_25%,#f7f7f7_0%_50%)] bg-[length:16px_16px]">
          <img src={item.asset_url} alt={item.title || item.slot} loading="lazy"
            className="h-36 w-full object-contain" referrerPolicy="no-referrer" />
        </a>
      )}
      <p className="text-sm font-black text-on-surface leading-snug">{item.title}</p>
      {item.description && (
        <p className="mt-1 text-[11px] leading-snug text-on-surface-variant">{item.description}</p>
      )}
    </div>
  );
}

function BoxCard({ box, onOpen }: { box: WagsBox; onOpen: (id: number) => void }) {
  // A box opened in a previous session shows its contents plainly; the
  // staggered reveal belongs to the first opening only.
  const [revealed, setRevealed] = useState(Boolean(box.opened_at));
  const [expanded, setExpanded] = useState(Boolean(box.opened_at) === false && box.status === "delivered");
  const wrapped = box.status === "delivered" && !box.opened_at && !revealed;

  const handleOpen = useCallback(() => {
    onOpen(box.id);
    // Mount the item cards hidden, then reveal on the next frame so the
    // CSS transitions actually run.
    requestAnimationFrame(() => requestAnimationFrame(() => setRevealed(true)));
  }, [box.id, onOpen]);

  if (box.status === "curating") {
    return (
      <section className="rounded-[1.6rem] border border-dashed border-outline-variant/60 bg-surface/60 p-6 text-center">
        <Clock size={20} className="mx-auto text-on-surface-variant" />
        <h3 className="mt-2 text-sm font-black text-on-surface">{monthLabel(box.box_month)}</h3>
        <p className="mt-1 text-[11px] text-on-surface-variant">
          Being curated for your {box.species} — it lands after our team signs off. 🐾
        </p>
      </section>
    );
  }

  if (wrapped) {
    return (
      <section className="rounded-[1.6rem] bg-gradient-to-br from-primary/15 via-surface to-secondary/10 border border-primary/25 p-8 text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/15">
          <Gift size={30} className="text-primary" />
        </div>
        <h3 className="mt-3 text-lg font-black text-on-surface">{monthLabel(box.box_month)} box is here!</h3>
        <p className="mt-1 text-xs text-on-surface-variant">{box.items.length} goodies inside · {box.tier} tier</p>
        <button
          type="button"
          onClick={handleOpen}
          className="mt-5 inline-flex items-center gap-2 rounded-2xl bg-primary px-7 py-3.5 text-sm font-black text-on-primary shadow-lg transition-all hover:brightness-105 active:scale-95"
        >
          <Sparkles size={15} /> Open your box
        </button>
      </section>
    );
  }

  return (
    <section className="rounded-[1.6rem] border border-outline-variant/40 bg-surface/80 p-5">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-3 text-left"
        aria-expanded={expanded}
      >
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
          <Gift size={18} className="text-primary" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-black text-on-surface">{monthLabel(box.box_month)}</h3>
          <p className="text-[11px] text-on-surface-variant">{box.items.length} items · {box.tier} tier</p>
        </div>
        <ChevronDown size={16} className={`text-on-surface-variant transition-transform ${expanded ? "rotate-180" : ""}`} />
      </button>
      {expanded && (
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {box.items.map((item, i) => (
            <ItemCard key={`${box.id}-${i}`} item={item} index={i} revealed={revealed} />
          ))}
        </div>
      )}
    </section>
  );
}

export default function WagsInboxScreen({ onGoToFidos }: { onGoToFidos?: () => void }) {
  const [boxes, setBoxes] = useState<WagsBox[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await authedFetch("/api/wags/boxes");
        if (!res.ok) throw new Error("Could not load your boxes.");
        const data = await res.json();
        if (!cancelled) setBoxes(data.boxes ?? []);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "Could not load your boxes.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const openBox = useCallback((id: number) => {
    // Optimistic: reveal locally, record server-side. A failed record just
    // means the reveal plays again next visit — harmless.
    setBoxes((prev) => prev.map((b) => (b.id === id ? { ...b, opened_at: new Date().toISOString() } : b)));
    authedFetch(`/api/wags/boxes/${id}/open`, { method: "POST" }).catch(() => {});
  }, []);

  const unlockedCount = useMemo(
    () => boxes.flatMap((b) => b.items).filter((i) => i.entitlement_type === "wardrobe_item").length,
    [boxes],
  );

  return (
    <main className="mx-auto w-full max-w-4xl px-4 pb-28 pt-7 sm:px-6">
      <div className="glass-hero rounded-[2rem] p-6 sm:p-8">
        <div className="flex items-center gap-2 text-primary">
          <Gift size={18} />
          <span className="text-xs font-black uppercase tracking-[.18em]">Wardrobe Wags</span>
        </div>
        <h1 className="mt-2 text-2xl font-black tracking-tight text-on-surface sm:text-3xl">Your monthly boxes</h1>
        <p className="mt-2 max-w-xl text-sm text-on-surface-variant">
          Every month, a themed drop of digital wardrobe pieces, collectibles, and treats for your pet's 3D model.
        </p>
        {unlockedCount > 0 && (
          <button
            type="button"
            onClick={() => onGoToFidos?.()}
            className="mt-4 inline-flex items-center gap-2 rounded-xl border border-primary/30 px-5 py-2.5 text-xs font-black text-primary transition-all hover:bg-primary/10 active:scale-95"
          >
            <Shirt size={14} /> {unlockedCount} wardrobe {unlockedCount === 1 ? "piece" : "pieces"} unlocked — dress your pet
          </button>
        )}
      </div>

      <div className="mt-6 space-y-4">
        {loading && (
          <div className="py-16 text-center text-sm text-on-surface-variant">Fetching your boxes…</div>
        )}
        {!loading && error && (
          <div className="rounded-2xl border border-error/30 bg-error/5 p-5 text-center text-sm text-error">{error}</div>
        )}
        {!loading && !error && boxes.length === 0 && (
          <div className="rounded-[1.6rem] border border-dashed border-outline-variant/60 bg-surface/60 p-10 text-center">
            <Gift size={26} className="mx-auto text-on-surface-variant" />
            <h3 className="mt-3 text-sm font-black text-on-surface">No boxes yet</h3>
            <p className="mx-auto mt-1 max-w-sm text-[11px] leading-snug text-on-surface-variant">
              Subscribe to Wardrobe Wags and your first themed box will be curated after your first renewal.
            </p>
          </div>
        )}
        {boxes.map((box) => (
          <BoxCard key={box.id} box={box} onOpen={openBox} />
        ))}
      </div>
    </main>
  );
}
