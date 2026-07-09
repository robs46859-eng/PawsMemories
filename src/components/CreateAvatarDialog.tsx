import React, { useState, useRef } from "react";
import { Camera, X, Check, Upload, Sparkles, Plus, User } from "lucide-react";

interface CreateAvatarDialogProps {
  onClose: () => void;
  onSubmit: (name: string, photos: string[], palette: string | null, avatarType: 'dog' | 'human', facePhoto?: string | null) => void;
  isDarkMode: boolean;
}

const MAX_PHOTOS = 5;

/**
 * Accent palettes for colour coordination. These tint the scene lighting and
 * any collar/accessory accents — they never recolour the pet's real fur, so the
 * likeness is preserved while the render stays colour-coordinated.
 */
const PALETTES: { id: string; label: string; swatch: string }[] = [
  { id: "auto",       label: "Auto",       swatch: "linear-gradient(135deg,#a3a3a3,#e5e5e5)" },
  { id: "warm",       label: "Warm",       swatch: "linear-gradient(135deg,#f59e0b,#ef4444)" },
  { id: "cool",       label: "Cool",       swatch: "linear-gradient(135deg,#0ea5e9,#6366f1)" },
  { id: "vibrant",    label: "Vibrant",    swatch: "linear-gradient(135deg,#ec4899,#8b5cf6)" },
  { id: "pastel",     label: "Pastel",     swatch: "linear-gradient(135deg,#fbcfe8,#bfdbfe)" },
  { id: "monochrome", label: "Mono",       swatch: "linear-gradient(135deg,#525252,#d4d4d4)" },
];

/** Downscale an image to max 1536px on the longest edge and re-encode as JPEG to keep payloads small. */
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

export default function CreateAvatarDialog({ onClose, onSubmit, isDarkMode }: CreateAvatarDialogProps) {
  const [name, setName] = useState("");
  const [facePhoto, setFacePhoto] = useState<string | null>(null);
  const [photos, setPhotos] = useState<string[]>([]);
  const [palette, setPalette] = useState<string>("auto");
  const [avatarType, setAvatarType] = useState<'dog' | 'human'>("dog");
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const faceInputRef = useRef<HTMLInputElement>(null);

  const handleFilesSelect = (files: FileList | File[]) => {
    const list = Array.from(files);
    for (const file of list) {
      if (!file.type.startsWith("image/")) {
        alert("Please select image files only (jpg, png, webp).");
        return;
      }
      if (file.size > 10 * 1024 * 1024) {
        alert(`"${file.name}" is over 10MB. Please use a smaller image.`);
        return;
      }
    }
    const remaining = MAX_PHOTOS - photos.length;
    if (list.length > remaining) {
      alert(`You can upload up to ${MAX_PHOTOS} additional photos (${remaining} more allowed).`);
    }
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
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      alert("Please select an image file (jpg, png, webp).");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      alert("Image is over 10MB. Please use a smaller image.");
      return;
    }
    const reader = new FileReader();
    reader.onload = async (e) => {
      const raw = e.target?.result as string;
      const optimized = await downscaleImage(raw);
      setFacePhoto(optimized);
    };
    reader.readAsDataURL(file);
  };

  const removePhoto = (index: number) => {
    setPhotos((prev) => prev.filter((_, i) => i !== index));
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files.length) handleFilesSelect(e.dataTransfer.files);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => setIsDragging(false);

  const handleSave = () => {
    if (!name.trim()) {
      alert("Please enter a name for your avatar.");
      return;
    }
    // Need either a face photo OR at least one general photo
    const hasAnyPhoto = !!facePhoto || photos.length > 0;
    if (!hasAnyPhoto) {
      alert(`Please upload at least one photo of your ${avatarType === "dog" ? "pet" : "person"}.`);
      return;
    }
    // Combine: face photo first (if present), then general photos
    const allPhotos = facePhoto ? [facePhoto, ...photos] : photos;
    onSubmit(name.trim(), allPhotos, palette === "auto" ? null : palette, avatarType, facePhoto);
  };

  const subjectLabel = avatarType === "dog" ? "pet" : "person";
  const faceLabel = avatarType === "dog" ? "face / snout" : "face";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in">
      <div className="bg-surface-container rounded-3xl p-6 max-w-lg w-full shadow-2xl border border-outline-variant/30 flex flex-col max-h-[90vh] overflow-y-auto">

        {/* Header */}
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-extrabold flex items-center gap-2 text-on-surface">
            <Sparkles className="text-primary" size={24} /> Create 3D Avatar
          </h2>
          <button onClick={onClose} className="p-2 rounded-full hover:bg-outline-variant/20 transition-colors text-on-surface-variant hover:text-on-surface">
            <X size={20} />
          </button>
        </div>

        {/* Avatar Type Segmented Control */}
        <div className="flex bg-surface border border-outline-variant/30 rounded-2xl p-1 mb-6">
          <button
            type="button"
            onClick={() => {
              setAvatarType("dog");
              setPhotos([]);
              setFacePhoto(null);
            }}
            className={`flex-1 py-2.5 text-sm font-bold rounded-xl transition-all ${
              avatarType === "dog"
                ? "bg-primary text-white shadow-md"
                : "text-on-surface-variant hover:text-on-surface hover:bg-outline-variant/10"
            }`}
          >
            🐕 Dog Avatar
          </button>
          <button
            type="button"
            onClick={() => {
              setAvatarType("human");
              setPhotos([]);
              setFacePhoto(null);
            }}
            className={`flex-1 py-2.5 text-sm font-bold rounded-xl transition-all ${
              avatarType === "human"
                ? "bg-primary text-white shadow-md"
                : "text-on-surface-variant hover:text-on-surface hover:bg-outline-variant/10"
            }`}
          >
            🧑 Human Avatar
          </button>
        </div>

        {/* Info Banner */}
        <div className="bg-primary/10 border border-primary/20 text-on-surface rounded-xl p-4 text-sm flex gap-3 items-start mb-6">
          <Camera size={18} className="shrink-0 mt-0.5 text-primary" />
          <div>
            <p className="font-bold mb-1">AI-Powered 3D Generation</p>
            <p className="opacity-70 text-xs">
              {avatarType === "dog" ? (
                <>Upload a clear face close-up plus additional photos from different angles. Our AI fuses them into one hyper-realistic reference image, then builds the 3D model, rigs it, and creates animations — all automatically!</>
              ) : (
                <>Upload a clear face close-up plus additional photos from different angles. Our AI fuses them into one hyper-realistic reference image (bipedal A-pose, standing, facing forward), then builds the 3D model, rigs it, and creates animations — all automatically!</>
              )}
            </p>
          </div>
        </div>

        {/* Name Input */}
        <div className="mb-4">
          <label className="block text-xs font-bold mb-1.5 opacity-60 uppercase tracking-wider text-on-surface-variant">
            Avatar Name
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={avatarType === "dog" ? "e.g. Buddy, Luna, Max..." : "e.g. Robert, Alice, John..."}
            className="w-full bg-surface border border-outline-variant/30 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all text-on-surface"
          />
        </div>

        {/* ═══════════ FACE PHOTO SLOT ═══════════ */}
        <div className="mb-4">
          <label className="block text-xs font-bold mb-1.5 opacity-60 uppercase tracking-wider text-on-surface-variant">
            {avatarType === "dog" ? "🐾" : "👤"} Face Close-Up <span className="text-primary">(recommended)</span>
          </label>
          {facePhoto ? (
            <div className="relative w-full max-w-[200px] mx-auto aspect-square rounded-2xl overflow-hidden border-2 border-primary/40 bg-surface group">
              <img src={facePhoto} alt="Face close-up" className="w-full h-full object-cover" />
              <button
                onClick={() => setFacePhoto(null)}
                className="absolute top-2 right-2 bg-black/60 backdrop-blur-sm text-white w-7 h-7 rounded-full flex items-center justify-center hover:bg-red-500 transition-colors"
                aria-label="Remove face photo"
              >
                <X size={14} />
              </button>
              <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/60 to-transparent py-2 px-3">
                <span className="text-[10px] font-bold text-white flex items-center gap-1">
                  <User size={10} /> Face Reference
                </span>
              </div>
            </div>
          ) : (
            <button
              onClick={() => faceInputRef.current?.click()}
              onDrop={(e) => { e.preventDefault(); e.stopPropagation(); if (e.dataTransfer.files.length) handleFaceFileSelect(e.dataTransfer.files); }}
              onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
              className="w-full max-w-[200px] mx-auto aspect-square rounded-2xl border-2 border-dashed border-primary/40 hover:border-primary bg-primary/5 hover:bg-primary/10 flex flex-col items-center justify-center gap-2 transition-all cursor-pointer"
            >
              <div className="w-12 h-12 rounded-full bg-primary/15 flex items-center justify-center">
                <User size={24} className="text-primary" />
              </div>
              <p className="text-xs font-bold text-on-surface">Upload {faceLabel} close-up</p>
              <p className="text-[10px] text-on-surface-variant/70 text-center px-4 leading-tight">
                A clear, well-lit, front-facing close-up gives the AI the best likeness
              </p>
            </button>
          )}
          <input
            ref={faceInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(e) => {
              if (e.target.files?.length) handleFaceFileSelect(e.target.files);
              e.target.value = "";
            }}
          />
        </div>

        {/* ═══════════ ADDITIONAL PHOTOS ═══════════ */}
        <div className="mb-6">
          <label className="block text-xs font-bold mb-1.5 opacity-60 uppercase tracking-wider text-on-surface-variant">
            📸 Additional Reference Photos ({photos.length}/{MAX_PHOTOS})
          </label>

          {photos.length > 0 && (
            <div className="grid grid-cols-3 gap-2 mb-2">
              {photos.map((p, i) => (
                <div key={i} className="relative rounded-xl overflow-hidden border border-outline-variant/30 bg-surface aspect-square group">
                  <img src={p} alt={`Photo ${i + 1}`} className="w-full h-full object-cover" />
                  <button
                    onClick={() => removePhoto(i)}
                    className="absolute top-1.5 right-1.5 bg-black/60 backdrop-blur-sm text-white w-6 h-6 rounded-full flex items-center justify-center hover:bg-red-500 transition-colors"
                    aria-label={`Remove photo ${i + 1}`}
                  >
                    <X size={12} />
                  </button>
                  <span className="absolute bottom-1 left-1 bg-black/50 backdrop-blur-sm text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full">
                    Body/Angle
                  </span>
                </div>
              ))}
              {photos.length < MAX_PHOTOS && (
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="rounded-xl border-2 border-dashed border-outline-variant/40 bg-surface hover:border-primary/50 hover:bg-primary/5 aspect-square flex flex-col items-center justify-center gap-1 transition-all"
                >
                  <Plus size={20} className="text-on-surface-variant" />
                  <span className="text-[10px] font-bold text-on-surface-variant">Add more</span>
                </button>
              )}
            </div>
          )}

          {photos.length === 0 && (
            <div
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onClick={() => fileInputRef.current?.click()}
              className={`
                cursor-pointer rounded-2xl border-2 border-dashed transition-all duration-200
                flex flex-col items-center justify-center p-6
                ${isDragging
                  ? "border-primary bg-primary/10 scale-[1.02]"
                  : "border-outline-variant/40 bg-surface hover:border-primary/50 hover:bg-primary/5"
                }
              `}
            >
              <div className={`
                w-12 h-12 rounded-full flex items-center justify-center mb-3 transition-colors
                ${isDragging ? "bg-primary/20" : "bg-outline-variant/20"}
              `}>
                <Upload size={22} className={isDragging ? "text-primary" : "text-on-surface-variant"} />
              </div>
              <p className="text-sm font-bold text-on-surface mb-1">
                {isDragging ? "Drop your photos here!" : `Add body & angle photos`}
              </p>
              <p className="text-xs text-on-surface-variant opacity-60 text-center">
                Full body shots, side angles, back view • Up to {MAX_PHOTOS} photos
              </p>
            </div>
          )}

          {(facePhoto || photos.length > 0) && (
            <p className="text-[10px] text-on-surface-variant opacity-60 mt-1.5">
              <Check size={10} className="inline mr-1 text-green-500" />
              Tip: a face close-up + body shots from different angles give the best 3D result.
            </p>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files?.length) handleFilesSelect(e.target.files);
              e.target.value = "";
            }}
          />
        </div>

        {/* Color coordination — accent palette picker */}
        <div className="mb-6">
          <label className="block text-xs font-bold mb-1.5 opacity-60 uppercase tracking-wider text-on-surface-variant">
            Color Coordination
          </label>
          <div className="grid grid-cols-6 gap-2">
            {PALETTES.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setPalette(p.id)}
                className={`flex flex-col items-center gap-1 rounded-xl p-1.5 border transition-all ${
                  palette === p.id
                    ? "border-primary ring-1 ring-primary bg-primary/5"
                    : "border-outline-variant/30 hover:border-primary/40"
                }`}
                aria-pressed={palette === p.id}
                title={p.label}
              >
                <span className="w-full aspect-square rounded-lg" style={{ background: p.swatch }} />
                <span className="text-[9px] font-bold text-on-surface-variant">{p.label}</span>
              </button>
            ))}
          </div>
          <p className="text-[10px] text-on-surface-variant opacity-60 mt-1.5">
            {avatarType === "dog"
              ? "Coordinates the render's lighting & accent tones. Your pet's real fur & eye colors are always kept true."
              : "Coordinates the render's lighting & accent tones. The person's clothing, hair & skin colors are always kept true."}
          </p>
        </div>

        {/* What happens section */}
        <div className="bg-surface rounded-xl border border-outline-variant/20 p-4 mb-6">
          <p className="text-xs font-bold text-on-surface mb-3 uppercase tracking-wider opacity-60">
            What the AI will do
          </p>
          <div className="grid grid-cols-2 gap-2">
            {[
              { icon: "👤", label: "Prioritize face likeness" },
              { icon: "🖼️", label: "Fuse photos into HD portrait" },
              { icon: "🧠", label: "Analyze anatomy" },
              { icon: "🧊", label: "Generate 3D mesh" },
              { icon: "🦴", label: "Rig skeleton" },
              { icon: "🎬", label: "Create animations" },
            ].map((step) => (
              <div
                key={step.label}
                className="flex items-center gap-2 bg-surface-container rounded-lg px-3 py-2"
              >
                <span className="text-base">{step.icon}</span>
                <span className="text-[11px] font-semibold text-on-surface">{step.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Submit Button */}
        <button
          onClick={handleSave}
          disabled={!name.trim() || (!facePhoto && photos.length === 0)}
          className="w-full bg-primary text-white py-3.5 rounded-xl font-black uppercase tracking-wider flex items-center justify-center gap-2 hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg active:scale-95"
        >
          <Sparkles size={18} />
          Generate 3D Avatar
        </button>

        <p className="text-[10px] text-center text-on-surface-variant opacity-50 mt-3">
          Generation takes 2-5 minutes. You'll see progress in the avatar card.
        </p>
      </div>
    </div>
  );
}
