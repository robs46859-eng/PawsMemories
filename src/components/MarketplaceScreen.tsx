import React, { useState } from "react";
import { ArrowRight, Search, ShoppingBag, Sparkles } from "lucide-react";

// Phase 2: wire to marketplace backend, cart, checkout
// This is the route shell with placeholder data.

type MarketplaceCategory = "all" | "breed" | "memorial" | "accessories" | "seasonal";

const CATEGORIES: { id: MarketplaceCategory; label: string; icon: string }[] = [
  { id: "all", label: "All", icon: "🐾" },
  { id: "breed", label: "Breed Models", icon: "🐕" },
  { id: "memorial", label: "Memorial Pieces", icon: "🕊️" },
  { id: "accessories", label: "Accessories", icon: "🎀" },
  { id: "seasonal", label: "Seasonal", icon: "🎄" },
];

/* Placeholder items using existing creation imagery from data.ts */
const PLACEHOLDER_ITEMS = [
  { id: 1, name: "Golden Retriever Classic", category: "breed" as const, price: "Preview catalog", image: "https://lh3.googleusercontent.com/aida-public/AB6AXuBU0nUa1m6O8-EVOuohKwONaRwJZZ1gEa5tLTsM6Pk1OPKho05x71b_umVngODZv7RWo73hOOvU9Pu2yXKJeirbxWxwhUK0Oc8ZFW0V8ZtACgsRSPZMsMbEYEEAO1esiiTpH2zeweZ3QKaShDtccGyScYK3DPYrRmCO8dvSv0zEfSO0vQfPknP_CW52xEaWsC4OY5-40p1XpbQMAuCeo0OUJO_pV-DEwfFkOxaCgZedlpRMbhqAEHqAtwegofQrEhqucTjtQ2OleIE" },
  { id: 2, name: "Bulldog Portrait", category: "breed" as const, price: "Preview catalog", image: "https://lh3.googleusercontent.com/aida-public/AB6AXuB8ObbseD9WagQBXRMd7E8BZ9RKHCgeVXiTKIOxDJMzlQsW7PyFS-UBTPelIFo5QDRzArLs-4-4Oy6SJRj96hu8uVRnQnCBEX1QpUj4KkwViPiT2O6z7A8hCU1m1tGqzsbjfqwTtmb-rdCuYzWTIV3knQxTGdj1wOIy_BZnirVnKurbIwHKukbwAZoLNP71iCjzmKKELvLlJFKabzz3CT54bzle2VywswLksCtnmOWoThBAC3PtfJYhh--0wQssrh3QDfwRSZgeL7o" },
  { id: 3, name: "Memorial Companion", category: "memorial" as const, price: "Preview catalog", image: "https://lh3.googleusercontent.com/aida/AP1WRLtFDVEbGliaP7_evzZN_0TExPZntgmOewmauFKbkzvCbsDtKQs6KG-2t6XJ2X111LgZJF1OEymMFPWvAmWawCw-BCq6LT56LCOMv1teoRQytKnceBBh9acShCALXBygU3f_ABu8p4jiWEJVExClrbt0bTGdcCQ6GxFLGP4wYdtYKWhbchG9EG7JxIw39ErS7Lal4ujgb8uz8bxQOr-4H1dKF26Fv2zKJ4DWGHaAF7N7C4clV0ba9n8zADQ" },
  { id: 4, name: "Adventure Series", category: "seasonal" as const, price: "Preview catalog", image: "https://lh3.googleusercontent.com/aida/AP1WRLuMUevcjZpP-AN97I_CA6dOQYEMS0BevxX3U39ALuZBdr-amMVOAtfxg8xCDxKyqZaseVEV-unjiFTjJh3qvOeeJK_FEcahmc-CSgTOIEsW_C9-BNmA7cgFVAjjQTQW0l1qQNz2RYiP8fzGVMjSgv3FD75s1qC_ghJQ5_sKyBUcPn7Gt74S_qwQy21Mq7ObaMtDVUR3Joq0QE0DwBDmKXXRXS21S-v6gRkS_EAKEwhLJiVOuOIm8xWZVQ" },
  { id: 5, name: "Engraved Collar Tag", category: "accessories" as const, price: "Preview catalog", image: "https://lh3.googleusercontent.com/aida-public/AB6AXuArSlWVwErnEbnk2aLPVkLPEEjldq0RTpdNmxIKDnsr0jldrmnxQNzO3oFoth-EUF5L-ve0PungeT2kbTWV9-HqepD_bMYQPybtGibaXw2_Oynq9OsXFAwTWDOyUKoHw9Occ-hDeYWecm5UiTBecp1pJ8HG4McquL-zeNdtxaL1BawQ0LiwU57VOsNZsHoHfR7gc1QlaJiH__hJaBqbICJSRdSQRABSJF0AdGyitxXO2XFVPFfAuO7ONqFyTAln4VgRkvPKqveYbmU" },
  { id: 6, name: "Holiday Sweater Set", category: "seasonal" as const, price: "Preview catalog", image: "https://lh3.googleusercontent.com/aida-public/AB6AXuBpepogeE9ufZ0XZMSpjfKeBawFEB3Qmx49SD1PgwI63lTVz1bW6wvysHa4fmtw4xd1G00jobdOZWmLem87ErgeS4Imv7DsgxgkWKeLcTZwHyiZ_PujCCuSTB345-TjQsds37FDjLmyFkORJoKl6Wu6JHkZO6R1HT_0OuZRHoAz8ecD2Wwc74UsqsYkv7MvrzjsJw-jaJxIkDjQlJHoozAYlh9SFBgKrQ52yXgIXi84m-1mHogWGi8hmVSJPKxmbT5rKZmEgsPp6Mw" },
];

interface MarketplaceScreenProps {
  onOpenCreate: () => void;
}

export default function MarketplaceScreen({ onOpenCreate }: MarketplaceScreenProps) {
  const [category, setCategory] = useState<MarketplaceCategory>("all");
  const [searchQuery, setSearchQuery] = useState("");

  const filtered = PLACEHOLDER_ITEMS.filter((item) => {
    if (category !== "all" && item.category !== category) return false;
    if (searchQuery && !item.name.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    return true;
  });

  return (
    <main className="mx-auto w-full max-w-7xl px-4 pb-28 pt-7 sm:px-6">
      {/* Header */}
      <div className="glass-hero rounded-[2rem] p-6 sm:p-8">
        <div className="flex items-center gap-2 text-primary">
          <ShoppingBag size={18} />
          <span className="text-xs font-black uppercase tracking-[.18em]">Marketplace</span>
        </div>
        <h1 className="mt-2 text-2xl font-black tracking-tight text-on-surface sm:text-3xl">
          3D Pet Marketplace
        </h1>
        <p className="mt-2 max-w-xl text-sm text-on-surface-variant">
          Browse breed-specific models, memorial pieces, accessories, and seasonal collections.
        </p>
        {/* Search */}
        <div className="relative mt-5 max-w-md">
          <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-on-surface-variant" />
          <input
            type="text"
            placeholder="Search marketplace..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-xl border border-outline-variant/40 bg-surface-container-lowest py-3 pl-10 pr-4 text-sm text-on-surface placeholder:text-on-surface-variant/50 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
        </div>
      </div>

      {/* Category tabs */}
      <div className="mt-6 flex flex-wrap gap-2" role="tablist" aria-label="Marketplace category">
        {CATEGORIES.map((cat) => (
          <button
            key={cat.id}
            type="button"
            role="tab"
            aria-selected={category === cat.id}
            onClick={() => setCategory(cat.id)}
            className={`min-h-10 rounded-full px-4 text-xs font-black transition ${
              category === cat.id
                ? "bg-primary text-on-primary"
                : "border border-outline-variant/45 bg-surface/80 text-on-surface-variant hover:text-primary"
            }`}
          >
            <span className="mr-1.5">{cat.icon}</span>
            {cat.label}
          </button>
        ))}
      </div>

      {/* Items grid */}
      {filtered.length === 0 ? (
        <div className="mt-8 rounded-[2rem] border border-dashed border-outline-variant/50 bg-surface/80 p-12 text-center text-sm text-on-surface-variant">
          No items match your search.
        </div>
      ) : (
        <div className="mt-7 grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
          {filtered.map((item) => (
            <article
              key={item.id}
              className="glass-showcase group cursor-pointer overflow-hidden rounded-[1.6rem]"
            >
              <div className="relative aspect-square overflow-hidden bg-surface-container-highest">
                <img
                  src={item.image}
                  alt={item.name}
                  className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                  referrerPolicy="no-referrer"
                />
                <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-black/60 px-2 py-1 text-[10px] font-black capitalize text-white">
                  {item.category}
                </span>
              </div>
              <div className="p-4">
                <h3 className="text-sm font-black text-on-surface">{item.name}</h3>
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-xs font-bold text-primary">{item.price}</span>
                  <span className="flex items-center gap-1 text-[10px] font-bold text-primary opacity-0 transition-opacity group-hover:opacity-100">
                    View <ArrowRight size={10} />
                  </span>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      {/* Phase 2 handoff */}
      <div className="mt-10 glass-card rounded-2xl p-6 text-center">
        <Sparkles size={22} className="mx-auto mb-3 text-primary" />
        <h3 className="text-base font-black text-on-surface">Full marketplace coming in Phase 2</h3>
        <p className="mt-2 text-xs text-on-surface-variant">
          Listings, cart, checkout, and seller tools will be wired here. For now, create your own custom model.
        </p>
        {/* Phase 2: wire to marketplace backend, cart, checkout */}
        <button
          type="button"
          onClick={onOpenCreate}
          className="mt-4 inline-flex items-center gap-2 rounded-xl bg-primary px-6 py-3 text-sm font-black text-on-primary shadow-md transition-all hover:brightness-105 active:scale-95"
        >
          Create My Own Model
          <ArrowRight size={14} />
        </button>
      </div>
    </main>
  );
}
