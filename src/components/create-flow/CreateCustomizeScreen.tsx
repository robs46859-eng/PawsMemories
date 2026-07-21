import React, { useState } from "react";
import { Screen } from "../../types";
import { useCreateFlow } from "./CreateFlowContext";
import { ChevronLeft, ChevronRight, Check, AlertTriangle } from "lucide-react";
import { CREDIT_PRICES, createModelCost } from "../../pricing";

interface CreateCustomizeScreenProps {
  onNavigate: (screen: Screen) => void;
}

export default function CreateCustomizeScreen({ onNavigate }: CreateCustomizeScreenProps) {
  const { state, setState } = useCreateFlow();
  const [pose, setPose] = useState(state.customizationState?.pose || "Sitting");
  const [engraving, setEngraving] = useState(state.customizationState?.engraving || "");
  const [rigEnabled, setRigEnabled] = useState<boolean>(!!state.customizationState?.rigging?.enabled);
  const [rigFacial, setRigFacial] = useState<boolean>(!!state.customizationState?.rigging?.facial);

  const rigging = { enabled: rigEnabled, facial: rigEnabled && rigFacial };
  const totalCost = createModelCost(rigging);

  const handleNext = () => {
    setState(s => ({
      ...s,
      customizationState: {
        ...s.customizationState,
        pose,
        engraving,
        rigging
      }
    }));
    onNavigate(Screen.CREATE_VALIDATE);
  };

  return (
    <div className="w-full max-w-4xl mx-auto px-4 py-8 animate-in fade-in zoom-in duration-500">
      <div className="mb-6 flex items-center justify-between">
        <button 
          onClick={() => onNavigate(Screen.CREATE_REFERENCE)}
          className="flex items-center gap-1 text-on-surface-variant hover:text-primary font-medium"
        >
          <ChevronLeft size={20} /> Back
        </button>
        <div className="flex gap-2">
          <div className="w-2.5 h-2.5 rounded-full bg-primary/30"></div>
          <div className="w-2.5 h-2.5 rounded-full bg-primary/30"></div>
          <div className="w-2.5 h-2.5 rounded-full bg-primary"></div>
          <div className="w-2.5 h-2.5 rounded-full bg-primary/30"></div>
        </div>
      </div>

      <div className="text-center mb-8">
        <h1 className="text-3xl font-black text-on-surface mb-2">Personalize It</h1>
        <p className="text-on-surface-variant text-lg">Add the final touches before we build your model.</p>
      </div>

      <div className="glass-panel p-8 rounded-3xl">
        <div className="grid md:grid-cols-2 gap-12">
          
          <div className="flex flex-col gap-8">
            <div>
              <h3 className="text-xl font-bold text-on-surface mb-4">Choose Pose</h3>
              <div className="grid grid-cols-2 gap-3">
                {["Sitting", "Standing", "Laying Down", "Playful"].map(p => (
                  <button
                    key={p}
                    onClick={() => setPose(p)}
                    className={`py-3 px-4 rounded-xl font-bold text-left flex justify-between items-center transition-all ${
                      pose === p 
                        ? 'bg-primary/10 border-2 border-primary text-primary' 
                        : 'bg-surface border-2 border-outline-variant text-on-surface-variant hover:border-primary/50'
                    }`}
                  >
                    {p}
                    {pose === p && <Check size={18} />}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <h3 className="text-xl font-bold text-on-surface mb-4">Custom Engraving (Optional)</h3>
              <p className="text-sm text-on-surface-variant mb-2">Add a name or short message to the base.</p>
              <input 
                type="text"
                value={engraving}
                onChange={(e) => setEngraving(e.target.value)}
                maxLength={24}
                placeholder="e.g. Good Boy Max"
                className="w-full px-4 py-3 rounded-xl border border-outline-variant bg-surface text-on-surface focus:outline-none focus:ring-2 focus:ring-primary"
              />
              <div className="text-right text-xs text-on-surface-variant mt-1">
                {engraving.length} / 24
              </div>
            </div>

            <div>
              <h3 className="text-xl font-bold text-on-surface mb-4">Animation Rigging (Optional)</h3>
              <label className="flex items-start gap-3 p-4 rounded-xl border-2 border-outline-variant bg-surface cursor-pointer hover:border-primary/50 transition-all">
                <input
                  type="checkbox"
                  checked={rigEnabled}
                  onChange={(e) => setRigEnabled(e.target.checked)}
                  className="mt-1 w-5 h-5 accent-[var(--md-sys-color-primary,#6750a4)]"
                />
                <span className="flex-1">
                  <span className="font-bold text-on-surface block">Rig this model for animation</span>
                  <span className="text-sm text-on-surface-variant">Animation-ready skeleton with automated quality checks (posture, limbs, weights).</span>
                </span>
                <span className="font-black text-primary whitespace-nowrap">+{CREDIT_PRICES.RIG_ADDON}</span>
              </label>
              <label className={`mt-3 flex items-start gap-3 p-4 rounded-xl border-2 bg-surface transition-all ${rigEnabled ? "border-outline-variant cursor-pointer hover:border-primary/50" : "border-outline-variant/40 opacity-50 cursor-not-allowed"}`}>
                <input
                  type="checkbox"
                  checked={rigEnabled && rigFacial}
                  disabled={!rigEnabled}
                  onChange={(e) => setRigFacial(e.target.checked)}
                  className="mt-1 w-5 h-5 accent-[var(--md-sys-color-primary,#6750a4)]"
                />
                <span className="flex-1">
                  <span className="font-bold text-on-surface block">
                    Include facial rig
                    <span className="ml-2 align-middle rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-amber-700 dark:text-amber-400">
                      Early access
                    </span>
                  </span>
                  <span className="text-sm text-on-surface-variant">Viseme blendshapes for lip-sync and expressions.</span>
                </span>
                <span className="font-black text-primary whitespace-nowrap">+{CREDIT_PRICES.FACIAL_RIG_ADDON}</span>
              </label>

              {/* Pre-purchase disclosure — MUST stay above the checkout step.
                  The facial pass only canonicalizes viseme morph targets that the
                  model provider actually returned; it never fabricates mouth
                  shapes by deforming the head mesh (see agent/graph/nodes/
                  facialVisemes.ts). Providers frequently return no morphs at all,
                  in which case the model falls back to jaw-only motion and the
                  add-on is still charged. Since we do not refund that case, the
                  user has to be told before they are billed, not after. */}
              {rigEnabled && rigFacial && (
                <div className="mt-3 flex items-start gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3">
                  <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
                  <p className="text-[13px] leading-snug text-on-surface">
                    <span className="font-black">Facial rigging is in early development and isn&apos;t guaranteed.</span>{" "}
                    It depends on the 3D model coming back with usable mouth shapes, which
                    doesn&apos;t always happen. If it can&apos;t be applied, your model still
                    animates with jaw movement — but{" "}
                    <span className="font-bold">this add-on is charged either way and isn&apos;t refunded.</span>{" "}
                    Skip it if you&apos;d rather not take that chance.
                  </p>
                </div>
              )}
              <div className="mt-3 text-right text-sm font-bold text-on-surface">
                Total: <span className="text-primary">{totalCost} PupCoins</span>
              </div>
            </div>
          </div>

          <div className="flex flex-col">
            <div className="relative rounded-2xl overflow-hidden shadow-md border border-outline-variant bg-surface-container aspect-square mb-6 flex items-center justify-center">
              {state.candidateImageUrl ? (
                <img src={state.candidateImageUrl} alt="Concept" className="w-full h-full object-cover opacity-50 blur-sm mix-blend-luminosity" />
              ) : (
                <div className="w-32 h-32 bg-outline-variant rounded-full opacity-20"></div>
              )}
              
              {/* Overlay representation */}
              <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center">
                <span className="font-black text-3xl text-on-surface drop-shadow-md">{pose}</span>
                {engraving && (
                  <div className="mt-8 px-6 py-2 bg-surface-variant/80 backdrop-blur-sm rounded-lg border-b-4 border-outline-variant text-on-surface-variant font-medium font-serif italic">
                    "{engraving}"
                  </div>
                )}
              </div>
            </div>
            
            <button 
              onClick={handleNext}
              className="mt-auto py-4 rounded-xl font-black text-lg text-on-primary bg-primary shadow-lg shadow-primary/25 hover:scale-[1.02] transition-transform flex justify-center items-center gap-2"
            >
              Validate Printability <ChevronRight />
            </button>
          </div>

        </div>
      </div>
    </div>
  );
}
