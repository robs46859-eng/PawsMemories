import React, { useState, useRef } from "react";
import { Camera, X, Check, Upload, Sparkles, RefreshCw } from "lucide-react";

interface CreateAvatarDialogProps {
  onClose: () => void;
  onSubmit: (name: string, photo: string) => void;
  isDarkMode: boolean;
}

export default function CreateAvatarDialog({ onClose, onSubmit, isDarkMode }: CreateAvatarDialogProps) {
  const [name, setName] = useState("");
  const [photo, setPhoto] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (file: File) => {
    if (!file.type.startsWith("image/")) {
      alert("Please select an image file (jpg, png, webp).");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      alert("Image must be under 10MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      setPhoto(e.target?.result as string);
    };
    reader.readAsDataURL(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFileSelect(file);
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
    if (!photo) {
      alert("Please upload a photo of your pet.");
      return;
    }
    onSubmit(name.trim(), photo);
  };

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

        {/* Info Banner */}
        <div className="bg-primary/10 border border-primary/20 text-on-surface rounded-xl p-4 text-sm flex gap-3 items-start mb-6">
          <Camera size={18} className="shrink-0 mt-0.5 text-primary" />
          <div>
            <p className="font-bold mb-1">AI-Powered 3D Generation</p>
            <p className="opacity-70 text-xs">
              Upload a clear photo of your pet. Our AI will analyze the photo, generate a 3D model, 
              rig it with proper anatomy, and create animations — all automatically!
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
            placeholder="e.g. Buddy, Luna, Max..."
            className="w-full bg-surface border border-outline-variant/30 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all text-on-surface"
          />
        </div>

        {/* Photo Upload Area */}
        <div className="mb-6">
          <label className="block text-xs font-bold mb-1.5 opacity-60 uppercase tracking-wider text-on-surface-variant">
            Pet Photo
          </label>
          
          {photo ? (
            // Preview uploaded photo
            <div className="relative rounded-2xl overflow-hidden border border-outline-variant/30 bg-surface">
              <img
                src={photo}
                alt="Pet preview"
                className="w-full aspect-square object-cover"
              />
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent p-4 flex justify-between items-end">
                <span className="text-white text-xs font-bold">📸 Photo uploaded</span>
                <button
                  onClick={() => setPhoto(null)}
                  className="bg-white/20 backdrop-blur-sm text-white px-3 py-1.5 rounded-full text-xs font-bold hover:bg-white/30 transition-colors"
                >
                  Replace
                </button>
              </div>
              {/* Success checkmark */}
              <div className="absolute top-3 right-3 bg-green-500 text-white w-8 h-8 rounded-full flex items-center justify-center shadow-lg">
                <Check size={16} />
              </div>
            </div>
          ) : (
            // Upload zone
            <div
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onClick={() => fileInputRef.current?.click()}
              className={`
                cursor-pointer rounded-2xl border-2 border-dashed transition-all duration-200
                flex flex-col items-center justify-center p-8 aspect-[4/3]
                ${isDragging
                  ? "border-primary bg-primary/10 scale-[1.02]"
                  : "border-outline-variant/40 bg-surface hover:border-primary/50 hover:bg-primary/5"
                }
              `}
            >
              <div className={`
                w-16 h-16 rounded-full flex items-center justify-center mb-4 transition-colors
                ${isDragging ? "bg-primary/20" : "bg-outline-variant/20"}
              `}>
                <Upload size={28} className={isDragging ? "text-primary" : "text-on-surface-variant"} />
              </div>
              <p className="text-sm font-bold text-on-surface mb-1">
                {isDragging ? "Drop your photo here!" : "Upload a pet photo"}
              </p>
              <p className="text-xs text-on-surface-variant opacity-60">
                Drag & drop or click to browse • JPG, PNG, WebP • Max 10MB
              </p>
            </div>
          )}
          
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFileSelect(file);
            }}
          />
        </div>

        {/* What happens section */}
        <div className="bg-surface rounded-xl border border-outline-variant/20 p-4 mb-6">
          <p className="text-xs font-bold text-on-surface mb-3 uppercase tracking-wider opacity-60">
            What the AI will do
          </p>
          <div className="grid grid-cols-2 gap-2">
            {[
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
          disabled={!name.trim() || !photo}
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
