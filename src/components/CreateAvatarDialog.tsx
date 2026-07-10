import React, { useState, useRef } from "react";
import { Camera, X, Check, Upload, Sparkles, Plus, User, ImageIcon, Type, ChevronDown, ChevronUp, Palette } from "lucide-react";
import {
  TEXT_STYLE_OPTIONS,
  TEXT_FRAMING_OPTIONS,
  TEXT_ANGLE_OPTIONS,
  TEXT_LIGHTING_OPTIONS,
  GEOMETRY_DETAIL_OPTIONS,
  GEOMETRY_TEXTURE_OPTIONS,
} from "../../avatarPrompts";

export interface CreateModelOptions {
  name: string;
  avatarType: 'dog' | 'human' | 'object';
  inputMode: 'image' | 'text';
  photos: string[];
  facePhoto?: string | null;
  subject?: string;
  palette?: string | null;
  style?: string;
  framing?: string;
  angle?: string;
  lighting?: string;
  geoDetail?: string;
  geoTexture?: string;
}

interface CreateAvatarDialogProps {
  onClose: () => void;
  onSubmit: (options: CreateModelOptions) => void;
  isDarkMode: boolean;
}

const MAX_PHOTOS = 5;

const PALETTES = [
  { id: "auto",       label: "Auto",       swatch: "linear-gradient(135deg,#a3a3a3,#e5e5e5)" },
  { id: "warm",       label: "Warm",       swatch: "linear-gradient(135deg,#f59e0b,#ef4444)" },
  { id: "cool",       label: "Cool",       swatch: "linear-gradient(135deg,#0ea5e9,#6366f1)" },
  { id: "vibrant",    label: "Vibrant",    swatch: "linear-gradient(135deg,#ec4899,#8b5cf6)" },
  { id: "pastel",     label: "Pastel",     swatch: "linear-gradient(135deg,#fbcfe8,#bfdbfe)" },
  { id: "monochrome", label: "Mono",       swatch: "linear-gradient(135deg,#525252,#d4d4d4)" },
];

function downscaleImage(dataUrl: string, maxDim = 1536): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      if (scale >= 1) return resolve(dataUrl);
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext("2d");
      if (!ctx) return resolve(dataUrl);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", 0.9));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

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
      <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">{label}</span>
      <div className="relative">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full appearance-none bg-surface text-on-surface text-xs font-medium rounded-lg border border-outline-variant/30 pl-2 pr-6 py-2 focus:outline-none focus:border-primary/60 cursor-pointer"
        >
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}{o.recommended ? " (recommended)" : ""}
            </option>
          ))}
        </select>
        <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-on-surface-variant/60 pointer-events-none" />
      </div>
      {active?.hint && <span className="text-[9px] text-on-surface-variant/60 leading-tight">{active.hint}</span>}
    </label>
  );
};

export default function CreateAvatarDialog({ onClose, onSubmit, isDarkMode }: CreateAvatarDialogProps) {
  const [name, setName] = useState("");
  const [inputMode, setInputMode] = useState<'image' | 'text'>('image');
  const [avatarType, setAvatarType] = useState<'dog' | 'human' | 'object'>("dog");
  
  // Image mode state
  const [facePhoto, setFacePhoto] = useState<string | null>(null);
  const [photos, setPhotos] = useState<string[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  
  // Text mode state
  const [subject, setSubject] = useState("");
  
  // Shared styling options
  const [palette, setPalette] = useState<string>("auto");
  const [showStyling, setShowStyling] = useState(false);
  const [style, setStyle] = useState(TEXT_STYLE_OPTIONS.find((o) => o.recommended)?.id || TEXT_STYLE_OPTIONS[0].id);
  const [framing, setFraming] = useState(TEXT_FRAMING_OPTIONS.find((o) => o.recommended)?.id || TEXT_FRAMING_OPTIONS[0].id);
  const [angle, setAngle] = useState(TEXT_ANGLE_OPTIONS.find((o) => o.recommended)?.id || TEXT_ANGLE_OPTIONS[0].id);
  const [lighting, setLighting] = useState(TEXT_LIGHTING_OPTIONS.find((o) => o.recommended)?.id || TEXT_LIGHTING_OPTIONS[0].id);
  const [geoDetail, setGeoDetail] = useState(GEOMETRY_DETAIL_OPTIONS.find((o) => o.recommended)?.id || GEOMETRY_DETAIL_OPTIONS[0].id);
  const [geoTexture, setGeoTexture] = useState(GEOMETRY_TEXTURE_OPTIONS.find((o) => o.recommended)?.id || GEOMETRY_TEXTURE_OPTIONS[0].id);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const faceInputRef = useRef<HTMLInputElement>(null);

  const handleFilesSelect = (files: FileList | File[]) => {
    const list = Array.from(files);
    for (const file of list) {
      if (!file.type.startsWith("image/")) {
        alert("Please select image files only (jpg, png, webp).");
        return;
      }
    }
    const remaining = MAX_PHOTOS - photos.length;
    list.slice(0, remaining).forEach((file) => {
      const reader = new FileReader();
      reader.onload = async (e) => {
        const raw = e.target?.result as string;
        const optimized = await downscaleImage(raw);
        setPhotos((prev) => (prev.length >= MAX_PHOTOS ? prev : [...prev, optimized]));
      };
      reader.readAsDataURL(file);
    });
  };

  const handleFaceFileSelect = (files: FileList | File[]) => {
    const file = Array.from(files)[0];
    if (!file || !file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = async (e) => {
      const raw = e.target?.result as string;
      const optimized = await downscaleImage(raw);
      setFacePhoto(optimized);
    };
    reader.readAsDataURL(file);
  };

  const removePhoto = (index: number) => setPhotos((prev) => prev.filter((_, i) => i !== index));

  const handleSave = () => {
    if (!name.trim()) {
      alert("Please enter a name.");
      return;
    }
    if (inputMode === 'image') {
      const hasAnyPhoto = !!facePhoto || photos.length > 0;
      if (!hasAnyPhoto) {
        alert("Please upload at least one photo.");
        return;
      }
    } else {
      if (subject.trim().length < 2) {
        alert("Please enter a subject description.");
        return;
      }
    }

    onSubmit({
      name: name.trim(),
      avatarType,
      inputMode,
      photos: inputMode === 'image' ? (facePhoto ? [facePhoto, ...photos] : photos) : [],
      facePhoto: inputMode === 'image' ? facePhoto : null,
      subject: inputMode === 'text' ? subject : undefined,
      palette: palette === "auto" ? null : palette,
      style, framing, angle, lighting, geoDetail, geoTexture
    });
  };

  const subjectLabel = avatarType === "dog" ? "pet" : avatarType === "human" ? "person" : "object";
  const typeIcon = avatarType === "dog" ? "🐾" : avatarType === "human" ? "🧑" : "🧊";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in">
      <div className="bg-surface-container rounded-3xl p-6 max-w-lg w-full shadow-2xl border border-outline-variant/30 flex flex-col max-h-[90vh] overflow-y-auto">

        {/* Header */}
        <div className="flex justify-between items-center mb-5">
          <h2 className="text-xl font-extrabold flex items-center gap-2 text-on-surface">
            <Sparkles className="text-primary" size={24} /> Create 3D Model
          </h2>
          <button onClick={onClose} className="p-2 rounded-full hover:bg-outline-variant/20 transition-colors text-on-surface-variant hover:text-on-surface">
            <X size={20} />
          </button>
        </div>

        {/* Input Mode Toggle */}
        <div className="flex gap-1.5 p-1 bg-surface-container-high rounded-2xl mb-5 mx-auto w-full">
          {([
            { id: "image", label: "Upload Photos", icon: ImageIcon },
            { id: "text", label: "Text Prompt", icon: Type },
          ] as const).map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setInputMode(id)}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                inputMode === id
                  ? "bg-primary text-on-primary shadow"
                  : "text-on-surface-variant hover:text-on-surface"
              }`}
            >
              <Icon size={14} /> {label}
            </button>
          ))}
        </div>

        {/* Avatar Type Segmented Control */}
        <div className="flex bg-surface border border-outline-variant/30 rounded-2xl p-1 mb-5">
          <button
            type="button"
            onClick={() => setAvatarType("dog")}
            className={`flex-1 py-2 text-xs font-bold rounded-xl transition-all ${
              avatarType === "dog" ? "bg-primary text-white shadow-md" : "text-on-surface-variant hover:bg-outline-variant/10"
            }`}
          >
            🐕 Dog
          </button>
          <button
            type="button"
            onClick={() => setAvatarType("human")}
            className={`flex-1 py-2 text-xs font-bold rounded-xl transition-all ${
              avatarType === "human" ? "bg-primary text-white shadow-md" : "text-on-surface-variant hover:bg-outline-variant/10"
            }`}
          >
            🧑 Human
          </button>
          <button
            type="button"
            onClick={() => setAvatarType("object")}
            className={`flex-1 py-2 text-xs font-bold rounded-xl transition-all ${
              avatarType === "object" ? "bg-primary text-white shadow-md" : "text-on-surface-variant hover:bg-outline-variant/10"
            }`}
          >
            🧊 Object
          </button>
        </div>

        {/* Info Banner */}
        <div className="bg-primary/10 border border-primary/20 text-on-surface rounded-xl p-3 text-xs flex gap-2 items-start mb-5">
          <Camera size={16} className="shrink-0 mt-0.5 text-primary" />
          <p className="opacity-80">
            {avatarType === "object" 
              ? "Generate a static GLB 3D model. No rigging or animations will be applied."
              : "Generate a fully rigged and animated 3D character with idle behaviors and an AI brain."}
          </p>
        </div>

        {/* Name Input */}
        <div className="mb-5">
          <label className="block text-[10px] font-bold mb-1 opacity-60 uppercase tracking-wider text-on-surface-variant">Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={`Name your ${subjectLabel}...`}
            className="w-full bg-surface border border-outline-variant/30 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-primary transition-all text-on-surface"
          />
        </div>

        {inputMode === 'image' ? (
          <>
            {/* FACE PHOTO */}
            {avatarType !== 'object' && (
              <div className="mb-4">
                <label className="block text-[10px] font-bold mb-1 opacity-60 uppercase tracking-wider text-on-surface-variant">
                  {typeIcon} Face Close-Up (recommended)
                </label>
                {facePhoto ? (
                  <div className="relative w-full max-w-[150px] aspect-square rounded-2xl overflow-hidden border-2 border-primary/40 bg-surface">
                    <img src={facePhoto} alt="Face" className="w-full h-full object-cover" />
                    <button onClick={() => setFacePhoto(null)} className="absolute top-1 right-1 bg-red-500 text-white w-6 h-6 rounded-full flex items-center justify-center">
                      <X size={12} />
                    </button>
                  </div>
                ) : (
                  <button onClick={() => faceInputRef.current?.click()} className="w-full max-w-[150px] aspect-square rounded-2xl border-2 border-dashed border-primary/40 flex flex-col items-center justify-center gap-2 hover:bg-primary/5 transition-all">
                    <User size={20} className="text-primary" />
                    <span className="text-[10px] font-bold text-on-surface">Upload face</span>
                  </button>
                )}
                <input ref={faceInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.length && handleFaceFileSelect(e.target.files)} />
              </div>
            )}

            {/* ADDITIONAL PHOTOS */}
            <div className="mb-5">
              <label className="block text-[10px] font-bold mb-1 opacity-60 uppercase tracking-wider text-on-surface-variant">
                📸 {avatarType === 'object' ? 'Reference Photos' : 'Additional Angles'} ({photos.length}/{MAX_PHOTOS})
              </label>
              
              {photos.length > 0 ? (
                <div className="grid grid-cols-4 gap-2 mb-2">
                  {photos.map((p, i) => (
                    <div key={i} className="relative rounded-xl overflow-hidden border aspect-square">
                      <img src={p} alt={`Angle ${i}`} className="w-full h-full object-cover" />
                      <button onClick={() => removePhoto(i)} className="absolute top-1 right-1 bg-red-500 text-white w-5 h-5 rounded-full flex items-center justify-center">
                        <X size={10} />
                      </button>
                    </div>
                  ))}
                  {photos.length < MAX_PHOTOS && (
                    <button onClick={() => fileInputRef.current?.click()} className="rounded-xl border-2 border-dashed aspect-square flex flex-col items-center justify-center hover:bg-surface-variant/50">
                      <Plus size={16} className="text-on-surface-variant" />
                    </button>
                  )}
                </div>
              ) : (
                <div onClick={() => fileInputRef.current?.click()} className="cursor-pointer rounded-2xl border-2 border-dashed flex flex-col items-center p-4 hover:bg-surface-variant/50 transition-all border-outline-variant/40 text-center">
                  <Upload size={20} className="text-on-surface-variant mb-2" />
                  <span className="text-xs font-bold text-on-surface">Upload {avatarType === 'object' ? 'photos of the object' : 'body/angle photos'}</span>
                </div>
              )}
              <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => e.target.files?.length && handleFilesSelect(e.target.files)} />
            </div>
          </>
        ) : (
          /* TEXT PROMPT MODE */
          <div className="mb-5">
            <label className="block text-[10px] font-bold mb-1 opacity-60 uppercase tracking-wider text-on-surface-variant">Subject Description</label>
            <textarea
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              rows={3}
              placeholder={`Describe the ${subjectLabel} in detail...`}
              className="w-full resize-none bg-surface border border-outline-variant/30 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-primary transition-all text-on-surface"
            />
          </div>
        )}

        {/* STYLING OPTIONS (Collapsible) */}
        <div className="mb-6">
          <button
            onClick={() => setShowStyling(!showStyling)}
            className="flex items-center gap-2 text-xs font-bold text-on-surface-variant hover:text-primary transition-colors cursor-pointer w-full text-left"
          >
            {showStyling ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            <Palette size={14} />
            Advanced Styling & Options
          </button>
          
          {showStyling && (
            <div className="mt-3 p-3 bg-surface-container/50 rounded-2xl border border-outline-variant/15 flex flex-col gap-4 animate-fade-in">
              {avatarType !== 'object' && (
                <div>
                  <label className="block text-[10px] font-bold mb-1 opacity-60 uppercase tracking-wider text-on-surface-variant">Color Coordination</label>
                  <div className="grid grid-cols-6 gap-2">
                    {PALETTES.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => setPalette(p.id)}
                        className={`flex flex-col items-center gap-1 p-1 rounded-lg border ${palette === p.id ? "border-primary ring-1 ring-primary bg-primary/10" : "border-outline-variant/30"}`}
                        title={p.label}
                      >
                        <span className="w-full aspect-square rounded-md" style={{ background: p.swatch }} />
                        <span className="text-[8px] font-bold">{p.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-0.5">
                  <PromptSelect label="Style" value={style} onChange={setStyle} options={TEXT_STYLE_OPTIONS} />
                  {inputMode === 'image' && avatarType === 'human' && (
                    <span className="text-[10px] text-on-surface-variant/70 pl-1">Humans always render as a full standing figure — pick the finish.</span>
                  )}
                </div>
                <PromptSelect label="Lighting" value={lighting} onChange={setLighting} options={TEXT_LIGHTING_OPTIONS} />
                <PromptSelect label="Detail" value={geoDetail} onChange={setGeoDetail} options={GEOMETRY_DETAIL_OPTIONS} />
                <PromptSelect label="Texture" value={geoTexture} onChange={setGeoTexture} options={GEOMETRY_TEXTURE_OPTIONS} />
                {inputMode === 'text' && (
                  <>
                    <PromptSelect label="Framing" value={framing} onChange={setFraming} options={TEXT_FRAMING_OPTIONS} />
                    <PromptSelect label="Angle" value={angle} onChange={setAngle} options={TEXT_ANGLE_OPTIONS} />
                  </>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Submit Button */}
        <button
          onClick={handleSave}
          className="w-full bg-primary text-white py-3.5 rounded-xl font-black uppercase tracking-wider flex items-center justify-center gap-2 hover:bg-primary/90 transition-all shadow-lg active:scale-95"
        >
          <Sparkles size={18} />
          Create Model (400 cr)
        </button>
      </div>
    </div>
  );
}
