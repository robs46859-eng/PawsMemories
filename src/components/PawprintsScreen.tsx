import React, { useState, useEffect } from "react";
import { UserProfile } from "../types";
import { Loader2, Sparkles, Camera, ImagePlus, Download } from "lucide-react";
import { authedFetch } from "../api";

interface PawprintsScreenProps {
  userProfile: UserProfile;
  onOpenCreditStore: () => void;
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

export default function PawprintsScreen({ userProfile, onOpenCreditStore }: PawprintsScreenProps) {
  const [categories, setCategories] = useState<string[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);
  const [generating, setGenerating] = useState(false);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [fileNames, setFileNames] = useState<Record<string, string>>({});
  const [error, setError] = useState("");

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
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Could not create your Pawprint.");
      setResultUrl(data.url);
    } catch (err: any) {
      setError(err.message || "Could not create your Pawprint.");
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="w-full max-w-3xl mx-auto px-4 pt-6 pb-28 animate-fade-in">
      <div className="flex items-center gap-3 mb-6">
        <Sparkles size={22} className="text-primary" />
        <h1 className="text-xl font-extrabold text-on-surface">Pawprints — Digital Stationery</h1>
      </div>
      <p className="text-xs text-on-surface-variant mb-4">
        Create custom stationery from smart templates. Each creation costs <strong>1 pawprint token</strong>.
        You have <strong className="text-secondary">{userProfile.pawprintTokens || 0}</strong> pawprint tokens.
      </p>

      {/* Category picker */}
      {!selectedCategory && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className="glass-panel border border-outline-variant/40 rounded-2xl p-4 text-left hover:border-primary/50 transition-all cursor-pointer"
            >
              <span className="text-sm font-bold text-on-surface">{categoryLabels[cat] || cat}</span>
              <span className="text-[10px] text-on-surface-variant block mt-1">{templates.filter((t) => t.category === cat).length} layouts</span>
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
              onClick={createPawprint}
              disabled={generating || (userProfile.pawprintTokens || 0) < 1}
              className="mt-4 w-full py-3 bg-primary text-on-primary rounded-xl text-xs font-black uppercase tracking-wide hover:opacity-90 active:scale-95 transition-all cursor-pointer disabled:opacity-40 flex items-center justify-center gap-2"
            >
              {generating ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
              {generating ? "Generating..." : `Create Pawprint (1 token)`}
            </button>
            {(userProfile.pawprintTokens || 0) < 1 && (
              <button type="button" onClick={onOpenCreditStore} className="mt-3 w-full py-3 rounded-xl border border-primary/30 text-primary text-xs font-black uppercase tracking-wide">
                Get pawprint tokens
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
