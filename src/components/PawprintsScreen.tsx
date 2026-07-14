import React, { useState, useEffect, useMemo } from "react";
import { PublicUser, UserProfile, Creation } from "../types";
import { Loader2, Sparkles, Camera, ImagePlus, Download, RotateCcw, Archive } from "lucide-react";
import { authedFetch } from "../api";
import { CREDIT_PRICES, REUSE_DISCOUNT } from "../pricing";
import PawprintWalkthrough from "./PawprintWalkthrough";

interface PawprintsScreenProps {
  userProfile: UserProfile;
  creations: Creation[];
  onOpenCreditStore: () => void;
  onUserUpdate: (user: PublicUser) => void;
  onGoToFurBin: () => void;
}

interface Template {
  category: string;
  layoutId: string;
  name: string;
  tone: string;
  sampleCopy: string[];
  fieldSchema: { key: string; type: string; label: string; maxLength?: number }[];
  imagePromptTemplate: string;
}

export default function PawprintsScreen({ userProfile, creations, onOpenCreditStore, onUserUpdate, onGoToFurBin }: PawprintsScreenProps) {
  const [categories, setCategories] = useState<string[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);
  const [generating, setGenerating] = useState(false);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [fileNames, setFileNames] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [reuseCreationId, setReuseCreationId] = useState<number | null>(null);
  const [showWalkthrough, setShowWalkthrough] = useState(false);

  // Themed graphic + gradient per category (watermark shown at low opacity on the cards).
  const categoryGraphic: Record<string, string> = {
    grieving_loss: "🕊️", new_puppy: "🐶", veterinarian: "🩺", holiday_birthday: "🎂",
    environment: "🌿", postcard_travel: "✈️", get_well: "💐", miss_you: "💌", pet_business: "🏪",
  };
  const categoryGradient: Record<string, string> = {
    grieving_loss: "from-slate-400/20 to-slate-600/10", new_puppy: "from-amber-300/25 to-orange-400/10",
    veterinarian: "from-teal-300/25 to-cyan-500/10", holiday_birthday: "from-pink-400/25 to-fuchsia-500/10",
    environment: "from-green-400/25 to-emerald-600/10", postcard_travel: "from-sky-400/25 to-blue-500/10",
    get_well: "from-rose-300/25 to-red-400/10", miss_you: "from-violet-400/25 to-purple-500/10",
    pet_business: "from-indigo-300/25 to-indigo-500/10",
  };

  // Prior generated images the user can reuse (skip fresh gen for 20% off).
  const reusable = useMemo(() => creations.filter((c) => c.image_url), [creations]);
  const reusePrice = Math.round(CREDIT_PRICES.PAWPRINT * (1 - REUSE_DISCOUNT));
  const effectivePrice = reuseCreationId ? reusePrice : CREDIT_PRICES.PAWPRINT;

  useEffect(() => {
    fetch("/api/pawprints/templates")
      .then((r) => r.json())
      .then((d) => {
        setCategories(d.categories || []);
        setTemplates(d.templates || []);
      })
      .catch(() => {});
  }, []);

  const categoryLabels: Record<string, string> = {
    grieving_loss: "Grieving Loss", new_puppy: "New Puppy", veterinarian: "Veterinarian",
    holiday_birthday: "Holiday & Birthday", environment: "Environment", postcard_travel: "Postcard & Travel",
    get_well: "Get Well", miss_you: "Miss You", pet_business: "Pet Business",
  };

  const filtered = selectedCategory ? templates.filter((t) => t.category === selectedCategory) : [];
  const readFile = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

  const createPawprint = async () => {
    if (!selectedTemplate) return;
    setGenerating(true);
    setError("");
    setResultUrl(null);
    try {
      const idempotencyKey = typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const res = await authedFetch("/api/pawprints/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
        body: JSON.stringify({
          templateId: selectedTemplate.layoutId,
          category: selectedTemplate.category,
          layoutId: selectedTemplate.layoutId,
          fields,
          customName: fields.petName || fields.name || "",
          customMessage: fields.message || "",
          reuseCreationId: reuseCreationId || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Could not create your Pawprint.");
      setResultUrl(data.url);
      if (data.user) onUserUpdate(data.user as PublicUser);
    } catch (err: any) {
      setError(err.message || "Could not create your Pawprint.");
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="w-full max-w-3xl mx-auto px-4 pt-6 pb-28 animate-fade-in">
      <div data-tour="pawprints-title" className="flex flex-wrap items-center gap-3 mb-6">
        <Sparkles size={22} className="text-primary" />
        <h1 className="text-xl font-extrabold text-on-surface">Pawprints — Digital Stationery</h1>
        <button
          type="button"
          onClick={onGoToFurBin}
          className="ml-auto inline-flex min-h-11 items-center gap-2 rounded-xl border border-outline-variant/50 px-3 text-sm font-black text-on-surface-variant hover:border-primary/40 hover:text-primary"
        >
          <Archive size={17} /> Fur Bin©️
        </button>
        <button
          type="button"
          onClick={() => setShowWalkthrough(true)}
          className="min-h-11 rounded-xl border border-primary/30 px-3 text-sm font-black text-primary hover:bg-primary/5"
        >
          Show me how
        </button>
      </div>
      <p className="text-base text-on-surface-variant mb-4 leading-relaxed">
        Create custom stationery from smart templates. Each creation costs <strong>{CREDIT_PRICES.PAWPRINT} credits</strong>.
        You have <strong className="text-secondary">{userProfile.credits} credits</strong>.
      </p>

      {/* Category picker — larger vertical cards with a themed graphic watermark */}
      {!selectedCategory && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`group relative overflow-hidden rounded-3xl border border-outline-variant/40 hover:border-primary/60 transition-all cursor-pointer aspect-[3/4] flex flex-col justify-end p-4 text-left bg-gradient-to-br ${categoryGradient[cat] || "from-primary/15 to-primary/5"}`}
            >
              {/* Themed graphic watermark at ~18% opacity */}
              <span
                aria-hidden
                className="pointer-events-none absolute -top-2 right-1 text-[7rem] leading-none select-none opacity-[0.18] group-hover:opacity-25 group-hover:scale-105 transition-all duration-300"
              >
                {categoryGraphic[cat] || "🐾"}
              </span>
              <div className="relative z-10">
                <span className="text-base font-extrabold text-on-surface block leading-tight">{categoryLabels[cat] || cat}</span>
                <span className="text-[11px] text-on-surface-variant block mt-1">{templates.filter((t) => t.category === cat).length} layouts</span>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Layout picker */}
      {selectedCategory && !selectedTemplate && (
        <div>
          <button onClick={() => setSelectedCategory(null)} className="text-xs text-primary font-bold mb-4 hover:underline cursor-pointer">← Back to categories</button>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {filtered.map((t) => (
              <button
                key={t.layoutId}
                onClick={() => setSelectedTemplate(t)}
                className="glass-panel border border-outline-variant/40 rounded-2xl p-4 text-left hover:border-primary/50 transition-all cursor-pointer"
              >
                <span className="text-sm font-bold text-on-surface">{t.name}</span>
                <span className="text-[10px] text-on-surface-variant block mt-1 capitalize">{t.tone} tone</span>
                <span className="text-[10px] text-on-surface-variant block">{t.fieldSchema.length} fields</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Template editor */}
      {selectedTemplate && (
        <div>
          <button onClick={() => setSelectedTemplate(null)} className="text-xs text-primary font-bold mb-4 hover:underline cursor-pointer">← Back to layouts</button>
          <div className="glass-panel border border-outline-variant/40 rounded-3xl p-6 mb-6">
            <h3 className="text-sm font-extrabold text-on-surface mb-3">{selectedTemplate.name}</h3>
            <p className="text-xs text-on-surface-variant mb-3 italic">"{selectedTemplate.sampleCopy[0]}"</p>

            {/* Reuse a previous image of the same subject — 20% off */}
            {reusable.length > 0 && (
              <div className="mb-4 rounded-2xl border border-secondary/30 bg-secondary/5 p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[11px] font-black uppercase tracking-wide text-secondary">Reuse a photo you made — save 20%</span>
                  {reuseCreationId && (
                    <button onClick={() => setReuseCreationId(null)} className="text-[10px] font-bold text-on-surface-variant hover:text-primary flex items-center gap-1">
                      <RotateCcw size={11} /> Generate fresh instead
                    </button>
                  )}
                </div>
                <p className="text-[10px] text-on-surface-variant mb-2">Same pet? Pick one of your earlier images and we'll skip the redraw — <strong>{reusePrice} cr instead of {CREDIT_PRICES.PAWPRINT}</strong>.</p>
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {reusable.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => setReuseCreationId((cur) => (cur === c.id ? null : c.id))}
                      className={`relative shrink-0 w-16 h-16 rounded-xl overflow-hidden border-2 transition-all ${reuseCreationId === c.id ? "border-secondary ring-2 ring-secondary/30" : "border-transparent hover:border-secondary/40"}`}
                      title={c.name || "Reuse this image"}
                    >
                      <img src={c.image_url as string} alt={c.name || "Creation"} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-3">
              {selectedTemplate.fieldSchema.map((field) => (
                <div key={field.key}>
                  <label className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wide">{field.label}</label>
                  {field.type === "image" ? (
                    <label className="block mt-1 p-8 border-2 border-dashed border-outline-variant/40 rounded-xl text-center text-xs text-on-surface-variant hover:border-primary/40 transition-all cursor-pointer">
                      <Camera size={20} className="mx-auto mb-1 text-primary" />
                      {fileNames[field.key] || `Upload ${field.label}`}
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          if (!file.type.startsWith("image/")) {
                            setError("Please choose an image file.");
                            return;
                          }
                          const dataUrl = await readFile(file);
                          setFields((prev) => ({ ...prev, [field.key]: dataUrl }));
                          setFileNames((prev) => ({ ...prev, [field.key]: file.name }));
                        }}
                      />
                    </label>
                  ) : (
                    <input
                      placeholder={field.label}
                      maxLength={field.maxLength || 200}
                      value={fields[field.key] || ""}
                      onChange={(e) => setFields((prev) => ({ ...prev, [field.key]: e.target.value }))}
                      className="w-full mt-1 p-2.5 rounded-xl border border-outline-variant/30 bg-surface-container text-xs text-on-surface placeholder:text-on-surface-variant/50 focus:outline-none focus:ring-2 focus:ring-primary/40"
                    />
                  )}
                </div>
              ))}
              {error && <p className="text-xs font-bold text-error">{error}</p>}
              {resultUrl && (
                <div className="rounded-2xl border border-primary/30 bg-primary/5 p-3">
                  <img src={resultUrl} alt="Generated Pawprint" className="w-full rounded-xl border border-outline-variant/30" />
                  <a href={resultUrl} target="_blank" rel="noopener noreferrer" className="mt-3 min-h-11 rounded-xl bg-primary text-on-primary text-xs font-black uppercase tracking-wide flex items-center justify-center gap-2">
                    <Download size={14} /> Open Pawprint
                  </a>
                </div>
              )}
            </div>
            <button
              data-tour="pawprints-create"
              onClick={createPawprint}
              disabled={generating || (!userProfile.isAdmin && userProfile.credits < effectivePrice)}
              className="mt-4 w-full py-3 bg-primary text-on-primary rounded-xl text-xs font-black uppercase tracking-wide hover:opacity-90 active:scale-95 transition-all cursor-pointer disabled:opacity-40 flex items-center justify-center gap-2"
            >
              {generating ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
              {generating ? "Generating..." : reuseCreationId ? `Create Pawprint (${effectivePrice} credits · 20% off)` : `Create Pawprint (${effectivePrice} credits)`}
            </button>
            {!userProfile.isAdmin && userProfile.credits < effectivePrice && (
              <button type="button" onClick={onOpenCreditStore} className="mt-3 w-full py-3 rounded-xl border border-primary/30 text-primary text-xs font-black uppercase tracking-wide">
                Buy credits
              </button>
            )}
          </div>
        </div>
      )}

      {showWalkthrough && (
        <PawprintWalkthrough
          onClose={() => setShowWalkthrough(false)}
          onStart={() => { setSelectedTemplate(null); setSelectedCategory("holiday_birthday"); }}
        />
      )}
    </div>
  );
}
