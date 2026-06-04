import React, { useState, useRef } from "react";
import { Sparkles, Sun, Crop, Compass, Upload, Save, HelpCircle, AlertCircle, RefreshCw, Dog, Camera, Mic, MicOff, Video } from "lucide-react";
import { StyleType, BackgroundType, Creation } from "../types";
import { STYLE_OPTIONS, BACKGROUND_OPTIONS } from "../data";

interface EditMemoryProps {
  credits: number;
  onCreationSaved: (newCreation: Creation) => void;
  onDeductCredits: (amount: number) => void;
  onNavigateBack: () => void;
  onUnlockAchievement?: (id: string) => void;
}

export default function EditMemory({
  credits,
  onCreationSaved,
  onDeductCredits,
  onNavigateBack,
  onUnlockAchievement,
}: EditMemoryProps) {
  const [selectedStyle, setSelectedStyle] = useState<StyleType>("Clay");
  const [selectedBackground, setSelectedBackground] = useState<BackgroundType>("Canyon");
  const [brightness, setBrightness] = useState(80);
  const [contrast, setContrast] = useState(45);
  const [petName, setPetName] = useState("");
  const [petBreed, setPetBreed] = useState("");

  const [uploadedBase64, setUploadedBase64] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string>(
    "https://lh3.googleusercontent.com/aida-public/AB6AXuBczLtNbUT0-FNdJXIZplkbyHP3RZ0l7FSpMuVhsyGBIbNVw7QJSKV8zKHjpchFtruJF1VwQuJ9d5i1O51cb868FuHplFp1aZ_ghTHpiGzXlTjKCJ2_8s6zU9HIkVDaL9fmRCv5ZA9CfNRqU25-gCu9KKtspHlbqjGatCm8qo2kE_AY7-qyM8qNK3nGUAfGOJrTcwc9wLh12AGf_8ymB9KWCTMjfTi-TRJrObqvRsInGYqeZ7G2W-GQ6XAMmuseisKQbdASDPauJK8"
  );
  
  const [loading, setLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState(0);
  const [errorMessage, setErrorMessage] = useState("");
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  // HTML5 MediaDevices camera state
  const [isCameraActive, setIsCameraActive] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [activeStream, setActiveStream] = useState<MediaStream | null>(null);

  // Vocal dictation state
  const [isDictatingName, setIsDictatingName] = useState(false);
  const [isDictatingBreed, setIsDictatingBreed] = useState(false);

  const startCamera = async () => {
    try {
      setErrorMessage("");
      setIsCameraActive(true);
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 512, height: 512, facingMode: "user" },
        audio: false,
      });
      setActiveStream(stream);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
      }
    } catch (err: any) {
      setIsCameraActive(false);
      setErrorMessage("Microphone/Camera permission error: " + (err.message || err.toString()));
    }
  };

  const stopCamera = () => {
    if (activeStream) {
      activeStream.getTracks().forEach((track) => track.stop());
    }
    setActiveStream(null);
    setIsCameraActive(false);
  };

  const captureSnapshot = () => {
    if (!videoRef.current) return;
    try {
      const video = videoRef.current;
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth || 512;
      canvas.height = video.videoHeight || 512;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        const size = Math.min(canvas.width, canvas.height);
        const sx = (canvas.width - size) / 2;
        const sy = (canvas.height - size) / 2;
        // Draw centered square
        ctx.drawImage(video, sx, sy, size, size, 0, 0, 512, 512);
        
        const dataUrl = canvas.toDataURL("image/jpeg");
        setUploadedBase64(dataUrl);
        setPreviewUrl(dataUrl);
        
        if (onUnlockAchievement) {
          onUnlockAchievement("camera_use");
        }
      }
      stopCamera();
    } catch (e: any) {
      setErrorMessage("Could not snap picture: " + e.message);
    }
  };

  const startVoiceDictation = (field: "name" | "breed") => {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      alert("Microphone text-to-speech transcription is not supported in this browser version. Please try Google Chrome or Safari!");
      return;
    }

    try {
      const rec = new SpeechRecognition();
      rec.continuous = false;
      rec.interimResults = false;
      rec.lang = "en-US";

      rec.onstart = () => {
        if (field === "name") setIsDictatingName(true);
        if (field === "breed") setIsDictatingBreed(true);
      };

      rec.onresult = (event: any) => {
        const transcript = event.results[0][0].transcript;
        if (transcript) {
          const cleanText = transcript.replace(/[.,/#!$%^&*;:{}=\-_`~()]/g, "").trim();
          if (field === "name") {
            setPetName(cleanText);
          } else {
            setPetBreed(cleanText);
          }
          if (onUnlockAchievement) {
            onUnlockAchievement("voice_use");
          }
        }
      };

      rec.onerror = (e: any) => {
        console.error("Mic transcribing error:", e);
      };

      rec.onend = () => {
        setIsDictatingName(false);
        setIsDictatingBreed(false);
      };

      rec.start();
    } catch (err) {
      console.error(err);
      setIsDictatingName(false);
      setIsDictatingBreed(false);
    }
  };

  const loadingMessages = [
    "Randy is setting up the canvas...",
    "Retrieving style guidelines...",
    "Sculpting clay shapes and contours...",
    "Blending golden hour light filters...",
    "Drenching background in warm sand textures...",
    "Formulating final high-definition heirloom memory..."
  ];

  // Rotate loading screen steps
  const startLoadingRotation = () => {
    setLoadingStep(0);
    const interval = setInterval(() => {
      setLoadingStep((prev) => {
        if (prev < loadingMessages.length - 1) {
          return prev + 1;
        }
        clearInterval(interval);
        return prev;
      });
    }, 2800);
    return interval;
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onloadend = () => {
      const b64 = reader.result as string;
      setUploadedBase64(b64);
      setPreviewUrl(b64);
    };
    reader.readAsDataURL(file);
  };

  const handleSaveToAlbum = async () => {
    if (credits < 40) {
      setErrorMessage("Insufficient credits (40 cr required). Use the daily bonus or share memories to get more credits!");
      return;
    }

    setErrorMessage("");
    setLoading(true);
    const loadingInterval = startLoadingRotation();

    try {
      const response = await fetch("/api/create-creation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          style: selectedStyle,
          background: selectedBackground,
          photo: uploadedBase64,
          breed: petBreed,
          name: petName,
          brightness,
          contrast,
        }),
      });

      const data = await response.json();
      clearInterval(loadingInterval);

      if (!response.ok || !data.success) {
        throw new Error(data.error || "Generation endpoint returned status non-ok");
      }

      onDeductCredits(40);

      // Create new Creation
      const userCreation: Creation = {
        id: `creation-${Date.now()}`,
        name: petName ? `${petName} in ${selectedBackground}` : `My Pet in ${selectedBackground}`,
        breed: petBreed,
        style: selectedStyle,
        background: selectedBackground,
        imageUrl: data.imageUrl,
        createdAt: "Just now",
        isCustomUploaded: !!uploadedBase64,
      };

      onCreationSaved(userCreation);
    } catch (err: any) {
      clearInterval(loadingInterval);
      setErrorMessage(
        err.message || "Something went wrong while connecting with the custom server. Please check your internet connection or Gemini API secrets keys."
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full max-w-md mx-auto px-4 py-6 space-y-6">
      
      {/* Loading Overlay */}
      {loading && (
        <div className="fixed inset-0 bg-white/95 backdrop-blur-md z-50 flex flex-col justify-center items-center p-6 text-center space-y-6 animate-fade-in">
          <div className="w-24 h-24 bg-surface-container rounded-full flex items-center justify-center soft-glow-shadow text-primary relative">
            <div className="absolute inset-0 border-4 border-primary/20 border-t-primary rounded-full animate-spin"></div>
            <span className="text-4xl animate-bounce">🎨</span>
          </div>
          <div className="space-y-2 max-w-sm">
            <h3 className="text-xl font-extrabold text-primary font-sans animate-pulse">
              Randy is crafting...
            </h3>
            <p className="text-sm text-on-surface-variant font-medium leading-relaxed min-h-[48px]">
              {loadingMessages[loadingStep]}
            </p>
          </div>
          <p className="text-xs text-outline/80 font-mono font-sans">
            Usually takes around 8-15 seconds. Hold tight!
          </p>
        </div>
      )}

      {/* Main Preview Block */}
      <section className="relative aspect-square w-full rounded-2xl overflow-hidden shadow-xl border border-surface-variant/30 group bg-surface-container">
        {isCameraActive ? (
          <div className="absolute inset-0 bg-slate-950 flex flex-col justify-between items-center overflow-hidden">
            <video
              ref={videoRef}
              playsInline
              muted
              className="absolute inset-0 w-full h-full object-cover scale-x-[-1]"
            />
            
            {/* Guide rectangle overlay */}
            <div className="absolute inset-10 border-2 border-dashed border-white/60 rounded-3xl pointer-events-none flex flex-col items-center justify-center bg-black/10">
              <span className="text-[10px] text-white font-extrabold uppercase tracking-widest bg-black/50 backdrop-blur-[2px] px-2.5 py-1 rounded-full">
                Position Pet / Face Area
              </span>
            </div>

            {/* Top badge */}
            <div className="absolute top-4 left-4 bg-orange-600 text-white text-[9px] font-black tracking-widest px-2.5 py-1 rounded-full flex items-center gap-1 shadow animate-pulse">
              <span className="w-1.5 h-1.5 bg-white rounded-full" />
              LIVE FEED ACTIVE
            </div>

            {/* Bottom Controls */}
            <div className="absolute bottom-4 left-4 right-4 flex gap-3.5 z-20">
              <button
                type="button"
                onClick={stopCamera}
                className="flex-1 py-2.5 bg-slate-900/90 hover:bg-slate-850 backdrop-blur-md text-white border border-slate-700 rounded-xl text-xs font-bold active:scale-95 transition-all cursor-pointer"
              >
                Cancel Cam
              </button>
              <button
                type="button"
                onClick={captureSnapshot}
                className="flex-1.5 py-2.5 bg-secondary text-white rounded-xl text-xs font-black shadow-md hover:bg-secondary/95 active:scale-95 transition-all flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Camera size={13} />
                Snap Photo
              </button>
            </div>
          </div>
        ) : (
          <img
            alt="Main Editing Preview"
            className="w-full h-full object-cover transition-transform duration-700"
            src={previewUrl}
            referrerPolicy="no-referrer"
            style={{
              filter: `brightness(${brightness + 20}%) contrast(${contrast + 55}%)`
            }}
          />
        )}

        {/* Style Floating Badges */}
        {!isCameraActive && (
          <div className="absolute top-4 left-4 flex flex-wrap gap-2 pointer-events-none">
            <div className="bg-white/85 backdrop-blur-md px-3 py-1 rounded-full flex items-center gap-1.5 shadow-sm border border-outline-variant/30">
              <Sparkles size={12} className="text-primary" />
              <span className="text-[10px] font-bold text-on-surface uppercase tracking-wider">{selectedStyle} Style</span>
            </div>
            <div className="bg-white/85 backdrop-blur-md px-3 py-1 rounded-full flex items-center gap-1.5 shadow-sm border border-outline-variant/30">
              <Compass size={12} className="text-secondary" />
              <span className="text-[10px] font-bold text-on-surface uppercase tracking-wider">📍 {selectedBackground}</span>
            </div>
          </div>
        )}

        {/* Custom Pet Photo Upload / Camera overlay */}
        {!isCameraActive && (
          <div className="absolute bottom-4 left-4 right-4 flex justify-between items-center bg-black/60 backdrop-blur-md p-2 rounded-xl border border-white/10">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center text-white">
                <Dog size={16} />
              </div>
              <p className="text-[10px] font-bold text-white uppercase tracking-wider leading-none">
                {uploadedBase64 ? "Custom Pet Active" : "Original Sample Preview"}
              </p>
            </div>
            <div className="flex gap-1.5">
              <button
                onClick={startCamera}
                className="flex items-center gap-1 text-[10px] font-bold uppercase py-1.5 px-2.5 bg-secondary text-white rounded-lg shadow-sm cursor-pointer hover:bg-secondary/95 transition-all"
              >
                <Camera size={11} />
                Live Camera
              </button>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-1 text-[10px] font-bold uppercase py-1.5 px-2.5 bg-primary text-white rounded-lg shadow-sm cursor-pointer hover:bg-primary/95 transition-all"
              >
                <Upload size={10} />
                Upload File
              </button>
            </div>
          </div>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleFileUpload}
        />
      </section>

      {/* Sliders adjustments and personalized details inputs */}
      <section className="bg-surface-container rounded-3xl p-5 border border-outline-variant/30 space-y-4 shadow-sm">
        <h3 className="text-xs font-bold text-on-surface-variant uppercase tracking-widest px-1">
          Pet Details &amp; Mic Dictation
        </h3>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <div className="flex justify-between items-center px-1">
              <label className="text-[11px] font-semibold text-on-surface-variant block">Pet Name</label>
              <button
                type="button"
                onClick={() => startVoiceDictation("name")}
                className={`p-1 rounded transition-all cursor-pointer ${
                  isDictatingName ? "bg-red-500 text-white animate-pulse" : "text-primary hover:bg-primary/10"
                }`}
                title="Voice dictate pet name"
              >
                <Mic size={11} />
              </button>
            </div>
            <input
              type="text"
              placeholder={isDictatingName ? "Listening..." : "e.g. Daisy"}
              value={petName}
              onChange={(e) => setPetName(e.target.value)}
              className="w-full bg-white border border-outline-variant rounded-xl py-2 px-3 text-xs focus:outline-none focus:border-primary disabled:opacity-60 text-slate-800 font-medium"
              disabled={isDictatingName}
            />
          </div>
          <div className="space-y-1">
            <div className="flex justify-between items-center px-1">
              <label className="text-[11px] font-semibold text-on-surface-variant block">Pet Breed</label>
              <button
                type="button"
                onClick={() => startVoiceDictation("breed")}
                className={`p-1 rounded transition-all cursor-pointer ${
                  isDictatingBreed ? "bg-red-500 text-white animate-pulse" : "text-primary hover:bg-primary/10"
                }`}
                title="Voice dictate breed name"
              >
                <Mic size={11} />
              </button>
            </div>
            <input
              type="text"
              placeholder={isDictatingBreed ? "Listening..." : "e.g. Pug, Beagle"}
              value={petBreed}
              onChange={(e) => setPetBreed(e.target.value)}
              className="w-full bg-white border border-outline-variant rounded-xl py-2 px-3 text-xs focus:outline-none focus:border-primary disabled:opacity-60 text-slate-800 font-medium"
              disabled={isDictatingBreed}
            />
          </div>
        </div>
      </section>

      {/* Style preset scroll columns */}
      <section className="space-y-2">
        <h3 className="text-xs font-bold text-on-surface-variant uppercase tracking-widest px-1">
          Creative Styles
        </h3>
        <div className="flex gap-3.5 overflow-x-auto hide-scrollbar py-1">
          {STYLE_OPTIONS.map((styleOpt) => (
            <div
              key={styleOpt.value}
              onClick={() => setSelectedStyle(styleOpt.value)}
              className="flex-shrink-0 flex flex-col items-center gap-1.5 cursor-pointer group"
            >
              <div
                className={`w-20 h-20 rounded-2xl border-3 p-0.5 overflow-hidden transition-all shadow-sm ${
                  selectedStyle === styleOpt.value
                    ? "border-primary scale-[1.03]"
                    : "border-transparent opacity-80 hover:opacity-100"
                }`}
              >
                <img
                  alt={styleOpt.label}
                  className="w-full h-full object-cover rounded-xl"
                  src={styleOpt.imageUrl}
                  referrerPolicy="no-referrer"
                />
              </div>
              <span
                className={`text-xs font-semibold ${
                  selectedStyle === styleOpt.value ? "text-primary font-bold" : "text-on-surface-variant"
                }`}
              >
                {styleOpt.label}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* Adjustments and background section */}
      <section className="bg-surface-container rounded-3xl p-5 border border-outline-variant/30 space-y-6 shadow-sm">
        
        {/* Background options catalogs */}
        <div className="space-y-2">
          <div className="flex justify-between items-center px-1">
            <h3 className="text-xs font-bold text-on-surface-variant uppercase tracking-widest">
              Dream Destins
            </h3>
            <span className="text-[10px] text-outline uppercase font-bold tracking-widest">5 locations</span>
          </div>
          
          <div className="flex gap-2.5 overflow-x-auto hide-scrollbar">
            {BACKGROUND_OPTIONS.slice(0, 4).map((bgOpt) => (
              <div
                key={bgOpt.value}
                onClick={() => setSelectedBackground(bgOpt.value)}
                className="flex-shrink-0 w-28 h-18 rounded-xl overflow-hidden relative cursor-pointer active:scale-95 transition-all shadow-sm border border-outline-variant/10"
              >
                <img
                  alt={bgOpt.label}
                  className={`w-full h-full object-cover ${selectedBackground === bgOpt.value ? "brightness-90" : "brightness-75"}`}
                  src={bgOpt.imageUrl}
                  referrerPolicy="no-referrer"
                />
                {/* Active check border */}
                {selectedBackground === bgOpt.value && (
                  <div className="absolute inset-0 border-3 border-primary rounded-xl"></div>
                )}
                <div className="absolute bottom-1.5 left-2 bg-black/30 backdrop-blur-[1px] px-1.5 py-0.5 rounded">
                  <span className="text-[9px] text-white font-bold uppercase tracking-tight">{bgOpt.label}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Adjustments Brightness / Contrast Sliders */}
        <div className="space-y-3 pt-2 border-t border-outline-variant/40">
          <h3 className="text-xs font-bold text-on-surface-variant uppercase tracking-widest px-1">
            Adjustments
          </h3>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <div className="flex justify-between items-center px-1">
                <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Brightness</span>
                <span className="text-xs font-bold text-primary font-sans">{brightness}%</span>
              </div>
              <input
                type="range"
                min="0"
                max="100"
                value={brightness}
                onChange={(e) => setBrightness(Number(e.target.value))}
                className="w-full h-1.5 bg-outline-variant/40 rounded-lg appearance-none cursor-pointer accent-primary"
              />
            </div>
            <div className="space-y-1.5">
              <div className="flex justify-between items-center px-1">
                <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Contrast</span>
                <span className="text-xs font-bold text-primary font-sans">{contrast}%</span>
              </div>
              <input
                type="range"
                min="0"
                max="100"
                value={contrast}
                onChange={(e) => setContrast(Number(e.target.value))}
                className="w-full h-1.5 bg-outline-variant/40 rounded-lg appearance-none cursor-pointer accent-primary"
              />
            </div>
          </div>
        </div>
      </section>

      {/* Global alert error handling display */}
      {errorMessage && (
        <div className="p-4 bg-error-container text-on-error-container border border-error/50 rounded-2xl flex gap-3 text-xs">
          <AlertCircle className="text-error flex-shrink-0 mt-0.5" size={16} />
          <p className="leading-relaxed leading-normal">{errorMessage}</p>
        </div>
      )}

      {/* Large save / restyle CTA button */}
      <button
        onClick={handleSaveToAlbum}
        className="w-full py-4 bg-primary text-white rounded-2xl font-bold font-sans text-sm shadow-md hover:bg-primary/95 active:scale-[0.98] transition-all flex items-center justify-center gap-2 cursor-pointer border border-outline-variant/20"
      >
        <span>Save & Restyle Memory</span>
        <Save size={16} />
      </button>
    </div>
  );
}
