import React, { useState, useRef } from "react";
import { Camera, Upload, X, Check, Image as ImageIcon } from "lucide-react";

interface CreateAvatarDialogProps {
  onClose: () => void;
  onSubmit: (name: string, imageUrl: string, style?: string) => void;
  isDarkMode: boolean;
}

const PRESET_DOGS = [
  "https://images.unsplash.com/photo-1543466835-00a7907e9de1?auto=format&fit=crop&q=80&w=600",
  "https://images.unsplash.com/photo-1517849845537-4d257902454a?auto=format&fit=crop&q=80&w=600",
  "https://images.unsplash.com/photo-1537151608804-ea2f1cb01e4a?auto=format&fit=crop&q=80&w=600",
  "https://images.unsplash.com/photo-1583511655857-d19b40a7a54e?auto=format&fit=crop&q=80&w=600",
  "https://images.unsplash.com/photo-1544568100-847a928585b9?auto=format&fit=crop&q=80&w=600",
  "https://images.unsplash.com/photo-1587300003388-59208cc962cb?auto=format&fit=crop&q=80&w=600",
];

export default function CreateAvatarDialog({ onClose, onSubmit, isDarkMode }: CreateAvatarDialogProps) {
  const [name, setName] = useState("");
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [mode, setMode] = useState<"preset" | "upload">("preset");
  const [style, setStyle] = useState<string>("3D");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      alert("Image is too large (max 5MB).");
      return;
    }

    const reader = new FileReader();
    reader.onload = (evt) => {
      if (evt.target?.result) {
        setSelectedImage(evt.target.result as string);
        setMode("upload");
      }
    };
    reader.readAsDataURL(file);
  };

  const handleSave = () => {
    if (!name.trim()) {
      alert("Please enter a name for your avatar.");
      return;
    }
    if (!selectedImage) {
      alert("Please select or upload an image.");
      return;
    }
    onSubmit(name.trim(), selectedImage, style === "None" ? undefined : style);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
      <div className={`bg-surface rounded-3xl p-6 max-w-md w-full shadow-2xl border border-outline-variant/30 flex flex-col max-h-[90vh] overflow-y-auto ${isDarkMode ? "text-white" : "text-slate-900"}`}>
        
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-extrabold flex items-center gap-2">
            <span className="text-2xl">🐶</span> New Avatar
          </h2>
          <button onClick={onClose} className="p-2 rounded-full hover:bg-outline-variant/20 transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="space-y-6">
          {/* Name Input */}
          <div>
            <label className="block text-sm font-bold mb-2 opacity-80">Avatar Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Buddy"
              className="w-full bg-surface-container border border-outline-variant/50 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all"
            />
          </div>

          {/* Image Selection Toggle */}
          <div className="flex bg-surface-container rounded-xl p-1 border border-outline-variant/30">
            <button
              onClick={() => setMode("preset")}
              className={`flex-1 py-2 text-sm font-bold rounded-lg transition-all ${mode === "preset" ? "bg-primary text-white shadow-md" : "opacity-60 hover:opacity-100"}`}
            >
              Preset Dogs
            </button>
            <button
              onClick={() => setMode("upload")}
              className={`flex-1 py-2 text-sm font-bold rounded-lg transition-all ${mode === "upload" ? "bg-primary text-white shadow-md" : "opacity-60 hover:opacity-100"}`}
            >
              Upload Photo
            </button>
          </div>

          {/* Style Selection */}
          <div>
            <label className="block text-sm font-bold mb-2 opacity-80">AI Avatar Style (40cr)</label>
            <select
              value={style}
              onChange={(e) => setStyle(e.target.value)}
              className="w-full bg-surface-container border border-outline-variant/50 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all"
            >
              <option value="None">None (Standard Upload)</option>
              <option value="3D">3D Render (Pixar-like)</option>
              <option value="Clay">Claymation</option>
              <option value="Anime">Anime (Studio Ghibli)</option>
              <option value="Sketch">Pencil Sketch</option>
              <option value="Watercolor">Watercolor Painting</option>
              <option value="Realistic">Hyper-Realistic</option>
              <option value="Retro">Retro Synthwave</option>
            </select>
          </div>

          {/* Preset Grid */}
          {mode === "preset" && (
            <div className="grid grid-cols-3 gap-3">
              {PRESET_DOGS.map((url, i) => (
                <div
                  key={i}
                  onClick={() => setSelectedImage(url)}
                  className={`aspect-square rounded-xl overflow-hidden cursor-pointer border-2 transition-all ${selectedImage === url ? "border-primary scale-105 shadow-lg" : "border-transparent opacity-80 hover:opacity-100"}`}
                >
                  <img src={url} alt="Preset Dog" className="w-full h-full object-cover" />
                </div>
              ))}
            </div>
          )}

          {/* Upload Area */}
          {mode === "upload" && (
            <div className="flex flex-col items-center">
              <input
                type="file"
                accept="image/*"
                ref={fileInputRef}
                onChange={handleFileChange}
                className="hidden"
              />
              {selectedImage && selectedImage.startsWith("data:image") ? (
                <div className="relative aspect-square w-48 rounded-2xl overflow-hidden border-2 border-primary mb-4 shadow-xl">
                  <img src={selectedImage} alt="Uploaded" className="w-full h-full object-cover" />
                  <button 
                    onClick={() => fileInputRef.current?.click()}
                    className="absolute bottom-2 right-2 bg-black/50 p-2 rounded-full backdrop-blur-sm text-white hover:bg-black/70 transition-colors"
                  >
                    <Upload size={16} />
                  </button>
                </div>
              ) : (
                <div 
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full aspect-video border-2 border-dashed border-outline-variant/50 rounded-2xl flex flex-col items-center justify-center cursor-pointer hover:border-primary hover:bg-primary/5 transition-all group"
                >
                  <div className="w-12 h-12 rounded-full bg-primary/10 text-primary flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
                    <ImageIcon size={24} />
                  </div>
                  <p className="text-sm font-bold">Tap to browse files</p>
                  <p className="text-xs opacity-60 mt-1">JPEG, PNG up to 5MB</p>
                </div>
              )}
            </div>
          )}

        </div>

        {/* Action Button */}
        <div className="mt-8">
          <button
            onClick={handleSave}
            disabled={!name.trim() || !selectedImage}
            className="w-full bg-primary text-white py-3.5 rounded-xl font-black uppercase tracking-wider flex items-center justify-center gap-2 hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg active:scale-95"
          >
            <Check size={18} />
            Create Avatar
          </button>
        </div>

      </div>
    </div>
  );
}
