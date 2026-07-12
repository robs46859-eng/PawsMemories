import React from "react";
import { UserProfile } from "../types";
import { HardDrive, Zap } from "lucide-react";
import StorageMeter from "./StorageMeter";

interface FurBinScreenProps {
  userProfile: UserProfile;
  onOpenCreditStore: () => void;
}

export default function FurBinScreen({ userProfile, onOpenCreditStore }: FurBinScreenProps) {
  return (
    <div className="w-full max-w-4xl mx-auto px-4 pt-6 pb-28 animate-fade-in">
      <div className="flex items-center gap-3 mb-6">
        <HardDrive size={22} className="text-primary" />
        <h1 className="text-xl font-extrabold text-on-surface">Fur Bin©️ — Storage</h1>
      </div>

      {/* Storage meter */}
      <StorageMeter />

      {/* Asset groups placeholder */}
      <div className="glass-panel border border-outline-variant/40 rounded-3xl p-6 mb-6">
        <p className="text-xs text-on-surface-variant leading-relaxed text-center py-8">
          Your assets are organized by how they're used across the site.
          Each group shows size, storage tier (hot/cold), and actions.
        </p>
      </div>

      {/* Asset groups */}
      {(["Furball3D Models", "Animator/Videos", "Voice Clone Files", "Pawprints", "Uploads/References", "Memories/Albums"] as const).map((group) => (
        <div key={group} className="glass-panel border border-outline-variant/40 rounded-2xl p-4 mb-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-on-surface">{group}</h3>
            <span className="text-[10px] text-on-surface-variant font-mono">0 items · 0 B</span>
          </div>
        </div>
      ))}
    </div>
  );
}