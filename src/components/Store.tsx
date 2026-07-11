import React, { useState } from "react";
import { UserProfile, Album, Creation, Screen } from "../types";
import { ArrowRight } from "lucide-react";
import PrintRequestForm from "./PrintRequestForm";

interface StoreProps {
  userProfile: UserProfile;
  onOpenCreditStore: () => void;
  onGoToAvatars: () => void;
  albums: Album[];
  creations: Creation[];
  onSelectCreation: (creation: Creation) => void;
  onNavigate: (screen: Screen) => void;
}

// "Avatars-R-Us" — two destinations: the (coming soon) accessory shop on
// getsemu.com, and a local 3D-print intake flow.
export default function Store(_props: StoreProps) {
  const [view, setView] = useState<"home" | "print">("home");

  if (view === "print") {
    return (
      <div className="w-full max-w-4xl mx-auto px-4 py-8">
        <PrintRequestForm onBack={() => setView("home")} />
      </div>
    );
  }

  return (
    <div className="w-full max-w-4xl mx-auto px-4 py-8">
      <div className="text-center mb-8">
        <h1 className="text-3xl font-extrabold text-primary tracking-tight">Avatars-R-Us</h1>
        <p className="text-sm text-on-surface-variant mt-1">
          Accessorize your avatar or bring it into the real world.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Card 1 — Accessory Shop (getsemu.com), coming soon */}
        <div className="relative rounded-3xl border border-outline-variant/30 bg-surface-container-high/70 backdrop-blur p-8 flex flex-col items-center text-center">
          <span className="absolute top-4 right-4 text-[10px] font-black uppercase tracking-wider text-secondary bg-secondary-container/50 px-3 py-1 rounded-full">
            Coming soon
          </span>
          <div className="text-5xl mb-4">🛍️</div>
          <h2 className="text-xl font-extrabold text-on-surface mb-2">Avatar Accessory Shop</h2>
          <p className="text-sm text-on-surface-variant mb-6">
            Outfits, hats, collars, and accessories for your avatar — hosted at{" "}
            <span className="font-semibold">getsemu.com</span>.
          </p>
          <div className="mt-auto text-xs font-bold text-on-surface-variant/60 bg-black/5 dark:bg-white/5 px-4 py-2 rounded-full">
            Launching soon
          </div>
        </div>

        {/* Card 2 — 3D Print (local intake) */}
        <button
          onClick={() => setView("print")}
          className="group relative rounded-3xl border border-primary/30 bg-primary/5 hover:bg-primary/10 p-8 flex flex-col items-center text-center transition-colors"
        >
          <div className="text-5xl mb-4">🖨️</div>
          <h2 className="text-xl font-extrabold text-on-surface mb-2">3D Print Your Avatar</h2>
          <p className="text-sm text-on-surface-variant mb-6">
            Turn your model into a real, physical figurine. Upload or paste your model and tell us how to build it.
          </p>
          <div className="mt-auto inline-flex items-center gap-2 text-sm font-bold text-primary">
            Start a print request
            <ArrowRight size={16} className="group-hover:translate-x-1 transition-transform" />
          </div>
        </button>
      </div>
    </div>
  );
}
