import React, { useState, useEffect, useMemo } from "react";
import { PublicUser, UserProfile, Creation, PawprintTemplateManifest, PawprintField } from "../types";
import { Loader2, Sparkles, Camera, Download, RotateCcw, ImagePlus, Check } from "lucide-react";
import { authedFetch } from "../api";
import { CREDIT_PRICES, REUSE_DISCOUNT } from "../pricing";

interface PawprintsScreenProps {
  userProfile: UserProfile;
  creations: Creation[];
  onOpenCreditStore: () => void;
  onUserUpdate: (user: PublicUser) => void;
  onGoToFurBin: () => void;
}

export default function PawprintsScreen({ userProfile, creations, onOpenCreditStore, onUserUpdate, onGoToFurBin }: PawprintsScreenProps) {
  const [categories, setCategories] = useState<string[]>([]);
  const [templates, setTemplates] = useState<PawprintTemplateManifest[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<PawprintTemplateManifest | null>(null);
  
  const [generating, setGenerating] = useState(false);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [fileNames, setFileNames] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [pawprintId, setPawprintId] = useState<number | null>(null);
  const [ordering, setOrdering] = useState(false);
  
  useEffect(() => {
    fetch("/api/pawprints/templates")
      .then((r) => r.json())
      .then((d) => {
        setCategories(d.categories || []);
        setTemplates(d.templates || []);
      })
      .catch(() => {});
  }, []);

  const filtered = selectedCategory ? templates.filter((t) => t.category === selectedCategory) : [];

  const readFile = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

  const handleFieldChange = async (key: string, value: string, file?: File) => {
    if (file) {
      try {
        const base64 = await readFile(file);
        setFields(p => ({ ...p, [key]: base64 }));
        setFileNames(p => ({ ...p, [key]: file.name }));
      } catch {
        setError("Could not read image file.");
      }
    } else {
      setFields(p => ({ ...p, [key]: value }));
    }
  };

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
          templateId: selectedTemplate.id,
          category: selectedTemplate.category,
          fields
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to generate Pawprint");
      if (data.user) onUserUpdate(data.user);
      setResultUrl(data.url);
      setPawprintId(data.pawprintId);
    } catch (err: any) {
      setError(err.message || "Failed to generate Pawprint.");
    } finally {
      setGenerating(false);
    }
  };

  const handleOrderPrint = async () => {
    if (!pawprintId) return;
    setOrdering(true);
    try {
      const res = await authedFetch("/api/orders/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pawprintId, provider: "printful" })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to initiate order");
      
      // Redirect to Stripe Checkout
      window.location.href = data.url;
    } catch (err: any) {
      setError(err.message || "Could not start checkout.");
      setOrdering(false);
    }
  };

  const renderLivePreview = () => {
    if (!selectedTemplate) return null;
    const { widthIn, heightIn, dpi } = selectedTemplate.printSpec;
    const totalWidth = widthIn * dpi;
    const totalHeight = heightIn * dpi;
    const aspect = `${widthIn}/${heightIn}`;

    return (
      <div 
        className="relative w-full overflow-hidden bg-surface shadow-[0_12px_40px_rgba(68,42,34,0.12)] rounded-xl"
        style={{ aspectRatio: aspect }}
      >
        {selectedTemplate.slots.map((slot, i) => {
          const field = selectedTemplate.fields.find(f => f.key === slot.fieldKey);
          if (!field) return null;
          
          const val = fields[slot.fieldKey] || field.defaultValue || "";
          const top = (slot.y / totalHeight) * 100;
          const left = (slot.x / totalWidth) * 100;
          const width = (slot.width / totalWidth) * 100;
          const height = (slot.height / totalHeight) * 100;

          if (field.kind === "image") {
            return (
              <div
                key={i}
                className="absolute bg-surface-dim flex items-center justify-center overflow-hidden"
                style={{ top: `${top}%`, left: `${left}%`, width: `${width}%`, height: `${height}%`, borderRadius: slot.styleToken === "circle_crop" ? '50%' : '0' }}
              >
                {val ? (
                  <img src={val} alt="preview" className="w-full h-full object-cover" />
                ) : (
                  <ImagePlus className="w-8 h-8 text-secondary/30" />
                )}
              </div>
            );
          }

          // Text overlay preview (approximate rendering)
          let twClass = "absolute whitespace-normal overflow-hidden leading-tight p-2 flex ";
          let color = "text-primary";
          if (slot.styleToken === "header_text") twClass += " font-headline-xl text-3xl font-bold justify-center";
          else if (slot.styleToken === "handwritten_text") twClass += " font-headline-xl text-xl justify-center items-end pb-4";
          else if (slot.styleToken === "timeline_date") twClass += " font-headline-lg text-lg font-bold";
          else if (slot.styleToken === "timeline_desc") { twClass += " font-body-md text-base"; color = "text-on-surface-variant"; }
          else if (slot.styleToken === "quote_overlay") { twClass += " font-body-md text-xl italic text-center"; color = "text-secondary"; }
          
          if (slot.styleToken === "glass_text_box") {
            twClass += " bg-surface/80 backdrop-blur-md rounded-xl justify-center items-center text-center p-6 text-xl";
          }

          return (
            <div
              key={i}
              className={`${twClass} ${color}`}
              style={{ top: `${top}%`, left: `${left}%`, width: `${width}%`, height: `${height}%` }}
            >
              {val || field.placeholder || field.label}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="flex-1 overflow-y-auto bg-background text-on-background font-body-md">
      <div className="max-w-[1200px] mx-auto px-5 py-8 md:py-16">
        
        <header className="mb-12">
          <h1 className="font-headline-xl text-4xl text-primary font-extrabold mb-4">Pawprints Studio</h1>
          <p className="text-on-surface-variant text-lg max-w-2xl">
            Design beautiful, high-quality physical mementos. Choose a category, fill in your details, and preview your composition in real-time.
          </p>
        </header>

        {!selectedCategory ? (
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-6">
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className="group relative flex flex-col items-center justify-center p-6 rounded-xl bg-surface-container hover:bg-surface-container-high transition-all shadow-[0_4px_12px_rgba(68,42,34,0.06)] hover:-translate-y-1 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
              >
                <div className="w-16 h-16 rounded-full bg-surface-container-highest flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                   <Sparkles className="w-8 h-8 text-primary opacity-60" />
                </div>
                <span className="font-headline-lg-mobile text-lg text-primary capitalize font-bold text-center">
                  {cat.replace(/_/g, " ")}
                </span>
              </button>
            ))}
          </div>
        ) : !selectedTemplate ? (
          <div>
            <div className="flex items-center gap-4 mb-8">
              <button onClick={() => setSelectedCategory(null)} className="text-secondary hover:text-primary font-semibold flex items-center gap-2">
                &larr; Categories
              </button>
              <h2 className="font-headline-lg text-3xl text-primary capitalize font-bold">{selectedCategory.replace(/_/g, " ")} Templates</h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              {filtered.map((t) => (
                <button
                  key={t.id}
                  onClick={() => { setSelectedTemplate(t); setFields({}); setFileNames({}); setResultUrl(null); }}
                  className="flex flex-col text-left rounded-xl bg-surface-container overflow-hidden hover:shadow-[0_12px_32px_rgba(68,42,34,0.1)] transition-all border-2 border-transparent hover:border-primary-fixed-dim focus:outline-none"
                >
                  <div className="aspect-[5/7] bg-surface-container-high relative w-full flex items-center justify-center">
                    <span className="font-label-caps text-secondary uppercase tracking-widest">{t.aspectRatio} Layout</span>
                  </div>
                  <div className="p-5">
                    <h3 className="font-headline-lg-mobile text-xl font-bold text-primary mb-1">{t.name}</h3>
                    <p className="text-sm text-on-surface-variant font-body-sm">{t.fields.length} editable regions</p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex flex-col lg:flex-row gap-12">
            
            {/* Editor Sidebar */}
            <div className="w-full lg:w-1/3 flex flex-col gap-6">
              <div className="flex items-center gap-4 mb-2">
                <button onClick={() => { setSelectedTemplate(null); setResultUrl(null); }} className="text-secondary hover:text-primary font-semibold flex items-center gap-2">
                  &larr; Templates
                </button>
              </div>
              <h2 className="font-headline-lg text-2xl text-primary font-bold">{selectedTemplate.name}</h2>
              <p className="text-on-surface-variant mb-4">Customize your template below. Changes appear instantly in the preview.</p>

              {selectedTemplate.fields.map((f) => (
                <div key={f.key} className="flex flex-col gap-2">
                  <label className="font-label-caps text-sm text-primary font-bold uppercase tracking-wider">{f.label}</label>
                  {f.kind === "image" ? (
                    <div className="relative">
                       <input
                        type="file"
                        accept="image/png, image/jpeg, image/webp"
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) handleFieldChange(f.key, "", file);
                        }}
                      />
                      <div className="w-full bg-surface-container-high rounded-lg p-4 flex items-center justify-center gap-3 border-2 border-dashed border-outline-variant hover:border-primary transition-colors cursor-pointer">
                        <Camera className="w-5 h-5 text-secondary" />
                        <span className="text-primary font-semibold">
                          {fileNames[f.key] || "Upload Photo..."}
                        </span>
                      </div>
                    </div>
                  ) : f.kind === "long_text" ? (
                    <textarea
                      placeholder={f.placeholder || f.defaultValue}
                      maxLength={f.maxLength}
                      rows={4}
                      className="w-full bg-surface-container p-4 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary resize-none text-primary"
                      value={fields[f.key] || ""}
                      onChange={(e) => handleFieldChange(f.key, e.target.value)}
                    />
                  ) : (
                    <input
                      type={f.kind === "date" ? "date" : "text"}
                      placeholder={f.placeholder || f.defaultValue}
                      maxLength={f.maxLength}
                      className="w-full bg-surface-container p-4 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary text-primary"
                      value={fields[f.key] || ""}
                      onChange={(e) => handleFieldChange(f.key, e.target.value)}
                    />
                  )}
                </div>
              ))}

              <div className="mt-6 p-5 rounded-xl bg-secondary-container text-on-secondary-container">
                <div className="flex justify-between items-center mb-2">
                  <span className="font-bold">Generation Cost</span>
                  <span className="font-label-caps tracking-widest">{CREDIT_PRICES.PAWPRINT} Credits</span>
                </div>
                <p className="text-sm mb-6">Generates a high-resolution, print-ready file composite.</p>
                
                {error && <div className="text-error font-bold mb-4">{error}</div>}
                
                <button
                  disabled={generating}
                  onClick={createPawprint}
                  className="w-full bg-primary text-on-primary py-4 rounded-lg font-bold hover:bg-primary-container transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {generating ? (
                    <><Loader2 className="w-5 h-5 animate-spin" /> Compositing...</>
                  ) : (
                    <><Check className="w-5 h-5" /> Export High-Res</>
                  )}
                </button>
              </div>
            </div>

            {/* Live Preview Area */}
            <div className="w-full lg:w-2/3 flex flex-col items-center justify-start bg-surface-container-low p-8 md:p-12 rounded-xl border border-surface-variant shadow-inner">
              {resultUrl ? (
                <div className="w-full max-w-2xl flex flex-col items-center animate-in fade-in zoom-in duration-500">
                  <h3 className="font-headline-lg text-2xl text-primary mb-6">Your Print-Ready Pawprint!</h3>
                  <img src={resultUrl} alt="Generated Pawprint" className="w-full h-auto rounded-xl shadow-[0_24px_60px_rgba(68,42,34,0.2)] mb-8" />
                  <div className="flex items-center gap-4">
                    <a
                      href={resultUrl}
                      download="pawprint_export.png"
                      target="_blank" rel="noreferrer"
                      className="flex items-center gap-2 bg-secondary text-on-secondary px-6 py-3 rounded-lg font-bold hover:bg-secondary-fixed-variant transition-colors"
                    >
                      <Download className="w-5 h-5" /> Download Asset
                    </a>
                    <button
                      onClick={handleOrderPrint}
                      disabled={ordering}
                      className="flex items-center gap-2 bg-primary text-on-primary px-6 py-3 rounded-lg font-bold hover:bg-primary-container transition-colors disabled:opacity-50"
                    >
                      {ordering ? <Loader2 className="w-5 h-5 animate-spin" /> : <Sparkles className="w-5 h-5" />}
                      Order Physical Print
                    </button>
                  </div>
                </div>
              ) : (
                <div className="w-full max-w-[500px]">
                  <div className="flex justify-between items-center w-full mb-6 text-on-surface-variant font-label-caps uppercase tracking-widest text-sm">
                    <span>Live Preview</span>
                    <span>{selectedTemplate.printSpec.widthIn}" x {selectedTemplate.printSpec.heightIn}" @ {selectedTemplate.printSpec.dpi} DPI</span>
                  </div>
                  {renderLivePreview()}
                </div>
              )}
            </div>
            
          </div>
        )}
      </div>
    </div>
  );
}
