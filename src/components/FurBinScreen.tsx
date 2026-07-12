import React, { useEffect, useState } from "react";
import { UserProfile, VoiceCloneAsset } from "../types";
import { HardDrive, ShieldCheck, ShieldAlert } from "lucide-react";
import StorageMeter from "./StorageMeter";
import { listVoiceCloneAssets } from "../api";

interface FurBinScreenProps {
  userProfile: UserProfile;
  onOpenCreditStore: () => void;
}

export default function FurBinScreen({ userProfile, onOpenCreditStore }: FurBinScreenProps) {
  const [voiceAssets, setVoiceAssets] = useState<VoiceCloneAsset[]>([]);

  useEffect(() => {
    listVoiceCloneAssets().then(setVoiceAssets).catch(() => setVoiceAssets([]));
  }, []);

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
            <span className="text-[10px] text-on-surface-variant font-mono">
              {group === "Voice Clone Files" ? `${voiceAssets.length} items` : "0 items · 0 B"}
            </span>
          </div>
          {group === "Voice Clone Files" && voiceAssets.length > 0 && (
            <div className="mt-3 space-y-2">
              {voiceAssets.map((asset) => (
                <div key={asset.id} className="rounded-xl bg-surface-container p-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-bold text-on-surface truncate">{asset.name}</div>
                    <div className="text-[11px] text-on-surface-variant">
                      {Math.max(1, Math.round(asset.bytes / 1024))} KB · {asset.mime_type}
                    </div>
                  </div>
                  <span className={`shrink-0 inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-black ${asset.voice_consent ? "bg-emerald-600/15 text-emerald-700 dark:text-emerald-300" : "bg-error/10 text-error"}`}>
                    {asset.voice_consent ? <ShieldCheck size={12} /> : <ShieldAlert size={12} />}
                    {asset.voice_consent ? "Consent saved" : "Missing consent"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
