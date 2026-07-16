import React from "react";

interface FidosBinDoghouseCardProps {
  onClick: () => void;
  className?: string;
}

export default function FidosBinDoghouseCard({ onClick, className = "" }: FidosBinDoghouseCardProps) {
  return (
    <button
      onClick={onClick}
      className={`group relative flex flex-col items-center justify-center p-6 rounded-2xl bg-[#9A4F32] shadow-lg transition-all duration-300 hover:scale-105 hover:-translate-y-1 hover:shadow-[0_12px_24px_rgba(154,79,50,0.3)] active:scale-95 focus-visible:outline focus-visible:outline-4 focus-visible:outline-primary ${className}`}
    >
      <div className="absolute inset-0 bg-black/10 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
      
      {/* Doghouse Silhouette */}
      <span className="material-symbols-outlined text-[64px] text-white drop-shadow-md mb-4" style={{ fontVariationSettings: "'FILL' 1" }}>
        other_houses
      </span>
      
      {/* Title with playful fallback font */}
      <h3 className="text-2xl text-white font-bold tracking-wide drop-shadow-md" style={{ fontFamily: "'Chewy', 'Comic Sans MS', cursive, sans-serif" }}>
        Fido's Bin
      </h3>
      
      <p className="mt-2 text-white/80 text-sm font-medium text-center">
        Explore your stored items
      </p>
    </button>
  );
}
