import React, { useState, useRef, useCallback, useEffect } from "react";
import { submitImageTo3D, generateTextReference, pollJob, type ImageTo3DGeometry } from "../api";
import PetModelViewer from "./PetModelViewer";
import { Upload, X, Download, RotateCw, ChevronDown, ChevronUp, Layers, Sparkles, AlertCircle, ImageIcon, Type, Wand2, Palette } from "lucide-react";
import {
  TEXT_STYLE_OPTIONS,
  TEXT_FRAMING_OPTIONS,
  TEXT_ANGLE_OPTIONS,
  TEXT_LIGHTING_OPTIONS,
  GEOMETRY_DETAIL_OPTIONS,
  GEOMETRY_TEXTURE_OPTIONS,
} from "../../avatarPrompts";

interface ImageTo3DPanelProps {
  credits: number;
  isAdmin?: boolean;
  onCreditsSpent?: (amount: number) => void;
}

/** Convert a File to a base64 data URL. */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

type GenerationState = "idle" | "uploading" | "generating" | "done" | "failed";

export default function ImageTo3DPanel({ credits, isAdmin, onCreditsSpent }: ImageTo3DPanelProps) {
  // Primary image
  const [image, setImage] = useState<string | null>(null);
  const [imageName, setImageName] = useState<string>("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Multiview
  const [showMultiview, setShowMultiview] = useState(false);
  const [mvLeft, setMvLeft] = useState<string | null>(null);
  const [mvBack, setMvBack] = useState<string | null>(null);
  const [mvRight, setMvRight] = useState<string | null>(null);

  // Generation state
  const [state, setState] = useState<GenerationState>("idle");
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState("");
  const [modelUrl, setModelUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [jobId, setJobId] = useState<number | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Drag state
  const [isDragging, setIsDragging] = useState(false);

  // Show styling options in image mode
  const [showStyling, setShowStyling] = useState(false);

  // Input mode: upload an image, or describe it with a structured text prompt.
  const [mode, setMode] = useState<"image" | "text">("image");

  // Styling / prompt fields (shared between text and image modes).
  // In text mode these drive the reference image generation.
  // In image mode they're optional overrides for the 3D generation.
  const [subject, setSubject] = useState("");
  const [style, setStyle] = useState(TEXT_STYLE_OPTIONS.find((o) => o.recommended)?.id || TEXT_STYLE_OPTIONS[0].id);
  const [framing, setFraming] = useState(TEXT_FRAMING_OPTIONS.find((o) => o.recommended)?.id || TEXT_FRAMING_OPTIONS[0].id);
  const [angle, setAngle] = useState(TEXT_ANGLE_OPTIONS.find((o) => o.recommended)?.id || TEXT_ANGLE_OPTIONS[0].id);
  const [lighting, setLighting] = useState(TEXT_LIGHTING_OPTIONS.find((o) => o.recommended)?.id || TEXT_LIGHTING_OPTIONS[0].id);
  const [geoDetail, setGeoDetail] = useState(GEOMETRY_DETAIL_OPTIONS.find((o) => o.recommended)?.id || GEOMETRY_DETAIL_OPTIONS[0].id);
  const [geoTexture, setGeoTexture] = useState(GEOMETRY_TEXTURE_OPTIONS.find((o) => o.recommended)?.id || GEOMETRY_TEXTURE_OPTIONS[0].id);
  const [previewing, setPreviewing] = useState(false);

  const MODEL_COST = 400;

  // Cleanup poller on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const handleFile = useCallback(async (file: File, target: "main" | "left" | "back" | "right") => {
    if (!file.type.startsWith("image/")) return;
    const b64 = await fileToBase64(file);
    switch (target) {
      case "main": setImage(b64); setImageName(file.name); break;
      case "left": setMvLeft(b64); break;
      case "back": setMvBack(b64); break;
      case "right": setMvRight(b64); break;
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent, target: "main" | "left" | "back" | "right" = "main") => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file, target);
  }, [handleFile]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleGenerate = useCallback(async () => {
    if (!image) return;
    setState("uploading");
    setError(null);
    setProgress(0);
    setStatusText("Uploading image…");
    setModelUrl(null);

    try {
      const multiview = (mvLeft || mvBack || mvRight)
        ? { left: mvLeft || undefined, back: mvBack || undefined, right: mvRight || undefined }
        : undefined;

      setState("generating");
      setStatusText("Starting 3D generation…");
      // Always pass geometry overrides — both image and text mode
      const geometry: ImageTo3DGeometry = { detail: geoDetail, texture: geoTexture };
      const result = await submitImageTo3D(image, multiview, geometry);
      setJobId(result.jobId);
      onCreditsSpent?.(MODEL_COST);

      // Start polling
      const poll = setInterval(async () => {
        try {
          const status = await pollJob(result.jobId);
          if (status.status === "done") {
            clearInterval(poll);
            pollRef.current = null;
            setProgress(100);
            setStatusText("3D model ready!");
            setModelUrl(status.model_url || null);
            setState("done");
          } else if (status.status === "failed") {
            clearInterval(poll);
            pollRef.current = null;
            setError(status.error || "Generation failed.");
            setState("failed");
          } else {
            // running/queued
            const p = (status as any).progress;
            if (typeof p === "number") setProgress(p);
            setStatusText(`Generating 3D model… ${typeof p === "number" ? `${p}%` : ""}`);
          }
        } catch {
          // Transient poll failure — keep trying
        }
      }, 3000);
      pollRef.current = poll;
    } catch (err: any) {
      setState("failed");
      setError(err?.message || "Failed to start generation.");
    }
  }, [image, mvLeft, mvBack, mvRight, onCreditsSpent, mode, geoDetail, geoTexture]);

  /** Text mode: generate a reference image from the structured prompt, then
   *  drop it into the shared preview slot so the user can review before paying
   *  for the mesh. This step only spends image-gen budget. */
  const handleTextPreview = useCallback(async () => {
    if (subject.trim().length < 2 || previewing) return;
    setPreviewing(true);
    setError(null);
    try {
      const { image: refImage } = await generateTextReference({ subject, style, framing, angle, lighting });
      setImage(refImage);
      setImageName("text-prompt");
      setState("idle");
    } catch (err: any) {
      setError(err?.message || "Could not generate a reference image.");
    } finally {
      setPreviewing(false);
    }
  }, [subject, style, framing, angle, lighting, previewing]);

  const handleReset = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    setImage(null);
    setImageName("");
    setMvLeft(null);
    setMvBack(null);
    setMvRight(null);
    setState("idle");
    setProgress(0);
    setStatusText("");
    setModelUrl(null);
    setError(null);
    setJobId(null);
  }, []);

  const canGenerate = image && (state === "idle" || state === "failed") && (isAdmin || credits >= MODEL_COST);

  /** Renders a small drop-zone for multiview slots. */
  const MvSlot = ({ label, value, onChange }: { label: string; value: string | null; onChange: (v: string | null) => void }) => {
    const ref = useRef<HTMLInputElement>(null);
    return (
      <div className="flex flex-col items-center gap-1.5">
        <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">{label}</span>
        {value ? (
          <div className="relative group w-20 h-20 rounded-xl overflow-hidden border-2 border-outline-variant/30">
            <img src={value} alt={label} className="w-full h-full object-cover" />
            <button
              onClick={() => onChange(null)}
              className="absolute top-0.5 right-0.5 w-5 h-5 bg-error/90 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
            >
              <X size={10} />
            </button>
          </div>
        ) : (
          <button
            onClick={() => ref.current?.click()}
            onDrop={(e) => { e.preventDefault(); e.stopPropagation(); const f = e.dataTransfer.files?.[0]; if (f) fileToBase64(f).then(b64 => onChange(b64)); }}
            onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
            className="w-20 h-20 rounded-xl border-2 border-dashed border-outline-variant/40 hover:border-primary/60 flex flex-col items-center justify-center gap-1 text-on-surface-variant/50 hover:text-primary/80 transition-all cursor-pointer"
          >
            <Upload size={14} />
            <span className="text-[9px]">Drop</span>
          </button>
        )}
        <input ref={ref} type="file" accept="image/*" className="hidden" onChange={async (e) => { const f = e.target.files?.[0]; if (f) onChange(await fileToBase64(f)); e.target.value = ""; }} />
      </div>
    );
  };

  /** Labeled dropdown driven by the shared 3D-safe option lists. */
  const PromptSelect = ({
    label, value, onChange, options,
  }: {
    label: string;
    value: string;
    onChange: (v: string) => void;
    options: { id: string; label: string; hint?: string; recommended?: boolean }[];
  }) => {
    const active = options.find((o) => o.id === value);
    return (
      <label className="flex flex-col gap-1">
        <span className="text-[11px] font-bold text-on-surface-variant uppercase tracking-wider">{label}</span>
        <div className="relative">
          <select
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="w-full appearance-none bg-surface-container-high text-on-surface text-sm font-medium rounded-xl border border-outline-variant/25 pl-3 pr-8 py-2.5 focus:outline-none focus:border-primary/60 cursor-pointer"
          >
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}{o.recommended ? "  (recommended)" : ""}
              </option>
            ))}
          </select>
          <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-on-surface-variant/60 pointer-events-none" />
        </div>
        {active?.hint && <span className="text-[10px] text-on-surface-variant/60 leading-tight">{active.hint}</span>}
      </label>
    );
  };

  return (
    <div className="w-full max-w-2xl mx-auto px-4 py-6 md:py-10 animate-fade-in">
      {/* Header */}
      <div className="text-center mb-6">
        <div className="inline-flex items-center gap-2 bg-tertiary/10 text-tertiary px-4 py-1.5 rounded-full text-xs font-bold mb-3">
          <Layers size={14} />
          3D Studio
        </div>
        <h1 className="text-headline-md font-headline-xl font-extrabold text-on-surface mb-1.5">
          {mode === "text" ? "Text → 3D Model" : "Image → 3D Model"}
        </h1>
        <p className="text-sm text-on-surface-variant max-w-md mx-auto leading-relaxed">
          {mode === "text"
            ? "Describe what to make and pick a style — we render a clean reference image, then turn it into a downloadable GLB."
            : "Upload any image and convert it into a downloadable GLB 3D model. Add optional side views for higher quality geometry."}
        </p>
      </div>

      {/* Main card */}
      <div className="bg-surface-container-low/60 backdrop-blur-xl border border-outline-variant/20 rounded-3xl p-5 md:p-8 shadow-xl">

        {/* Input mode toggle */}
        {!(state === "done" && modelUrl) && (
          <div className="flex gap-1.5 p-1 bg-surface-container/60 rounded-2xl mb-5 max-w-xs mx-auto">
            {([
              { id: "image", label: "Upload image", icon: ImageIcon },
              { id: "text", label: "Describe it", icon: Type },
            ] as const).map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => {
                  if (state === "generating" || state === "uploading") return;
                  setMode(id);
                  setImage(null);
                  setImageName("");
                  setError(null);
                  setState("idle");
                }}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                  mode === id
                    ? "bg-primary text-on-primary shadow"
                    : "text-on-surface-variant hover:text-on-surface"
                }`}
              >
                <Icon size={13} /> {label}
              </button>
            ))}
          </div>
        )}

        {/* Upload zone / preview */}
        {state === "done" && modelUrl ? (
          /* --- 3D Viewer --- */
          <div className="flex flex-col items-center gap-4">
            <div className="w-full aspect-square max-h-[420px] rounded-2xl overflow-hidden border border-outline-variant/20 bg-surface-dim/50">
              <PetModelViewer src={modelUrl} alt="Generated 3D model" autoRotate />
            </div>
            <div className="flex gap-3 w-full">
              <a
                href={modelUrl}
                download="model.glb"
                className="flex-1 flex items-center justify-center gap-2 py-3 bg-primary text-on-primary rounded-2xl font-bold text-sm shadow-lg hover:shadow-xl hover:bg-primary/90 transition-all active:scale-[0.97]"
              >
                <Download size={16} /> Download GLB
              </a>
              <button
                onClick={handleReset}
                className="flex items-center justify-center gap-2 px-5 py-3 bg-surface-container-high text-on-surface rounded-2xl font-bold text-sm border border-outline-variant/20 hover:bg-surface-container-highest transition-all active:scale-[0.97] cursor-pointer"
              >
                <RotateCw size={14} /> New
              </button>
            </div>
          </div>
        ) : (
          /* --- Upload / Describe + Generate --- */
          <div className="flex flex-col gap-5">

            {/* Text-prompt form */}
            {mode === "text" && (state === "idle" || state === "failed") && (
              <div className="flex flex-col gap-4">
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] font-bold text-on-surface-variant uppercase tracking-wider">Subject</span>
                  <textarea
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    rows={2}
                    maxLength={600}
                    placeholder="e.g. a fluffy orange tabby cat wearing a tiny wizard hat"
                    className="w-full resize-none bg-surface-container-high text-on-surface text-sm rounded-xl border border-outline-variant/25 px-3 py-2.5 focus:outline-none focus:border-primary/60 placeholder:text-on-surface-variant/40"
                  />
                </label>

                <div className="grid grid-cols-2 gap-3">
                  <PromptSelect label="Style" value={style} onChange={setStyle} options={TEXT_STYLE_OPTIONS} />
                  <PromptSelect label="Framing" value={framing} onChange={setFraming} options={TEXT_FRAMING_OPTIONS} />
                  <PromptSelect label="View angle" value={angle} onChange={setAngle} options={TEXT_ANGLE_OPTIONS} />
                  <PromptSelect label="Lighting" value={lighting} onChange={setLighting} options={TEXT_LIGHTING_OPTIONS} />
                  <PromptSelect label="Detail" value={geoDetail} onChange={setGeoDetail} options={GEOMETRY_DETAIL_OPTIONS} />
                  <PromptSelect label="Texture" value={geoTexture} onChange={setGeoTexture} options={GEOMETRY_TEXTURE_OPTIONS} />
                </div>

                <button
                  onClick={handleTextPreview}
                  disabled={subject.trim().length < 2 || previewing}
                  className={`w-full py-3 rounded-2xl font-bold text-sm flex items-center justify-center gap-2 transition-all ${
                    subject.trim().length >= 2 && !previewing
                      ? "bg-tertiary/15 text-tertiary hover:bg-tertiary/25 active:scale-[0.98] cursor-pointer"
                      : "bg-surface-dim text-on-surface-variant/50 cursor-not-allowed"
                  }`}
                >
                  {previewing ? <RotateCw size={15} className="animate-spin" /> : <Wand2 size={15} />}
                  {previewing ? "Rendering reference…" : image ? "Regenerate reference" : "Generate reference image"}
                </button>

                {image && (
                  <div className="flex flex-col items-center gap-2">
                    <div className="relative w-full aspect-square max-h-[300px] rounded-2xl overflow-hidden border border-outline-variant/20 bg-surface-dim/40">
                      <img src={image} alt="Reference preview" className="w-full h-full object-contain" />
                    </div>
                    <span className="text-[11px] text-on-surface-variant/70">Reference preview — happy with it? Generate the 3D model below.</span>
                  </div>
                )}
              </div>
            )}

            {/* Primary drop zone (image mode) */}
            {mode === "image" && (
            <div
              onDrop={(e) => handleDrop(e, "main")}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onClick={() => state === "idle" || state === "failed" ? inputRef.current?.click() : null}
              className={`relative w-full min-h-[220px] rounded-2xl border-2 border-dashed transition-all duration-300 flex flex-col items-center justify-center gap-3 overflow-hidden cursor-pointer ${
                isDragging
                  ? "border-primary bg-primary/10 scale-[1.01]"
                  : image
                  ? "border-outline-variant/30 bg-surface-dim/30"
                  : "border-outline-variant/40 hover:border-primary/50 bg-surface-dim/20 hover:bg-primary/5"
              }`}
            >
              {image ? (
                <>
                  <img src={image} alt="Preview" className="absolute inset-0 w-full h-full object-contain p-3" />
                  {(state === "idle" || state === "failed") && (
                    <button
                      onClick={(e) => { e.stopPropagation(); setImage(null); setImageName(""); }}
                      className="absolute top-3 right-3 w-8 h-8 bg-error/90 text-white rounded-full flex items-center justify-center shadow-lg hover:bg-error transition-colors cursor-pointer z-10"
                    >
                      <X size={14} />
                    </button>
                  )}
                </>
              ) : (
                <>
                  <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center">
                    <Upload size={24} className="text-primary" />
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-bold text-on-surface">
                      Drop image here or <span className="text-primary">browse</span>
                    </p>
                    <p className="text-xs text-on-surface-variant mt-1">JPG, PNG, or WebP — any subject</p>
                  </div>
                </>
              )}
              <input
                ref={inputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (f) await handleFile(f, "main");
                  e.target.value = "";
                }}
              />
            </div>
            )}

            {/* Multiview toggle (image mode only) */}
            {mode === "image" && image && (state === "idle" || state === "failed") && (
              <div>
                <button
                  onClick={() => setShowMultiview(!showMultiview)}
                  className="flex items-center gap-2 text-xs font-bold text-on-surface-variant hover:text-primary transition-colors cursor-pointer"
                >
                  {showMultiview ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  <Layers size={13} />
                  Multiview (optional — add left, back, right)
                </button>

                {showMultiview && (
                  <div className="mt-3 flex justify-center gap-5 p-4 bg-surface-container/50 rounded-2xl border border-outline-variant/15">
                    <MvSlot label="Left" value={mvLeft} onChange={setMvLeft} />
                    <MvSlot label="Back" value={mvBack} onChange={setMvBack} />
                    <MvSlot label="Right" value={mvRight} onChange={setMvRight} />
                  </div>
                )}
              </div>
            )}

            {/* Styling options toggle (image mode only) */}
            {mode === "image" && image && (state === "idle" || state === "failed") && (
              <div>
                <button
                  onClick={() => setShowStyling(!showStyling)}
                  className="flex items-center gap-2 text-xs font-bold text-on-surface-variant hover:text-primary transition-colors cursor-pointer"
                >
                  {showStyling ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  <Palette size={13} />
                  Styling Options (optional — customise the 3D output)
                </button>

                {showStyling && (
                  <div className="mt-3 p-4 bg-surface-container/50 rounded-2xl border border-outline-variant/15 flex flex-col gap-4 animate-fade-in">
                    <p className="text-[10px] text-on-surface-variant/70 leading-relaxed">
                      These are optional — &ldquo;Auto&rdquo; works great for any image. Pick specific styles only if you want a particular look.
                    </p>
                    <div className="grid grid-cols-2 gap-3">
                      <PromptSelect label="Style" value={style} onChange={setStyle} options={TEXT_STYLE_OPTIONS} />
                      <PromptSelect label="Lighting" value={lighting} onChange={setLighting} options={TEXT_LIGHTING_OPTIONS} />
                      <PromptSelect label="Detail" value={geoDetail} onChange={setGeoDetail} options={GEOMETRY_DETAIL_OPTIONS} />
                      <PromptSelect label="Texture" value={geoTexture} onChange={setGeoTexture} options={GEOMETRY_TEXTURE_OPTIONS} />
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Progress bar */}
            {(state === "uploading" || state === "generating") && (
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-on-surface-variant">{statusText}</span>
                  <span className="text-xs font-mono text-primary font-bold">{progress}%</span>
                </div>
                <div className="w-full h-2 bg-surface-dim/60 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-primary via-tertiary to-primary rounded-full transition-all duration-700 ease-out"
                    style={{ width: `${Math.max(progress, 5)}%` }}
                  />
                </div>
              </div>
            )}

            {/* Error */}
            {error && (
              <div className="flex items-start gap-2 p-3 bg-error-container/30 border border-error/20 rounded-xl">
                <AlertCircle size={16} className="text-error mt-0.5 shrink-0" />
                <p className="text-xs text-error font-medium leading-relaxed">{error}</p>
              </div>
            )}

            {/* Generate button */}
            {(state === "idle" || state === "failed") && (
              <button
                onClick={handleGenerate}
                disabled={!canGenerate}
                className={`w-full py-3.5 rounded-2xl font-bold text-sm shadow-lg flex items-center justify-center gap-2 transition-all duration-200 ${
                  canGenerate
                    ? "bg-primary text-on-primary hover:shadow-xl hover:bg-primary/90 active:scale-[0.97] cursor-pointer"
                    : "bg-surface-dim text-on-surface-variant/50 cursor-not-allowed"
                }`}
              >
                <Sparkles size={16} />
                {!isAdmin && credits < MODEL_COST
                  ? `Need ${MODEL_COST} credits (you have ${credits})`
                  : `Generate 3D Model${!isAdmin ? ` · ${MODEL_COST} credits` : ""}`}
              </button>
            )}

            {/* Generating state — disable interaction */}
            {(state === "uploading" || state === "generating") && (
              <div className="flex items-center justify-center gap-3 py-3 text-on-surface-variant">
                <RotateCw size={16} className="animate-spin text-primary" />
                <span className="text-sm font-bold">Processing…</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer info */}
      <p className="text-center text-[10px] text-on-surface-variant/60 mt-4 leading-relaxed max-w-sm mx-auto">
        Powered by Tripo3D. Models are generated as GLB files suitable for import into
        Blender, Unity, Unreal Engine, and other 3D applications.
      </p>
    </div>
  );
}
