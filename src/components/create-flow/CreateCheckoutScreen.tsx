import React, { useState } from "react";
import { Screen, UserProfile } from "../../types";
import { useCreateFlow } from "./CreateFlowContext";
import { ChevronLeft, Check, RefreshCw, AlertTriangle } from "lucide-react";
import { CREDIT_PRICES } from "../../pricing";

interface CreateCheckoutScreenProps {
  onNavigate: (screen: Screen) => void;
  userProfile: UserProfile;
}

export default function CreateCheckoutScreen({ onNavigate, userProfile }: CreateCheckoutScreenProps) {
  const { state, resetState } = useCreateFlow();
  const [isApproving, setIsApproving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const MODEL_COST = CREDIT_PRICES.STATIC_3D_PHOTO;

  const hasEnoughCredits = userProfile.isAdmin || userProfile.credits >= MODEL_COST;

  const handleApproveAndBuild = async () => {
    setIsApproving(true);
    setError(null);
    try {
      const token = localStorage.getItem("paws_token");
      
      // Idempotency key - a simple random string for this attempt
      const idempotencyKey = crypto.randomUUID();

      const res = await fetch("/api/create-pipeline/approve", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          sessionId: state.sessionId,
          idempotencyKey
        })
      });

      const data = await res.json();
      if (!data.success) {
        throw new Error(data.error || "Failed to start build.");
      }

      // Success! Clear state and go to FurBin
      resetState();
      // Wait a moment for UI transition
      setTimeout(() => {
        onNavigate(Screen.FURBIN);
      }, 500);

    } catch (err: any) {
      setError(err.message);
      setIsApproving(false);
    }
  };

  return (
    <div className="w-full max-w-4xl mx-auto px-4 py-8 animate-in fade-in zoom-in duration-500">
      <div className="mb-6 flex items-center justify-between">
        <button 
          onClick={() => onNavigate(Screen.CREATE_VALIDATE)}
          className="flex items-center gap-1 text-on-surface-variant hover:text-primary font-medium"
        >
          <ChevronLeft size={20} /> Back
        </button>
      </div>

      <div className="text-center mb-8">
        <h1 className="text-3xl font-black text-on-surface mb-2">Checkout</h1>
        <p className="text-on-surface-variant text-lg">Approve the blueprint and start the 3D build process.</p>
      </div>

      <div className="glass-panel p-8 rounded-3xl max-w-2xl mx-auto">
        <div className="flex gap-6 mb-8 border-b border-outline-variant pb-8">
          <div className="w-32 h-32 rounded-2xl overflow-hidden shadow-lg border-2 border-primary/20 shrink-0">
            <img src={state.candidateImageUrl} alt="Model Blueprint" className="w-full h-full object-cover" />
          </div>
          <div className="flex flex-col justify-center">
            <h3 className="text-xl font-bold text-on-surface capitalize">{state.species} 3D Model</h3>
            <p className="text-on-surface-variant mt-1">
              Pose: {state.customizationState?.pose || "Sitting"}
            </p>
            {state.customizationState?.engraving && (
              <p className="text-on-surface-variant text-sm mt-1">
                Engraving: "{state.customizationState.engraving}"
              </p>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-4 mb-8">
          <div className="flex justify-between items-center text-lg">
            <span className="text-on-surface-variant font-medium">3D Model Generation</span>
            <span className="font-bold text-on-surface flex items-center gap-1">
              {MODEL_COST} <span className="text-xs uppercase font-black text-primary">PupCoins</span>
            </span>
          </div>
          
          <div className="flex justify-between items-center text-sm p-4 rounded-xl bg-surface-variant/30 border border-outline-variant">
            <span className="text-on-surface-variant">Your Balance</span>
            <span className={`font-bold flex items-center gap-1 ${hasEnoughCredits ? 'text-emerald-500' : 'text-error'}`}>
              {userProfile.isAdmin ? 'Unlimited (Admin)' : userProfile.credits}
            </span>
          </div>
        </div>

        {error && (
          <div className="mb-6 p-4 rounded-xl bg-error/10 border border-error/20 flex items-start gap-3">
            <AlertTriangle className="text-error shrink-0 mt-0.5" size={20} />
            <p className="text-error text-sm font-medium">{error}</p>
          </div>
        )}

        {hasEnoughCredits ? (
          <button
            onClick={handleApproveAndBuild}
            disabled={isApproving}
            className={`w-full py-4 rounded-xl font-black text-lg text-on-primary bg-primary shadow-lg shadow-primary/25 hover:scale-[1.02] transition-transform flex justify-center items-center gap-2 ${isApproving ? 'opacity-80 pointer-events-none' : ''}`}
          >
            {isApproving ? (
              <><RefreshCw size={20} className="animate-spin" /> Starting Build...</>
            ) : (
              <><Check size={20} /> Approve and Build</>
            )}
          </button>
        ) : (
          <div className="text-center">
            <p className="text-error font-medium mb-4">You need {MODEL_COST - userProfile.credits} more PupCoins.</p>
            <button
              onClick={() => { /* Should trigger credit store, handled globally typically but we'll just show message */ }}
              className="px-6 py-3 rounded-xl font-bold text-primary border-2 border-primary hover:bg-primary/5 transition-colors"
            >
              Get More PupCoins
            </button>
          </div>
        )}
        
        <p className="text-center text-xs text-on-surface-variant mt-4">
          By approving, {MODEL_COST} PupCoins will be deducted from your account. The build takes a few minutes.
        </p>
      </div>
    </div>
  );
}
