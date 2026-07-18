import React, { useState } from "react";
import { Lock, Construction, ArrowRight, Bell, BellRing } from "lucide-react";

interface UnderConstructionLockProps {
  /** Display name of the locked feature. */
  featureName: string;
  /** Brief description of what the feature will do. */
  featureDescription?: string;
  /** Navigate to the Create flow. */
  onGoToCreate: () => void;
}

/**
 * Full-screen lock overlay for modules that are visible but not yet functional.
 * Never renders functional controls behind it — it replaces the content entirely.
 * Never deducts PupCoins.
 */
export default function UnderConstructionLock({
  featureName,
  featureDescription,
  onGoToCreate,
}: UnderConstructionLockProps) {
  const [notifyRequested, setNotifyRequested] = useState(false);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col items-center justify-center px-6 py-16 text-center">
      {/* Lock icon */}
      <div className="relative mb-6">
        <div className="flex h-24 w-24 items-center justify-center rounded-full bg-primary/10">
          <Construction className="h-10 w-10 text-primary" />
        </div>
        <div className="absolute -right-1 -top-1 flex h-9 w-9 items-center justify-center rounded-full bg-primary text-on-primary shadow-lg">
          <Lock size={16} />
        </div>
      </div>

      {/* Heading */}
      <h2 className="text-2xl font-black tracking-tight text-on-surface md:text-3xl">
        {featureName}
      </h2>
      <span className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-black uppercase tracking-wider text-primary">
        <Construction size={12} />
        Under Construction
      </span>

      {/* Description */}
      <p className="mt-5 max-w-md text-sm leading-relaxed text-on-surface-variant md:text-base">
        {featureDescription || `${featureName} is being crafted and will be available soon.`}
      </p>

      {/* Available now redirect */}
      <div className="mt-8 w-full max-w-sm glass-card rounded-2xl p-5">
        <p className="text-sm font-bold text-on-surface">
          The 3D create-to-print workflow is available now!
        </p>
        <p className="mt-1 text-xs text-on-surface-variant">
          Turn your pet photo into a printable 3D keepsake today.
        </p>
        <button
          type="button"
          onClick={onGoToCreate}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 text-sm font-black text-on-primary shadow-md transition-all hover:brightness-105 active:scale-95"
        >
          Create My 3D Model
          <ArrowRight size={16} />
        </button>
      </div>

      {/* Notification signup stub */}
      <button
        type="button"
        disabled
        className="mt-5 flex items-center gap-2 rounded-full border border-outline-variant/20 bg-surface-container-low px-5 py-2.5 text-xs font-bold text-on-surface-variant/50 cursor-not-allowed"
      >
        <Bell size={14} />
        Notifications coming later
      </button>
    </div>
  );
}
