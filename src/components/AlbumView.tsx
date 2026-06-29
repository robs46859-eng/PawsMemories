import React, { useState } from "react";
import { ArrowLeft, Play, LayoutGrid } from "lucide-react";
import { Album, Creation } from "../types";

interface AlbumViewProps {
  album: Album;
  creations: Creation[];
  onBack: () => void;
  onSelectCreation: (creation: Creation) => void;
  onPlayVideo: (creation: Creation) => void;
  animatingJobs: Record<string, boolean>;
}

const AlbumView: React.FC<AlbumViewProps> = ({
  album,
  creations,
  onBack,
  onSelectCreation,
  onPlayVideo,
  animatingJobs,
}) => {
  // Filter creations to only those in this album
  const albumCreations = creations.filter((c) => c.album_id?.toString() === album.id.toString());

  return (
    <div className="min-h-screen bg-surface px-4 py-6 max-w-7xl mx-auto pb-24">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-on-surface hover:text-primary transition-colors"
        >
          <ArrowLeft size={20} />
          <span className="font-bold">Back to Dashboard</span>
        </button>
      </div>

      <div className="mb-8">
        <h1 className="text-3xl font-black text-on-surface mb-2">{album.name}</h1>
        <p className="text-sm text-on-surface-variant font-medium">
          {albumCreations.length} {albumCreations.length === 1 ? "Item" : "Items"}
        </p>
      </div>

      {albumCreations.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center border-2 border-dashed border-outline-variant/30 rounded-3xl bg-surface-container-low">
          <LayoutGrid size={48} className="text-primary/40 mb-4" />
          <h3 className="text-lg font-bold text-on-surface mb-2">This album is empty</h3>
          <p className="text-sm text-on-surface-variant max-w-xs">
            Start adding memories to this album to bring it to life!
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {albumCreations.map((creation) => {
            const animating = animatingJobs[creation.id];
            return (
              <div
                key={creation.id}
                className="group relative cursor-pointer aspect-square rounded-2xl overflow-hidden bg-surface-container shadow-sm hover:shadow-md transition-all"
                onClick={() => onSelectCreation(creation)}
              >
                <img
                  alt={creation.name}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"
                  src={creation.image_url || undefined}
                  referrerPolicy="no-referrer"
                />

                {creation.video_url && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onPlayVideo(creation);
                    }}
                    className="absolute top-2 left-2 p-1.5 bg-black/60 hover:bg-primary backdrop-blur-md rounded-full text-white transition-colors z-10"
                  >
                    <Play size={14} className="fill-white" />
                  </button>
                )}

                <div className="absolute inset-x-0 bottom-0 p-3 bg-gradient-to-t from-black/80 via-black/40 to-transparent">
                  <p className="text-white font-bold text-xs truncate">
                    {creation.name}
                  </p>
                  <p className="text-white/80 text-[10px] capitalize">
                    {creation.style} {creation.media_type === 'video' ? 'Video' : 'Still'}
                  </p>
                </div>

                {animating && (
                  <div className="absolute inset-0 bg-black/50 flex items-center justify-center z-20 backdrop-blur-sm">
                    <div className="animate-spin rounded-full h-6 w-6 border-2 border-primary border-t-transparent" />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default AlbumView;
