import React, { useEffect, useRef, useState } from "react";
import { UserProfile } from "../types";
import {
  MapPin, CloudSun, AlertTriangle, Sparkles, Upload, Users, ShieldCheck,
  Store as StoreIcon, Loader2, Navigation, Radio,
} from "lucide-react";
import {
  getCommunityParks, getCommunityWeather, getPetRecalls, getCommunityMemories,
  uploadCommunityMemory, CommunityPark, CommunityWeather, CommunityRecall, CommunityMemory,
} from "../api";

interface CommunityProps {
  userProfile: UserProfile;
}

type FeedItem =
  | { kind: "live"; url: string; id: string }
  | { kind: "memory"; url: string; id: string; caption: string | null };

const COMING_SOON = [
  {
    icon: Users,
    title: "Meet-ups in Virtual Dog Parks",
    desc: "Bring your avatar into shared, pre-built environments and hang out with other members' pets in real time.",
  },
  {
    icon: ShieldCheck,
    title: "Vetted Local Services",
    desc: "Community-sourced recommendations for groomers, sitters, and vets — every listing verified through our vetting process.",
  },
  {
    icon: StoreIcon,
    title: "Store Grand Opening",
    desc: "Our full merch store is almost here. Early adopters unlock exclusive launch-day discounts.",
  },
];

export default function Community({ userProfile }: CommunityProps) {
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [locState, setLocState] = useState<"idle" | "prompt" | "denied" | "ok">("idle");
  const [weather, setWeather] = useState<CommunityWeather | null>(null);
  const [parks, setParks] = useState<CommunityPark[]>([]);
  const [recalls, setRecalls] = useState<CommunityRecall[]>([]);
  const [memories, setMemories] = useState<CommunityMemory[]>([]);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [fact, setFact] = useState<string>("");
  const [uploading, setUploading] = useState(false);
  const [caption, setCaption] = useState("");
  const fileRef = useRef<HTMLInputElement | null>(null);

  // 1) Ask for location (opt-in per browser).
  const requestLocation = () => {
    if (!navigator.geolocation) { setLocState("denied"); return; }
    setLocState("prompt");
    navigator.geolocation.getCurrentPosition(
      (pos) => { setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude }); setLocState("ok"); },
      () => setLocState("denied"),
      { timeout: 8000 },
    );
  };
  useEffect(() => { requestLocation(); }, []);

  // 2) Local info once we have coordinates.
  useEffect(() => {
    if (!coords) return;
    getCommunityWeather(coords.lat, coords.lng).then(setWeather).catch(() => {});
    getCommunityParks(coords.lat, coords.lng).then(setParks).catch(() => {});
  }, [coords]);

  // 3) Recalls + saved memories (no location needed).
  useEffect(() => {
    getPetRecalls().then(setRecalls).catch(() => {});
    getCommunityMemories().then(setMemories).catch(() => {});
  }, []);

  // 4) Live pet curation: stream random dogs (dog.ceo) + rotating facts (dogapi.dog).
  useEffect(() => {
    let active = true;
    const pushDog = async () => {
      try {
        const r = await fetch("https://dog.ceo/api/breeds/image/random");
        const j = await r.json();
        if (active && j?.message) {
          setFeed((prev) => [{ kind: "live" as const, url: j.message, id: `${Date.now()}-${Math.random()}` }, ...prev].slice(0, 24));
        }
      } catch { /* ignore transient failures */ }
    };
    const pushFact = async () => {
      try {
        const r = await fetch("https://dogapi.dog/api/v2/facts?limit=1");
        const j = await r.json();
        const f = j?.data?.[0]?.attributes?.body;
        if (active && f) setFact(f);
      } catch { /* ignore */ }
    };
    pushDog(); pushDog(); pushDog(); pushFact();
    const imgInt = setInterval(pushDog, 4000);
    const factInt = setInterval(pushFact, 15000);
    return () => { active = false; clearInterval(imgInt); clearInterval(factInt); };
  }, []);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      setUploading(true);
      try {
        const mem = await uploadCommunityMemory(reader.result as string, caption);
        setMemories((prev) => [mem, ...prev]);
        setCaption("");
      } catch (err: any) {
        alert(err.message || "Upload failed.");
      } finally {
        setUploading(false);
        if (fileRef.current) fileRef.current.value = "";
      }
    };
    reader.readAsDataURL(file);
  };

  const boardItems: FeedItem[] = [
    ...memories.map((m) => ({ kind: "memory" as const, url: m.image_url, id: `m${m.id}`, caption: m.caption })),
    ...feed,
  ];

  return (
    <div className="w-full max-w-5xl mx-auto px-4 pt-20 md:pt-6 pb-28 animate-fade-in">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl md:text-3xl font-extrabold text-on-surface tracking-tight flex items-center gap-2">
          <Users className="text-primary" size={26} /> Community
        </h1>
        <p className="text-sm text-on-surface-variant">Local happenings, a live pet board, and what's coming next.</p>
      </div>

      {/* ---------------- Local Information ---------------- */}
      <section className="mb-8">
        <h2 className="text-xs font-black uppercase tracking-widest text-on-surface-variant mb-3 flex items-center gap-2">
          <MapPin size={13} className="text-primary" /> Local Information
        </h2>

        {locState === "denied" && (
          <div className="glass-panel border border-outline-variant/40 rounded-2xl p-5 mb-4 flex items-center justify-between gap-4">
            <p className="text-xs text-on-surface-variant">Enable location to see nearby parks and local weather.</p>
            <button onClick={requestLocation} className="shrink-0 flex items-center gap-1.5 bg-primary text-on-primary px-4 py-2 rounded-xl text-[11px] font-black uppercase tracking-wide hover:opacity-90 active:scale-95 transition-all cursor-pointer">
              <Navigation size={12} /> Enable
            </button>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Weather */}
          <div className="glass-panel border border-outline-variant/40 rounded-2xl p-5">
            <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-on-surface-variant mb-2">
              <CloudSun size={13} className="text-primary" /> Weather
            </div>
            {weather ? (
              <>
                <div className="text-3xl font-black text-on-surface font-mono">{weather.tempF}°<span className="text-base align-top">F</span></div>
                <div className="text-xs text-on-surface-variant">{weather.condition} · {weather.tempC}°C</div>
                <div className="text-[9px] text-on-surface-variant/70 mt-1">A good day for a walk? 🐾</div>
              </>
            ) : (
              <div className="text-xs text-on-surface-variant">{locState === "ok" ? "Loading…" : "Location needed"}</div>
            )}
          </div>

          {/* Parks */}
          <div className="glass-panel border border-outline-variant/40 rounded-2xl p-5 md:col-span-2">
            <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-on-surface-variant mb-2">
              <MapPin size={13} className="text-primary" /> Nearby Parks
            </div>
            {parks.length > 0 ? (
              <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
                {parks.map((p, i) => (
                  <div key={i} className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-on-surface truncate">{p.name}</div>
                      {p.address && <div className="text-[10px] text-on-surface-variant truncate">{p.address}</div>}
                    </div>
                    <div className="shrink-0 flex items-center gap-2">
                      {p.rating != null && <span className="text-[10px] font-black text-primary font-mono">★ {p.rating}</span>}
                      {p.open != null && (
                        <span className={`text-[9px] font-black uppercase px-1.5 py-0.5 rounded ${p.open ? "bg-emerald-500/15 text-emerald-600" : "bg-outline-variant/30 text-on-surface-variant"}`}>
                          {p.open ? "Open" : "Closed"}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-xs text-on-surface-variant">{locState === "ok" ? "Looking for parks nearby…" : "Enable location to find parks."}</div>
            )}
          </div>
        </div>

        {/* Recalls */}
        <div className="glass-panel border border-outline-variant/40 rounded-2xl p-5 mt-4">
          <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-on-surface-variant mb-3">
            <AlertTriangle size={13} className="text-amber-500" /> Pet Product Recalls
          </div>
          {recalls.length > 0 ? (
            <div className="space-y-3 max-h-56 overflow-y-auto pr-1">
              {recalls.map((r, i) => (
                <div key={i} className="border-l-2 border-amber-500/50 pl-3">
                  <div className="text-xs font-bold text-on-surface">{r.product}</div>
                  {r.reason && <div className="text-[11px] text-on-surface-variant leading-snug">{r.reason}</div>}
                  <div className="text-[9px] text-on-surface-variant/70 mt-0.5">
                    {r.company}{r.classification ? ` · ${r.classification}` : ""}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-xs text-on-surface-variant">No recent pet recalls found. That's good news! 🎉</div>
          )}
          <div className="text-[9px] text-on-surface-variant/60 mt-3">Source: U.S. FDA enforcement reports.</div>
        </div>
      </section>

      {/* ---------------- Live Pet Inspiration Board ---------------- */}
      <section className="mb-8">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs font-black uppercase tracking-widest text-on-surface-variant flex items-center gap-2">
            <Radio size={13} className="text-primary animate-pulse" /> Live Pet Inspiration Board
          </h2>
          <label className="shrink-0 flex items-center gap-1.5 bg-primary text-on-primary px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-wide hover:opacity-90 active:scale-95 transition-all cursor-pointer">
            {uploading ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
            {uploading ? "Sharing…" : "Add yours"}
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFile} disabled={uploading} />
          </label>
        </div>

        {fact && (
          <div className="glass-panel border border-outline-variant/40 rounded-2xl px-4 py-2.5 mb-3 flex items-center gap-2">
            <Sparkles size={13} className="text-primary shrink-0" />
            <p className="text-[11px] text-on-surface-variant italic">{fact}</p>
          </div>
        )}

        <input
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          placeholder="Add a caption for your next upload (optional)…"
          maxLength={200}
          className="w-full mb-3 bg-surface-container-high border border-outline-variant/40 rounded-xl px-3 py-2 text-xs text-on-surface placeholder:text-on-surface-variant/60 focus:outline-none focus:border-primary/50"
        />

        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
          {boardItems.length === 0 && (
            <div className="col-span-full text-xs text-on-surface-variant py-8 text-center">Curating live pets…</div>
          )}
          {boardItems.map((item) => (
            <div key={item.id} className="relative aspect-square rounded-xl overflow-hidden glass-panel border border-outline-variant/30 group">
              <img src={item.url} alt="Pet" loading="lazy" className="w-full h-full object-cover transition-transform group-hover:scale-110" />
              {item.kind === "memory" && (
                <span className="absolute top-1 left-1 bg-primary text-on-primary text-[8px] font-black uppercase px-1.5 py-0.5 rounded">Member</span>
              )}
              {item.kind === "memory" && item.caption && (
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-1.5">
                  <p className="text-[9px] text-white font-medium truncate">{item.caption}</p>
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* ---------------- Coming Soon ---------------- */}
      <section>
        <h2 className="text-xs font-black uppercase tracking-widest text-on-surface-variant mb-3 flex items-center gap-2">
          <Sparkles size={13} className="text-primary" /> Coming Soon
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {COMING_SOON.map((c, i) => {
            const Icon = c.icon;
            return (
              <div key={i} className="relative glass-panel border border-outline-variant/40 rounded-2xl p-5 overflow-hidden">
                <span className="absolute top-3 right-3 bg-primary/10 text-primary text-[8px] font-black uppercase tracking-wider rounded-full px-2 py-0.5">Soon</span>
                <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center mb-3">
                  <Icon size={18} />
                </div>
                <h3 className="text-sm font-extrabold text-on-surface mb-1">{c.title}</h3>
                <p className="text-[11px] text-on-surface-variant leading-relaxed">{c.desc}</p>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
