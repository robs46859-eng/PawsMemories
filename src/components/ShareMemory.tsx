import React, { useState } from "react";
import { ArrowLeft, Copy, Check, Download, Share2, Compass, ShieldAlert, Heart, Calendar, MessageSquare, ExternalLink, Sparkles, ShoppingBag } from "lucide-react";
import { Creation } from "../types";
import OrderAlbumModal from "./OrderAlbumModal";

interface ShareMemoryProps {
  creation: Creation;
  userCredits: number;
  onBack: () => void;
}

export default function ShareMemory({ creation, userCredits, onBack }: ShareMemoryProps) {
  const [copied, setCopied] = useState(false);
  const [showOrderModal, setShowOrderModal] = useState(false);
  const [roverOwnerName, setRoverOwnerName] = useState("Alex");
  const [roverCustomText, setRoverCustomText] = useState("Today was such a joyful day! I crafted this magical portrait as a keepsake memory.");
  const [roverTemplate, setRoverTemplate] = useState("stay_update");
  const [roverCopied, setRoverCopied] = useState(false);
  const [showIntegrationsGuide, setShowIntegrationsGuide] = useState(false);

  const getPetFirstName = () => {
    // Graceful extraction or fallback
    if (!creation.name) return "your pet";
    return creation.name.split(" ")[0];
  };

  const getRoverMessageText = () => {
    const petName = getPetFirstName();
    if (roverTemplate === "stay_update") {
      return `Hi ${roverOwnerName}! 🐾 Just wanted to send an update on ${petName}. They are doing fantastic! I crafted this special ${creation.style} artwork of them today. Check it out here: ${creation.image_url}`;
    }
    if (roverTemplate === "goodnight") {
      return `Good evening ${roverOwnerName}! 🌙 ${petName} is all curled up and cozy. Before we turn in, here is a lovely ${creation.style} photo memory I made of them: ${creation.image_url}`;
    }
    return `Hi ${roverOwnerName}! We just finished a super fun session. Look at this beautiful ${creation.style} digital keepsake of your furry buddy! 🎨🐶 Link: ${creation.image_url}`;
  };

  const handleCopyLink = () => {
    navigator.clipboard.writeText(creation.image_url || "");
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCopyRoverMessage = () => {
    navigator.clipboard.writeText(getRoverMessageText());
    setRoverCopied(true);
    setTimeout(() => setRoverCopied(false), 2000);
  };

  const handleDownload = () => {
    // Phase 4: Support downloading videos or images
    const urlToDownload = creation.media_type === "video" && creation.video_url 
      ? creation.video_url 
      : (creation.image_url || "");
      
    const ext = creation.media_type === "video" ? "mp4" : "jpeg";
    const link = document.createElement("a");
    link.href = urlToDownload;
    link.download = `${creation.name?.replace(/\s+/g, "_") || "memory"}.${ext}`;
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
      <div className="relative w-full aspect-[4/3] rounded-3xl overflow-hidden soft-glow-shadow border-4 border-white bg-surface-container bg-black">
        {creation.media_type === "video" && creation.video_url ? (
          <video
            src={creation.video_url}
            autoPlay
            loop
            muted
            playsInline
            className="w-full h-full object-cover"
          />
        ) : (
          <img
            alt={creation.name || "Creation"}
            className="w-full h-full object-cover"
            src={creation.image_url || creation.image_url || ""}
            referrerPolicy="no-referrer"
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent"></div>

        <div className="absolute bottom-4 left-4 right-4 flex justify-between items-end text-white">
          <div>
            <span className="text-[10px] font-bold text-primary-container-lowest uppercase tracking-wider bg-primary/40 backdrop-blur-sm px-2.5 py-0.5 rounded-full mb-1 inline-block">
              {creation.style} Restyle
            </span>
            <h2 className="text-lg font-bold leading-tight">{creation.name || "Untitled Memory"}</h2>
          </div>
          <p className="text-[10px] opacity-80 font-medium whitespace-nowrap">
            {creation.created_at ? new Date(creation.created_at).toLocaleDateString() : "Recent"}
          </p>
        </div>
        
        {creation.media_type === "video" && (
          <div className="absolute top-3 right-3 bg-black/60 backdrop-blur-sm text-white px-3 py-1 rounded-full flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider">
            <span className="w-1.5 h-1.5 bg-yellow-400 rounded-full animate-pulse" />
            Video
          </div>
        )}
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
            <p className="text-xs text-on-surface-variant truncate font-sans">{creation.image_url}</p>
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

      {/* Rover Pet-Sitter Quick-Share Assistant */}
      <section className="bg-surface-container rounded-3xl p-5 border border-outline-variant/30 space-y-4 shadow-sm">
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-2 text-primary">
            <Compass size={18} className="text-orange-600 animate-spin animate-duration-[12000ms]" />
            <h3 className="text-xs font-black uppercase tracking-wider font-sans">
              Rover Sitter Quick-Share
            </h3>
          </div>
          <span className="text-[9px] bg-amber-500/10 text-amber-600 font-extrabold px-2 py-0.5 rounded-full uppercase tracking-wider">
            Sitter Toolkit
          </span>
        </div>

        <p className="text-xs text-on-surface-variant leading-relaxed">
          Are you sitting <strong className="text-on-surface">{getPetFirstName()}</strong>? Share this beautiful masterpiece directly with their owner Alex on your Rover thread!
        </p>

        {/* Form elements inside assistant */}
        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] text-on-surface-variant font-bold uppercase tracking-wider px-1 block mb-1">
                Owner's Name
              </label>
              <input
                type="text"
                value={roverOwnerName}
                onChange={(e) => setRoverOwnerName(e.target.value)}
                placeholder="e.g. Alex, Sarah"
                className="w-full bg-white border border-outline-variant rounded-xl py-2 px-3 text-xs focus:outline-none focus:border-primary text-slate-800 font-medium"
              />
            </div>
            <div>
              <label className="text-[10px] text-on-surface-variant font-bold uppercase tracking-wider px-1 block mb-1">
                Update Scenario
              </label>
              <select
                value={roverTemplate}
                onChange={(e) => setRoverTemplate(e.target.value)}
                className="w-full bg-white border border-outline-variant rounded-xl py-2 px-3 text-xs focus:outline-none focus:border-primary text-slate-800 font-black cursor-pointer"
              >
                <option value="stay_update">🐾 Active Day Update</option>
                <option value="goodnight">🌙 Sweet Dreams Sleep</option>
                <option value="keepsake">🎨 Digital Art Keepsake</option>
              </select>
            </div>
          </div>

          {/* Render Preview Card */}
          <div className="bg-white/95 dark:bg-slate-900 border border-outline-variant/40 rounded-2xl p-4 space-y-2.5 relative">
            <div className="flex justify-between items-center pb-2 border-b border-outline-variant/20">
              <span className="text-[9px] font-black text-rose-500 uppercase tracking-widest flex items-center gap-1">
                <Heart size={10} className="fill-rose-500" /> Rover Message Preview
              </span>
              <span className="text-[9px] text-on-surface-variant/50 font-mono">Character length: {getRoverMessageText().length}</span>
            </div>
            
            <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed italic pr-3 font-medium">
              "{getRoverMessageText()}"
            </p>

            {/* Direct Thumbnail Attachment Badge */}
            <div className="flex items-center gap-2.5 bg-surface-container-low/80 p-2 rounded-xl border border-outline-variant/15">
              <img
                src={creation.image_url}
                alt="Thumbnail Attachment"
                className="w-10 h-10 object-cover rounded-lg border border-outline-variant/20"
                referrerPolicy="no-referrer"
              />
              <div className="text-[10px] truncate">
                <span className="font-bold text-on-surface block">Attached Masterpiece link</span>
                <span className="text-on-surface-variant font-mono truncate block max-w-[200px]">{creation.image_url}</span>
              </div>
            </div>
          </div>

          {/* Quick-Action Controls */}
          <div className="grid grid-cols-2 gap-3 pt-1">
            <button
              onClick={handleCopyRoverMessage}
              type="button"
              className="py-3 px-4 bg-primary text-white text-xs font-black uppercase rounded-xl hover:bg-primary/95 shadow-sm active:scale-95 duration-100 transition-all flex items-center justify-center gap-1.5 cursor-pointer"
            >
              {roverCopied ? <Check size={14} className="text-white" /> : <Copy size={14} />}
              <span>{roverCopied ? "Copied!" : "Copy Rover Text"}</span>
            </button>

            <a
              href="https://www.rover.com/inbox/"
              target="_blank"
              rel="noopener noreferrer"
              className="py-3 px-4 bg-orange-600 text-white text-xs font-black uppercase rounded-xl hover:bg-orange-700 shadow-sm active:scale-95 duration-100 transition-all flex items-center justify-center gap-1.5 text-center cursor-pointer decoration-transparent"
            >
              <ExternalLink size={14} />
              <span>Go to Rover Inbox</span>
            </a>
          </div>

          {/* API Transparency notice helper info toggle */}
          <div className="pt-2">
            <button
              type="button"
              onClick={() => setShowIntegrationsGuide(!showIntegrationsGuide)}
              className="text-[10px] text-primary font-bold uppercase tracking-wider hover:underline flex items-center gap-1 cursor-pointer"
            >
              <ShieldAlert size={12} />
              {showIntegrationsGuide ? "Hide API Integration details" : "How does direct Rover messaging integration work?"}
            </button>

            {showIntegrationsGuide && (
              <div className="mt-2 bg-primary/5 p-3 rounded-xl border border-primary/20 text-[10px] text-primary font-medium tracking-wide leading-relaxed space-y-1 animate-slide-down">
                <p className="font-bold uppercase text-[9px] tracking-wider text-primary">Integration Architecture Notice Details:</p>
                <ul className="list-disc pl-4 space-y-1">
                  <li>Rover.com is a closed marketplace and does not maintain public developer APIs or direct SMS/messaging webhooks for third-party platforms to programmatically inject messages on behalf of active users.</li>
                  <li>Our tailored **Quick-Share Assistant** bridges this gap securely! By compiling an optimized text payload and providing a 1-click clipboard shortcut tool, you can drop high-resolution cloud links into the owner's chat thread safely.</li>
                  <li>Unlike heavy platform proxies, this guarantees 100% security under Rover Terms of Service since it operates directly through your certified human workspace.</li>
                </ul>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Download direct heirloom high-res photo button */}
      <div className="pt-2 flex flex-col gap-3">
        <button
          onClick={() => setShowOrderModal(true)}
          className="w-full py-4 bg-gradient-to-tr from-amber-500 to-orange-600 text-white rounded-2xl font-black text-sm shadow-lg flex items-center justify-center gap-2 hover:brightness-110 active:scale-[0.98] transition-all cursor-pointer border border-white/10 glow-orange-shadow"
        >
          <ShoppingBag size={16} />
          <span>Order Physical Photo Album</span>
        </button>

        <button
          onClick={handleDownload}
          className="w-full py-3.5 bg-primary text-white rounded-2xl font-bold text-sm shadow-md flex items-center justify-center gap-2 hover:bg-primary/95 transition-colors cursor-pointer border border-outline-variant/20"
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

      {showOrderModal && (
        <OrderAlbumModal
          creation={creation}
          userCredits={userCredits}
          onClose={() => setShowOrderModal(false)}
        />
      )}
    </div>
  );
}
