import React, { useState } from "react";
import { ArrowLeft, Copy, Check, Download, Share2, Compass, ShieldAlert, Heart, Calendar } from "lucide-react";
import { Creation } from "../types";

interface ShareMemoryProps {
  creation: Creation;
  onBack: () => void;
}

export default function ShareMemory({ creation, onBack }: ShareMemoryProps) {
  const [copied, setCopied] = useState(false);
  const [sitterService, setSitterService] = useState("Rover");
  const [showSitterMessage, setShowSitterMessage] = useState(false);
  const [contactName, setContactName] = useState("Sarah Connor");
  const [contactEmail, setContactEmail] = useState("stelartechos@gmail.com");

  const handleCopyLink = () => {
    navigator.clipboard.writeText(creation.imageUrl || "");
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    // Standard trigger
    const link = document.createElement("a");
    link.href = creation.imageUrl;
    link.download = `${creation.name.replace(/\s+/g, "_")}.jpeg`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="w-full max-w-lg mx-auto px-4 py-6 space-y-6">
      
      {/* Back button header row */}
      <div className="flex justify-between items-center px-1">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-xs font-bold text-on-surface-variant hover:text-primary transition-colors cursor-pointer"
        >
          <ArrowLeft size={16} />
          Back to Feed
        </button>
        <span className="text-[10px] font-bold text-secondary uppercase tracking-widest bg-secondary-container/15 py-1 px-3 rounded-full">
          Memory Shared
        </span>
      </div>

      {/* Hero preview card of selected creation */}
      <div className="relative w-full aspect-[4/3] rounded-3xl overflow-hidden soft-glow-shadow border-4 border-white bg-surface-container">
        <img
          alt={creation.name}
          className="w-full h-full object-cover"
          src={creation.imageUrl}
          referrerPolicy="no-referrer"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent"></div>

        <div className="absolute bottom-4 left-4 right-4 flex justify-between items-end text-white">
          <div>
            <span className="text-[10px] font-bold text-primary-container-lowest uppercase tracking-wider bg-primary/40 backdrop-blur-sm px-2.5 py-0.5 rounded-full mb-1 inline-block">
              {creation.style} Restyle
            </span>
            <h2 className="text-lg font-bold leading-tight">{creation.name}</h2>
          </div>
          <p className="text-[10px] opacity-80 font-medium whitespace-nowrap">{creation.createdAt}</p>
        </div>
      </div>

      {/* Share Actions buttons */}
      <section className="bg-surface-container rounded-3xl p-5 border border-outline-variant/30 space-y-4 shadow-sm">
        <h3 className="text-xs font-bold text-on-surface-variant uppercase tracking-widest px-1">
          Share your masterpiece
        </h3>

        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => alert("Successfully simulated direct sharing to TikTok. +10 Credits rewarded!")}
            className="flex items-center justify-center gap-2 py-3 bg-on-surface text-white hover:brightness-110 active:scale-95 transition-all text-xs font-bold rounded-xl cursor-pointer"
          >
            <Share2 size={14} className="text-secondary-container" />
            TikTok Feed
          </button>
          
          <button
            onClick={() => alert("Successfully simulated direct sharing to Instagram. +10 Credits rewarded!")}
            className="flex items-center justify-center gap-2 py-3 bg-gradient-to-tr from-orange-500 to-rose-600 text-white hover:brightness-110 active:scale-95 transition-all text-xs font-bold rounded-xl cursor-pointer"
          >
            <Share2 size={14} className="text-orange-200" />
            Insta Stories
          </button>
        </div>

        {/* Copy memory Link snippet block */}
        <div className="bg-white/60 p-3 rounded-xl border border-outline-variant/50 flex justify-between items-center gap-3">
          <div className="truncate text-left flex-grow">
            <span className="text-[9px] font-bold text-outline uppercase tracking-wider block">Direct Image Link</span>
            <p className="text-xs text-on-surface-variant truncate font-sans">{creation.imageUrl}</p>
          </div>
          <button
            onClick={handleCopyLink}
            className="w-10 h-10 rounded-lg bg-surface-container flex items-center justify-center text-primary border border-outline-variant/30 hover:bg-surface-container-high transition-colors cursor-pointer"
            title="Copy URL"
          >
            {copied ? <Check size={16} /> : <Copy size={16} />}
          </button>
        </div>
      </section>

      {/* Sitter and Rover integration block */}
      <section className="bg-surface-container rounded-3xl p-5 border border-outline-variant/30 space-y-4 shadow-sm">
        <div className="flex items-center gap-2 text-primary">
          <Compass size={18} />
          <h3 className="text-xs font-extrabold uppercase tracking-wider">
            Connected Sitter Services
          </h3>
        </div>

        <p className="text-xs text-on-surface-variant leading-relaxed">
          Need a trusted helper for {creation.name.replace(/in\s+\w+/gi, "").trim() || "your pet"} while you are away? Find certified sitters directly:
        </p>

        <div className="flex gap-3">
          <select
            value={sitterService}
            onChange={(e) => {
              setSitterService(e.target.value);
              setShowSitterMessage(true);
            }}
            className="bg-white border border-outline-variant rounded-xl py-2.5 px-3 text-xs w-full focus:outline-none focus:border-primary select-none text-on-surface font-semibold"
          >
            <option value="Rover">Rover Sitter Network</option>
            <option value="Wag">Wag! Quick Walkers</option>
          </select>
          
          <button
            onClick={() => setShowSitterMessage(true)}
            className="bg-primary/10 hover:bg-primary/15 text-primary py-2.5 px-4 rounded-xl text-xs font-bold whitespace-nowrap cursor-pointer"
          >
            Search Sitters
          </button>
        </div>

        {showSitterMessage && (
          <div className="p-3 bg-primary/5 rounded-xl border border-primary/20 text-xs text-primary leading-normal animate-fade-in flex gap-2">
            <Heart size={14} className="mt-0.5 flex-shrink-0" />
            <p>
              Looking for companions matched with <span className="font-bold">{sitterService}</span>. We will share your verified owner details under <strong>{contactName}</strong> and matching pet breed safely!
            </p>
          </div>
        )}
      </section>

      {/* Owner identification record details */}
      <section className="bg-surface-container rounded-3xl p-5 border border-outline-variant/30 space-y-3.5 shadow-sm">
        <h3 className="text-xs font-bold text-on-surface-variant uppercase tracking-widest px-1">
          Owner Identification Record
        </h3>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <span className="text-[10px] text-outline font-bold uppercase tracking-wider px-1">Owner Name</span>
            <input
              type="text"
              value={contactName}
              onChange={(e) => setContactName(e.target.value)}
              className="w-full bg-white border border-outline-variant rounded-xl py-1.5 px-3 text-xs focus:outline-none"
            />
          </div>
          <div>
            <span className="text-[10px] text-outline font-bold uppercase tracking-wider px-1">Contact Email</span>
            <input
              type="email"
              value={contactEmail}
              onChange={(e) => setContactEmail(e.target.value)}
              className="w-full bg-white border border-outline-variant rounded-xl py-1.5 px-3 text-xs focus:outline-none"
            />
          </div>
        </div>
      </section>

      {/* Download direct heirloom high-res photo button */}
      <div className="pt-2 flex flex-col gap-3">
        <button
          onClick={handleDownload}
          className="w-full py-4 bg-primary text-white rounded-2xl font-bold text-sm shadow-md flex items-center justify-center gap-2 hover:bg-primary/95 transition-colors cursor-pointer border border-outline-variant/20"
        >
          <Download size={16} />
          <span>Download High-Resolution Image</span>
        </button>
        
        <button
          onClick={onBack}
          className="w-full py-2.5 text-on-surface-variant text-xs font-semibold hover:text-primary transition-colors cursor-pointer"
        >
          Browse gallery instead
        </button>
      </div>
    </div>
  );
}
