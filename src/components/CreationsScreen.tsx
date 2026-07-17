import { useMemo, useState } from "react";
import { Download, Film, Image as ImageIcon, LayoutGrid, Loader2, PackageOpen, PawPrint, RefreshCw } from "lucide-react";
import type { Creation } from "../types";

type CreationFilter = "all" | "videos" | "pawprints" | "images" | "models";

interface CreationsScreenProps {
  creations: Creation[];
  onRefresh: () => Promise<void> | void;
  onOpenVideoCreator: () => void;
  onOpenPawprints: () => void;
}

const FILTERS: Array<{ id: CreationFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "videos", label: "Videos" },
  { id: "pawprints", label: "Pawprints" },
  { id: "images", label: "Images" },
  { id: "models", label: "3D models" },
];

function isPawprint(creation: Creation) {
  return creation.preset_name?.toLowerCase() === "pawprint";
}

function creationTitle(creation: Creation) {
  if (isPawprint(creation)) return creation.name || creation.place_label || "Pawprint";
  return creation.name || creation.place_label || (creation.video_url ? "Video creation" : "Untitled creation");
}

function creationDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Saved creation" : date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export default function CreationsScreen({ creations, onRefresh, onOpenVideoCreator, onOpenPawprints }: CreationsScreenProps) {
  const [filter, setFilter] = useState<CreationFilter>("all");
  const [refreshing, setRefreshing] = useState(false);

  const sortedCreations = useMemo(() => [...creations].sort((a, b) => {
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  }), [creations]);

  const visibleCreations = useMemo(() => sortedCreations.filter((creation) => {
    if (filter === "videos") return Boolean(creation.video_url);
    if (filter === "pawprints") return isPawprint(creation);
    if (filter === "images") return Boolean(creation.image_url) && !creation.video_url && !isPawprint(creation);
    if (filter === "models") return Boolean(creation.model_url);
    return true;
  }), [filter, sortedCreations]);

  const refresh = async () => {
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <main className="mx-auto w-full max-w-7xl px-4 pb-28 pt-7 sm:px-6">
      <div className="flex flex-col gap-5 rounded-[2rem] border border-outline-variant/35 bg-surface/90 p-5 shadow-xl backdrop-blur-xl sm:flex-row sm:items-end sm:justify-between sm:p-7">
        <div>
          <div className="flex items-center gap-2 text-primary"><LayoutGrid size={18} /><span className="text-xs font-black uppercase tracking-[.18em]">Your library</span></div>
          <h1 className="mt-2 text-3xl font-black tracking-tight text-on-surface sm:text-4xl">Creations</h1>
          <p className="mt-2 max-w-xl text-sm text-on-surface-variant">Every completed video and saved Pawprint lives here, alongside the images and models you created.</p>
        </div>
        <button type="button" onClick={refresh} disabled={refreshing} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-outline-variant/50 bg-surface-container-high px-4 text-sm font-bold text-on-surface transition hover:border-primary/40 hover:text-primary disabled:opacity-60">
          {refreshing ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />} Refresh library
        </button>
      </div>

      <div className="mt-6 flex flex-wrap gap-2" role="tablist" aria-label="Filter creations">
        {FILTERS.map((item) => (
          <button key={item.id} type="button" role="tab" aria-selected={filter === item.id} onClick={() => setFilter(item.id)} className={`min-h-10 rounded-full px-4 text-sm font-bold transition ${filter === item.id ? "bg-primary text-on-primary shadow-md" : "border border-outline-variant/45 bg-surface/80 text-on-surface-variant hover:border-primary/40 hover:text-primary"}`}>
            {item.label}
          </button>
        ))}
      </div>

      {visibleCreations.length === 0 ? (
        <section className="mt-7 rounded-[2rem] border border-dashed border-outline-variant/60 bg-surface/75 px-6 py-14 text-center shadow-sm">
          <PackageOpen className="mx-auto text-primary" size={34} />
          <h2 className="mt-4 text-xl font-black text-on-surface">Nothing here yet</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-on-surface-variant">Finished videos and saved Pawprints will appear automatically. Start with either studio below.</p>
          <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
            <button type="button" onClick={onOpenVideoCreator} className="min-h-11 rounded-full bg-primary px-5 text-sm font-black text-on-primary"><Film className="mr-2 inline" size={16} />Create a video</button>
            <button type="button" onClick={onOpenPawprints} className="min-h-11 rounded-full border border-primary/40 bg-primary/10 px-5 text-sm font-black text-primary"><PawPrint className="mr-2 inline" size={16} />Make a Pawprint</button>
          </div>
        </section>
      ) : (
        <section className="mt-7 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {visibleCreations.map((creation) => {
            const pawprint = isPawprint(creation);
            const hasVideo = Boolean(creation.video_url);
            const mediaUrl = creation.video_url || creation.image_url || creation.model_url;
            return (
              <article key={creation.id} className="group overflow-hidden rounded-[1.6rem] border border-outline-variant/35 bg-surface/90 shadow-lg transition hover:-translate-y-0.5 hover:border-primary/45">
                <div className="relative aspect-[4/3] overflow-hidden bg-surface-container-highest">
                  {hasVideo ? (
                    <video src={creation.video_url as string} controls playsInline preload="metadata" className="h-full w-full bg-black object-cover" />
                  ) : creation.image_url ? (
                    <img src={creation.image_url} alt={creationTitle(creation)} className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]" referrerPolicy="no-referrer" />
                  ) : (
                    <div className="flex h-full flex-col items-center justify-center gap-2 text-on-surface-variant"><ImageIcon size={28} /><span className="text-sm font-bold">3D model saved</span></div>
                  )}
                  <span className="absolute left-3 top-3 inline-flex items-center gap-1 rounded-full bg-black/65 px-2.5 py-1 text-[11px] font-black text-white backdrop-blur">
                    {hasVideo ? <Film size={13} /> : pawprint ? <PawPrint size={13} /> : creation.model_url ? <PackageOpen size={13} /> : <ImageIcon size={13} />}
                    {hasVideo ? "Video" : pawprint ? "Pawprint" : creation.model_url ? "3D model" : "Image"}
                  </span>
                </div>
                <div className="flex items-center gap-3 p-4">
                  <div className="min-w-0 flex-1"><h2 className="truncate text-base font-black text-on-surface">{creationTitle(creation)}</h2><p className="mt-1 text-xs text-on-surface-variant">{creationDate(creation.created_at)}</p></div>
                  {mediaUrl && <a href={mediaUrl} download className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary transition hover:bg-primary hover:text-on-primary" aria-label={`Download ${creationTitle(creation)}`}><Download size={17} /></a>}
                </div>
              </article>
            );
          })}
        </section>
      )}
    </main>
  );
}
