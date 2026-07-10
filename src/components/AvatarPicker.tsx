import React, { useEffect, useState } from "react";
import { X, Loader2 } from "lucide-react";
import { fetchAvatars } from "../api";
import { Avatar } from "../types";

export interface AvatarPickerProps {
  onSelect: (avatar: Avatar) => void;
  onClose: () => void;
  excludeId?: number;
}

export default function AvatarPicker({ onSelect, onClose, excludeId }: AvatarPickerProps) {
  const [avatars, setAvatars] = useState<Avatar[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let canceled = false;
    fetchAvatars().then((list) => {
      if (!canceled) {
        setAvatars(list.filter(a => a.id !== excludeId && a.generation_status === "done" && !!a.model_url));
        setLoading(false);
      }
    }).catch(() => {
      if (!canceled) setLoading(false);
    });
    return () => { canceled = true; };
  }, [excludeId]);

  return (
    <div className="absolute inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-6 bg-black/60 backdrop-blur-sm">
      <div className="w-full sm:max-w-md bg-surface text-on-surface rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[80vh]">
        <div className="flex items-center justify-between p-4 border-b border-outline-variant/20">
          <h3 className="font-bold text-lg">Add Companion</h3>
          <button onClick={onClose} className="p-2 rounded-full hover:bg-black/5 active:scale-95">
            <X size={20} />
          </button>
        </div>

        <div className="p-4 overflow-y-auto">
          {loading ? (
            <div className="flex justify-center p-8">
              <Loader2 className="animate-spin opacity-50" />
            </div>
          ) : avatars.length === 0 ? (
            <div className="text-center p-8 opacity-60 text-sm">
              No other 3D avatars available.
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {avatars.map((a) => (
                <button
                  key={a.id}
                  onClick={() => onSelect(a)}
                  className="relative group rounded-2xl overflow-hidden border border-outline-variant/20 aspect-square flex flex-col active:scale-95 transition-transform"
                >
                  {a.image_url ? (
                    <img src={a.image_url} alt={a.name} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full bg-primary/10 flex items-center justify-center font-bold text-primary opacity-50">
                      {a.name[0]}
                    </div>
                  )}
                  <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/80 to-transparent p-3 pt-8 text-left">
                    <p className="font-bold text-white text-sm truncate">{a.name}</p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
