import React, { useState } from "react";
import { UserProfile, Album, Creation, Screen } from "../types";
import { ShoppingBag, Sparkles, ArrowRight, Zap, Package, Dog, Store as StoreIcon, Images } from "lucide-react";
import AlbumsPage from "./AlbumsPage";

interface StoreProps {
  userProfile: UserProfile;
  onOpenCreditStore: () => void;
  onGoToAvatars: () => void;
  albums: Album[];
  creations: Creation[];
  onSelectCreation: (creation: Creation) => void;
  onNavigate: (screen: Screen) => void;
}

interface Product {
  id: string;
  name: string;
  desc: string;
  price: string;
  badge?: string;
  emoji: string;
  cta: string;
}

// Stubbed catalog — replace with server-backed products when the merch backend lands.
const FEATURED: Product[] = [
  { id: "resin-print", name: "3D Avatar Model", desc: "Ultra-detailed resin print of your custom avatar with hand-painted accents.", price: "$89.00", badge: "Best Seller", emoji: "🐕", cta: "Customize" },
  { id: "plush", name: "Custom Plush Doll", desc: "Hand-sewn with premium hypoallergenic soft-fur fabrics.", price: "$45.00", emoji: "🧸", cta: "Customize" },
  { id: "bowl", name: "Engraved Bowl", desc: "Ceramic bowl with a laser-etched portrait of your pet.", price: "$32.00", emoji: "🥣", cta: "Design" },
  { id: "dog-house", name: "Designer Dog House", desc: "Eco-friendly biopolymer structure custom-sized for your breed.", price: "From $299", badge: "New Release", emoji: "🏠", cta: "Configure" },
];

const PERSONALIZED: Product[] = [
  { id: "id-tag", name: "Bronze ID Tag", desc: "Engraved with your avatar silhouette.", price: "$18.00", emoji: "🏷️", cta: "Add" },
  { id: "tote", name: "Avatar Tote", desc: "Printed canvas tote with your avatar.", price: "$24.00", emoji: "👜", cta: "Add" },
  { id: "mug", name: "Ceramic Mug", desc: "Your avatar on an 11oz ceramic mug.", price: "$15.00", emoji: "☕", cta: "Add" },
  { id: "stickers", name: "Vinyl Sticker Pack", desc: "6 die-cut stickers of your avatar poses.", price: "$12.00", emoji: "✨", cta: "Add" },
];

export default function Store({ userProfile, onOpenCreditStore, onGoToAvatars, albums, creations, onSelectCreation, onNavigate }: StoreProps) {
  const [toast, setToast] = useState("");
  const [tab, setTab] = useState<"shop" | "albums">("shop");

  const notifyComingSoon = (name: string) => {
    setToast(`${name} ordering is coming soon — we'll notify you at launch!`);
    setTimeout(() => setToast(""), 4000);
  };

  return (
    <div className="w-full max-w-5xl mx-auto px-4 pt-6 pb-28 animate-fade-in">
      {/* Store tab switcher: Shop vs Albums (Albums now lives inside the Store) */}
      <div className="flex items-center gap-2 mb-6 pt-16 md:pt-0">
        <button
          onClick={() => setTab("shop")}
          className={`flex items-center gap-2 px-4 py-2 rounded-full text-xs font-black uppercase tracking-wide transition-all cursor-pointer ${tab === "shop" ? "bg-primary text-on-primary shadow-md" : "bg-primary/10 text-primary hover:bg-primary/20"}`}
        >
          <StoreIcon size={14} /> Shop
        </button>
        <button
          onClick={() => setTab("albums")}
          className={`flex items-center gap-2 px-4 py-2 rounded-full text-xs font-black uppercase tracking-wide transition-all cursor-pointer ${tab === "albums" ? "bg-primary text-on-primary shadow-md" : "bg-primary/10 text-primary hover:bg-primary/20"}`}
        >
          <Images size={14} /> Albums
        </button>
      </div>

      {tab === "albums" && (
        <AlbumsPage
          userProfile={userProfile}
          creations={creations}
          albums={albums}
          onSelectCreation={onSelectCreation}
          onNavigate={onNavigate}
        />
      )}

      {tab === "shop" && (<>
      {/* Hero */}
      <section className="relative overflow-hidden rounded-3xl bg-primary text-on-primary p-8 md:p-12 mb-8 soft-glow-shadow">
        <div className="relative z-10 max-w-lg">
          <span className="inline-flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest bg-white/15 rounded-full px-3 py-1 mb-4">
            <ShoppingBag size={12} /> Premium 3D Collective
          </span>
          <h2 className="text-2xl md:text-4xl font-extrabold tracking-tight mb-3 font-sans">
            Bring Your Digital Best Friend to Life.
          </h2>
          <p className="text-sm opacity-85 leading-relaxed mb-6">
            Transform your unique pet avatar into high-fidelity physical keepsakes — from tactile 3D prints to cuddly custom plush dolls.
          </p>
          <div className="flex flex-wrap gap-3">
            <button
              onClick={onGoToAvatars}
              className="flex items-center gap-2 bg-white text-primary px-5 py-3 rounded-xl text-xs font-black uppercase tracking-wide shadow-md hover:opacity-90 active:scale-95 transition-all cursor-pointer"
            >
              <Dog size={14} /> Start Designing
            </button>
            <button
              onClick={onOpenCreditStore}
              className="flex items-center gap-2 bg-white/10 border border-white/25 px-5 py-3 rounded-xl text-xs font-black uppercase tracking-wide hover:bg-white/20 active:scale-95 transition-all cursor-pointer"
            >
              <Zap size={14} /> Buy Credits
            </button>
          </div>
        </div>
        <span className="absolute -right-6 -bottom-8 text-[9rem] opacity-15 select-none floating">🐾</span>
      </section>

      {/* Featured products */}
      <section className="mb-10">
        <div className="flex items-end justify-between mb-4">
          <div>
            <h3 className="text-lg font-extrabold text-on-surface tracking-tight">Featured Products</h3>
            <p className="text-xs text-on-surface-variant">Precision engineered, artisan finished.</p>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {FEATURED.map((p) => (
            <div key={p.id} className="glass-panel border border-outline-variant/40 rounded-2xl p-5 flex flex-col soft-glow-shadow hover:-translate-y-0.5 transition-transform">
              <div className="relative glass-panel rounded-xl h-32 flex items-center justify-center text-5xl mb-4">
                {p.emoji}
                {p.badge && (
                  <span className="absolute top-2 left-2 bg-primary text-on-primary text-[9px] font-black uppercase tracking-wider rounded-full px-2 py-0.5">
                    {p.badge}
                  </span>
                )}
              </div>
              <h4 className="text-sm font-extrabold text-on-surface mb-1">{p.name}</h4>
              <p className="text-[11px] text-on-surface-variant leading-relaxed flex-grow mb-3">{p.desc}</p>
              <div className="flex items-center justify-between">
                <span className="text-sm font-black text-primary font-mono">{p.price}</span>
                <button
                  onClick={() => notifyComingSoon(p.name)}
                  className="text-[10px] font-black uppercase tracking-wide bg-primary/10 text-primary border border-primary/20 rounded-lg px-3 py-1.5 hover:bg-primary/20 active:scale-95 transition-all cursor-pointer"
                >
                  {p.cta}
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Personalized collection */}
      <section>
        <div className="glass-panel border border-outline-variant/40 rounded-3xl p-6 md:p-8">
          <div className="flex items-center gap-2 mb-1">
            <Sparkles size={16} className="text-primary" />
            <h3 className="text-lg font-extrabold text-on-surface tracking-tight">
              Customized for {userProfile.fullName.split(" ")[0] || "You"}
            </h3>
          </div>
          <p className="text-xs text-on-surface-variant mb-6">
            We'll apply your active avatar to these premium physical goods. One click turns your digital creation into reality.
          </p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {PERSONALIZED.map((p) => (
              <button
                key={p.id}
                onClick={() => notifyComingSoon(p.name)}
                className="glass-panel border border-outline-variant/40 rounded-2xl p-4 text-center hover:border-primary/40 active:scale-95 transition-all cursor-pointer"
              >
                <div className="text-3xl mb-2">{p.emoji}</div>
                <div className="text-xs font-extrabold text-on-surface">{p.name}</div>
                <div className="text-xs font-black text-primary font-mono mt-1">{p.price}</div>
              </button>
            ))}
          </div>
          <div className="flex items-center justify-center mt-6">
            <span className="inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">
              <Package size={12} /> Physical fulfillment launching soon <ArrowRight size={12} />
            </span>
          </div>
        </div>
      </section>
      </>)}

      {/* Coming-soon toast */}
      {toast && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 bg-primary text-on-primary px-5 py-3 rounded-2xl shadow-xl text-sm font-bold animate-fade-in max-w-sm text-center">
          {toast}
        </div>
      )}
    </div>
  );
}
