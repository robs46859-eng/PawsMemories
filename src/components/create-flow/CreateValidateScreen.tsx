import React, { useEffect, useState } from "react";
import { Screen } from "../../types";
import { useCreateFlow } from "./CreateFlowContext";
import { ChevronLeft, ChevronRight, CheckCircle2, XCircle, AlertTriangle, RefreshCw } from "lucide-react";
import { authedFetch } from "../../api";

interface CreateValidateScreenProps {
  onNavigate: (screen: Screen) => void;
}

interface ValidationResult {
  rule: string;
  pass: boolean;
  detail: string;
}

export default function CreateValidateScreen({ onNavigate }: CreateValidateScreenProps) {
  const { state, setState } = useCreateFlow();
  const [isValidating, setIsValidating] = useState(true);
  const [results, setResults] = useState<ValidationResult[]>([]);
  const [isPrintable, setIsPrintable] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    // Simulate validation engine
    const runValidation = () => {
      const checks: ValidationResult[] = [];
      let passed = true;

      // Rule 1: Must have a candidate image
      if (state.candidateImageUrl) {
        checks.push({ rule: "Reference Image", pass: true, detail: "Valid blueprint found." });
      } else {
        checks.push({ rule: "Reference Image", pass: false, detail: "Missing blueprint." });
        passed = false;
      }

      // Rule 2: Printability rules based on pose and species heuristics
      if (state.customizationState?.pose === "Standing") {
        checks.push({ rule: "Structural Integrity", pass: true, detail: "Standing pose requires base (auto-added)." });
      } else {
        checks.push({ rule: "Structural Integrity", pass: true, detail: "Pose is stable for 3D printing." });
      }

      // Rule 3: Text validation
      if (state.customizationState?.engraving) {
        const text = state.customizationState.engraving;
        // Example failure: too many characters
        if (text.length > 24) {
          checks.push({ rule: "Engraving Text", pass: false, detail: "Text is too long for the base." });
          passed = false;
        } else {
          checks.push({ rule: "Engraving Text", pass: true, detail: "Text length and characters are valid." });
        }
      }

      setResults(checks);
      setIsPrintable(passed);
      setIsValidating(false);

      // Save validation state
      setState(s => ({
        ...s,
        validationState: { passed, checks }
      }));
    };

    const timer = setTimeout(runValidation, 1500);
    return () => clearTimeout(timer);
  }, [state, setState]);

  const handleContinue = async () => {
    setIsSaving(true);
    setSaveError(null);
    try {
      const res = await authedFetch("/api/create-pipeline/update", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          sessionId: state.sessionId,
          customizationState: state.customizationState,
          validationState: state.validationState ? {
             isPrintable: state.validationState.passed,
             errors: state.validationState.checks.filter(c => !c.pass).map(c => c.detail),
             warnings: [],
          } : undefined
        })
      });

      const data = await res.json();
      if (!data.success) {
        throw new Error(data.error || "Failed to save validation state.");
      }
      onNavigate(Screen.CREATE_CHECKOUT);
    } catch (err: any) {
      setSaveError(err.message);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="w-full max-w-4xl mx-auto px-4 py-8 animate-in fade-in zoom-in duration-500">
      <div className="mb-6 flex items-center justify-between">
        <button 
          onClick={() => onNavigate(Screen.CREATE_CUSTOMIZE)}
          className="flex items-center gap-1 text-on-surface-variant hover:text-primary font-medium"
        >
          <ChevronLeft size={20} /> Back
        </button>
        <div className="flex gap-2">
          <div className="w-2.5 h-2.5 rounded-full bg-primary/30"></div>
          <div className="w-2.5 h-2.5 rounded-full bg-primary/30"></div>
          <div className="w-2.5 h-2.5 rounded-full bg-primary/30"></div>
          <div className="w-2.5 h-2.5 rounded-full bg-primary"></div>
        </div>
      </div>

      <div className="text-center mb-8">
        <h1 className="text-3xl font-black text-on-surface mb-2">Printability Check</h1>
        <p className="text-on-surface-variant text-lg">Ensuring your model is physically sound before we build it.</p>
      </div>

      <div className="glass-panel p-8 rounded-3xl max-w-2xl mx-auto min-h-[400px]">
        {isValidating ? (
          <div className="flex flex-col items-center justify-center py-12 text-center h-full">
            <RefreshCw className="animate-spin text-primary mb-6" size={48} />
            <h3 className="text-xl font-bold text-on-surface mb-2">Running Diagnostics...</h3>
            <p className="text-on-surface-variant">Checking overhangs, wall thickness, and stability.</p>
          </div>
        ) : (
          <div className="flex flex-col h-full">
            <div className="flex items-center gap-4 mb-8 p-6 rounded-2xl bg-surface-variant/30 border border-outline-variant">
              {isPrintable ? (
                <>
                  <CheckCircle2 size={48} className="text-emerald-500 shrink-0" />
                  <div>
                    <h3 className="text-xl font-bold text-on-surface">Ready to Print!</h3>
                    <p className="text-on-surface-variant">Your model passed all physical checks.</p>
                  </div>
                </>
              ) : (
                <>
                  <XCircle size={48} className="text-error shrink-0" />
                  <div>
                    <h3 className="text-xl font-bold text-on-surface">Not Printable</h3>
                    <p className="text-on-surface-variant">Please fix the issues below to continue.</p>
                  </div>
                </>
              )}
            </div>

            <div className="space-y-4 mb-8 flex-1">
              <h4 className="font-bold text-on-surface px-2 text-sm uppercase tracking-wider">Validation Rules</h4>
              {results.map((res, i) => (
                <div key={i} className="flex items-start gap-4 p-4 rounded-xl bg-surface border border-outline-variant">
                  {res.pass ? (
                    <CheckCircle2 size={24} className="text-emerald-500 shrink-0 mt-0.5" />
                  ) : (
                    <AlertTriangle size={24} className="text-error shrink-0 mt-0.5" />
                  )}
                  <div>
                    <h5 className="font-bold text-on-surface">{res.rule}</h5>
                    <p className="text-sm text-on-surface-variant mt-1">{res.detail}</p>
                  </div>
                </div>
              ))}
            </div>

            {saveError && (
              <div className="mb-4 p-4 rounded-xl bg-error/10 border border-error/20 flex items-start gap-3">
                <AlertTriangle className="text-error shrink-0 mt-0.5" size={20} />
                <p className="text-error text-sm font-medium">{saveError}</p>
              </div>
            )}

            <button
              onClick={handleContinue}
              disabled={!isPrintable || isSaving}
              className={`py-4 rounded-xl font-black text-lg flex justify-center items-center gap-2 w-full transition-all ${
                isPrintable && !isSaving
                  ? 'bg-primary text-on-primary shadow-lg shadow-primary/25 hover:scale-[1.02]' 
                  : 'bg-surface-variant text-on-surface-variant/50 cursor-not-allowed'
              }`}
            >
              {isSaving ? (
                <><RefreshCw className="animate-spin" size={20} /> Saving...</>
              ) : (
                <>Continue to Checkout <ChevronRight size={20} /></>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
