import React, { useEffect, useState } from "react";
import { Screen } from "../../types";
import { useCreateFlow } from "./CreateFlowContext";
import { ChevronLeft, ChevronRight, RefreshCw, AlertTriangle } from "lucide-react";
import { authedFetch } from "../../api";

interface CreateReferenceScreenProps {
  onNavigate: (screen: Screen) => void;
}

export default function CreateReferenceScreen({ onNavigate }: CreateReferenceScreenProps) {
  const { state, setState } = useCreateFlow();
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generateCandidate = async (isRemake = false) => {
    setIsGenerating(true);
    setError(null);
    try {
      const res = await authedFetch("/api/create-pipeline/generate-reference", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          sessionId: state.sessionId,
          species: state.species,
          breed: state.breed,
          petName: state.petName,
          intent: state.intent,
          style: state.style,
          // Only send a photo in image mode — passing a stale one alongside a
          // description would make the generator condition on the wrong subject.
          inputPhotoUrl: state.inputMode === "text" ? null : state.inputPhotoUrl,
          inputMode: state.inputMode ?? "image",
          textPrompt: state.inputMode === "text" ? (state.textPrompt || "").trim() : undefined,
        })
      });

      const data = await res.json();
      if (!data.success) {
        throw new Error(data.error || "Failed to generate concept.");
      }

      setState(s => ({
        ...s,
        sessionId: data.sessionId,
        candidateImageUrl: data.candidateUrl
      }));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsGenerating(false);
    }
  };

  useEffect(() => {
    if (!state.candidateImageUrl && !isGenerating && !error && state.inputPhotoUrl) {
      generateCandidate();
    }
  }, []);

  const handleApprove = () => {
    onNavigate(Screen.CREATE_CUSTOMIZE);
  };

  const handleRemake = () => {
    // According to specs, remake is idempotent and just calls generate again with same session
    generateCandidate(true);
  };

  return (
    <div className="w-full max-w-4xl mx-auto px-4 py-8 animate-in fade-in zoom-in duration-500">
      <div className="mb-6 flex items-center justify-between">
        <button 
          onClick={() => onNavigate(Screen.CREATE)}
          className="flex items-center gap-1 text-on-surface-variant hover:text-primary font-medium"
        >
          <ChevronLeft size={20} /> Back
        </button>
        <div className="flex gap-2">
          <div className="w-2.5 h-2.5 rounded-full bg-primary/30"></div>
          <div className="w-2.5 h-2.5 rounded-full bg-primary"></div>
          <div className="w-2.5 h-2.5 rounded-full bg-primary/30"></div>
          <div className="w-2.5 h-2.5 rounded-full bg-primary/30"></div>
        </div>
      </div>

      <div className="text-center mb-8">
        <h1 className="text-3xl font-black text-on-surface mb-2">Review AI Concept</h1>
        <p className="text-on-surface-variant text-lg">We transformed your photo into a 3D-ready blueprint.</p>
      </div>

      <div className="glass-panel p-8 rounded-3xl relative overflow-hidden min-h-[400px] flex flex-col items-center justify-center">
        
        {isGenerating ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <RefreshCw className="animate-spin text-primary mb-6" size={48} />
            <h3 className="text-xl font-bold text-on-surface mb-2">Generating Concept...</h3>
            <p className="text-on-surface-variant">Our AI is sketching the blueprint for your pet.</p>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-12 text-center max-w-md mx-auto">
            <div className="w-16 h-16 rounded-full bg-error/10 flex items-center justify-center mb-4">
              <AlertTriangle className="text-error" size={32} />
            </div>
            <h3 className="text-xl font-bold text-on-surface mb-2">Oops, something went wrong</h3>
            <p className="text-on-surface-variant mb-6">{error}</p>
            <button 
              onClick={() => generateCandidate()}
              className="px-6 py-3 bg-primary text-on-primary font-bold rounded-xl shadow-md hover:scale-105 transition-transform"
            >
              Try Again
            </button>
          </div>
        ) : state.candidateImageUrl ? (
          <div className="w-full max-w-lg mx-auto flex flex-col gap-6">
            <div className="relative rounded-2xl overflow-hidden shadow-2xl border-4 border-surface-variant aspect-square">
              <img src={state.candidateImageUrl} alt="AI Concept" className="w-full h-full object-cover" />
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <button 
                onClick={handleRemake}
                className="py-4 rounded-xl font-bold text-on-surface bg-surface-variant border border-outline-variant hover:bg-surface-variant/80 transition-colors flex justify-center items-center gap-2"
              >
                <RefreshCw size={18} /> Remake Image
              </button>
              <button 
                onClick={handleApprove}
                className="py-4 px-2 rounded-xl font-black text-on-primary bg-primary shadow-lg shadow-primary/25 hover:scale-[1.02] transition-transform flex justify-center items-center gap-2"
              >
                Approve Reference and Continue <ChevronRight size={20} />
              </button>
            </div>
            <p className="text-center text-xs text-on-surface-variant">Still no PupCoins charged. Next, we'll customize it before building.</p>
          </div>
        ) : null}

      </div>
    </div>
  );
}
